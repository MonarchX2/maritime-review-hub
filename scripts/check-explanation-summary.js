const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const backendContext = {};
vm.createContext(backendContext);
vm.runInContext(
  `${fs.readFileSync("backend/main.js", "utf8")}
globalThis.summaryApi = { encodeSummaryDictionary, decodeSummaryDictionary, hasUsableExplanation, handleSyncStatus };`,
  backendContext,
  { filename: "backend/main.js" },
);

const backend = backendContext.summaryApi;
assert.equal(backend.hasUsableExplanation([{ e: "" }, { e: "  " }]), false);
assert.equal(backend.hasUsableExplanation([{ e: " Available " }]), true);

const scriptProperties = new Map([
  ["MRH_SUBJECT_SCHEMA_VERSION", "8"],
  ["LAST_CACHE_BUILD_SUCCESS", "2026-10-14T00:00:00.000Z"],
  ["MRH_CACHE_VERSION", "old-cache-version"],
]);
let rebuildScheduled = false;
backendContext.getScriptProps = () => ({
  getProperty: (key) => scriptProperties.get(key) || null,
  setProperty: (key, value) => scriptProperties.set(key, value),
});
backendContext.jsonResponse = (payload) => payload;
backendContext.ensureResumeBuildTrigger = () => {
  rebuildScheduled = true;
};
const schemaStatus = backend.handleSyncStatus();
assert.equal(schemaStatus.isColdStart, true);
assert.equal(schemaStatus.subjectSchemaVersion, "10");
assert.equal(schemaStatus.payloadSchemaVersion, 2);
assert.equal(rebuildScheduled, true);
assert.equal(scriptProperties.get("FORCE_REBUILD"), "true");

const encoded = backend.encodeSummaryDictionary([
  { s: "Available", c: 1, t: "ID", l: "f", e: "t", h: "a".repeat(64) },
  { s: "Unavailable", c: 1, t: "ID", l: "f", e: "f", h: "b".repeat(64) },
]);
assert.equal(encoded.d[0].length, 6, "available decks include the e marker");
assert.equal(encoded.d[1].length, 5, "unavailable decks omit the e marker");
assert.equal(backend.decodeSummaryDictionary(encoded)[0].e, "t");
assert.equal(backend.decodeSummaryDictionary(encoded)[1].e, "f");
assert.equal(Array.from(encoded.h).join(","), `${"a".repeat(64)},${"b".repeat(64)}`);
assert.equal(backend.decodeSummaryDictionary(encoded)[1].h, "b".repeat(64));
assert.equal(
  backend.decodeSummaryDictionary({ ...encoded, h: [encoded.h[0]] }),
  null,
  "the backend must reject a summary with a short fingerprint array",
);
assert.equal(
  backend.decodeSummaryDictionary({
    ...encoded,
    d: [[1, "Malformed", 1, "ID", 0]],
    h: [encoded.h[0]],
  }),
  null,
  "the backend must reject malformed summary rows rather than silently dropping decks",
);
assert.equal(
  backend.decodeSummaryDictionary({
    v: 1,
    p: [""],
    d: [[0, "Marker", 1, "ID", 0, 1]],
    h: ["c".repeat(64)],
  })[0].e,
  "t",
  "the presence of the e slot denotes explanation availability",
);

const appCore = fs.readFileSync("app-core.js", "utf8");
const changedDecksStart = appCore.indexOf(
  "  function getChangedDownloadedDecks(",
);
const changedDecksEnd = appCore.indexOf(
  "\n  function applySummaryData(",
  changedDecksStart,
);
assert.ok(changedDecksStart >= 0 && changedDecksEnd > changedDecksStart);
const changedDecksContext = { Map, Set, String, Array };
vm.createContext(changedDecksContext);
vm.runInContext(
  `${appCore.slice(changedDecksStart, changedDecksEnd)}
globalThis.getChangedDownloadedDecks = getChangedDownloadedDecks;`,
  changedDecksContext,
  { filename: "app-core.js payload fingerprint helper" },
);
const changedDownloadedDecks =
  changedDecksContext.getChangedDownloadedDecks(
    [
      { Subject: "UNCHANGED", PayloadVersion: "a" },
      { Subject: "CHANGED", PayloadVersion: "old" },
      { Subject: "NOT-DOWNLOADED", PayloadVersion: "old" },
      { Subject: "REMOVED", PayloadVersion: "old" },
    ],
    [
      { Subject: "UNCHANGED", PayloadVersion: "a" },
      { Subject: "CHANGED", PayloadVersion: "new" },
      { Subject: "NOT-DOWNLOADED", PayloadVersion: "new" },
      { Subject: "NO-FINGERPRINT" },
    ],
    new Set(["UNCHANGED", "CHANGED", "REMOVED"]),
  );
assert.equal(
  Array.from(changedDownloadedDecks).sort().join(","),
  "CHANGED,REMOVED",
);

const activeSessionStart = appCore.indexOf(
  "  function hasActiveContentSession()",
);
const activeSessionEnd = appCore.indexOf(
  "\n  async function refreshPendingDeckPayloads()",
  activeSessionStart,
);
assert.ok(activeSessionStart >= 0 && activeSessionEnd > activeSessionStart);
const activeSessionContext = {
  state: { session: { active: false } },
  document: {
    reviewActive: false,
    getElementById() {
      return {
        classList: {
          contains: () => activeSessionContext.document.reviewActive,
        },
      };
    },
  },
};
vm.createContext(activeSessionContext);
vm.runInContext(
  `${appCore.slice(activeSessionStart, activeSessionEnd)}
globalThis.hasActiveContentSession = hasActiveContentSession;`,
  activeSessionContext,
  { filename: "app-core.js active content session helper" },
);
assert.equal(
  activeSessionContext.hasActiveContentSession(),
  false,
  "a remembered review subject must not keep a closed study session active",
);
activeSessionContext.document.reviewActive = true;
assert.equal(activeSessionContext.hasActiveContentSession(), true);

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
assert.equal(normalized[0].PayloadVersion, "a".repeat(64));
assert.equal(normalized[1].PayloadVersion, "b".repeat(64));
assert.throws(
  () =>
    frontendContext.normalizeSummaryData({
      ...encoded,
      d: [[99, "Wrong Prefix", 1, "ID", 0]],
      h: ["c".repeat(64)],
    }),
  /malformed/,
  "the frontend must reject compact summary rows with invalid prefix indexes",
);
assert.throws(
  () =>
    frontendContext.normalizeSummaryData({
      ...encoded,
      h: [encoded.h[0]],
    }),
  /fingerprints are malformed/,
  "the frontend must reject compact summaries with an incomplete fingerprint array",
);
assert.equal(
  frontendContext.normalizeSummaryData({
    v: 1,
    p: [""],
    d: [[0, "Marker", 1, "ID", 0, 1]],
    h: ["c".repeat(64)],
  })[0].HasExplanations,
  true,
);
assert.equal(
  frontendContext.normalizeSummaryData({
    v: 1,
    p: [""],
    d: [[0, "No Marker", 1, "ID", 0]],
    h: ["d".repeat(64)],
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
