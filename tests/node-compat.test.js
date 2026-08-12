const assert = require("assert");

const StorageUtils = require("../storage-utils.js");
const SessionUtils = require("../session-utils.js");

delete global.state;
delete global.userState;

assert.doesNotThrow(() => StorageUtils.getSafeStorageIdentity());
assert.doesNotThrow(() => StorageUtils.getStorageNamespace());
assert.doesNotThrow(() => SessionUtils.getProgressMeta());
assert.doesNotThrow(() => SessionUtils.createIdempotencyKey({ ok: true }));

console.log("node compatibility tests passed");
