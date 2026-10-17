"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(repositoryRoot, "reviewer-pdf-service", "vendor", "pdf-lib-1.17.1.min.js");
const workerPath = path.join(repositoryRoot, "reviewer-pdf-worker.js");

function createRuntime() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
  });
  context.self = {
    postMessage(message) {
      context.__workerResult = message;
    },
  };
  context.importScripts = (assetPath) => {
    assert.equal(assetPath, "./pdf-lib-1.17.1.min.js");
    vm.runInContext(fs.readFileSync(bundlePath, "utf8"), context, {
      filename: "pdf-lib-1.17.1.min.js",
    });
  };
  vm.runInContext(fs.readFileSync(workerPath, "utf8"), context, {
    filename: "reviewer-pdf-worker.js",
  });
  return context;
}

async function buildPdf(context, dimensions) {
  const pdf = await context.PDFLib.PDFDocument.create();
  const font = await pdf.embedFont(context.PDFLib.StandardFonts.Helvetica);
  const runtimeDimensions = vm.runInContext(JSON.stringify(dimensions), context);
  for (const [index, size] of runtimeDimensions.entries()) {
    const page = pdf.addPage(size);
    page.drawText(`Private proof page ${index + 1}`, {
      x: 20,
      y: 50,
      font,
      size: 14,
    });
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function runWorker(context, sourceBytes, identity) {
  context.__workerResult = null;
  const sourceBuffer = sourceBytes.buffer.slice(
    sourceBytes.byteOffset,
    sourceBytes.byteOffset + sourceBytes.byteLength,
  );
  await context.self.onmessage({ data: { sourceBuffer, identity } });
  return context.__workerResult;
}

async function readPageText(context, bytes, pageIndex = 0) {
  context.__resultBytes = Array.from(bytes);
  context.__pageIndex = pageIndex;
  const text = await vm.runInContext(
    `(async function () {
      var pdf = await PDFLib.PDFDocument.load(Uint8Array.from(__resultBytes));
      var page = pdf.getPages()[__pageIndex];
      var contents = pdf.context.lookup(page.node.Contents());
      var streams = contents instanceof PDFLib.PDFArray
        ? contents.asArray()
        : [page.node.Contents()];
      return streams.map(function (reference) {
        var stream = pdf.context.lookup(reference);
        var decoded = PDFLib.decodePDFRawStream(stream).decode();
        var source = Array.from(decoded, function (byte) {
          return String.fromCharCode(byte);
        }).join("");
        return source.replace(/<([0-9a-fA-F]+)> Tj/g, function (_match, hex) {
          var text = "";
          for (var index = 0; index + 1 < hex.length; index += 2)
            text += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
          return text;
        });
      }).join("\\n");
    })()`,
    context,
  );
  delete context.__resultBytes;
  delete context.__pageIndex;
  return text;
}

async function readPageTextMatrices(context, bytes, pageIndex = 0) {
  context.__resultBytes = Array.from(bytes);
  context.__pageIndex = pageIndex;
  const matrices = await vm.runInContext(
    `(async function () {
      var pdf = await PDFLib.PDFDocument.load(Uint8Array.from(__resultBytes));
      var page = pdf.getPages()[__pageIndex];
      var contents = pdf.context.lookup(page.node.Contents());
      var streams = contents instanceof PDFLib.PDFArray
        ? contents.asArray()
        : [page.node.Contents()];
      return streams.map(function (reference) {
        var stream = pdf.context.lookup(reference);
        var decoded = PDFLib.decodePDFRawStream(stream).decode();
        return Array.from(decoded, function (byte) {
          return String.fromCharCode(byte);
        }).join("");
      }).join("\\n").match(/[-\\d.]+\\s+[-\\d.]+\\s+[-\\d.]+\\s+[-\\d.]+\\s+[-\\d.]+\\s+[-\\d.]+\\s+Tm/g) || [];
    })()`,
    context,
  );
  delete context.__resultBytes;
  delete context.__pageIndex;
  return matrices;
}

async function readPageOperatorCounts(context, bytes, pageIndex = 0) {
  context.__resultBytes = Array.from(bytes);
  context.__pageIndex = pageIndex;
  const counts = await vm.runInContext(
    `(async function () {
      var pdf = await PDFLib.PDFDocument.load(Uint8Array.from(__resultBytes));
      var page = pdf.getPages()[__pageIndex];
      var contents = pdf.context.lookup(page.node.Contents());
      var streams = contents instanceof PDFLib.PDFArray
        ? contents.asArray()
        : [page.node.Contents()];
      var source = streams.map(function (reference) {
        var stream = pdf.context.lookup(reference);
        var decoded = PDFLib.decodePDFRawStream(stream).decode();
        return Array.from(decoded, function (byte) {
          return String.fromCharCode(byte);
        }).join("");
      }).join("\\n");
      return {
        textObjects: (source.match(/\\bBT\\b/g) || []).length,
        graphicsStatePushes: (source.match(/\\bq\\b/g) || []).length,
      };
    })()`,
    context,
  );
  delete context.__resultBytes;
  delete context.__pageIndex;
  return counts;
}

async function readPdfMetadata(context, bytes) {
  context.__resultBytes = Array.from(bytes);
  const metadata = await vm.runInContext(
    `(async function () {
      var pdf = await PDFLib.PDFDocument.load(Uint8Array.from(__resultBytes));
      return {
        author: pdf.getAuthor(),
        title: pdf.getTitle(),
        subject: pdf.getSubject(),
        keywords: pdf.getKeywords(),
      };
    })()`,
    context,
  );
  delete context.__resultBytes;
  return metadata;
}

const identity = {
  fullName: "Test Reviewer | Dept",
  email: "Test.Reviewer@Example.com",
  downloadFileName: "REVIEWER Test Reviewer PDF TEST.pdf",
};

test("browser worker applies the diagonal, horizontal, and side watermark pattern without mutating source", async () => {
  const runtime = createRuntime();
  const original = await buildPdf(runtime, [
    [612, 792],
    [792, 612],
    [420, 900],
  ]);
  const originalHash = crypto.createHash("sha256").update(original).digest("hex");
  const result = await runWorker(runtime, original, identity);

  assert.equal(result.status, "success");
  const watermarked = new Uint8Array(result.resultBuffer);
  assert.ok(watermarked.byteLength > 0);
  assert.ok(watermarked.byteLength <= 12 * 1024 * 1024);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await readPdfMetadata(runtime, watermarked))),
    {
      author: "Test Reviewer Dept",
      title: identity.downloadFileName,
      subject: identity.email,
      keywords: "Test Reviewer Dept Test.Reviewer@Example.com",
    },
    "the PDF metadata should include the verified account name and email",
  );
  const pageWatermarkCounts = [];
  const metricPdf = await runtime.PDFLib.PDFDocument.create();
  const metricFont = await metricPdf.embedFont(
    runtime.PDFLib.StandardFonts.HelveticaBold,
  );
  const cleanName = "Test Reviewer Dept";
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    const pageText = await readPageText(runtime, watermarked, pageIndex);
    assert.doesNotMatch(pageText, /AUTHORIZED USER:|Student Portal|\|/);
    const matrices = await readPageTextMatrices(
      runtime,
      watermarked,
      pageIndex,
    );
    const sourceOperatorCounts = await readPageOperatorCounts(
      runtime,
      original,
      pageIndex,
    );
    const operatorCounts = await readPageOperatorCounts(
      runtime,
      watermarked,
      pageIndex,
    );
    assert.equal(
      operatorCounts.textObjects - sourceOperatorCounts.textObjects,
      1,
      "batch all watermark text and shared graphics state into one PDF text object per page",
    );
    const parsedMatrices = matrices.map((matrix) => {
      const [a, b, , , x, y] = matrix.split(/\s+/).map(Number);
      return {
        rotation: Math.round((Math.atan2(b, a) * 180) / Math.PI),
        x,
        y,
      };
    });
    const rotations = parsedMatrices.map(({ rotation }) => rotation);
    const horizontalTextLines = rotations.filter((rotation) => rotation === 0)
      .length - 1;
    const verticalTextLines = rotations.filter(
      (rotation) => Math.abs(rotation) === 90,
    ).length;
    const diagonalMatrices = parsedMatrices.filter(
      ({ rotation }) => Math.abs(rotation) === 25,
    );
    const diagonalTextLines = diagonalMatrices.length;
    const watermarkTextLines =
      horizontalTextLines + verticalTextLines + diagonalTextLines;
    const watermarkCount = watermarkTextLines / 2;
    assert.ok(
      operatorCounts.graphicsStatePushes -
        sourceOperatorCounts.graphicsStatePushes <
        watermarkCount,
      "use far fewer graphics-state setups than watermark blocks",
    );
    assert.equal(watermarkTextLines % 2, 0);
    assert.equal(pageText.split("Test Reviewer Dept").length - 1, watermarkCount);
    assert.equal(
      pageText.split("Test.Reviewer@Example.com").length - 1,
      watermarkCount,
    );
    assert.ok(horizontalTextLines >= 14, "include top/bottom and interior horizontal marks");
    assert.equal(verticalTextLines, 12, "place three vertical marks on each side");
    assert.ok(diagonalTextLines >= 8, "begin and end the diagonal pattern with a pair");
    assert.ok(
      rotations.filter((rotation) => Math.abs(rotation) === 25)
        .every((rotation) => rotation === -25),
      "use a shallower, consistent diagonal angle",
    );
    const diagonalRows = new Map();
    const pageWidth = [612, 792, 420][pageIndex];
    const diagonalColumns = [];
    for (let index = 0; index < diagonalMatrices.length; index += 2) {
      const first = diagonalMatrices[index];
      const second = diagonalMatrices[index + 1];
      const rowCenterY = ((first.y + second.y) / 2).toFixed(1);
      diagonalRows.set(
        rowCenterY,
        (diagonalRows.get(rowCenterY) || 0) + 2,
      );
      const nameWidthAtUnitSize = metricFont.widthOfTextAtSize(
        cleanName,
        1,
      );
      const emailWidthAtUnitSize = metricFont.widthOfTextAtSize(
        identity.email,
        1,
      );
      const unitWidthDifference = Math.abs(
        nameWidthAtUnitSize - emailWidthAtUnitSize,
      );
      const size = Math.hypot(
        first.x - second.x,
        first.y - second.y,
      ) / Math.hypot(unitWidthDifference / 2, 1.15);
      const averageTextWidth = (
        nameWidthAtUnitSize +
        emailWidthAtUnitSize
      ) / 2;
      const textWidth = averageTextWidth * size;
      const angle = (-25 * Math.PI) / 180;
      diagonalColumns.push(
        ((first.x + second.x) / 2 +
          (textWidth / 2) * Math.cos(angle) -
          (size * 0.35) * Math.sin(angle)) /
          pageWidth,
      );
    }
    assert.ok(
      [...diagonalRows.values()].every((lineCount) => lineCount === 4),
      "each staggered diagonal row contains exactly two watermarks",
    );
    assert.ok(
      diagonalColumns.every(
        (x, index) =>
          Math.abs(x - (index % 2 === 0 ? 0.23 : 0.77)) < 0.01,
      ),
      "keep diagonal watermarks in the left and right columns, never the middle",
    );
    const pageHeight = [792, 612, 900][pageIndex];
    const diagonalYPositions = diagonalMatrices.map(({ y }) => y);
    assert.ok(
      Math.min(...diagonalYPositions) < 0.17 * pageHeight &&
        Math.max(...diagonalYPositions) > 0.83 * pageHeight,
      "spread diagonal rows across the interior from near the top to near the bottom",
    );
    assert.equal(
      horizontalTextLines,
      12 + 2 * (diagonalRows.size + 3 * (diagonalRows.size - 1)),
      "include horizontal accents between diagonal pairs and beside every large centerline mark",
    );
    const horizontalMatrices = parsedMatrices.filter(
      ({ rotation }) => rotation === 0,
    ).slice(1);
    const horizontalCenters = [];
    for (let index = 0; index < horizontalMatrices.length; index += 2) {
      horizontalCenters.push(
        (horizontalMatrices[index].y + horizontalMatrices[index + 1].y) / 2,
      );
    }
    assert.equal(
      horizontalCenters.filter((y) => y > 0.9 * pageHeight).length,
      3,
      "place three small horizontal watermarks at the top edge",
    );
    assert.equal(
      horizontalCenters.filter((y) => y < 0.1 * pageHeight).length,
      3,
      "place three small horizontal watermarks at the bottom edge",
    );
    const interiorHorizontalCenters = horizontalCenters.filter(
      (y) => y > 0.1 * pageHeight && y < 0.9 * pageHeight,
    );
    assert.ok(
      Math.min(...interiorHorizontalCenters) < 0.25 * pageHeight &&
        Math.max(...interiorHorizontalCenters) > 0.75 * pageHeight,
      "spread centerline watermarks through the full interior height",
    );
    const sideMatrices = parsedMatrices.filter(
      ({ rotation }) => Math.abs(rotation) === 90,
    );
    assert.ok(
      sideMatrices.filter(({ x }) => x < 0.12 * pageWidth).length === 6 &&
        sideMatrices.filter(({ x }) => x > 0.88 * pageWidth).length === 6,
      "place three vertical perimeter watermarks along both edge-aligned side rails",
    );
    const sideCenters = new Map();
    for (let index = 0; index < sideMatrices.length; index += 2) {
      const centerY = (
        (sideMatrices[index].y + sideMatrices[index + 1].y) / 2
      ).toFixed(1);
      sideCenters.set(centerY, (sideCenters.get(centerY) || 0) + 2);
    }
    assert.equal(sideCenters.size, 3);
    assert.ok(
      [...sideCenters.values()].every((lineCount) => lineCount === 4),
      "evenly distribute three vertical watermarks down each side",
    );
    pageWatermarkCounts.push(watermarkCount);
  }
  assert.notEqual(
    pageWatermarkCounts[0],
    pageWatermarkCounts[1],
    "the interior watermark density should adapt to portrait and landscape page dimensions",
  );
  assert.equal(
    crypto.createHash("sha256").update(original).digest("hex"),
    originalHash,
    "watermarking must not modify the source buffer",
  );
});

test("browser worker rejects invalid identity, malformed PDFs, and excessive pages", async () => {
  const runtime = createRuntime();
  const source = await buildPdf(runtime, [[612, 792]]);

  const missingIdentity = await runWorker(runtime, source, {
    fullName: "",
    email: "reviewer@example.com",
    downloadFileName: "REVIEWER Protected PDF REVIEWER.pdf",
  });
  assert.equal(missingIdentity.status, "error");
  assert.match(missingIdentity.message, /Verified account details/);

  const missingBackendFilename = await runWorker(runtime, source, {
    fullName: identity.fullName,
    email: identity.email,
  });
  assert.equal(missingBackendFilename.status, "error");
  assert.match(missingBackendFilename.message, /backend filename/);

  const malformed = await runWorker(runtime, new Uint8Array([1, 2, 3, 4, 5]), identity);
  assert.equal(malformed.status, "error");

  const oversizedSource = new Uint8Array(8 * 1024 * 1024 + 1);
  oversizedSource.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const oversized = await runWorker(runtime, oversizedSource, identity);
  assert.equal(oversized.status, "error");
  assert.match(oversized.message, /8 MiB limit/);

  const tooManyPages = await buildPdf(
    runtime,
    Array.from({ length: 81 }, () => [612, 792]),
  );
  const excessive = await runWorker(runtime, tooManyPages, identity);
  assert.equal(excessive.status, "error");
  assert.match(excessive.message, /80-page processing limit/);
});

test("browser worker processes a mixed-orientation 20-page PDF", async () => {
  const runtime = createRuntime();
  const original = await buildPdf(
    runtime,
    Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? [612, 792] : [792, 612],
    ),
  );
  assert.ok(original.byteLength < 8 * 1024 * 1024);

  const startedAt = performance.now();
  const result = await runWorker(runtime, original, identity);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.status, "success");
  assert.ok(elapsedMs < 30000, `20-page browser worker run took ${elapsedMs} ms`);
});
