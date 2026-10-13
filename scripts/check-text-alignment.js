const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const bodyClasses = new Set();
const body = {
  classList: {
    remove(...classes) {
      classes.forEach((name) => bodyClasses.delete(name));
    },
    add(name) {
      bodyClasses.add(name);
    },
  },
};
const alignmentSelect = { value: "left" };
let saveCount = 0;
const context = {
  state: { prefs: { textAlignment: "left" } },
  document: {
    body,
    getElementById(id) {
      return id === "text-alignment-select" ? alignmentSelect : null;
    },
  },
  saveState() {
    saveCount += 1;
    return true;
  },
};
context.globalScope = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync("preferences-core.js", "utf8"),
  context,
  { filename: "preferences-core.js" },
);

for (const alignment of ["left", "center", "right", "justify"]) {
  assert.equal(context.PreferencesCore.setTextAlignment(alignment), true);
  assert.equal(context.state.prefs.textAlignment, alignment);
  assert.equal(alignmentSelect.value, alignment);
  assert.ok(bodyClasses.has(`text-align-${alignment}`));
  assert.equal(bodyClasses.size, 1, "only the selected alignment class remains");
}
assert.equal(context.PreferencesCore.setTextAlignment("invalid"), false);
assert.equal(context.state.prefs.textAlignment, "justify");
assert.equal(saveCount, 4, "valid user changes are persisted");

const appStateSource = fs.readFileSync("app-core-state.js", "utf8");
const normalizeStart = appStateSource.indexOf("function normalizePrefs(");
const normalizeEnd = appStateSource.indexOf(
  "\n  function syncPreferenceControls(",
  normalizeStart,
);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);

const normalizeContext = {
  state: { prefs: { textAlignment: "left" } },
  coerceBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  },
};
vm.createContext(normalizeContext);
vm.runInContext(
  `${appStateSource.slice(normalizeStart, normalizeEnd)}
globalThis.normalizePrefs = normalizePrefs;`,
  normalizeContext,
  { filename: "app-core-state.js preference normalization" },
);
assert.equal(
  normalizeContext.normalizePrefs({ textAlignment: "center" }).textAlignment,
  "center",
);
assert.equal(
  normalizeContext.normalizePrefs({ textAlignment: "invalid" }).textAlignment,
  "left",
);
assert.equal(
  normalizeContext.normalizePrefs({}).textAlignment,
  "left",
);

const html = fs.readFileSync("index.html", "utf8");
assert.match(html, /id="text-alignment-select"/);
assert.match(html, /onchange="setTextAlignment\(this\.value\)"/);
assert.match(
  html,
  /id="text-alignment-select"[\s\S]*?<\/select>\s*<p[^>]*>\s*Default to LEFT\s*<\/p>/,
);
assert.match(
  html,
  /id="text-alignment-help"[\s\S]*?Affects question and explanation text, deck-review content, and selected help, warning, and status messages\. It does not affect answer choices, buttons, navigation, or setting controls\./,
);
assert.match(
  html,
  /id="text-alignment-select"[\s\S]*?aria-describedby="text-alignment-help"/,
);
assert.match(html, /<h3 class="[^"]*user-text-content[^"]*" id="q-text"/);
assert.match(html, /id="q-explanation-text"/);
assert.match(
  fs.readFileSync("deck-review-core.js", "utf8"),
  /user-text-content font-medium text-gray-800/,
);
assert.match(
  fs.readFileSync("styles.css", "utf8"),
  /body\.text-align-justify \.user-text-content\s*\{\s*text-align: justify;/,
);

console.log("Text alignment checks passed.");
