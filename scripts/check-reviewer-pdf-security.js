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
const PDFLib = require("../reviewer-pdf-service/vendor/pdf-lib-1.17.1.min.js");
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
  /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?authorizeReviewerPdfRequest_\(data\)[\s\S]*?getReviewerPdfSource_\(fileId\)[\s\S]*?fullName: identity\.fullName[\s\S]*?email: identity\.email[\s\S]*?data: Utilities\.base64Encode\(sourceBytes\)/,
  "online preview must authorize and return the validated source plus verified identity metadata",
);
assert.match(
  backend,
  /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?Drive\.Files\.get\(fileId[\s\S]*?reviewerPdfSourceVersion_\([\s\S]*?latestSourceVersion !== source\.sourceVersion/,
  "preview should verify the source with one metadata lookup instead of rechecking its full Drive hierarchy",
);
assert.match(
  backend,
  /function handleGetReviewerPdfPreviewRequest_\(data\)[\s\S]*?cachedSourceVersion === source\.sourceVersion[\s\S]*?cacheHit: true/,
  "a repeat preview may reuse bytes only after fresh authorization and current source-version validation",
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
  /function setupReviewerPdfDelivery\(\)[\s\S]*?REVIEWER_PDF_WORKER_READY_PROPERTY[\s\S]*?scheduleReviewerPdfWorkerLocked_\(\s*1000\s*\)[\s\S]*?function enqueueReviewerPdfRequest_\([\s\S]*?authorizeReviewerPdfRequest_\(data\)/,
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
  backend,
  /function scheduleReviewerPdfWorkerLocked_\(delayMs\)[\s\S]*?Math\.max\(1000, Number\(delayMs\) \|\| 1000\)/,
  "new PDF jobs should request the earliest supported worker trigger",
);
assert.match(
  backend,
  /function getReviewerPdfJobStatus_\([\s\S]*?if \(job\.status === "queued" \|\| job\.status === "processing"\)[\s\S]*?return jsonResponse\(\{ status: "pending", jobId: jobId \}\)[\s\S]*?var currentSource = getReviewerPdfSource_\(job\.fileId\)/,
  "pending polls must not repeatedly traverse the protected PDF source hierarchy",
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
  /async function processReviewerPdfQueue\(\w+\)[\s\S]*?await handleGetReviewerPdfRequest\([\s\S]*?reviewerPdfOutputIsPrivate_\([\s\S]*?PDF_OUTPUT_NOT_PRIVATE/,
  "the background worker must await watermarking and reject non-private derivatives",
);
assert.match(
  backend,
  /function getReviewerPdfJobStatus_\([\s\S]*?authorizeReviewerPdfRequest_\(data\)[\s\S]*?job\.sessionId !== String\(data\.sessionId[\s\S]*?getReviewerPdfSource_\(job\.fileId\)[\s\S]*?currentSource\.sourceVersion !== job\.sourceVersion[\s\S]*?Utilities\.base64Encode\(outputBytes\)/,
  "download polling must reauthorize and revalidate the index, source version, and session before returning the derivative",
);
assert.match(
  backend,
  /const REVIEWER_PDF_OUTPUT_FOLDER_ID = "10IQyKdYYX5_jP1hQHVjoSEml4FxAlGCl"[\s\S]*?DriveApp\.getFolderById\(REVIEWER_PDF_OUTPUT_FOLDER_ID\)\.createFile/,
  "generated watermarked PDFs must be saved in the configured Drive folder",
);
assert.match(
  backend,
  /function getReviewerPdfJobStatus_\([\s\S]*?Drive\.Files\.get\(job\.outputFileId[\s\S]*?REVIEWER_PDF_OUTPUT_FOLDER_ID[\s\S]*?DriveApp\.getFileById\(job\.outputFileId\)[\s\S]*?Utilities\.base64Encode\(outputBytes\)/,
  "delivery must read the saved PDF from the configured Drive folder",
);
assert.doesNotMatch(
  backend.match(/function getReviewerPdfJobStatus_\([\s\S]*?\n\}/)?.[0] || "",
  /permanentlyDeleteReviewerPdfOutput_/,
  "successful delivery must retain the generated PDF in the output folder",
);
assert.match(
  backend,
  /if \(job\.outputFileId && job\.persistentOutput !== true\)[\s\S]*?permanentlyDeleteReviewerPdfOutput_/,
  "only temporary or legacy outputs may be deleted during session cleanup",
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
  /Math\.min\(size\.width, size\.height\) \* 0\.3[\s\S]*?Math\.min\(18,[\s\S]*?\[0\.25, 0\.14\][\s\S]*?\[0\.75, 0\.14\][\s\S]*?\[0\.32, 0\.26\][\s\S]*?\[0\.25, 0\.38\][\s\S]*?\[0\.75, 0\.38\][\s\S]*?\[0\.68, 0\.5\][\s\S]*?\[0\.25, 0\.62\][\s\S]*?\[0\.75, 0\.62\][\s\S]*?\[0\.32, 0\.74\][\s\S]*?\[0\.25, 0\.86\][\s\S]*?\[0\.75, 0\.86\][\s\S]*?opacity: 0\.18/,
  "downloaded PDFs should use the same compact two-column and staggered-center watermark positions as previews",
);
assert.match(
  pdfHelper,
  /fullNameCount < 11[\s\S]*?emailCount < 11/,
  "downloaded PDF watermark verification should require all eleven stamps on each page",
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
  /cachedSourceVersion: cachedReviewerPdf\.sourceVersion[\s\S]*?isReviewerCacheHit[\s\S]*?cachedReviewerPdf\.sourceVersion !== response\.sourceVersion[\s\S]*?expiresAt: Date\.now\(\) \+ 10 \* 60 \* 1000/,
  "repeat opens may reuse only short-lived tab-memory bytes after server source-version validation",
);
assert.match(
  reviewerPreview,
  /sourceBytes\.byteLength > REVIEWER_PDF_MAX_SOURCE_BYTES[\s\S]*?sourceBytes\[0\] !== 0x25[\s\S]*?sourceBytes\[4\] !== 0x2d[\s\S]*?bytes\.byteLength > REVIEWER_PDF_MAX_OUTPUT_BYTES/,
  "source and watermarked preview bytes must be bounded and start with a PDF signature",
);
assert.match(
  reviewerPreview,
  /await watermarkReviewerPreviewPdfBytes\([\s\S]*?response\.fullName[\s\S]*?response\.email[\s\S]*?resourcePortalReviewerPdf/,
  "online preview must embed the verified identity into PDF bytes before rendering",
);
assert.match(
  reviewerPreview,
  /cachedReviewerPdf\.fullName !== String\(response\.fullName \|\| ""\)[\s\S]*?cachedReviewerPdf\.email !== String\(response\.email \|\| ""\)[\s\S]*?type: "get_reviewer_pdf_preview"/,
  "a cached derivative with an old identity must trigger a fresh source fetch",
);
assert.match(
  frontend,
  /async function watermarkReviewerPreviewPdfBytes\([\s\S]*?PDFDocument\.load[\s\S]*?page\.drawText[\s\S]*?await pdf\.save[\s\S]*?REVIEWER_PDF_MAX_OUTPUT_BYTES/,
  "the browser must create and size-check a zoom-safe watermarked PDF derivative",
);
assert.match(
  frontend,
  /function loadReviewerPdfLibrary\(\)[\s\S]*?meta\[name="mrh-pdf-lib"\][\s\S]*?script\.async = true[\s\S]*?globalScope\.PDFLib/,
  "the browser should lazily load the locally hosted PDF library for previews",
);
assert.match(
  reviewerDownload,
  /type: "get_reviewer_pdf"[\s\S]*?type: "get_reviewer_pdf_job"[\s\S]*?link\.download/,
  "only the explicit download action may enqueue and save a physical watermarked PDF",
);
assert.match(
  reviewerDownload,
  /__MRH_PDF_DOWNLOAD_ACTIVE = true[\s\S]*?finally[\s\S]*?__MRH_PDF_DOWNLOAD_ACTIVE = false/,
  "downloading a Reviewer PDF should defer automatic app reloads until it finishes",
);
assert.match(
  reviewerDownload,
  /let pollDelayMs = 1000[\s\S]*?Math\.min\(2500, Math\.round\(pollDelayMs \* 1\.35\)\)/,
  "browser polling should start promptly and use a shorter capped backoff",
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
  /runReviewerPdfWatermarkProofOfConcept[\s\S]*?7,461 ms/,
  "the setup guide must report the measured Apps Script proof",
);
assert.match(
  setupGuide,
  /10IQyKdYYX5_jP1hQHVjoSEml4FxAlGCl[\s\S]*?one second[\s\S]*?setupReviewerPdfDelivery/,
  "the setup guide must document output storage, faster trigger requests, and setup",
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

async function verifyClientWatermarkRuntime() {
  const placementPattern =
    /(\[\s*\[0\.25,\s*0\.14\][\s\S]*?\[0\.75,\s*0\.86\],?\s*\])\.forEach/;
  const frontendPlacements = frontend.match(placementPattern)?.[1];
  const backendPlacements = pdfHelper.match(placementPattern)?.[1];
  assert.ok(frontendPlacements && backendPlacements);
  assert.deepEqual(
    JSON.parse(frontendPlacements.replace(/,\s*([\]}])/g, "$1")),
    JSON.parse(backendPlacements.replace(/,\s*([\]}])/g, "$1")),
    "frontend preview and backend download must use identical watermark positions",
  );
  const watermarkSizingPattern =
    /Math\.max\(\s*40,\s*Math\.min\(size\.width,\s*size\.height\)\s*\*\s*([0-9.]+)\s*\)[\s\S]*?Math\.min\(\s*([0-9.]+),\s*Math\.min\(size\.width,\s*size\.height\)\s*\*\s*([0-9.]+)\s*\)/;
  assert.deepEqual(
    frontend.match(watermarkSizingPattern)?.slice(1),
    pdfHelper.match(watermarkSizingPattern)?.slice(1),
    "frontend preview and backend download must use identical watermark sizing",
  );
  assert.match(
    frontendPlacements,
    /\[0\.32,\s*0\.26\][\s\S]*?\[0\.68,\s*0\.5\][\s\S]*?\[0\.32,\s*0\.74\]/,
    "center watermark stamps should alternate horizontally to avoid diagonal alignment",
  );

  const watermarkStart = frontend.indexOf(
    "  async function watermarkReviewerPreviewPdfBytes(",
  );
  const watermarkEnd = frontend.indexOf(
    "\n  async function previewResourceFile(",
    watermarkStart,
  );
  assert.ok(watermarkStart >= 0 && watermarkEnd > watermarkStart);
  const watermarkFunction = frontend.slice(watermarkStart, watermarkEnd);
  const createWatermarker = new Function(
    "PDFLib",
    "REVIEWER_PDF_MAX_SOURCE_BYTES",
    "REVIEWER_PDF_MAX_OUTPUT_BYTES",
    `const loadReviewerPdfLibrary = () => Promise.resolve(PDFLib);\n${watermarkFunction}\nreturn watermarkReviewerPreviewPdfBytes;`,
  );
  const watermarkPdf = createWatermarker(
    PDFLib,
    2 * 1024 * 1024,
    4 * 1024 * 1024,
  );
  const sourcePdf = await PDFLib.PDFDocument.create();
  sourcePdf.addPage([612, 792]).drawText("Preview sample");
  const outputBytes = await watermarkPdf(
    await sourcePdf.save(),
    "Reviewer Example",
    "Reviewer.Name@Example.com",
  );
  assert.equal(String.fromCharCode(...outputBytes.slice(0, 5)), "%PDF-");
  const outputPdf = await PDFLib.PDFDocument.load(outputBytes);
  assert.equal(outputPdf.getPageCount(), 1);

  const page = outputPdf.getPages()[0];
  const content = outputPdf.context.lookup(page.node.Contents());
  const streams =
    content instanceof PDFLib.PDFArray
      ? content.asArray()
      : [page.node.Contents()];
  const decodedContent = streams
    .map((streamReference) =>
      PDFLib.decodePDFRawStream(
        outputPdf.context.lookup(streamReference),
      )
        .decode()
        .reduce((text, byte) => text + String.fromCharCode(byte), ""),
    )
    .join("\n")
    .replace(/<([0-9a-fA-F]+)> Tj/g, (_match, hex) =>
      hex.match(/.{2}/g).map((byte) => String.fromCharCode(parseInt(byte, 16))).join(""),
    );
  assert.equal(
    decodedContent.split("Reviewer Example").length - 1,
    11,
    "the preview PDF should include eleven embedded name stamps",
  );
  assert.equal(
    decodedContent.split("Reviewer.Name@Example.com").length - 1,
    11,
    "the preview PDF should preserve the verified email's letter case on all stamps",
  );
}

verifyClientWatermarkRuntime()
  .then(() => console.log("Reviewer PDF security contract checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
