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

const identity = {
  fullName: "Test Reviewer | Dept",
  email: "Test.Reviewer@Example.com",
};

test("browser worker watermarks each page in six horizontal positions without mutating source", async () => {
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
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    const pageText = await readPageText(runtime, watermarked, pageIndex);
    assert.equal(pageText.split("Test Reviewer Dept").length - 1, 6);
    assert.equal(pageText.split("Test.Reviewer@Example.com").length - 1, 6);
    assert.doesNotMatch(pageText, /AUTHORIZED USER:|Student Portal|\|/);
  }
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
  });
  assert.equal(missingIdentity.status, "error");
  assert.match(missingIdentity.message, /Verified account details/);

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
