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
  index,
  /frame-src https:\/\/drive\.google\.com https:\/\/docs\.google\.com/,
  "the content security policy should allow only Google Drive preview frames",
);
assert.match(
  index,
  /id="resource-portal-preview-frame"[\s\S]*?allowfullscreen/,
  "the Resources view should contain an embedded file preview",
);

console.log("Resource Portal in-site preview checks passed.");
