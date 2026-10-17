"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const backend = fs.readFileSync("backend/main.js", "utf8");
const frontend = fs.readFileSync("app-core.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");
const worker = fs.readFileSync("reviewer-pdf-worker.js", "utf8");
const entry = fs.readFileSync("app-entry.js", "utf8");
const vendorScript = fs.readFileSync(
  "scripts/vendor-reviewer-pdf-lib.js",
  "utf8",
);
const docs = fs.readFileSync("docs/resources-security.md", "utf8");
const setupGuide = fs.readFileSync("reviewer-pdf-service/README.md", "utf8");
const manifest = JSON.parse(
  fs.readFileSync("backend/appsscript.json", "utf8"),
);
const appCorePreview =
  frontend.match(
    /async function previewResourceFile\([\s\S]*?\n  \}/,
  )?.[0] || "";
const appCoreDownload =
  frontend.match(
    /function downloadReviewerPdf\(event\)[\s\S]*?\n  \}/,
  )?.[0] || "";
const previewHandler =
  backend.match(
    /function handleGetReviewerPdfPreviewRequest_\([\s\S]*?\n\}/,
  )?.[0] || "";
const queueHandler =
  backend.match(
    /function processReviewerPdfQueue\(\)[\s\S]*?\n\}/,
  )?.[0] || "";

assert.match(
  backend,
  /function authorizeReviewerPdfRequest_\(data\)[\s\S]*?authorizeReviewerRequest_\(data, true\)/,
  "every protected PDF source request must revalidate reviewer approval",
);
assert.match(
  backend,
  /function getReviewerPdfSource_\(fileId,\s*timings\)[\s\S]*?getReviewerPdfIndexEntries_\(\)[\s\S]*?getReviewerPdfDriveHierarchy_\(fileId\)[\s\S]*?hierarchy\.insideRoot/,
  "source delivery must require index membership and protected resource ancestry",
);
assert.match(
  previewHandler,
  /authorizeReviewerPdfRequest_\(data\)[\s\S]*?getReviewerPdfSource_\(fileId,\s*timings\)/,
  "only the authorized preview route may return validated source bytes for client processing",
);
assert.match(
  previewHandler,
  /DriveApp\.getFileById\(fileId\)\.getBlob\(\)\.getBytes\(\)[\s\S]*?Utilities\.base64Encode\(sourceBytes\)/,
  "source bytes must still come directly from Drive and be base64 encoded for delivery",
);
assert.match(
  backend,
  /function logReviewerPdfRequestTiming_\([\s\S]*?authorizationMs:[\s\S]*?indexLookupMs:[\s\S]*?driveHierarchyMs:[\s\S]*?sourceReadMs:[\s\S]*?accessLogMs:[\s\S]*?base64EncodeMs:/,
  "Reviewer PDF requests must log backend authorization, Drive, audit, and encoding phase timings",
);
assert.match(
  previewHandler,
  /appendMRHAccessLog_\([\s\S]*?PROTECTED_PDF_VIEW/,
  "successful PDF delivery must keep synchronous access auditing and separately time it",
);
assert.ok(
  previewHandler.includes("timings.accessLogMs = Date.now() - accessLogStartedAt") &&
    previewHandler.includes("Utilities.base64Encode(sourceBytes)"),
  "access logging duration should be measured before encoding the source response",
);
assert.match(
  backend,
  /reviewerPdfDownloadName_\(\s*source\.entry\.title,[\s\S]*?downloadFileName:\s*downloadFileName/,
  "the backend should derive the download name from its indexed filename and verified account identity",
);
assert.match(
  previewHandler,
  /event:\s*"PROTECTED_PDF_VIEW"[\s\S]*?resource:\s*source\.entry\.title/,
  "protected PDF access logs should identify the resource without recording its Drive ID",
);
assert.match(
  appCoreDownload,
  /activePdf\?\.downloadFileName[\s\S]*?resourcePortalPreviewObjectUrl[\s\S]*?validDownloadName/,
  "the native download action must target the prepared PDF and validate the backend filename",
);
assert.doesNotMatch(
  backend,
  /watermarkReviewerPdfBytes_|verifyReviewerPdfWatermarks_|PDFLib|REVIEWER_PDF_OUTPUT_FOLDER_ID|reviewerPdfOutputFolder/,
  "Apps Script must not contain PDF watermark processing, a PDF library, or derivative Drive writes",
);
assert.match(
  queueHandler,
  /status:\s*"disabled"/,
  "stale Apps Script triggers must remain harmless and cannot process or store PDFs",
);
assert.doesNotMatch(
  backend,
  /REVIEWER_PDF_JOB_|REVIEWER_PDF_QUEUE_|REVIEWER_PDF_WORKER_|setupReviewerPdfDelivery|watermarkReviewerPdf|reviewerPdfWatermarkIdentity_/,
  "Apps Script must not retain PDF watermarking, queue, or derivative-setup code",
);
assert.doesNotMatch(
  backend,
  /get_reviewer_pdf_job|cleanup_reviewer_pdf_jobs|enqueueReviewerPdfRequest_|getReviewerPdfJobStatus_/,
  "the backend must not expose job polling or derivative-management routes",
);
assert.match(
  appCorePreview,
  /response\.deliveryMode !== "source"[\s\S]*?watermarkReviewerPdfInWorker\(bytes,[\s\S]*?reviewerPdfPreviewCache\.set/,
  "the browser must watermark authorized source bytes in a worker and cache only the prepared output",
);
assert.match(
  appCoreDownload,
  /const bytes = activePdf\?\.bytes[\s\S]*?bytes\.byteLength > REVIEWER_PDF_MAX_OUTPUT_BYTES[\s\S]*?activePdf\.sourceVersion[\s\S]*?resourcePortalPreviewUrlOpened = true/,
  "native download actions must validate and retain only the prepared, browser-watermarked PDF",
);
assert.match(
  frontend,
  /downloadButton\.href = resourcePortalPreviewObjectUrl;\s*downloadButton\.download = resourcePortalReviewerPdf\.downloadFileName/,
  "the visible download control should be a native user-activated link to the prepared PDF",
);
assert.doesNotMatch(
  frontend,
  /Applying personalized watermark/,
  "the Reviewer preview must keep the Loading PDF Preview label throughout watermark processing",
);
assert.match(
  frontend,
  /function renderReviewerPdfDownloadFallback\([\s\S]*?download the PDF[\s\S]*?function downloadReviewerPdf/,
  "the preview should provide a visible native PDF download link without exposing processing details",
);
assert.match(
  worker,
  /importScripts\("\.\/pdf-lib-1\.17\.1\.min\.js"\)[\s\S]*?MAX_SOURCE_BYTES = 8 \* 1024 \* 1024[\s\S]*?MAX_PAGES = 80/,
  "the isolated worker must load the pinned browser PDF library and enforce input bounds",
);
assert.match(
  worker,
  /postMessage\(\{\s*status:\s*"ready"\s*\}\)/,
  "the PDF worker must signal readiness after loading its PDF library",
);
assert.match(
  frontend,
  /function openResourceDashboardTab\([\s\S]*?tabName === "REVIEWERS"[\s\S]*?warmReviewerPdfWorker\(\)/,
  "opening the Reviewer dashboard should warm the PDF worker before a PDF is selected",
);
assert.match(
  frontend,
  /resourceDashboardActiveTab === "REVIEWERS"\s*\?\s*warmReviewerPdfWorker\(\)/,
  "deferred worker warm-up must not start after leaving the Reviewer dashboard",
);
assert.match(
  frontend,
  /reviewerPdfWorkerReadyTimer = globalScope\.setTimeout\([\s\S]*?30000/,
  "the warmed PDF worker must fail explicitly if startup never signals readiness",
);
assert.match(
  frontend,
  /function watermarkReviewerPdfInWorker\([\s\S]*?getReviewerPdfWorker\(\)[\s\S]*?worker\.postMessage/,
  "PDF watermarking should reuse the warmed worker instead of starting a new worker",
);
assert.match(
  frontend,
  /authorizationAndSourceRoundTripMs[\s\S]*?decodeMs[\s\S]*?watermarkMs[\s\S]*?previewSetupMs/,
  "Reviewer preview timing must report request, decode, watermark, and preview setup phases",
);
assert.ok(
  frontend.includes("MRH_PDF_VIEWER_FIRST_PAGE_RENDERED") &&
    frontend.includes("firstPageRenderMs") &&
    frontend.includes("pageNumber === 1"),
  "PDF.js first-page rendering must have its own preview timing",
);
assert.match(
  worker,
  /const drawBlock = \(centerX, centerY, angle, blockFontSize\)[\s\S]*?watermarkTextLines\.push\([\s\S]*?page\.pushOperators\(\.\.\.operators\)/,
  "each page should batch positioned and rotated watermarks into one operator stream",
);
[
  "[0.17, 0.5, 0.83]",
  "size.height - perimeterMargin",
  "size.width - perimeterMargin",
  "const firstRowY = size.height * 0.12",
  "const lastRowY = size.height * 0.88",
  "shortSide * 0.18",
  "diagonalHeight * 1.3",
  "Math.floor((lastRowY - firstRowY) / targetRowSpacing) + 1",
  "[0.23, 0.77].forEach((x)",
  "y + rowSpacing / 2",
  "[0.12, 0.88].forEach((x)",
  "drawBlock(size.width * 0.5, y, 0, smallFontSize)",
  "Math.min(12, Math.min(size.width, size.height) * 0.02)",
  "interiorFontSize * 0.8",
  "perimeterFontSize * 0.7",
  "shortSide * 0.4",
  "const diagonalAngle = -25",
  "const localX = -textWidth(line, blockFontSize) / 2",
  "PDFLib.setTextMatrix(...matrix)",
  "PDFLib.showText(font.encodeText(line))",
  "page.pushOperators(...operators)",
  "interiorFontSize",
  "smallFontSize",
].forEach((placement) => {
  assert.ok(
    worker.includes(placement),
    `the watermark layout should include ${placement}`,
  );
});
assert.match(
  worker,
  /pdf\.setAuthor\(fullName\);[\s\S]*?pdf\.setTitle\(downloadFileName\);[\s\S]*?pdf\.setSubject\(email\);[\s\S]*?pdf\.setKeywords\(\[fullName, email\]\);[\s\S]*?pdf\.save/,
  "watermarked PDFs should include the backend-provided filename, verified name, and email in metadata before saving",
);
assert.match(
  frontend,
  /\["selectstart", "copy", "cut", "contextmenu"\][\s\S]*?preview\.addEventListener\(eventName,[\s\S]*?event\.preventDefault\(\)/,
  "Reviewer preview must prevent page-level text selection and copy actions",
);
assert.match(
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-portal-preview\.is-reviewer-pdf[\s\S]*?user-select:\s*none;/,
  "Reviewer preview controls should disable selection where browser viewers honor it",
);
assert.match(entry, /"reviewer-pdf-worker\.js"[\s\S]*?"pdf-lib-1\.17\.1\.min\.js"/);
assert.match(vendorScript, /repositoryRoot, `pdf-lib-\$\{expectedVersion\}\.min\.js`/);
assert.match(
  docs + setupGuide,
  /browser|client-side watermark/i,
  "documentation must describe the browser-side watermark flow",
);
assert.match(
  docs + setupGuide,
  /cannot prevent|cannot keep|inspect|source bytes/i,
  "documentation must state that authorized browser users can inspect clean source bytes",
);
assert.doesNotMatch(
  docs + setupGuide,
  /REVIEWER_PDF_OUTPUT_FOLDER_ID|auditReviewerPdfOutputFolderPrivacy|queued-job identifier/,
  "documentation must not require the retired PDF output folder or server queue",
);
assert.equal(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/userinfo.email"),
  true,
  "Apps Script still needs verified user identity for authorization and watermark data",
);
assert.equal(
  fs.existsSync("backend/PDFLib.js"),
  false,
  "the backend must not ship a PDF parsing or watermark bundle",
);
assert.deepEqual(
  fs.readFileSync("pdf-lib-1.17.1.min.js"),
  fs.readFileSync("reviewer-pdf-service/vendor/pdf-lib-1.17.1.min.js"),
  "the published browser bundle must match the pinned local vendor bundle",
);

console.log("Reviewer PDF browser-watermark security checks passed.");
