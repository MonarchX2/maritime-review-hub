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
  /previewButton\.addEventListener\("click", \(\) => \{\s*previewResourceFile\(item\.id, item\.name, item\.mimeType\);/,
  "clicking a Drive file should preview it inside the Resources view",
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
  /frame-src https:\/\/drive\.google\.com https:\/\/docs\.google\.com/,
  "the content security policy should allow only Google Drive preview frames",
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
  /Public resources[\s\S]*?Reviewer folders are excluded from this public browser/,
  "the file browser should clearly retain its public-only access boundary",
);

console.log("Resource Portal in-site preview checks passed.");
