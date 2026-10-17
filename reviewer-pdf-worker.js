"use strict";

importScripts("./pdf-lib-1.17.1.min.js");

self.postMessage({ status: "ready" });

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 80;

function sanitizeWatermarkText(value, maxLength) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function createWatermarkedPdf(sourceBuffer, identity) {
  if (typeof PDFLib === "undefined" || !PDFLib.PDFDocument)
    throw new Error("The PDF processor could not be loaded.");
  const source = new Uint8Array(sourceBuffer);
  if (
    source.byteLength < 5 ||
    source.byteLength > MAX_SOURCE_BYTES ||
    String.fromCharCode(...source.slice(0, 5)) !== "%PDF-"
  )
    throw new Error("The source PDF is invalid or exceeds the 8 MiB limit.");

  const fullName = sanitizeWatermarkText(identity?.fullName, 160)
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const email = sanitizeWatermarkText(identity?.email, 254);
  const downloadFileName = sanitizeWatermarkText(
    identity?.downloadFileName,
    255,
  );
  if (
    !fullName ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !/^[^<>:"/\\|?*\u0000-\u001f]{1,255}\.pdf$/i.test(downloadFileName)
  )
    throw new Error(
      "Verified account details and backend filename are required to prepare this PDF.",
    );

  let pdf;
  try {
    pdf = await PDFLib.PDFDocument.load(source, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch {
    throw new Error("The source PDF could not be safely processed.");
  }

  const pages = pdf.getPages();
  if (!pages.length) throw new Error("The PDF has no pages.");
  if (pages.length > MAX_PAGES)
    throw new Error("The PDF exceeds the 80-page processing limit.");

  const lines = [fullName, email];
  const font = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const widthCache = new Map();
  const textWidth = (text, size) => {
    const key = `${size}\n${text}`;
    if (!widthCache.has(key))
      widthCache.set(key, font.widthOfTextAtSize(text, size));
    return widthCache.get(key);
  };

  pages.forEach((page) => {
    const size = page.getSize();
    const watermarkTextLines = [];
    let fontSize = Math.max(
      6,
      Math.min(12, Math.min(size.width, size.height) * 0.02),
    );
    const getFontSize = (maxWidth, maximum = fontSize, minimum = 3.5) => {
      let selectedFontSize = maximum;
      while (
        lines.some((line) => textWidth(line, selectedFontSize) > maxWidth) &&
        selectedFontSize > minimum
      )
        selectedFontSize = Math.max(minimum, selectedFontSize - 0.5);
      if (lines.some((line) => textWidth(line, selectedFontSize) > maxWidth))
        throw new Error("Account details exceed the supported PDF limits.");
      return selectedFontSize;
    };
    const drawBlock = (centerX, centerY, angle, blockFontSize) => {
      const lineHeight = blockFontSize * 1.15;
      const radians = (angle * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      lines.forEach((line, index) => {
        const localX = -textWidth(line, blockFontSize) / 2;
        const localY =
          ((lines.length - 1) / 2 - index) * lineHeight -
          blockFontSize * 0.35;
        watermarkTextLines.push({
          line,
          size: blockFontSize,
          matrix: [
            cos,
            sin,
            -sin,
            cos,
            centerX + localX * cos - localY * sin,
            centerY + localX * sin + localY * cos,
          ],
        });
      });
    };

    const shortSide = Math.min(size.width, size.height);
    const interiorFontSize = getFontSize(
      shortSide * 0.4,
      fontSize,
      5.5,
    );
    const perimeterFontSize = getFontSize(
      Math.min(size.width * 0.32, size.height * 0.32),
      interiorFontSize * 0.8,
      3.5,
    );
    const smallFontSize = getFontSize(
      Math.min(size.width * 0.32, size.height * 0.32),
      perimeterFontSize * 0.7,
      2.5,
    );
    const perimeterMargin = perimeterFontSize * 2.5;
    [0.17, 0.5, 0.83].forEach((x) => {
      drawBlock(
        size.width * x,
        size.height - perimeterMargin,
        0,
        perimeterFontSize,
      );
      drawBlock(size.width * x, perimeterMargin, 0, perimeterFontSize);
    });
    [0.17, 0.5, 0.83].forEach((y) => {
      drawBlock(
        perimeterMargin,
        size.height * y,
        90,
        perimeterFontSize,
      );
      drawBlock(
        size.width - perimeterMargin,
        size.height * y,
        90,
        perimeterFontSize,
      );
    });

    const interiorTextWidth = Math.max(
      ...lines.map((line) => textWidth(line, interiorFontSize)),
    );
    const interiorLineHeight = interiorFontSize * 1.15;
    const diagonalAngle = -25;
    const diagonalRadians = (diagonalAngle * Math.PI) / 180;
    const diagonalHeight =
      interiorTextWidth * Math.abs(Math.sin(diagonalRadians)) +
      interiorLineHeight * Math.abs(Math.cos(diagonalRadians));
    const targetRowSpacing = Math.max(
      shortSide * 0.18,
      diagonalHeight * 1.3,
    );
    const firstRowY = size.height * 0.12;
    const lastRowY = size.height * 0.88;
    const rowCount = Math.max(
      2,
      Math.floor((lastRowY - firstRowY) / targetRowSpacing) + 1,
    );
    const rowSpacing = (lastRowY - firstRowY) / (rowCount - 1);

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const y = firstRowY + rowIndex * rowSpacing;
      [0.23, 0.77].forEach((x) => {
        drawBlock(
          size.width * x,
          y,
          diagonalAngle,
          interiorFontSize,
        );
      });
      if (rowIndex < rowCount - 1) {
        const centerY = y + rowSpacing / 2;
        drawBlock(size.width * 0.5, centerY, 0, interiorFontSize);
        [0.12, 0.88].forEach((x) => {
          drawBlock(size.width * x, centerY, 0, smallFontSize);
        });
      }
      drawBlock(size.width * 0.5, y, 0, smallFontSize);
    }

    page.setFont(font);
    const [, fontKey] = page.getFont();
    const opacityKey = page.maybeEmbedGraphicsState({ opacity: 0.18 });
    const operators = [
      PDFLib.pushGraphicsState(),
      PDFLib.setGraphicsState(opacityKey),
      PDFLib.beginText(),
      PDFLib.setFillingColor(PDFLib.rgb(0.24, 0.24, 0.24)),
    ];
    watermarkTextLines.forEach(({ line, size: blockFontSize, matrix }) => {
      operators.push(
        PDFLib.setFontAndSize(fontKey, blockFontSize),
        PDFLib.setTextMatrix(...matrix),
        PDFLib.showText(font.encodeText(line)),
      );
    });
    operators.push(PDFLib.endText(), PDFLib.popGraphicsState());
    page.pushOperators(...operators);
  });

  pdf.setAuthor(fullName);
  pdf.setTitle(downloadFileName);
  pdf.setSubject(email);
  pdf.setKeywords([fullName, email]);
  const watermarkedBytes = await pdf.save({ useObjectStreams: true });
  if (
    watermarkedBytes.byteLength < 5 ||
    watermarkedBytes.byteLength > MAX_OUTPUT_BYTES ||
    String.fromCharCode(...watermarkedBytes.slice(0, 5)) !== "%PDF-"
  )
    throw new Error("The prepared PDF is invalid or exceeds the 12 MiB limit.");
  return watermarkedBytes;
}

self.onmessage = async (event) => {
  try {
    const bytes = await createWatermarkedPdf(
      event.data?.sourceBuffer,
      event.data?.identity,
    );
    const resultBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    self.postMessage({ status: "success", resultBuffer }, [resultBuffer]);
  } catch (error) {
    self.postMessage({
      status: "error",
      message: String(error?.message || "The PDF could not be prepared."),
    });
  }
};
