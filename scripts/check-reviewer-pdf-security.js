const assert = require("node:assert/strict");
const fs = require("node:fs");

const backend = fs.readFileSync("backend/main.js", "utf8");
const frontend = fs.readFileSync("app-core.js", "utf8");
const browserPdfWorker = fs.readFileSync("reviewer-pdf-worker.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");
const appConfig = fs.readFileSync("app-config.js", "utf8");
const manifest = JSON.parse(
  fs.readFileSync("backend/appsscript.json", "utf8"),
);
const pdfHelper = fs.readFileSync("backend/ReviewerPdf.gs", "utf8");
const bundledPdfLibrary = fs.readFileSync(
  "reviewer-pdf-service/vendor/pdf-lib-1.17.1.min.js",
);
const websitePdfLibrary = fs.readFileSync("pdf-lib-1.17.1.min.js");
const websitePdfLicense = fs.readFileSync(
  "pdf-lib-1.17.1-LICENSE.md",
  "utf8",
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
const protectedPreviewHandler = backend.match(
  /function handleGetReviewerPdfPreviewRequest_\([\s\S]*?\n\}/,
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
  /async function handleGetReviewerPdfRequest\(data, expectedSourceVersion\) \{\s*return errorResponse\([\s\S]*?PDF_BACKEND_PROCESSING_DISABLED/,
  "the legacy backend PDF-processing route must be disabled",
);
const protectedPdfHandler = backend.match(
  /async function handleGetReviewerPdfRequest\(data, expectedSourceVersion\) \{[\s\S]*?\/\*/,
)?.[0] || "";
assert.match(
  protectedPdfHandler,
  /return errorResponse\([\s\S]*?PDF_BACKEND_PROCESSING_DISABLED/,
  "the legacy route must stop before any server-side PDF processing",
);
assert.match(
  backend,
  /if \(requestType === "get_reviewer_pdf_preview"\)\s*return handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?if \(requestType === "get_reviewer_pdf"\)\s*return enqueueReviewerPdfRequest_\(data\)/,
  "the active preview uses its protected source route; the legacy processing route is disabled",
);
assert.match(
  protectedPreviewHandler,
  /authorizeReviewerPdfRequest_\(data\)[\s\S]*?getReviewerPdfSource_\(fileId\)[\s\S]*?cacheHit: true[\s\S]*?DriveApp\.getFileById\(fileId\)\.getBlob\(\)\.getBytes\(\)[\s\S]*?clientProcessing: true[\s\S]*?Utilities\.base64Encode\(sourceBytes\)/,
  "online preview must authorize the source and return bytes for browser-side watermarking",
);
assert.match(
  protectedPreviewHandler,
  /getReviewerPdfSource_\(fileId\)[\s\S]*?source\.sourceVersion/,
  "preview must validate current source ancestry and version before returning source bytes",
);
assert.match(
  backend,
  /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?cachedSourceVersion === source\.sourceVersion[\s\S]*?cacheHit: true/,
  "a repeat preview may reuse bytes only after fresh authorization and current source-version validation",
);
assert.doesNotMatch(
  protectedPreviewHandler,
  /enqueueReviewerPdfRequest_|watermarkReviewerPdfBytes_|verifyReviewerPdfWatermarks_|DriveApp\.createFile/,
  "the interactive preview route must not enqueue jobs, parse PDFs, verify stamps, or write Drive derivatives",
);
assert.match(
  backend,
  /function setupReviewerPdfDelivery\(\)[\s\S]*?deleteTrigger\(trigger\)[\s\S]*?deleteProperty\(REVIEWER_PDF_WORKER_READY_PROPERTY\)[\s\S]*?Backend PDF watermark processing is disabled/,
  "legacy PDF setup must remove old worker triggers and leave processing disabled",
);
assert.match(
  backend,
  /async function processReviewerPdfQueue\(event\) \{[\s\S]*?return;\s*\/\*/,
  "an already scheduled legacy trigger must exit without processing a PDF",
);
assert.match(
  backend,
  /async function processReviewerPdfQueue\(event\) \{\s*ScriptApp\.getProjectTriggers\(\)[\s\S]*?deleteTrigger\(trigger\)[\s\S]*?return;\s*\/\*/,
  "legacy worker triggers must remove themselves and stop before PDF processing",
);
assert.match(
  backend,
  /function enqueueReviewerPdfRequest_\(data, previewContext\) \{\s*return errorResponse\([\s\S]*?PDF_BACKEND_PROCESSING_DISABLED/,
  "no web API route may enqueue backend watermarking",
);
assert.match(
  backend,
  /function getReviewerPdfJobStatus_\(data\) \{\s*return errorResponse\([\s\S]*?PDF_BACKEND_PROCESSING_DISABLED/,
  "legacy job polling must not deliver or process server-watermarked PDFs",
);
assert.match(
  backend,
  /async function runReviewerPdfWatermarkProofOfConcept\(\) \{\s*throw new Error\("Backend PDF watermark processing has been disabled\."\)/,
  "the manual backend watermark proof must also be disabled",
);
const executableBackend = backend.replace(/\/\*[\s\S]*?\*\//g, "");
assert.doesNotMatch(
  executableBackend,
  /\b(?:watermarkReviewerPdfBytes_|verifyReviewerPdfWatermarks_)\s*\(/,
  "no executable Apps Script code may call the backend watermark processor",
);
assert.match(
  appConfig,
  /databaseUrl:\s*"https:\/\/script\.google\.com\//,
  "PDF source delivery must use HTTPS transport encryption",
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
  /mrh_reviewer_dashboard_v2_[\s\S]*?file\.getLastUpdated\(\)\.getTime\(\)[\s\S]*?reviewerCache\.get\(reviewerCacheKey\)/,
  "reviewer dashboard cache entries must be keyed by the current Drive version",
);
assert.doesNotMatch(
  backend,
  /mrh_reviewer_dashboard_latest_v2/,
  "reviewer requests must not serve unversioned latest cache entries",
);
assert.match(
  pdfHelper,
  /var angle = columnFraction === 0\.5 \? 0 : \(28 \* Math\.PI\) \/ 180[\s\S]*?rotate: PDFLib\.degrees\(columnFraction === 0\.5 \? 0 : -28\)/,
  "the retained legacy helper must keep middle-column marks horizontal",
);
assert.match(
  pdfHelper,
  /var watermarkLines = \[fullName, email\]/,
  "the PDF watermark should contain only the account name and email on separate lines",
);
assert.match(
  pdfHelper,
  /Math\.min\(size\.width, size\.height\) \* 0\.4[\s\S]*?Math\.min\(24,[\s\S]*?\[0\.25, 0\.15\][\s\S]*?\[0\.75, 0\.15\][\s\S]*?\[0\.5, 0\.325\][\s\S]*?\[0\.25, 0\.5\][\s\S]*?\[0\.75, 0\.5\][\s\S]*?\[0\.5, 0\.675\][\s\S]*?\[0\.25, 0\.85\][\s\S]*?\[0\.75, 0\.85\][\s\S]*?opacity: 0\.18/,
  "the retained legacy placement helper should keep paired and centered watermark rows",
);
assert.match(
  pdfHelper,
  /fullNameCount < 8[\s\S]*?emailCount < 8/,
  "downloaded PDF watermark verification should require all eight stamps on each page",
);
assert.doesNotMatch(
  pdfHelper,
  /AUTHORIZED USER:|Student Portal|var watermark = .*\\\|/,
  "the watermark should not add a label, separator, or portal name",
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
  /type: "get_reviewer_pdf_preview"[\s\S]*?sessionId: reviewerSessionId[\s\S]*?fileId[\s\S]*?watermarkReviewerPdfInWorker\(/,
  "online preview must fetch the authorized source and watermark it in a browser worker",
);
assert.doesNotMatch(
  reviewerPreview,
  /window\.open|location\.href|drive\.google\.com/,
  "the PDF viewer must not open or redirect to the original Drive URL",
);
assert.match(
  reviewerPreview,
  /responseMimeType !== "application\/pdf"[\s\S]*?response\.clientProcessing !== true[\s\S]*?REVIEWER_PDF_MAX_SOURCE_BASE64_LENGTH/,
  "preview responses must be authorized for browser processing and stay within the source limit",
);
assert.match(
  reviewerPreview,
  /cachedSourceVersion: cachedReviewerPdf\.sourceVersion[\s\S]*?isReviewerCacheHit[\s\S]*?cachedReviewerPdf\.sourceVersion !== response\.sourceVersion[\s\S]*?expiresAt: Date\.now\(\) \+ 10 \* 60 \* 1000/,
  "repeat opens may reuse only short-lived tab-memory bytes after server source-version validation",
);
assert.match(
  reviewerPreview,
  /bytes\.byteLength > REVIEWER_PDF_MAX_OUTPUT_BYTES[\s\S]*?bytes\[0\] !== 0x25[\s\S]*?bytes\[4\] !== 0x2d/,
  "browser watermarked output must be bounded and start with a PDF signature",
);
assert.doesNotMatch(
  frontend,
  /PDFDocument\.load/,
  "PDF parsing should stay in the dedicated worker, not block the UI thread",
);
assert.match(
  browserPdfWorker,
  /importScripts\("\.\/pdf-lib-1\.17\.1\.min\.js"\)[\s\S]*?PDFDocument\.load[\s\S]*?WATERMARK_PLACEMENTS[\s\S]*?await pdf\.save/,
  "the dedicated browser worker must load the pinned PDF library and watermark every page",
);
assert.match(
  reviewerPreview,
  /cachedReviewerPdf\.fullName !== String\(response\.fullName \|\| ""\)[\s\S]*?cachedReviewerPdf\.email !== String\(response\.email \|\| ""\)[\s\S]*?type: "get_reviewer_pdf_preview"/,
  "a cached derivative with an old identity must trigger a fresh source fetch",
);
assert.match(
  frontend,
  /function watermarkReviewerPdfInWorker\([\s\S]*?new globalScope\.Worker\(workerUrl\)[\s\S]*?worker\.postMessage\([\s\S]*?\[sourceBuffer\]/,
  "client-side PDF parsing must use a transferable buffer and keep the UI responsive in a worker",
);
assert.match(
  reviewerDownload,
  /const bytes = activePdf\.bytes[\s\S]*?link\.click\(\)[\s\S]*?Download Started/,
  "download should start immediately from the browser-watermarked preview bytes",
);
assert.match(
  reviewerDownload,
  /__MRH_PDF_DOWNLOAD_ACTIVE = true[\s\S]*?finally[\s\S]*?__MRH_PDF_DOWNLOAD_ACTIVE = false/,
  "download preparation should defer automatic app reloads until a local download starts",
);
assert.match(
  reviewerDownload,
  /link\.click\(\)[\s\S]*?reviewerPdfDownloadPreparationPending = false[\s\S]*?__MRH_PDF_DOWNLOAD_ACTIVE = false[\s\S]*?Download Started/,
  "starting the local download should immediately release the exit-confirmation and reload guards",
);
assert.match(
  reviewerDownload,
  /downloadIcon\.className = "fa-solid fa-download";[\s\S]*?message\.textContent = "Download Started"/,
  "the success status should show the download icon and exact Download Started label",
);
assert.match(
  frontend,
  /resource-portal-preview-close[\s\S]*?closeResourcePreview\(\{ confirmDuringDownload: true \}\)/,
  "the exit button should remain active and open the confirmation prompt during a download",
);
assert.match(
  frontend,
  /requestConfirmation\([\s\S]*?Are you sure you want to exit the preview/,
  "the close action should request confirmation while PDF processing is active",
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
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-portal-preview\.is-reviewer-pdf[\s\S]*?cursor:\s*default;[\s\S]*?user-select:\s*none;/,
  "Reviewer PDF preview content should use a neutral cursor and disable selection where supported",
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
  frontend,
  /function signOutReviewer\([\s\S]*?reviewerPdfPreviewCache\.clear\(\)/,
  "sign-out must clear cached Reviewer PDF bytes from tab memory",
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
  /Backend PDF watermark processing is disabled|browser Web Worker/i,
  "the setup guide must describe the browser-only interactive processing path",
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
assert.deepEqual(
  websitePdfLibrary,
  bundledPdfLibrary,
  "the lazy website worker bundle must match the pinned local vendor file",
);
assert.match(websitePdfLicense, /MIT License/);
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

const watermarkPlacementPattern =
  /(\[\s*\[0\.25,\s*0\.15\][\s\S]*?\[0\.75,\s*0\.85\],?\s*\])\.forEach/;
const backendWatermarkPlacements =
  pdfHelper.match(watermarkPlacementPattern)?.[1] || "";
assert.match(
  backendWatermarkPlacements,
  /\[\s*0\.25,\s*0\.15\s*\][\s\S]*?\[\s*0\.75,\s*0\.15\s*\][\s\S]*?\[\s*0\.5,\s*0\.325\s*\][\s\S]*?\[\s*0\.25,\s*0\.5\s*\][\s\S]*?\[\s*0\.75,\s*0\.5\s*\][\s\S]*?\[\s*0\.5,\s*0\.675\s*\][\s\S]*?\[\s*0\.25,\s*0\.85\s*\][\s\S]*?\[\s*0\.75,\s*0\.85\s*\]/,
  "legacy placement data should retain alternating paired and centered rows",
);
assert.match(
  pdfHelper,
  /var angle = columnFraction === 0\.5 \? 0 : \(28 \* Math\.PI\) \/ 180/,
  "legacy middle-column marks must be explicitly horizontal",
);
assert.match(
  browserPdfWorker,
  /const angle =\s*columnFraction === 0\.5 \? 0 : \(28 \* Math\.PI\) \/ 180[\s\S]*?rotate: PDFLib\.degrees\(columnFraction === 0\.5 \? 0 : -28\)/,
  "the browser middle-column marks must be explicitly horizontal",
);
console.log("Reviewer PDF security contract checks passed.");
