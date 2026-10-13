const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const appCore = fs.readFileSync(path.join(rootDir, "app-core.js"), "utf8");
const styles = fs.readFileSync(path.join(rootDir, "styles.css"), "utf8");

assert.match(appCore, /function isTreeViewConstrained\(\)/);
assert.match(appCore, /state\.prefs\.layoutMode !== "tree"/);
assert.match(appCore, /availableWidth < 600/);
assert.match(appCore, /treeView\?\.querySelector\("\.deck-tree-row"\)/);
assert.match(
  appCore,
  /Tree view may be difficult to read on your current screen\. For a better experience, use a larger screen or rotate your device to landscape mode\./,
);
assert.match(appCore, /supportsMobileLandscapeAction\(\)/);
assert.match(appCore, /orientation\.lock\("landscape"\)/);
assert.match(
  appCore,
  /Your browser cannot change orientation here\. Please rotate your device manually\./,
);
assert.match(appCore, /rootScope\.addEventListener\(\s*"resize"/);
assert.match(appCore, /treeViewNoticeDismissed \|\| !isTreeViewConstrained\(\)/);
assert.match(styles, /\.tree-view-readability-notice\[hidden\]\s*\{\s*display:\s*none;/);
assert.match(styles, /@media \(max-width: 639px\)\s*\{\s*\.tree-view-readability-notice/);

console.log("Tree view readability checks passed.");
