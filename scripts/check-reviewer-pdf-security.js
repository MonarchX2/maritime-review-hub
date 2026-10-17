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
    /async function downloadReviewerPdf\(\)[\s\S]*?\n  \}/,
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
  /function getReviewerPdfSource_\(fileId\)[\s\S]*?getReviewerPdfIndexEntries_\(\)[\s\S]*?getReviewerPdfDriveHierarchy_\(fileId\)[\s\S]*?hierarchy\.insideRoot/,
  "source delivery must require index membership and protected resource ancestry",
);
assert.match(
  previewHandler,
  /authorizeReviewerPdfRequest_\(data\)[\s\S]*?getReviewerPdfSource_\(fileId\)[\s\S]*?DriveApp\.getFileById\(fileId\)\.getBlob\(\)\.getBytes\(\)[\s\S]*?deliveryMode:\s*"source"[\s\S]*?base64Encode\(sourceBytes\)/,
  "only the authorized preview route may return validated source bytes for client processing",
);
assert.match(
  previewHandler,
  /event:\s*"PROTECTED_PDF_VIEW"[\s\S]*?resource:\s*source\.entry\.title/,
  "protected PDF access logs should identify the resource without recording its Drive ID",
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
  /const bytes = activePdf\.bytes[\s\S]*?link\.click\(\)[\s\S]*?reviewerPdfDownloadInFlight = null/,
  "preview and repeat downloads must reuse the same browser-watermarked bytes",
);
assert.match(
  worker,
  /importScripts\("\.\/pdf-lib-1\.17\.1\.min\.js"\)[\s\S]*?MAX_SOURCE_BYTES = 8 \* 1024 \* 1024[\s\S]*?MAX_PAGES = 80/,
  "the isolated worker must load the pinned browser PDF library and enforce input bounds",
);
assert.match(
  worker,
  /\[0\.035, 0\.035, "left", "bottom"\][\s\S]*?\[0\.965, 0\.035, "right", "bottom"\][\s\S]*?\[0\.5, 0\.035, "center", "bottom"\][\s\S]*?\[0\.035, 0\.965, "left", "top"\][\s\S]*?\[0\.965, 0\.965, "right", "top"\][\s\S]*?\[0\.5, 0\.965, "center", "top"\][\s\S]*?rotate:\s*PDFLib\.degrees\(0\)/,
  "every page must receive six small horizontal corner and top/bottom-center watermark placements",
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
