const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  console,
  JSON,
  Math,
  Date,
  Logger: { log() {} },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_algorithm, value) {
      return Array.from(
        crypto.createHash("sha256").update(String(value), "utf8").digest(),
        (byte) => (byte > 127 ? byte - 256 : byte),
      );
    },
  },
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync("backend/main.js", "utf8"),
  context,
  { filename: "backend/main.js" },
);

assert.equal(
  context.normalizeStoredPassword("test"),
  "test",
  "plaintext UUID-sheet passwords must remain plaintext in memory",
);
assert.equal(
  context.passwordMatches("test", "test"),
  true,
  "a plaintext UUID-sheet password must match the value entered on the website",
);
assert.equal(
  context.passwordMatches("test ", "test"),
  false,
  "password comparison must preserve exact whitespace",
);
assert.equal(
  context.passwordMatches(
    "test",
    "sha256i$1500$41ba38ac-d185-4a8f-93a6-59dc216090da$b054ecf509de3038f955b79468f0ef2b5230f0a433714b3f8136ca1e5605833a",
  ),
  true,
  "existing iterated password hashes must remain verifiable",
);
assert.equal(
  context.passwordMatches(
    "test",
    "sha256i$1500$41ba38ac-d185-4a8f-93a6-59dc216090da$b7f62bd56d0fabe86e860c6cecc8eac8fcd00921ebeb17e2f20f4e89f9418245",
  ),
  false,
  "invalid hashes must not be accepted for a plaintext password",
);
let writtenUUIDRows;
const sheetTextFormats = [];
const sheetWriteEvents = [];
context.getOrInitializeUUIDSheet = () => ({
  getLastRow: () => 1,
  getRange() {
    return {
      setValues(values) {
        writtenUUIDRows = values;
        sheetWriteEvents.push("values");
      },
      setNumberFormat(format) {
        sheetTextFormats.push(format);
        sheetWriteEvents.push("format");
      },
    };
  },
});
context.writeUUIDRecords([
  { uuid: "deck-1", subject: "TEST", password: "test" },
  { uuid: "deck-2", subject: "FORMULA-LIKE", password: "=literal" },
]);
assert.equal(
  writtenUUIDRows.find((row) => row[1] === "TEST")[3],
  "test",
  "UUID sheet writes must preserve the plaintext password rather than replace it with a hash",
);
assert.equal(
  writtenUUIDRows.find((row) => row[1] === "FORMULA-LIKE")[3],
  "=literal",
  "UUID sheet writes must preserve formula-like passwords exactly",
);
assert.equal(
  sheetTextFormats[0],
  "@",
  "UUID sheet password cells must be formatted as text before writing",
);
assert.equal(
  sheetWriteEvents[0],
  "format",
  "UUID password cells must be text-formatted before password values are written",
);
context.loadDeckMetadataMap = () => Object.create(null);

assert.equal(
  context.filterSummaryDataByAccess("{ invalid json"),
  null,
  "malformed summary data must be distinguished from a valid empty summary",
);
assert.equal(
  context.filterSummaryDataByAccess(JSON.stringify({ v: 2, p: [], d: [] })),
  null,
  "unsupported summary encodings must trigger recovery",
);
assert.deepEqual(
  JSON.parse(context.filterSummaryDataByAccess("[]")),
  { v: 1, p: [], d: [], h: [] },
  "a valid empty summary must remain a successful empty result",
);
assert.equal(
  context.filterSummaryDataByAccess(JSON.stringify([{ Subject: "STALE" }])),
  null,
  "legacy non-empty summaries without payload fingerprints must trigger recovery",
);

const response = {
  content: "",
  setMimeType() {
    return this;
  },
};
const properties = new Map([
  ["MRH_SUBJECT_SCHEMA_VERSION", "10"],
  ["LAST_CACHE_BUILD_SUCCESS", "2026-10-14T00:00:00.000Z"],
]);
context.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput(content) {
    return { ...response, content };
  },
};
context.getScriptProps = () => ({
  getProperty: (key) => properties.get(key) || null,
  setProperty: (key, value) => properties.set(key, value),
});
context.jsonResponse = (payload) => payload;
context.generateCacheKey = () => "summary";
context.cacheGetChunked = () => "{ invalid cached json";
context.cachePutChunked = () => {};
context.loadDeckMetadataMap = () => ({
  COLREGS: { uuid: "deck-1", password: "", hidden: false },
});
context.getOrCreateCacheFolder = () => ({});

const validPersistentSummary = JSON.stringify({
  v: 1,
  p: [""],
  d: [[0, "COLREGS", 1, "MC", 0]],
  h: ["a".repeat(64)],
});
context.findCacheFilesByName = () => ({
  hasNext: () => true,
  next: () => ({
    getBlob: () => ({ getDataAsString: () => validPersistentSummary }),
  }),
});
const recoveredResponse = context.doGetInternal({ parameter: {} });
assert.deepEqual(
  JSON.parse(recoveredResponse.content),
  {
    v: 1,
    p: [""],
    d: [[0, "COLREGS", 1, "MC", 0]],
    h: ["a".repeat(64)],
  },
  "a corrupt cache entry must fall back to the valid persistent summary",
);

let rebuildScheduled = false;
context.getScriptProps = () => ({
  getProperty: (key) => properties.get(key) || null,
  setProperty: (key, value) => properties.set(key, value),
});
context.ensureResumeBuildTrigger = () => {
  rebuildScheduled = true;
};
context.findCacheFilesByName = () => ({
  hasNext: () => true,
  next: () => ({ getBlob: () => ({ getDataAsString: () => "{ broken" }) }),
});
const coldStartResponse = context.doGetInternal({ parameter: {} });
assert.deepEqual(
  JSON.parse(JSON.stringify(coldStartResponse)),
  { isColdStart: true, subjects: [] },
  "two invalid summary copies must report cold start instead of a successful empty list",
);
assert.equal(properties.get("FORCE_REBUILD"), "true");
assert.equal(rebuildScheduled, true);

context.errorResponse = (message, code) => ({
  status: "error",
  code,
  message,
});
context.loadDeckMetadataMap = () => Object.create(null);
context.getEffectivePassword = () => "";
context.isSubjectHiddenByHierarchy = () => false;
assert.equal(
  context.doGetInternal({ parameter: { subject: "MISSING" } }).status,
  "error",
  "GET deck errors must use the network client's recognized error envelope",
);

context.loadDeckMetadataMap = () => ({
  LOCKED: { uuid: "deck-locked", password: "protected" },
});
context.getEffectivePassword = () => "protected";
assert.equal(
  context.doGetInternal({ parameter: { subject: "LOCKED" } }).code,
  "PASSWORD_REQUIRED",
);

context.loadDeckMetadataMap = () => ({
  HIDDEN: { uuid: "deck-hidden", password: "" },
});
context.getEffectivePassword = () => "";
context.isSubjectHiddenByHierarchy = () => true;
assert.equal(
  context.doGetInternal({ parameter: { subject: "HIDDEN" } }).code,
  "FORBIDDEN",
);

const rateLimitValues = new Map();
let rateLimitLockHeld = false;
let canAcquireRateLimitLock = true;
let rateLimitLockReleases = 0;
context.LockService = {
  getUserLock() {
    return {
      tryLock(timeoutMs) {
        assert.equal(timeoutMs, 5000);
        if (!canAcquireRateLimitLock || rateLimitLockHeld) return false;
        rateLimitLockHeld = true;
        return true;
      },
      releaseLock() {
        assert.equal(rateLimitLockHeld, true);
        rateLimitLockHeld = false;
        rateLimitLockReleases += 1;
      },
    };
  },
};
context.CacheService = {
  getScriptCache() {
    return {
      get(key) {
        assert.equal(
          rateLimitLockHeld,
          true,
          "rate-limit reads must be protected by the user lock",
        );
        return rateLimitValues.get(key) || null;
      },
      put(key, value, ttlSeconds) {
        assert.equal(
          rateLimitLockHeld,
          true,
          "rate-limit writes must be protected by the same user lock",
        );
        assert.equal(ttlSeconds, 60);
        rateLimitValues.set(key, value);
      },
    };
  },
};
assert.equal(context.incrementRateLimit("password", 2, 60), true);
assert.equal(context.incrementRateLimit("password", 2, 60), true);
assert.equal(context.incrementRateLimit("password", 2, 60), false);
assert.equal(rateLimitValues.get("password"), "2");
assert.equal(rateLimitLockReleases, 3);

canAcquireRateLimitLock = false;
assert.equal(
  context.incrementRateLimit("contended", 2, 60),
  false,
  "rate-limit updates must fail closed when the lock cannot be acquired",
);
assert.equal(rateLimitValues.has("contended"), false);
assert.equal(rateLimitLockReleases, 3);

console.log("Backend cache recovery checks passed.");
