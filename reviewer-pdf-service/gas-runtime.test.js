"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(
  __dirname,
  "vendor",
  "pdf-lib-1.17.1.min.js",
);
const helperPath = path.join(repositoryRoot, "backend", "ReviewerPdf.gs");
const browserWorkerPath = path.join(repositoryRoot, "reviewer-pdf-worker.js");

function createRuntime() {
  const context = vm.createContext({
    console,
    Date,
    Math,
    Promise,
  });
  vm.runInContext(fs.readFileSync(bundlePath, "utf8"), context, {
    filename: "pdf-lib-1.17.1.min.js",
  });
  vm.runInContext(fs.readFileSync(helperPath, "utf8"), context, {
    filename: "ReviewerPdf.gs",
  });
  return context;
}

function createBrowserWorkerRuntime(messages) {
  const context = vm.createContext({
    console,
    Date,
    Math,
    Promise,
    Uint8Array,
    Map,
    importScripts: (scriptPath) => {
      assert.equal(scriptPath, "./pdf-lib-1.17.1.min.js");
      vm.runInContext(fs.readFileSync(bundlePath, "utf8"), context, {
        filename: "pdf-lib-1.17.1.min.js",
      });
    },
  });
  context.self = context;
  context.postMessage = (message) => messages.push(message);
  vm.runInContext(fs.readFileSync(browserWorkerPath, "utf8"), context, {
    filename: "reviewer-pdf-worker.js",
  });
  return context;
}

async function buildPdf(context, dimensions, fillerLength = 0) {
  const PDFLib = context.PDFLib;
  const pdf = await PDFLib.PDFDocument.create();
  const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  const runtimeDimensions = vm.runInContext(
    JSON.stringify(dimensions),
    context,
  );
  let seed = 984231;
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const filler = Array.from({ length: fillerLength }, () => {
    seed = (seed * 48271) % 2147483647;
    return alphabet[seed % alphabet.length];
  }).join("");
  runtimeDimensions.forEach((size, index) => {
    const page = pdf.addPage(size);
    page.drawText(`Private proof page ${index + 1}`, {
      x: 20,
      y: 50,
      font,
      size: 14,
    });
    if (filler) {
      page.drawText(filler, {
        x: 18,
        y: 420,
        font,
        size: 2,
      });
    }
  });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

test("the bundled library runs without Node or browser-only globals", async () => {
  const runtime = createRuntime();
  assert.ok(runtime.PDFLib?.PDFDocument);
  assert.equal("Buffer" in runtime, false);
  assert.equal("require" in runtime, false);
  assert.equal("process" in runtime, false);
  assert.equal("window" in runtime, false);
  assert.equal("document" in runtime, false);

  const original = await buildPdf(runtime, [
    [612, 792],
    [792, 612],
    [420, 900],
  ]);
  const originalHash = crypto
    .createHash("sha256")
    .update(original)
    .digest("hex");
  const result = await runtime.watermarkReviewerPdfBytes_(
    Array.from(original, (byte) => (byte > 127 ? byte - 256 : byte)),
    {
      fullName: "Test Reviewer | Dept",
      email: "Test.Reviewer@Example.com",
    },
  );

  assert.equal(result.pageCount, 3);
  assert.ok(result.bytes.length > 0);
  assert.ok(result.bytes.length <= runtime.MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES);
  const expectedWatermarkName = "Test Reviewer Dept";
  const verification = await runtime.verifyReviewerPdfWatermarks_(
    result.bytes,
    {
      fullName: expectedWatermarkName,
      email: "Test.Reviewer@Example.com",
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(verification)),
    { pageCount: 3, pagesWithWatermarks: 3 },
  );
  runtime.__reviewerPdfBytes = result.bytes;
  const firstPageText = await vm.runInContext(
    `(async function () {
      var pdf = await PDFLib.PDFDocument.load(
        Uint8Array.from(__reviewerPdfBytes),
      );
      var page = pdf.getPages()[0];
      var contents = pdf.context.lookup(page.node.Contents());
      var streams = contents instanceof PDFLib.PDFArray
        ? contents.asArray()
        : [page.node.Contents()];
      return streams.map(function (stream) {
        return reviewerPdfStreamText_(pdf, stream);
      }).join("\\n");
    })()`,
    runtime,
  );
  delete runtime.__reviewerPdfBytes;
  assert.equal(firstPageText.split(expectedWatermarkName).length - 1, 8);
  assert.equal(
    firstPageText.split("Test.Reviewer@Example.com").length - 1,
    8,
  );
  assert.doesNotMatch(firstPageText, /AUTHORIZED USER:|Student Portal|\|/);
  assert.equal(
    crypto
      .createHash("sha256")
      .update(original)
      .digest("hex"),
    originalHash,
    "the original bytes must remain unchanged",
  );
});

test("the browser worker watermarks PDFs without blocking the page runtime", async () => {
  const creator = createRuntime();
  const original = await buildPdf(creator, [
    [612, 792],
    [792, 612],
  ]);
  const messages = [];
  const worker = createBrowserWorkerRuntime(messages);
  const sourceBuffer = original.buffer.slice(
    original.byteOffset,
    original.byteOffset + original.byteLength,
  );

  await worker.onmessage({
    data: {
      sourceBuffer,
      identity: {
        fullName: "Test Reviewer | Dept",
        email: "Test.Reviewer@Example.com",
      },
    },
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, "success");
  const result = new Uint8Array(messages[0].resultBuffer);
  const verifier = createRuntime();
  const verification = await verifier.verifyReviewerPdfWatermarks_(
    Array.from(result, (byte) => (byte > 127 ? byte - 256 : byte)),
    {
      fullName: "Test Reviewer Dept",
      email: "Test.Reviewer@Example.com",
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(verification)),
    { pageCount: 2, pagesWithWatermarks: 2 },
  );
});

test("rejects oversized sources, invalid input, and excessive page counts", async () => {
  const runtime = createRuntime();
  await assert.rejects(
    runtime.watermarkReviewerPdfBytes_(
      new Array(runtime.MRH_REVIEWER_PDF_MAX_BYTES + 1).fill(0),
      {
        fullName: "Test Reviewer",
        email: "test.reviewer@example.com",
      },
    ),
    (error) => error.code === "FILE_TOO_LARGE",
  );

  await assert.rejects(
    runtime.watermarkReviewerPdfBytes_([1, 2, 3, 4, 5], {
      fullName: "Test Reviewer",
      email: "test.reviewer@example.com",
    }),
    (error) => error.code === "INVALID_PDF",
  );

  const tooManyPages = await buildPdf(
    runtime,
    Array.from(
      { length: runtime.MRH_REVIEWER_PDF_MAX_PAGES + 1 },
      () => [612, 792],
    ),
  );
  await assert.rejects(
    runtime.watermarkReviewerPdfBytes_(
      Array.from(tooManyPages, (byte) => (byte > 127 ? byte - 256 : byte)),
      {
        fullName: "Test Reviewer",
        email: "test.reviewer@example.com",
      },
    ),
    (error) => error.code === "TOO_MANY_PAGES",
  );
});

test("watermark failures never return source bytes", async () => {
  const runtime = createRuntime();
  const original = await buildPdf(runtime, [[612, 792]]);
  const source = Array.from(original, (byte) => (byte > 127 ? byte - 256 : byte));
  await assert.rejects(
    runtime.watermarkReviewerPdfBytes_(source, {
      fullName: "",
      email: "test.reviewer@example.com",
    }),
    (error) => {
      assert.equal(error.code, "BAD_REQUEST");
      assert.equal("data" in error, false);
      return true;
    },
  );
  assert.deepEqual(
    source,
    Array.from(original, (byte) => (byte > 127 ? byte - 256 : byte)),
    "watermark failure must not mutate the source bytes",
  );
});

test("processes a synthetic 20-page PDF and records local workload metrics", async () => {
  const runtime = createRuntime();
  const original = await buildPdf(
    runtime,
    Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? [612, 792] : [792, 612],
    ),
    30000,
  );
  assert.ok(
    original.length < runtime.MRH_REVIEWER_PDF_MAX_BYTES,
    `synthetic source ${original.length} bytes should fit the configured limit`,
  );
  const startedAt = performance.now();
  const result = await runtime.watermarkReviewerPdfBytes_(
    Array.from(original, (byte) => (byte > 127 ? byte - 256 : byte)),
    {
      fullName: "Test Reviewer",
      email: "test.reviewer@example.com",
    },
  );
  const verification = await runtime.verifyReviewerPdfWatermarks_(
    result.bytes,
    {
      fullName: "Test Reviewer",
      email: "test.reviewer@example.com",
    },
  );
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.pageCount, 20);
  assert.equal(verification.pagesWithWatermarks, 20);
  assert.ok(result.bytes.length <= runtime.MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES);
  console.log(JSON.stringify({
    localRuntime: "Node VM without Node/browser globals",
    pages: verification.pageCount,
    sourceBytes: original.length,
    outputBytes: result.bytes.length,
    elapsedMs: Math.round(elapsedMs),
    processMemoryBytes: process.memoryUsage().heapUsed,
    appsScriptMemoryBytes: null,
  }));
});

test("benchmarks maximum-page and maximum-input PDF workloads locally", async () => {
  const runtime = createRuntime();
  const identity = {
    fullName: "Capacity Test",
    email: "capacity.test@example.com",
  };
  const pageSource = await buildPdf(
    runtime,
    Array.from({ length: runtime.MRH_REVIEWER_PDF_MAX_PAGES }, (_, index) =>
      index % 2 === 0 ? [612, 792] : [792, 612],
    ),
    10000,
  );
  assert.ok(pageSource.length < runtime.MRH_REVIEWER_PDF_MAX_BYTES);
  const pageStartedAt = performance.now();
  const pageResult = await runtime.watermarkReviewerPdfBytes_(
    Array.from(pageSource, (byte) => (byte > 127 ? byte - 256 : byte)),
    identity,
  );
  const pageVerification = await runtime.verifyReviewerPdfWatermarks_(
    pageResult.bytes,
    identity,
  );
  const pageElapsedMs = performance.now() - pageStartedAt;
  assert.equal(pageResult.pageCount, runtime.MRH_REVIEWER_PDF_MAX_PAGES);
  assert.equal(
    pageVerification.pagesWithWatermarks,
    runtime.MRH_REVIEWER_PDF_MAX_PAGES,
  );
  assert.ok(pageResult.bytes.length <= runtime.MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES);

  const smallSource = await buildPdf(runtime, [[612, 792]]);
  const maxInput = new Uint8Array(runtime.MRH_REVIEWER_PDF_MAX_BYTES);
  maxInput.set(smallSource);
  maxInput.fill(0x20, smallSource.length);
  const inputStartedAt = performance.now();
  const inputResult = await runtime.watermarkReviewerPdfBytes_(
    Array.from(maxInput, (byte) => (byte > 127 ? byte - 256 : byte)),
    identity,
  );
  const inputVerification = await runtime.verifyReviewerPdfWatermarks_(
    inputResult.bytes,
    identity,
  );
  const inputElapsedMs = performance.now() - inputStartedAt;
  assert.equal(inputResult.pageCount, 1);
  assert.equal(inputVerification.pagesWithWatermarks, 1);
  assert.ok(inputResult.bytes.length <= runtime.MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES);
  console.log(JSON.stringify({
    test: "maximum PDF workloads",
    maximumPages: runtime.MRH_REVIEWER_PDF_MAX_PAGES,
    pageCaseSourceBytes: pageSource.length,
    pageCaseOutputBytes: pageResult.bytes.length,
    pageCaseElapsedMs: Math.round(pageElapsedMs),
    maximumInputBytes: maxInput.length,
    maxInputOutputBytes: inputResult.bytes.length,
    maxInputElapsedMs: Math.round(inputElapsedMs),
    processMemoryBytes: process.memoryUsage().heapUsed,
    appsScriptMemoryBytes: null,
    environment: "local Node VM; not an Apps Script execution measurement",
  }));
});

test("measures a small concurrent PDF batch without changing worker concurrency", async () => {
  const runtime = createRuntime();
  const identity = {
    fullName: "Concurrent Test",
    email: "concurrent.test@example.com",
  };
  const sources = await Promise.all(
    Array.from({ length: 3 }, () => buildPdf(runtime, [[612, 792], [792, 612]])),
  );
  const startedAt = performance.now();
  const results = await Promise.all(
    sources.map((source) =>
      runtime.watermarkReviewerPdfBytes_(
        Array.from(source, (byte) => (byte > 127 ? byte - 256 : byte)),
        identity,
      ),
    ),
  );
  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(
    results.map((result) => result.pageCount),
    [2, 2, 2],
  );
  console.log(JSON.stringify({
    test: "local concurrent PDF batch",
    requests: results.length,
    totalPages: results.reduce((total, result) => total + result.pageCount, 0),
    elapsedMs: Math.round(elapsedMs),
    processMemoryBytes: process.memoryUsage().heapUsed,
    appsScriptMemoryBytes: null,
    environment: "local Node VM; no production Apps Script concurrency claim",
  }));
});
