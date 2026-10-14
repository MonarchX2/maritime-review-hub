const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  console,
  JSON,
  Math,
  Date,
  Logger: { log() {} },
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync("backend/main.js", "utf8"),
  context,
  { filename: "backend/main.js" },
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
