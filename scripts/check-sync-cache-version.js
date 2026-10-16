const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const backendSource = fs.readFileSync("backend/main.js", "utf8");
const context = {
  console,
  Date,
  JSON,
  Math,
};
vm.createContext(context);
vm.runInContext(backendSource, context, { filename: "backend/main.js" });

const timestamp = "2026-10-16T12:00:00.000Z";
const properties = new Map([
  ["MRH_SUBJECT_SCHEMA_VERSION", "10"],
  ["LAST_CACHE_BUILD_SUCCESS", "true"],
  ["BUILD_STATUS", "IDLE"],
  ["MRH_CACHE_VERSION_TIMESTAMP", timestamp],
  ["MRH_CACHE_VERSION", "cache-v2"],
]);
context.getScriptProps = () => ({
  getProperty: (key) => properties.get(key) || "",
});
context.generateCacheKey = () => "summary";
context.cacheGetChunked = () => "[]";
context.filterSummaryDataByAccess = () => "[]";
context.jsonResponse = (payload) => payload;

const changedCacheVersion = context.handleDeckSyncSnapshot_(
  timestamp,
  "cache-v1",
);
assert.equal(
  changedCacheVersion.notModified,
  undefined,
  "a cache mutation must fetch a fresh summary even if the timestamp is unchanged",
);
assert.equal(changedCacheVersion.cacheVersion, "cache-v2");
assert.deepEqual(
  JSON.parse(JSON.stringify(changedCacheVersion.summary)),
  [],
);

const unchangedSnapshot = context.handleDeckSyncSnapshot_(timestamp, "cache-v2");
assert.equal(unchangedSnapshot.notModified, true);

assert.match(
  backendSource,
  /handleDeckSyncSnapshot_\(\s*String\(params\.since \|\| ""\),\s*String\(params\.sinceCacheVersion \|\| ""\),\s*\)/,
  "the GET sync endpoint must accept both parts of the applied-state token",
);

console.log("Sync cache-version consistency checks passed.");
