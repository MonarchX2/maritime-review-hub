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

assert.match(
  backend,
  /function handleGetReviewerPdfRequest\(data\)[\s\S]*?authorizeReviewerRequest_\(data, true\)/,
  "each protected PDF request must recheck the account without the short cache",
);
assert.match(
  backend,
  /function handleGetReviewerPdfRequest\(data\)[\s\S]*?getReviewerPdfIndexEntries_\(\)[\s\S]*?getReviewerPdfDriveHierarchy_\(fileId\)[\s\S]*?ROOT_FOLDER_ID/,
  "the handler must verify current Reviewer-index membership and root ancestry",
);
assert.match(
  backend,
  /function handleGetReviewerPdfRequest\(data\)[\s\S]*?await verifyReviewerPdfWatermarks_\([\s\S]*?mimeType: "application\/pdf"[\s\S]*?data: Utilities\.base64Encode\(outputBytes\)/,
  "only a derivative verified page-by-page may be returned",
);
const protectedPdfHandler = backend.match(
  /async function handleGetReviewerPdfRequest\(data\) \{[\s\S]*?\n\}/,
)?.[0] || "";
assert.doesNotMatch(
  protectedPdfHandler,
  /data:\s*sourceBytes|base64Encode\(\s*sourceBytes\s*\)/,
  "the protected route must never serialize source PDF bytes",
);
assert.match(
  backend,
  /if \(requestType === "get_reviewer_pdf"\)\s*return errorResponse\([\s\S]*?PDF_RUNTIME_UNVERIFIED/,
  "the web-app route must fail closed until its async PDF path is proven compatible",
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
  /get_reviewer_pdf:\s*\{\s*required:\s*\["sessionId",\s*"eventId",\s*"fileId"\]/,
  "the frontend must require a session, correlation ID, and file ID for protected PDFs",
);
assert.match(
  network,
  /cache:\s*"no-store"/,
  "protected backend POST requests must bypass browser caching",
);
assert.match(
  frontend,
  /resourceDashboardActiveTab === "REVIEWERS"[\s\S]*?mrh-reviewer-pdf:[\s\S]*?type: "get_reviewer_pdf"[\s\S]*?sessionId: reviewerSessionId/,
  "only the Reviewer tab may route opaque PDF IDs to the protected viewer",
);
assert.doesNotMatch(
  frontend.match(/async function previewResourceFile\([\s\S]*?\n  \}/)?.[0] || "",
  /window\.open|location\.href|drive\.google\.com/,
  "the PDF viewer must not open or redirect to the original Drive URL",
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
  /not a supported\s+return type/,
  "the setup guide must document the blocked web-app response",
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
