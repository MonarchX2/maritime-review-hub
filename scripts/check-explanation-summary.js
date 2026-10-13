const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const backendContext = {};
vm.createContext(backendContext);
vm.runInContext(
  `${fs.readFileSync("backend/main.js", "utf8")}
globalThis.summaryApi = { encodeSummaryDictionary, decodeSummaryDictionary, hasUsableExplanation };`,
  backendContext,
  { filename: "backend/main.js" },
);

const backend = backendContext.summaryApi;
assert.equal(backend.hasUsableExplanation([{ e: "" }, { e: "  " }]), false);
assert.equal(backend.hasUsableExplanation([{ e: " Available " }]), true);

const encoded = backend.encodeSummaryDictionary([
  { s: "Available", c: 1, t: "ID", l: "f", e: "t" },
  { s: "Unavailable", c: 1, t: "ID", l: "f", e: "f" },
]);
assert.equal(encoded.d[0].length, 6, "available decks include the e marker");
assert.equal(encoded.d[1].length, 5, "unavailable decks omit the e marker");
assert.equal(backend.decodeSummaryDictionary(encoded)[0].e, "t");
assert.equal(backend.decodeSummaryDictionary(encoded)[1].e, "f");
assert.equal(
  backend.decodeSummaryDictionary({
    v: 1,
    p: [""],
    d: [[0, "Marker", 1, "ID", 0, 0]],
  })[0].e,
  "t",
  "the presence of the e slot denotes explanation availability",
);

const appCore = fs.readFileSync("app-core.js", "utf8");
const normalizeStart = appCore.indexOf("function normalizeSummaryData(");
const normalizeEnd = appCore.indexOf(
  "\n  function normalizeAccessFlag(",
  normalizeStart,
);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);

const frontendContext = {
  normalizeAccessFlag(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0 || value == null || value === "") {
      return false;
    }
    return ["true", "1", "yes", "y", "on", "t"].includes(
      String(value).trim().toLowerCase(),
    );
  },
};
vm.createContext(frontendContext);
vm.runInContext(
  `${appCore.slice(normalizeStart, normalizeEnd)}
globalThis.normalizeSummaryData = normalizeSummaryData;`,
  frontendContext,
  { filename: "app-core.js summary normalizer" },
);

const normalized = frontendContext.normalizeSummaryData(encoded);
assert.equal(normalized[0].HasExplanations, true);
assert.equal(normalized[1].HasExplanations, false);
assert.equal(
  frontendContext.normalizeSummaryData({
    v: 1,
    p: [""],
    d: [[0, "Marker", 1, "ID", 0, 0]],
  })[0].HasExplanations,
  true,
);
assert.equal(
  frontendContext.normalizeSummaryData({
    v: 1,
    p: [""],
    d: [[0, "No Marker", 1, "ID", 0]],
  })[0].HasExplanations,
  false,
);

const helperStart = appCore.indexOf(
  "      const folderExplanationAvailabilityCache = new WeakMap();",
);
const helperEnd = appCore.indexOf(
  "      const downloadedSubjects = new Set(",
  helperStart,
);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const folderContext = {
  deckHasExplanations(deckData) {
    return (
      Object.prototype.hasOwnProperty.call(deckData || {}, "e") ||
      deckData?.HasExplanations === true
    );
  },
};
vm.createContext(folderContext);
vm.runInContext(
  `${appCore.slice(helperStart, helperEnd)}
globalThis.folderHasOnlyExplainedDecks = folderHasOnlyExplainedDecks;`,
  folderContext,
  { filename: "app-core.js folder explanation helper" },
);

const allAvailable = {
  _children: {
    Explained: { _data: { e: "t" }, _children: {} },
    Nested: {
      _children: {
        AlsoExplained: { _data: { HasExplanations: true }, _children: {} },
      },
    },
  },
};
assert.equal(folderContext.folderHasOnlyExplainedDecks(allAvailable), true);
assert.equal(
  folderContext.folderHasOnlyExplainedDecks({
    _children: {
      Explained: { _data: { e: "t" }, _children: {} },
      Missing: { _data: {}, _children: {} },
    },
  }),
  false,
  "a folder must not claim complete explanation coverage when a child deck lacks explanations",
);
assert.equal(
  folderContext.folderHasOnlyExplainedDecks({ _children: {} }),
  false,
  "an empty folder must not claim explanation coverage",
);
assert.equal(
  folderContext.folderHasOnlyExplainedDecks({
    _data: { IsFolder: true },
    _children: {
      Explained: { _data: { e: "t" }, _children: {} },
    },
  }),
  true,
  "folder metadata must not count as a child deck",
);

assert.match(appCore, /isGroup\s*\?\s*folderHasOnlyExplainedDecks\(item\)/);
assert.match(
  appCore,
  /const explanationsAvailableBadge =\s*folderHasOnlyExplainedDecks\(item\)/,
);

console.log("Explanation summary checks passed.");
