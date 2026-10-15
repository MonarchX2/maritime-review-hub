const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appCore = fs.readFileSync("app-core.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const previewUrlFunction = appCore.match(
  /  function getResourcePreviewUrl\(fileId, mimeType\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(previewUrlFunction, "Resources should provide a Drive preview URL");

const previewContext = { encodeURIComponent };
vm.createContext(previewContext);
vm.runInContext(
  `${previewUrlFunction}\nglobalThis.getResourcePreviewUrl = getResourcePreviewUrl;`,
  previewContext,
);
assert.equal(
  previewContext.getResourcePreviewUrl(
    "abcdefghij",
    "application/vnd.google-apps.document",
  ),
  "https://docs.google.com/document/d/abcdefghij/preview",
  "Google Docs should use the native in-site preview URL",
);
assert.equal(
  previewContext.getResourcePreviewUrl(
    "abcdefghij",
    "application/vnd.google-apps.spreadsheet",
  ),
  "https://docs.google.com/spreadsheets/d/abcdefghij/preview",
  "Google Sheets should use the native in-site preview URL",
);
assert.equal(
  previewContext.getResourcePreviewUrl("abcdefghij", "application/pdf"),
  "https://drive.google.com/file/d/abcdefghij/preview",
  "ordinary Drive files should use the Drive viewer",
);
assert.throws(
  () => previewContext.getResourcePreviewUrl("invalid/id", "application/pdf"),
  /invalid file ID/,
  "preview URLs should reject malformed file IDs",
);

assert.match(
  appCore,
  /previewButton\.addEventListener\("click", \(\) => \{\s*void previewResourceFile\([\s\S]*?item\.isPublic === true/,
  "clicking a Drive file should choose a public Drive preview or private in-site preview",
);
assert.match(
  appCore,
  /type: "get_resource_preview",\s*fileId/,
  "private Drive file contents should load through the backend preview action",
);
assert.match(
  appCore,
  /type: "get_resource_preview",\s*fileId\s*\},\s*\{\s*timeoutMs: 60000,\s*maxRetries: 0/,
  "private Google Workspace exports should have time to complete without duplicate requests",
);
assert.match(
  appCore,
  /getSessionStoredJSON[\s\S]*?setSessionStoredJSON/,
  "recent folder listings should persist briefly in the current browser session",
);
assert.match(
  appCore,
  /const RESOURCE_PORTAL_CACHE_TTL_MS = 5 \* 60 \* 1000/,
  "the browser cache should expire rather than retain resource listings indefinitely",
);
assert.match(
  appCore,
  /renderResourcePortalListing\(cachedEntry\.response, "refreshing"\)/,
  "cached folders should appear immediately while the portal refreshes them",
);
assert.match(
  appCore,
  /function filterResourcePortalItems\(query\)[\s\S]*?row\.dataset\.search\.includes\(normalizedQuery\)/,
  "search should filter the files and folders currently displayed",
);
assert.match(
  appCore,
  /function openResourcePortalRoot\(\)[\s\S]*?resourcePortalCurrentFolderId = ""/,
  "the My Files navigation should return to the public resource root",
);
assert.match(
  appCore,
  /resource-portal-row[\s\S]*?resource-portal-item-type[\s\S]*?resource-portal-item-modified/,
  "resource rows should include name, type, and modified-time fields",
);
assert.match(
  index,
  /frame-src https:\/\/drive\.google\.com https:\/\/docs\.google\.com blob:/,
  "the content security policy should allow Drive and in-site preview frames",
);
assert.match(
  index,
  /id="resource-portal-preview-frame"[\s\S]*?allowfullscreen/,
  "the Resources view should contain an embedded file preview",
);
assert.match(
  index,
  /class="resource-portal-shell"[\s\S]*?class="resource-portal-sidebar"[\s\S]*?class="resource-portal-browser"/,
  "the Resources view should use the file portal sidebar layout",
);
assert.match(
  index,
  /id="resource-portal-search"[\s\S]*?oninput="filterResourcePortalItems\(this\.value\)"/,
  "the portal should provide live search within the current folder",
);
assert.match(
  index,
  /id="resource-portal-preview-download"[\s\S]*?Download/,
  "private files should have an in-site download link",
);
assert.match(
  index,
  /Content is visible to website visitors[\s\S]*?Reviewer folders remain excluded/,
  "the file browser should disclose website visibility and retained reviewer restrictions",
);

console.log("Resource Portal in-site preview checks passed.");
