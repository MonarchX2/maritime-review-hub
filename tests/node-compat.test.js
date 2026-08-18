const assert = require("assert");

const StorageUtils = require("../storage-utils.js");
const SessionUtils = require("../session-utils.js");
const AppState = require("../app-core-state.js");

delete global.state;
delete global.userState;

const storage =
  globalThis.__mrhNodeStorage || (globalThis.__mrhNodeStorage = {});
for (const key of Object.keys(storage)) delete storage[key];

AppState.state.currentPath = ["HOME", "Card 1", "CARD2"];
AppState.saveState();
assert.deepStrictEqual(
  JSON.parse(StorageUtils.getStoredItem("mrh_navigation_path") || "[]"),
  ["HOME", "Card 1", "CARD2"],
);

assert.doesNotThrow(() => StorageUtils.getSafeStorageIdentity());
assert.doesNotThrow(() => StorageUtils.getStorageNamespace());
assert.doesNotThrow(() => SessionUtils.getProgressMeta());
assert.doesNotThrow(() => SessionUtils.createIdempotencyKey({ ok: true }));

console.log("node compatibility tests passed");
