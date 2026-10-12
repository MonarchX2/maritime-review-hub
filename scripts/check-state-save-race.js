const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const idleCallbacks = [];
const storedValues = new Map();
const pendingWrites = [];
const context = {
  module: { exports: {} },
  console,
  Date,
  Math,
  Promise,
  JSON,
  requestIdleCallback(callback) {
    idleCallbacks.push(callback);
  },
  StorageUtils: {
    mergeStoredJSON(key, value, merge) {
      return new Promise((resolve) => {
        pendingWrites.push({ key, merge, resolve });
      });
    },
    getStoredItem() {
      return null;
    },
    getAnyNamespaceStoredItem() {
      return null;
    },
    setStoredItem() {
      return true;
    },
    removeStoredItem() {
      return true;
    },
    getStoredJSON() {
      return null;
    },
    setStoredJSON() {
      return true;
    },
    getSessionStoredItem() {
      return null;
    },
    setSessionStoredItem() {
      return true;
    },
    removeSessionStoredItem() {
      return true;
    },
    getSessionStoredJSON() {
      return null;
    },
    setSessionStoredJSON() {
      return true;
    },
  },
  DebugUtils: {
    error() {},
    warn() {},
  },
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync("app-core-state.js", "utf8"),
  context,
  { filename: "app-core-state.js" },
);

function completeNextWrite() {
  const write = pendingWrites.shift();
  assert.ok(write, "expected an outstanding serialized-state write");
  const value = write.merge(storedValues.get(write.key) ?? null);
  storedValues.set(write.key, value);
  write.resolve({ saved: true, value });
}

function runNextIdleCallback() {
  const callback = idleCallbacks.shift();
  assert.ok(callback, "expected a queued state-save flush");
  return callback();
}

async function checkReplacementDuringPendingSave() {
  const appState = context.module.exports;
  appState.state.stats = {
    totalAnswered: 4,
    correct: 3,
    mistakes: [],
    subjectAccuracy: {},
    completedQs: [],
    srsMap: {},
  };

  const savePromise = appState.saveState("stats");
  const firstFlush = runNextIdleCallback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingWrites.length, 1);

  appState.state.stats = {
    totalAnswered: 0,
    correct: 0,
    mistakes: [],
    subjectAccuracy: {},
    completedQs: [],
    srsMap: {},
  };
  appState.saveState("stats");

  completeNextWrite();
  await new Promise((resolve) => setImmediate(resolve));
  const secondFlush = runNextIdleCallback();
  assert.equal(pendingWrites.length, 1);
  completeNextWrite();
  await Promise.all([firstFlush, secondFlush]);
  assert.equal(await savePromise, true);

  assert.equal(
    appState.state.stats.totalAnswered,
    0,
    "an older in-flight snapshot must not overwrite a newer state replacement",
  );
  assert.equal(
    storedValues.get("stats").totalAnswered,
    0,
    "the queued follow-up save must persist the newer reset state",
  );
}

checkReplacementDuringPendingSave()
  .then(() => console.log("State-save race checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
