const assert = require("node:assert/strict");
const fs = require("node:fs");

const backend = fs.readFileSync("backend/main.js", "utf8");
const frontend = fs.readFileSync("app-core.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");
const manifest = JSON.parse(
  fs.readFileSync("backend/appsscript.json", "utf8"),
);
const pdfHelper = fs.readFileSync("backend/ReviewerPdf.gs", "utf8");
const bundledPdfLibrary = fs.readFileSync(
  "reviewer-pdf-service/vendor/pdf-lib-1.17.1.min.js",
);
const appsScriptPdfLibrary = fs.readFileSync("backend/PDFLib.js");
const setupGuide = fs.readFileSync(
  "reviewer-pdf-service/README.md",
  "utf8",
);
const servicePackage = JSON.parse(
  fs.readFileSync("reviewer-pdf-service/package.json", "utf8"),
);
const publicDashboardHandler =
  backend.match(
    /function handleGetResourceDashboardRequest\(cachedVersion\) \{[\s\S]*?\n\}/,
  )?.[0] || "";
const reviewerPreview = frontend.match(
  /async function previewResourceFile\([\s\S]*?\n  \}/,
)?.[0] || "";
const reviewerDownload = frontend.match(
  /async function downloadReviewerPdf\([\s\S]*?\n  \}/,
)?.[0] || "";

assert.match(
  backend,
  /function authorizeReviewerPdfRequest_\(data\)[\s\S]*?authorizeReviewerRequest_\(data, true\)/,
  "each protected PDF request must recheck the account without the short cache",
);
assert.match(
  backend,
  /function handleGetReviewerPdfRequest\(data, expectedSourceVersion\)[\s\S]*?getReviewerPdfSource_\(fileId\)[\s\S]*?expectedSourceVersion !== source\.sourceVersion[\s\S]*?sourceAfterProcessing\.sourceVersion !== source\.sourceVersion/,
  "the handler must validate current index membership, source version, and root ancestry",
);
assert.match(
  backend,
  /function getReviewerPdfSource_\(fileId\)[\s\S]*?getReviewerPdfIndexEntries_\(\)[\s\S]*?getReviewerPdfDriveHierarchy_\(fileId\)[\s\S]*?hierarchy\.insideRoot/,
  "source validation must check authoritative index membership and root ancestry",
);
assert.match(
  backend,
  /if \(String\(file\.id\) === RESOURCE_PORTAL_ROOT_FOLDER_ID\)[\s\S]*?isPrivateResourceFolderName\(item\.name\)/,
  "protected PDF ancestry must reach the resource portal root through a versioned private Reviewer folder",
);
assert.match(
  backend,
  /message: "This PDF is outside the protected resource hierarchy\."/,
  "the out-of-hierarchy response should not include the word Reviewer",
);
assert.match(
  backend,
  /function handleGetReviewerPdfRequest\(data, expectedSourceVersion\)[\s\S]*?await verifyReviewerPdfWatermarks_\([\s\S]*?mimeType: "application\/pdf"[\s\S]*?sourceVersion: source\.sourceVersion[\s\S]*?data: Utilities\.base64Encode\(outputBytes\)/,
  "only a derivative verified page-by-page may be returned",
);
const protectedPdfHandler = backend.match(
  /async function handleGetReviewerPdfRequest\(data, expectedSourceVersion\) \{[\s\S]*?\n\}/,
)?.[0] || "";
assert.doesNotMatch(
  protectedPdfHandler,
  /data:\s*sourceBytes|base64Encode\(\s*sourceBytes\s*\)/,
  "the protected route must never serialize source PDF bytes",
);
assert.match(
  backend,
  /if \(requestType === "get_reviewer_pdf_preview"\)\s*return handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?if \(requestType === "get_reviewer_pdf"\)\s*return enqueueReviewerPdfRequest_\(data\)/,
  "preview must be a lightweight protected route while explicit downloads enqueue PDF processing",
);
assert.match(
  backend,
  /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?authorizeReviewerPdfRequest_\(data\)[\s\S]*?getReviewerPdfSource_\(fileId\)[\s\S]*?data: Utilities\.base64Encode\(sourceBytes\)/,
  "online preview must authorize and return only the current protected source bytes without watermark generation",
);
assert.match(
  backend,
  /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?Drive\.Files\.get\(fileId[\s\S]*?reviewerPdfSourceVersion_\([\s\S]*?latestSourceVersion !== source\.sourceVersion/,
  "preview should verify the source with one metadata lookup instead of rechecking its full Drive hierarchy",
);
assert.doesNotMatch(
  backend.match(
    /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?\n\}/,
  )?.[0] || "",
  /watermarkReviewerPdfBytes_|DriveApp\.createFile/,
  "online preview must not generate or persist a physical derivative",
);
assert.doesNotMatch(
  backend.match(
    /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?\n\}/,
  )?.[0] || "",
  /appendMRHAccessLog_/,
  "preview delivery should not wait for a duplicate synchronous spreadsheet log",
);
assert.match(
  backend,
  /function setupReviewerPdfDelivery\(\)[\s\S]*?REVIEWER_PDF_WORKER_READY_PROPERTY[\s\S]*?scheduleReviewerPdfWorkerLocked_\(\)[\s\S]*?function enqueueReviewerPdfRequest_\([\s\S]*?authorizeReviewerPdfRequest_\(data\)/,
  "PDF jobs must run through an on-demand trigger after explicit setup and fresh authorization",
);
assert.match(
  backend,
  /function enqueueReviewerPdfRequest_\(data\)[\s\S]*?authorizeReviewerPdfRequest_\(data\)[\s\S]*?if \(!reviewerPdfQueueConfigured_\(\)\)/,
  "every PDF enqueue must authorize the reviewer before disclosing processor configuration",
);
assert.match(
  backend,
  /function scheduleReviewerPdfWorkerLocked_\([\s\S]*?\.after\(delay\)\s*\.create\(\)/,
  "the worker must use bounded, on-demand triggers instead of polling continuously",
);
assert.match(
  frontend,
  /const deadline = Date\.now\(\) \+ 9 \* 60 \* 1000/,
  "the browser must allow time for stale processing claims to be recovered before timing out",
);
assert.match(
  backend,
  /Number\(job\.processingAt \|\| 0\) < (?:now|Date\.now\(\)) - 6\.5 \* 60 \* 1000/,
  "the browser download deadline must exceed the worker's stale-claim recovery window",
);
assert.match(
  backend,
  /const REVIEWER_PDF_JOB_TTL_MS = 10 \* 60 \* 1000/,
  "the browser deadline must remain below the server-side PDF job expiry",
);
assert.match(
  backend,
  /async function processReviewerPdfQueue\(\w+\)[\s\S]*?await handleGetReviewerPdfRequest\([\s\S]*?listReviewerPdfPermissions_\([\s\S]*?PDF_OUTPUT_NOT_PRIVATE/,
  "the background worker must await watermarking and reject non-private derivatives",
);
assert.match(
  backend,
  /function getReviewerPdfJobStatus_\([\s\S]*?authorizeReviewerPdfRequest_\(data\)[\s\S]*?job\.sessionId !== String\(data\.sessionId[\s\S]*?getReviewerPdfSource_\(job\.fileId\)[\s\S]*?currentSource\.sourceVersion !== job\.sourceVersion[\s\S]*?Utilities\.base64Encode\(outputBytes\)/,
  "download polling must reauthorize and revalidate the index, source version, and session before returning the derivative",
);
assert.match(
  backend,
  /function getReviewerPdfJobStatus_\([\s\S]*?Utilities\.base64Encode\(outputBytes\)[\s\S]*?permanentlyDeleteReviewerPdfOutput_\(job\.outputFileId\)/,
  "a generated download must be permanently deleted from Drive before its bytes are returned",
);
assert.match(
  backend,
  /function permanentlyDeleteReviewerPdfOutput_\([\s\S]*?Drive\.Files\.delete\(normalizedId, \{ supportsAllDrives: true \}\)/,
  "temporary PDF outputs must be permanently deleted rather than merely trashed",
);
assert.match(
  backend,
  /function cleanupReviewerPdfJobsForSession_\([\s\S]*?job\.sessionId !== normalizedSessionId[\s\S]*?permanentlyDeleteReviewerPdfOutput_\(job\.outputFileId\)/,
  "session cleanup must only delete generated PDFs belonging to that session",
);
assert.match(
  backend,
  /function authorizeReviewerPdfRequest_\(data\)[\s\S]*?authorizeReviewerRequest_\(data, true\)[\s\S]*?rawAccountStatus !== "TRUE"/,
  "PDF authorization must require the exact stored Active value TRUE, not a normalized alias",
);
assert.match(
  backend,
  /function getReviewerPdfIndexEntries_\(\)[\s\S]*?indexFile\.getLastUpdated\(\)\.getTime\(\)[\s\S]*?CacheService\.getScriptCache\(\)[\s\S]*?getResourceDashboardCombinedIndex/,
  "index entries should be cached by authoritative Drive file version, not rescanned from JSON on every request",
);
assert.match(
  backend,
  /var isDryRun = dryRun !== false[\s\S]*?if \(isDryRun\)[\s\S]*?planned: pendingRevocations[\s\S]*?Drive\.Permissions\.delete/,
  "the separate ACL helper must provide a no-mutation dry run before explicit deletion",
);
assert.doesNotMatch(
  backend.match(/function doPost\(e\) \{[\s\S]*?\n\}/)?.[0] || "",
  /return handleGetReviewerPdfRequest\(data\)/,
  "doPost must not return an unverified Promise instead of TextOutput",
);
assert.match(
  backend,
  /function protectReviewerDashboardTab_\(tab\)[\s\S]*?mrh-reviewer-pdf:/,
  "Reviewer dashboard responses must replace indexed PDF Drive URLs with opaque IDs",
);
assert.doesNotMatch(
  publicDashboardHandler,
  /protectReviewerDashboardTab_|get_reviewer_pdf/,
  "the public Modules/Syllabus dashboard must not use the Reviewer PDF protection route",
);
assert.match(
  backend,
  /mrh_reviewer_dashboard_v2_[\s\S]*?mrh_reviewer_dashboard_latest_v2/,
  "reviewer dashboard cache versions must not reuse legacy direct-URL cache entries",
);
assert.match(
  pdfHelper,
  /async function watermarkReviewerPdfBytes_\([\s\S]*?PDFLib\.PDFDocument\.load[\s\S]*?page\.drawText[\s\S]*?await pdf\.save/,
  "watermarking must run in Apps Script using its locally loaded PDF library",
);
assert.match(
  pdfHelper,
  /var watermarkLines = \[fullName, email\]/,
  "the PDF watermark should contain only the account name and email on separate lines",
);
assert.match(
  pdfHelper,
  /\[0\.25, 0\.75\]\.forEach\(function \(columnFraction\)[\s\S]*?\[0\.12, 0\.31, 0\.5, 0\.69, 0\.88\]\.forEach\(function \(rowFraction\)[\s\S]*?opacity: 0\.18/,
  "downloaded PDFs should carry ten compact, reduced-opacity two-line identity watermarks per page",
);
assert.match(
  pdfHelper,
  /fullNameCount < 10[\s\S]*?emailCount < 10/,
  "downloaded PDF watermark verification should require all ten stamps on each page",
);
assert.doesNotMatch(
  pdfHelper,
  /AUTHORIZED USER:|Student Portal|var watermark = .*\\\|/,
  "the watermark should not add a label, separator, or portal name",
);
assert.match(
  backend,
  /async function runReviewerPdfWatermarkProofOfConcept\(\)[\s\S]*?Session\.getEffectiveUser\(\)\.getEmail\(\)[\s\S]*?DriveApp\.createFile[\s\S]*?sourceFile\.setTrashed\(true\)/,
  "the in-project proof must use a verified script identity and clean up its private test source",
);
assert.match(
  backend,
  /function applyReviewedReviewerPdfPermissionRevocations\([\s\S]*?REVOKE THE REVIEWED REVIEWER PDF SHARES[\s\S]*?record\.permission\.inherited[\s\S]*?Drive\.Permissions\.delete/,
  "ACL deletion must be separate, explicit, reviewed, and reject inherited grants",
);
assert.match(
  backend,
  /record\.file\.mimeType !== "application\/pdf"[\s\S]*?Ancestor-folder permissions are report-only/,
  "the ACL apply path must not alter shared ancestors and affect Modules/Syllabus",
);
assert.match(
  backend,
  /function auditReviewerPdfDrivePermissions\(\)[\s\S]*?REVIEWER_PDF_ACL_REPORT[\s\S]*?function applyReviewedReviewerPdfPermissionRevocations/,
  "the read-only ACL dry run must be separate from the apply operation",
);
assert.match(
  network,
  /get_reviewer_pdf_preview:\s*\{\s*required:\s*\["sessionId",\s*"eventId",\s*"fileId"\]/,
  "preview requests must require a valid session, correlation ID, and file ID",
);
assert.match(
  network,
  /cleanup_reviewer_pdf_jobs:\s*\{\s*required:\s*\["sessionId",\s*"eventId"\]/,
  "temporary PDF cleanup requests must be session-bound",
);
assert.match(
  network,
  /get_reviewer_pdf:\s*\{\s*required:\s*\["sessionId",\s*"eventId",\s*"fileId"\]/,
  "the frontend must require a session, correlation ID, and file ID for protected PDFs",
);
assert.match(
  network,
  /get_reviewer_pdf_job:\s*\{\s*required:\s*\["sessionId",\s*"eventId",\s*"jobId"\]/,
  "job polling must require a session, correlation ID, and unguessable job ID",
);
assert.match(
  network,
  /cache:\s*"no-store"/,
  "protected backend POST requests must bypass browser caching",
);
assert.match(
  frontend,
  /resourceDashboardActiveTab === "REVIEWERS"[\s\S]*?mrh-reviewer-pdf:[\s\S]*?reviewer: true/,
  "only the protected PDF tab may route opaque IDs to the protected viewer",
);
assert.match(
  reviewerPreview,
  /type: "get_reviewer_pdf_preview"[\s\S]*?sessionId: reviewerSessionId[\s\S]*?fileId/,
  "online preview must fetch the source PDF without enqueuing watermark processing",
);
assert.doesNotMatch(
  reviewerPreview,
  /window\.open|location\.href|drive\.google\.com/,
  "the PDF viewer must not open or redirect to the original Drive URL",
);
assert.match(
  reviewerPreview,
  /responseMimeType !== "application\/pdf"[\s\S]*?REVIEWER_PDF_MAX_SOURCE_BYTES/,
  "preview responses must have the PDF MIME type and stay within the source limit",
);
assert.match(
  reviewerPreview,
  /bytes\.byteLength > REVIEWER_PDF_MAX_SOURCE_BYTES[\s\S]*?bytes\[0\] !== 0x25[\s\S]*?bytes\[4\] !== 0x2d/,
  "preview responses must be bounded and begin with a PDF signature before rendering",
);
assert.match(
  reviewerPreview,
  /renderReviewerPdfWatermark\(response\.fullName, response\.email\)[\s\S]*?resourcePortalReviewerPdf/,
  "online preview must display the verified identity as a dynamic viewer overlay",
);
assert.match(
  reviewerDownload,
  /type: "get_reviewer_pdf"[\s\S]*?type: "get_reviewer_pdf_job"[\s\S]*?link\.download/,
  "only the explicit download action may enqueue and save a physical watermarked PDF",
);
assert.match(
  frontend,
  /function sendReviewerPdfCleanupBeacon\(\)[\s\S]*?navigator\.sendBeacon[\s\S]*?cleanup_reviewer_pdf_jobs/,
  "the browser must request session cleanup when the active page exits",
);
assert.match(
  reviewerPreview,
  /reviewerPdfPreviewInFlight\?\.key === reviewerRequestKey[\s\S]*?finally[\s\S]*?reviewerPdfPreviewInFlight === reviewerRequest/,
  "repeated clicks on one Reviewer PDF must not enqueue duplicate processing jobs",
);
assert.match(
  frontend,
  /function closeReviewerPdfPreview\(\)[\s\S]*?resourcePortalPreviewIsReviewer[\s\S]*?closeResourcePreview\(\)/,
  "the currently displayed Reviewer PDF must be cleared independently of non-PDF previews",
);
assert.match(
  frontend,
  /const accountStatus = response\.accountStatus;\s*if \(accountStatus !== "TRUE"\) closeReviewerPdfPreview\(\)/,
  "loss of approval must clear the displayed Reviewer PDF",
);
assert.match(
  frontend,
  /if \(tabName !== "REVIEWERS"\) closeReviewerPdfPreview\(\)/,
  "leaving the Reviewer tab must release displayed Reviewer PDF content",
);
assert.match(
  frontend,
  /function signOutReviewer\([\s\S]*?closeReviewerPdfPreview\(\)/,
  "sign-out must clear the displayed Reviewer PDF and revoke its object URL",
);
assert.match(
  reviewerPreview,
  /isDefinitivelyInvalidReviewerCredential\(error\)[\s\S]*?signOutReviewer\(false\)/,
  "an expired or revoked session encountered during PDF delivery must be cleared",
);
assert.equal(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/iam"),
  false,
  "the Apps Script project must not request IAM access for an external processor",
);
assert.equal(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/userinfo.email"),
  true,
  "the verified server execution identity requires the user email OAuth scope",
);
assert.match(
  setupGuide,
  /`pdf-lib` \*\*1\.17\.1\*\*[\s\S]*?MIT License/,
  "the setup guide must document the pinned library and its license",
);
assert.match(
  setupGuide,
  /runReviewerPdfWatermarkProofOfConcept[\s\S]*?7,461 ms/,
  "the setup guide must report the measured Apps Script proof",
);
assert.match(
  setupGuide,
  /processReviewerPdfQueue[\s\S]*?setupReviewerPdfDelivery/,
  "the setup guide must document the synchronous polling and trigger setup",
);
assert.equal(
  servicePackage.devDependencies?.["pdf-lib"],
  "1.17.1",
  "pdf-lib must be pinned exactly for reproducible bundling",
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
