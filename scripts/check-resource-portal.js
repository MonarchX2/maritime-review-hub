const assert = require("node:assert/strict");
const fs = require("node:fs");

const appCore = fs.readFileSync("app-core.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
assert.match(
  appCore,
  /previewButton\.addEventListener\("click", \(\) => \{\s*void previewResourceFile\(\s*item\.id,\s*item\.name/,
  "clicking a file should open the portal's own online preview",
);
const appNetwork = fs.readFileSync("app-core-network.js", "utf8");
assert.match(
  appNetwork,
  /cache: "no-store"/,
  "backend requests, including document preview responses, must not use the browser HTTP cache",
);
assert.match(
  appCore,
  /type: "get_resource_preview",\s*fileId/,
  "file contents should load only through the backend preview action",
);
assert.match(
  appCore,
  /type: "get_resource_preview",\s*fileId\s*\},\s*\{\s*timeoutMs: 60000,\s*maxRetries: 0/,
  "Google Workspace exports should have time to complete without duplicate requests",
);
assert.doesNotMatch(
  appCore,
  /resource_portal_listing_\$\{|RESOURCE_PORTAL_CACHE_TTL|setSessionStoredJSON/,
  "folder listings must not be persisted in browser storage",
);
assert.match(
  appCore,
  /removeSessionStoredItemsByPrefix\("resource_portal_listing_"\)/,
  "obsolete listing data from previous portal releases should be removed",
);
assert.match(
  appCore,
  /function filterResourcePortalItems\(query\)[\s\S]*?row\.dataset\.search\.includes\(normalizedQuery\)/,
  "search should filter the files and folders currently displayed",
);
assert.match(
  appCore,
  /function openResourcePortalRoot\(\)[\s\S]*?resourcePortalCurrentFolderId = ""/,
  "the My Files navigation should return to the resource root",
);
assert.match(
  appCore,
  /resource-portal-row[\s\S]*?resource-portal-item-type[\s\S]*?resource-portal-item-modified/,
  "resource rows should include name, type, and modified-time fields",
);
assert.match(
  index,
  /frame-src blob:/,
  "the content security policy should allow only in-site preview frames",
);
assert.match(
  index,
  /id="resource-portal-preview-frame"[\s\S]*?allowfullscreen/,
  "the Resources view should contain an embedded file preview",
);
assert.match(
  index,
  /id="resource-portal-preview-expand"[\s\S]*?onclick="toggleResourceViewer\(\)"/,
  "online file previews should be expandable into a focused viewer",
);
assert.match(
  appCore,
  /function openResourcePortalAccess\(\)[\s\S]*?browser\.hidden = true;[\s\S]*?accessScreen\.hidden = false/,
  "reviewer access navigation should open its dedicated access screen",
);
assert.match(
  appCore,
  /function toggleResourceViewer\(\)[\s\S]*?preview\.classList\.toggle\("is-expanded"\)/,
  "the online viewer should support expanded and inline modes",
);
assert.match(
  index,
  /class="resource-portal-shell"[\s\S]*?class="resource-portal-sidebar"[\s\S]*?class="resource-portal-browser"/,
  "the Resources view should use the file portal sidebar layout",
);
assert.match(
  index,
  /id="resource-portal-access-nav"[\s\S]*?Reviewer access[\s\S]*?id="resource-portal-access-screen"/,
  "the portal should provide a separate reviewer access screen",
);
assert.match(
  index,
  /id="resource-portal-access-screen"[\s\S]*?Secure Google sign-in has not been configured[\s\S]*?id="resource-portal-auth-help"[\s\S]*?Access will be enabled only after account verification/,
  "reviewer sign-in must clearly remain unavailable until identity and grants are configured",
);
assert.match(
  index,
  /class="resource-portal-google-signin"[\s\S]*?disabled/,
  "the portal must not present an unconfigured sign-in button as functional",
);
assert.match(
  index,
  /id="resource-portal-search"[\s\S]*?oninput="filterResourcePortalItems\(this\.value\)"/,
  "the portal should provide live search within the current folder",
);
assert.doesNotMatch(
  index,
  /resource-portal-preview-download|>\s*Download\s*</i,
  "the portal should not expose a file download control",
);
assert.ok(
  index.includes("Matching reviewer folders and their contents are withheld") &&
    index.includes("Browser-based copying or") &&
    index.includes("capture cannot be prevented"),
  "the portal should disclose reviewer restrictions and the limits of online viewing",
);
assert.doesNotMatch(
  `${appCore}\n${index}`,
  /https:\/\/(?:drive|docs)\.google\.com\/(?:file|document|spreadsheets|presentation)/i,
  "the portal should not embed reusable Google Drive viewer URLs",
);
assert.doesNotMatch(
  appCore,
  /resource-portal-preview-download|item\.url|resource-portal-drive-link/,
  "the portal should not create download or original-file links",
);
assert.match(
  appCore,
  /Online preview is not available for this file type\./,
  "unsupported file types should show a view-only unsupported message",
);
assert.doesNotMatch(
  appCore,
  /REVIEWERS v/,
  "reviewer authorization must not rely on client-side name filtering",
);

const reviewerNamePattern = /^REVIEWERS v\d{2}\.\d{2}\.\d{2}$/;
assert.equal(reviewerNamePattern.test("REVIEWERS v01.02.03"), true);
assert.equal(reviewerNamePattern.test("REVIEWERS v12.05.26"), true);
assert.equal(reviewerNamePattern.test("REVIEWERS v1.2"), false);
assert.equal(reviewerNamePattern.test("REVIEWERS archive"), false);
assert.equal(reviewerNamePattern.test("REVIEWERS v01.02"), false);
assert.equal(reviewerNamePattern.test("REVIEWERS v01.02.03 Draft"), false);

console.log("Resource Portal privacy and preview checks passed.");
