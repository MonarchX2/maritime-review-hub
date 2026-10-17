const assert = require("node:assert/strict");
const fs = require("node:fs");

const backend = fs.readFileSync("backend/main.js", "utf8");
const frontend = fs.readFileSync("app-core.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");
const appConfig = fs.readFileSync("app-config.js", "utf8");
const manifest = JSON.parse(
  fs.readFileSync("backend/appsscript.json", "utf8"),
);
const pdfHelper = fs.readFileSync("backend/ReviewerPdf.gs", "utf8");
const setupGuide = fs.readFileSync(
  "reviewer-pdf-service/README.md",
  "utf8",
);
const servicePackage = JSON.parse(
  fs.readFileSync("reviewer-pdf-service/package.json", "utf8"),
);
const appsScriptPdfLibrary = fs.readFileSync("backend/PDFLib.js");
const bundledPdfLibrary = fs.readFileSync(
  "reviewer-pdf-service/vendor/pdf-lib-1.17.1.min.js",
);
const reviewerPreview =
  frontend.match(
    /async function previewResourceFile\([\s\S]*?\n  \}/,
  )?.[0] || "";
const reviewerDownload =
  frontend.match(
    /async function downloadReviewerPdf\(\)[\s\S]*?\n  \}/,
  )?.[0] || "";
const protectedPreviewHandler =
  backend.match(
    /function handleGetReviewerPdfPreviewRequest_\([\s\S]*?\n\}/,
  )?.[0] || "";
const publicDashboardHandler =
  backend.match(
    /function handleGetResourceDashboardRequest\([\s\S]*?\n\}/,
  )?.[0] || "";
const jobStatusHandler =
  backend.match(/function getReviewerPdfJobStatus_\([\s\S]*?\n\}/)?.[0] ||
  "";
const setupHandler =
  backend.match(/function setupReviewerPdfDelivery\(\)[\s\S]*?\n\}/)?.[0] ||
  "";
const requestHandler =
  backend.match(
    /async function handleGetReviewerPdfRequest\(data, expectedSourceVersion\) \{[\s\S]*?\n\}/,
  )?.[0] || "";

assert.match(
  backend,
  /function authorizeReviewerPdfRequest_\(data\)[\s\S]*?authorizeReviewerRequest_\(data, true\)/,
  "each protected PDF request must recheck account approval without the short cache",
);
assert.match(
  backend,
  /function getReviewerPdfSource_\(fileId\)[\s\S]*?getReviewerPdfIndexEntries_\(\)[\s\S]*?getReviewerPdfDriveHierarchy_\(fileId\)[\s\S]*?hierarchy\.insideRoot/,
  "protected PDF source validation must require index membership and protected root ancestry",
);
assert.match(
  backend,
  /function authorizeReviewerPdfRequest_\(data\)[\s\S]*?authorizeReviewerRequest_\(data, true\)[\s\S]*?rawAccountStatus !== "TRUE"/,
  "PDF access must require the exact stored Active value TRUE",
);
assert.match(
  backend,
  /function getReviewerPdfIndexEntries_\(\)[\s\S]*?indexFile\.getLastUpdated\(\)\.getTime\(\)[\s\S]*?CacheService\.getScriptCache\(\)[\s\S]*?getResourceDashboardCombinedIndex/,
  "Reviewer PDF index entries should be cached against the authoritative Drive file version",
);
assert.match(
  backend,
  /if \(String\(file\.id\) === RESOURCE_PORTAL_ROOT_FOLDER_ID\)[\s\S]*?isPrivateResourceFolderName\(item\.name\)/,
  "protected PDF ancestry must reach the portal root through a versioned private Reviewer folder",
);
assert.match(
  backend,
  /function doPost\(e\)[\s\S]*?get_reviewer_pdf_preview[\s\S]*?handleGetReviewerPdfPreviewRequest_[\s\S]*?get_reviewer_pdf"\)\s*return enqueueReviewerPdfRequest_/,
  "the preview request must enqueue server-side watermarking rather than return clean source bytes",
);
assert.doesNotMatch(
  backend.match(/function doPost\(e\) \{[\s\S]*?\n\}/)?.[0] || "",
  /return handleGetReviewerPdfRequest\(data\)/,
  "doPost must not return an unawaited Promise for internal PDF processing",
);
assert.match(
  backend,
  /function protectReviewerDashboardTab_\(tab\)[\s\S]*?mrh-reviewer-pdf:/,
  "Reviewer PDF dashboard responses must replace original Drive URLs with opaque IDs",
);
assert.doesNotMatch(
  publicDashboardHandler,
  /protectReviewerDashboardTab_|get_reviewer_pdf/,
  "public Modules/Syllabus dashboard responses must not include the Reviewer PDF route",
);
assert.match(
  backend,
  /mrh_reviewer_dashboard_v2_[\s\S]*?file\.getLastUpdated\(\)\.getTime\(\)[\s\S]*?reviewerCache\.get\(reviewerCacheKey\)/,
  "Reviewer dashboard cache entries must be keyed by the current Drive version",
);
assert.match(
  protectedPreviewHandler,
  /authorizeReviewerPdfRequest_\(data\)[\s\S]*?getReviewerPdfSource_\(fileId\)[\s\S]*?reviewerPdfWatermarkIdentity_[\s\S]*?enqueueReviewerPdfRequest_/,
  "the preview route must authorize and validate the source before queueing its watermarked derivative",
);
assert.doesNotMatch(
  protectedPreviewHandler,
  /getBlob\(\)\.getBytes\(\)|base64Encode|clientProcessing/,
  "the preview route must never return clean source bytes to the browser",
);
assert.match(
  protectedPreviewHandler,
  /cachedSourceVersion === source\.sourceVersion[\s\S]*?cacheHit: true[\s\S]*?watermarked: true/,
  "a cache hit may be returned only after reauthorization and fresh source-version validation",
);
assert.match(
  setupHandler,
  /reviewerPdfOutputFolderIsPrivate_\(\)[\s\S]*?setProperty\(REVIEWER_PDF_WORKER_READY_PROPERTY, "true"\)/,
  "the worker setup must verify the private output folder before enabling PDF delivery",
);
assert.match(
  backend,
  /function enqueueReviewerPdfRequest_\(data, previewContext\)[\s\S]*?reviewerPdfQueueConfigured_\(\)[\s\S]*?sessionId[\s\S]*?scheduleReviewerPdfWorkerLocked_\(/,
  "PDF jobs must require a configured processor and schedule the worker",
);
assert.match(
  backend,
  /candidate\.sessionId === String\(data\.sessionId \|\| ""\)[\s\S]*?candidate\.fileId === fileId[\s\S]*?candidate\.sourceVersion === source\.sourceVersion/,
  "same-session requests for an unchanged PDF must reuse an existing job",
);
assert.match(
  backend,
  /var response = await handleGetReviewerPdfRequest\([\s\S]*?Array\.isArray\(response\.bytes\)[\s\S]*?var outputBytes = response\.bytes/,
  "the worker should pass PDF bytes directly to Drive without a base64 JSON round-trip",
);
assert.doesNotMatch(
  backend.match(/async function processReviewerPdfQueue\(event\) \{[\s\S]*?\n\}/)?.[0] || "",
  /base64Decode\(response\.data\)/,
  "the background processor must not waste time decoding its own JSON-encoded output",
);
assert.match(
  jobStatusHandler,
  /authorizeReviewerPdfRequest_\(data\)[\s\S]*?job\.sessionId !== String\(data\.sessionId \|\| ""\)[\s\S]*?getReviewerPdfSource_\(job\.fileId\)[\s\S]*?reviewerPdfOutputIsPrivate_\(job\.outputFileId\)[\s\S]*?DriveApp\.getFileById\(job\.outputFileId\)[\s\S]*?base64Encode/,
  "job polling must reauthorize the session, verify source version and output privacy, and deliver only the prepared derivative",
);
assert.match(
  backend,
  /REVIEWER_PDF_OUTPUT_FOLDER_ID = "10IQyKdYYX5_jP1hQHVjoSEml4FxAlGCl"[\s\S]*?DriveApp\.getFolderById\(REVIEWER_PDF_OUTPUT_FOLDER_ID\)\.createFile\([\s\S]*?persistentOutput = true/,
  "each generated watermarked PDF must be saved in the configured Drive folder and retained",
);
assert.match(
  backend,
  /function reviewerPdfOutputFolderIsPrivate_\(\)[\s\S]*?function isOwnerOnly\(targetId\)[\s\S]*?permissions\.length === 1[\s\S]*?permission\.type === "user"[\s\S]*?permission\.role === "owner"/,
  "the configured Drive folder and its ancestors must be owner-only",
);
assert.match(
  backend,
  /var isDryRun = dryRun !== false[\s\S]*?if \(isDryRun\)[\s\S]*?planned: pendingRevocations[\s\S]*?Drive\.Permissions\.delete/,
  "the Drive ACL helper must default to a non-mutating dry run",
);
assert.match(
  backend,
  /function applyReviewedReviewerPdfPermissionRevocations\([\s\S]*?REVOKE THE REVIEWED REVIEWER PDF SHARES[\s\S]*?record\.permission\.inherited[\s\S]*?Drive\.Permissions\.delete/,
  "ACL revocation must require explicit confirmation and reject inherited permissions",
);
assert.match(
  backend,
  /record\.file\.mimeType !== "application\/pdf"[\s\S]*?Ancestor-folder permissions are report-only/,
  "ACL changes must not alter shared ancestors and affect public resource access",
);
assert.match(
  backend,
  /function auditReviewerPdfDrivePermissions\(\)[\s\S]*?REVIEWER_PDF_ACL_REPORT[\s\S]*?function applyReviewedReviewerPdfPermissionRevocations/,
  "the read-only Drive permission audit must remain separate from the apply operation",
);
assert.match(
  requestHandler,
  /expectedSourceVersion !== source\.sourceVersion[\s\S]*?watermarkReviewerPdfBytes_[\s\S]*?verifyReviewerPdfWatermarks_[\s\S]*?sourceAfterProcessing\.sourceVersion !== source\.sourceVersion[\s\S]*?bytes: outputBytes/,
  "backend processing must watermark and verify output while checking the source did not change",
);
assert.match(
  pdfHelper,
  /var watermarkLines = \[fullName, email\][\s\S]*?size\.width \* 0\.46[\s\S]*?Math\.min\(8,/,
  "each watermark must use the verified identity at the reduced requested text size",
);
assert.match(
  pdfHelper,
  /\[0\.035, 0\.035, "left", "bottom"\][\s\S]*?\[0\.965, 0\.035, "right", "bottom"\][\s\S]*?\[0\.5, 0\.035, "center", "bottom"\][\s\S]*?\[0\.035, 0\.965, "left", "top"\][\s\S]*?\[0\.965, 0\.965, "right", "top"\][\s\S]*?\[0\.5, 0\.965, "center", "top"\]/,
  "each PDF page must receive six horizontal marks: four corners and top/bottom center",
);
assert.match(
  pdfHelper,
  /opacity: 0\.18[\s\S]*?rotate: PDFLib\.degrees\(0\)/,
  "all marks must remain horizontal and subtle",
);
assert.match(
  network,
  /get_reviewer_pdf_preview:\s*\{\s*required:\s*\["sessionId",\s*"eventId",\s*"fileId"\]/,
  "preview requests must require session, correlation ID, and file ID",
);
assert.match(
  network,
  /get_reviewer_pdf_job:\s*\{\s*required:\s*\["sessionId",\s*"eventId",\s*"jobId"\]/,
  "job polling must require session, correlation ID, and an unguessable job ID",
);
assert.match(
  network,
  /cache:\s*"no-store"/,
  "protected backend requests must bypass browser caching",
);
assert.match(
  frontend,
  /type: "get_reviewer_pdf_preview"[\s\S]*?response\?\.status === "pending"[\s\S]*?waitForReviewerPdfJob[\s\S]*?response\.watermarked !== true/,
  "the browser must poll for and accept only server-watermarked PDFs",
);
assert.match(
  reviewerPreview,
  /REVIEWER_PDF_MAX_OUTPUT_BASE64_LENGTH[\s\S]*?REVIEWER_PDF_MAX_OUTPUT_BYTES[\s\S]*?bytes\[0\] !== 0x25[\s\S]*?bytes\[4\] !== 0x2d/,
  "the browser must bound delivered output and validate its PDF signature",
);
assert.doesNotMatch(
  frontend,
  /PDFDocument\.load|new globalScope\.Worker/,
  "the client must not parse or watermark clean PDFs",
);
assert.match(
  reviewerDownload,
  /link\.click\(\)[\s\S]*?Download Started[\s\S]*?finally[\s\S]*?reviewerPdfDownloadInFlight = null/,
  "downloads must use prepared output and release the in-flight guard for subsequent downloads",
);
assert.match(
  reviewerDownload,
  /reviewerPdfDownloadStatusTimer = globalScope\.setTimeout/,
  "the success status must dismiss after its short timer",
);
assert.match(
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-portal-preview\.is-reviewer-pdf[\s\S]*?user-select:\s*none;/,
  "Reviewer PDF preview controls and content should disable page-level text selection",
);
assert.match(
  appConfig,
  /databaseUrl:\s*"https:\/\/script\.google\.com\//,
  "the backend PDF request must use HTTPS",
);
assert.equal(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/iam"),
  false,
  "the Apps Script project must not request IAM access for an external processor",
);
assert.equal(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/userinfo.email"),
  true,
  "the backend requires the verified user email OAuth scope",
);
assert.match(
  setupGuide,
  /private Apps Script processor[\s\S]*?clean source PDF is read and\s*processed by Apps Script and is never returned to the browser/i,
  "the setup guide must document the backend-only watermark security boundary",
);
assert.equal(
  servicePackage.devDependencies?.["pdf-lib"],
  "1.17.1",
  "pdf-lib must be pinned exactly for reproducible backend bundling",
);
assert.deepEqual(
  appsScriptPdfLibrary,
  bundledPdfLibrary,
  "the Apps Script runtime bundle must match the pinned local vendor file",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(servicePackage, "dependencies"),
  false,
  "the Apps Script runtime must not have a remote service dependency",
);
assert.doesNotMatch(
  backend + manifest.oauthScopes.join("\n") + JSON.stringify(servicePackage),
  /run\.app|iamcredentials\.googleapis\.com|MRH_REVIEWER_PDF_SERVICE_URL|MRH_REVIEWER_PDF_SERVICE_ACCOUNT/,
  "the Cloud Run processor must not remain a runtime dependency",
);
console.log("Reviewer PDF security contract checks passed.");
