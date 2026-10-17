"use strict";

importScripts("./pdf-lib-1.17.1.min.js");

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 80;
const WATERMARK_PLACEMENTS = [
  [0.035, 0.035, "left", "bottom"],
  [0.965, 0.035, "right", "bottom"],
  [0.5, 0.035, "center", "bottom"],
  [0.035, 0.965, "left", "top"],
  [0.965, 0.965, "right", "top"],
  [0.5, 0.965, "center", "top"],
];

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
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Verified account details are required to watermark this PDF.");

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
    const maxWidth = Math.max(40, size.width * 0.46);
    let fontSize = Math.max(
      5,
      Math.min(8, Math.min(size.width, size.height) * 0.015),
    );
    while (
      lines.some((line) => textWidth(line, fontSize) > maxWidth) &&
      fontSize > 5
    )
      fontSize = Math.max(5, fontSize - 0.5);
    if (lines.some((line) => textWidth(line, fontSize) > maxWidth))
      throw new Error("Account details do not fit the watermark area.");

    const lineHeight = fontSize * 1.15;
    if (lines.length * lineHeight > size.height * 0.08)
      throw new Error("Account details do not fit the watermark area.");

    WATERMARK_PLACEMENTS.forEach(
      ([columnFraction, rowFraction, alignment, verticalAlignment]) => {
        const blockHeight = lineHeight * (lines.length - 1);
        const firstLineY =
          verticalAlignment === "top"
            ? size.height * rowFraction - fontSize
            : size.height * rowFraction + blockHeight;
        lines.forEach((line, index) => {
          const measuredWidth = textWidth(line, fontSize);
          let x = size.width * columnFraction;
          if (alignment === "left") x += size.width * 0.012;
          if (alignment === "right")
            x -= measuredWidth + size.width * 0.012;
          if (alignment === "center") x -= measuredWidth / 2;
          page.drawText(line, {
            x,
            y: firstLineY - index * lineHeight,
            size: fontSize,
            font,
            color: PDFLib.rgb(0.24, 0.24, 0.24),
            opacity: 0.18,
            rotate: PDFLib.degrees(0),
          });
        });
      },
    );
  });

  const watermarkedBytes = await pdf.save({ useObjectStreams: true });
  if (
    watermarkedBytes.byteLength < 5 ||
    watermarkedBytes.byteLength > MAX_OUTPUT_BYTES ||
    String.fromCharCode(...watermarkedBytes.slice(0, 5)) !== "%PDF-"
  )
    throw new Error("The watermarked PDF is invalid or exceeds the 12 MiB limit.");
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
      message: String(error?.message || "The PDF could not be watermarked."),
    });
  }
};
