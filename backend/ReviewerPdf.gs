var MRH_REVIEWER_PDF_MAX_BYTES = 2 * 1024 * 1024;
var MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
var MRH_REVIEWER_PDF_MAX_PAGES = 80;
var setTimeout =
  typeof setTimeout === "function"
    ? setTimeout
    : function (callback) {
        callback();
        return 0;
      };

function reviewerPdfWatermarkIdentity_(account, verifiedEmail) {
  var email = String(verifiedEmail || "").trim();
  var fullName = [
    account && account.firstName,
    account && account.middleInitial,
    account && account.lastName,
  ].filter(function (part) {
    return String(part || "").trim();
  }).join(" ");
  fullName = String(fullName)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName)
    throw reviewerPdfError_("Verified account details are required.", "BAD_REQUEST");
  return { fullName: fullName, email: email };
}

function reviewerPdfError_(message, code) {
  var error = new Error(message);
  error.code = code;
  error.reviewerPdfSafe = true;
  return error;
}

function reviewerPdfSafeText_(value, maxLength) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function watermarkReviewerPdfBytes_(sourceBytes, identity) {
  if (typeof PDFLib === "undefined" || !PDFLib.PDFDocument)
    throw reviewerPdfError_("The bundled PDF processor is unavailable.", "PDF_LIBRARY_UNAVAILABLE");
  if (
    !sourceBytes ||
    !sourceBytes.length ||
    sourceBytes.length > MRH_REVIEWER_PDF_MAX_BYTES
  )
    throw reviewerPdfError_("The source PDF exceeds the 2 MiB limit.", "FILE_TOO_LARGE");

  var unsignedBytes = Uint8Array.from(sourceBytes, function (byte) {
    return Number(byte) & 255;
  });
  if (
    unsignedBytes.length < 5 ||
    String.fromCharCode.apply(null, Array.from(unsignedBytes.slice(0, 5))) !== "%PDF-"
  )
    throw reviewerPdfError_("The source is not a supported PDF.", "INVALID_PDF");

  var email = reviewerPdfSafeText_(identity && identity.email, 254);
  var fullName = reviewerPdfSafeText_(identity && identity.fullName, 160)
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw reviewerPdfError_("Verified account details are required.", "BAD_REQUEST");
  var watermarkLines = [fullName, email];
  var pdf;
  try {
    pdf = await PDFLib.PDFDocument.load(unsignedBytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (error) {
    throw reviewerPdfError_("The source PDF could not be safely processed.", "INVALID_PDF");
  }
  var pages = pdf.getPages();
  if (!pages.length)
    throw reviewerPdfError_("The PDF has no pages.", "INVALID_PDF");
  if (pages.length > MRH_REVIEWER_PDF_MAX_PAGES)
    throw reviewerPdfError_("The PDF exceeds the 80-page processing limit.", "TOO_MANY_PAGES");

  try {
    var font = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var textWidthCache = Object.create(null);
    function textWidth(line, fontSize) {
      var key = fontSize + "\n" + line;
      if (!Object.prototype.hasOwnProperty.call(textWidthCache, key))
        textWidthCache[key] = font.widthOfTextAtSize(line, fontSize);
      return textWidthCache[key];
    }
    var angle = (28 * Math.PI) / 180;
    var cosine = Math.cos(angle);
    var sine = Math.sin(angle);
    pages.forEach(function (page) {
      var size = page.getSize();
      var maxWidth = Math.max(
        40,
        Math.min(size.width, size.height) * 0.3,
      );
      var fontSize = Math.max(
        8,
        Math.min(18, Math.min(size.width, size.height) * 0.04),
      );
      while (
        watermarkLines.some(function (line) {
          return textWidth(line, fontSize) > maxWidth;
        }) &&
        fontSize > 8
      ) {
        fontSize -= 1;
      }
      var lines = watermarkLines.slice();
      if (
        lines.some(function (line) {
          return textWidth(line, fontSize) > maxWidth;
        })
      )
        throw reviewerPdfError_("Account details do not fit the watermark area.", "WATERMARK_TEXT_TOO_LONG");
      var blockHeight = lines.length * fontSize * 1.25;
      if (blockHeight > size.height * 0.25)
        throw reviewerPdfError_("Account details do not fit the watermark area.", "WATERMARK_TEXT_TOO_LONG");
      [
        [0.25, 0.14],
        [0.75, 0.14],
        [0.32, 0.26],
        [0.25, 0.38],
        [0.75, 0.38],
        [0.68, 0.5],
        [0.25, 0.62],
        [0.75, 0.62],
        [0.32, 0.74],
        [0.25, 0.86],
        [0.75, 0.86],
      ].forEach(function (placement) {
        var columnFraction = placement[0];
        var rowFraction = placement[1];
        lines.forEach(function (line, index) {
          var measuredWidth = textWidth(line, fontSize);
          var lineOffset = ((lines.length - 1) / 2 - index) * fontSize * 1.25;
          page.drawText(line, {
            x: size.width * columnFraction - measuredWidth * cosine / 2,
            y: size.height * rowFraction + lineOffset + measuredWidth * sine / 2,
            size: fontSize,
            font: font,
            color: PDFLib.rgb(0.24, 0.24, 0.24),
            opacity: 0.18,
            rotate: PDFLib.degrees(-28),
          });
        });
      });
    });
  } catch (error) {
    if (error && error.code) throw error;
    throw reviewerPdfError_("The PDF could not be watermarked.", "PDF_PROCESSING_FAILED");
  }

  var savedBytes;
  try {
    savedBytes = await pdf.save({ useObjectStreams: true });
  } catch (error) {
    throw reviewerPdfError_("The watermarked PDF could not be created.", "PDF_PROCESSING_FAILED");
  }
  if (
    !savedBytes.length ||
    savedBytes.length > MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES ||
    String.fromCharCode.apply(null, Array.from(savedBytes.slice(0, 5))) !== "%PDF-"
  )
    throw reviewerPdfError_("The watermarked PDF exceeds the 4 MiB delivery limit.", "OUTPUT_TOO_LARGE");
  return {
    bytes: Array.prototype.map.call(savedBytes, function (byte) {
      return byte > 127 ? byte - 256 : byte;
    }),
    pageCount: pages.length,
  };
}

function reviewerPdfStreamText_(pdf, streamReference) {
  var stream = pdf.context.lookup(streamReference);
  var decoded = PDFLib.decodePDFRawStream(stream).decode();
  var text = "";
  for (var offset = 0; offset < decoded.length; offset += 8192) {
    text += String.fromCharCode.apply(
      null,
      decoded.subarray(offset, Math.min(offset + 8192, decoded.length)),
    );
  }
  return text.replace(/<([0-9a-fA-F]+)> Tj/g, function (_match, hex) {
    var result = "";
    for (var index = 0; index + 1 < hex.length; index += 2)
      result += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
    return result;
  });
}

async function verifyReviewerPdfWatermarks_(bytes, identity) {
  var fullName = reviewerPdfSafeText_(identity && identity.fullName, 160);
  var email = reviewerPdfSafeText_(identity && identity.email, 254);
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw reviewerPdfError_("Verified account details are required.", "BAD_REQUEST");
  var pdf = await PDFLib.PDFDocument.load(
    Uint8Array.from(bytes, function (byte) { return Number(byte) & 255; }),
    { ignoreEncryption: false },
  );
  var pagesWithWatermarks = 0;
  pdf.getPages().forEach(function (page) {
    var contents = pdf.context.lookup(page.node.Contents());
    var streams = contents instanceof PDFLib.PDFArray
      ? contents.asArray()
      : [page.node.Contents()];
    var fullNameCount = 0;
    var emailCount = 0;
    streams.forEach(function (stream) {
      var streamText = reviewerPdfStreamText_(pdf, stream);
      fullNameCount += streamText.split(fullName).length - 1;
      emailCount += streamText.split(email).length - 1;
    });
    if (
      fullNameCount < 11 ||
      emailCount < 11
    )
      throw reviewerPdfError_("A page is missing the verified identity watermark.", "WATERMARK_VERIFICATION_FAILED");
    pagesWithWatermarks += 1;
  });
  return { pageCount: pdf.getPageCount(), pagesWithWatermarks: pagesWithWatermarks };
}
