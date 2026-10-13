const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const appCore = fs.readFileSync(path.join(rootDir, "app-core.js"), "utf8");
const styles = fs.readFileSync(path.join(rootDir, "styles.css"), "utf8");

assert.match(
  appCore,
  /"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"/,
  "Grid deck cards should use the shared 1.25rem spacing.",
);
assert.match(
  appCore,
  /"flex flex-col gap-5"/,
  "List deck cards should use the same spacing as the grid.",
);
assert.doesNotMatch(
  appCore,
  /"flex flex-col space-y-4"/,
  "List layout should not use a different vertical spacing utility.",
);
assert.ok(
  appCore.includes('class="deck-card ${') &&
    appCore.includes("relative w-full flex flex-col"),
  "Deck cards should size from their content and grid track instead of 100% height.",
);
assert.ok(
  appCore.includes("group bg-white dark:bg-gray-800 rounded-xl") &&
    appCore.includes("overflow-hidden flex flex-col transform hover:-translate-y-1 relative"),
  "Folder cards should size from their content without a forced height.",
);
assert.match(styles, /main\s*\{\s*scrollbar-gutter:\s*stable;/);
assert.match(
  styles,
  /\.deck-card-title-text\s*\{\s*overflow-wrap:\s*anywhere;/,
);
assert.match(styles, /\.deck-card-badges\s*\{\s*align-content:\s*flex-start;/);
assert.match(
  styles,
  /#category-list \[data-deck-list-layout\]\.grid\s*\{\s*grid-auto-rows:\s*auto;/,
  "Each grid row should size to its tallest card.",
);
assert.doesNotMatch(
  styles,
  /#category-list \[data-deck-list-layout\]\.grid\s*>[^}]*align-self:\s*start;/,
  "Grid cards should stretch to fill their equal-height rows.",
);
assert.doesNotMatch(styles, /\.deck-card-title(?:,|\s*\{)[^}]*min-height:/);
assert.doesNotMatch(styles, /\.deck-card-badges\s*\{[^}]*max-height:/);
assert.doesNotMatch(styles, /\.deck-folder-card\s*\{[^}]*min-height:/);

console.log("Deck layout spacing checks passed.");
