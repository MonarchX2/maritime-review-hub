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
const appStateSource = fs.readFileSync("app-core-state.js", "utf8");
const mergeHelpersStart = appStateSource.indexOf("  function cloneStoredValue");
const mergeHelpersEnd = appStateSource.indexOf("  function coerceBoolean");
assert.ok(mergeHelpersStart >= 0 && mergeHelpersEnd > mergeHelpersStart);
const mergeHelpers = vm.runInNewContext(
  `${appStateSource.slice(mergeHelpersStart, mergeHelpersEnd)}
  ({ mergeStoredStateValue });`,
);
const baseStudyProgress = { page: 1, index: 0, updatedAt: 100 };
const newerStudyProgress = { page: 1, index: 2, updatedAt: 300 };
const olderStudyProgress = { page: 1, index: 1, updatedAt: 200 };
assert.equal(
  JSON.stringify(
    mergeHelpers.mergeStoredStateValue(
      "prefs",
      baseStudyProgress,
      newerStudyProgress,
      olderStudyProgress,
      "prefs.studyProgress.Deck",
    ),
  ),
  JSON.stringify(newerStudyProgress),
  "a later study-progress edit must win over a stale tab save",
);
assert.equal(
  JSON.stringify(
    mergeHelpers.mergeStoredStateValue(
      "prefs",
      baseStudyProgress,
      olderStudyProgress,
      newerStudyProgress,
      "prefs.studyProgress.Deck",
    ),
  ),
  JSON.stringify(newerStudyProgress),
  "study-progress conflict resolution must not depend on response arrival order",
);
const baseSrs = { qId: "q1", reps: 1, lastAnsweredAt: 100 };
const newerSrs = { qId: "q1", reps: 3, lastAnsweredAt: 300 };
const olderSrs = { qId: "q1", reps: 2, lastAnsweredAt: 200 };
assert.equal(
  JSON.stringify(
    mergeHelpers.mergeStoredStateValue(
      "stats",
      baseSrs,
      olderSrs,
      newerSrs,
      "stats.srsMap.q1",
    ),
  ),
  JSON.stringify(newerSrs),
  "a stale SRS record must not overwrite the most recently answered record",
);

vm.createContext(context);
vm.runInContext(
  appStateSource,
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

async function checkPersistenceStopBeforeClear() {
  const appState = context.module.exports;
  appState.state.stats = {
    totalAnswered: 8,
    correct: 5,
    mistakes: [],
    subjectAccuracy: {},
    completedQs: [],
    srsMap: {},
  };

  appState.saveState("stats");
  assert.equal(idleCallbacks.length, 1);
  const staleIdleCallback = idleCallbacks[0];
  const stopped = appState.stopStatePersistence();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingWrites.length, 1);

  completeNextWrite();
  assert.equal(await stopped, true);

  storedValues.clear();
  assert.equal(
    await appState.saveState("stats"),
    false,
    "state saves must be rejected after persistence is stopped",
  );
  assert.equal(
    idleCallbacks.length,
    1,
    "stopping persistence must leave only the already-scheduled stale callback",
  );
  assert.equal(
    storedValues.size,
    0,
    "finishing the in-flight save before clearing must prevent data resurrection",
  );

  appState.resumeStatePersistence();
  appState.state.stats.totalAnswered = 9;
  appState.saveState("stats");
  const currentIdleCallback = idleCallbacks.shift();
  assert.equal(typeof currentIdleCallback, "function");
  const staleFlush = staleIdleCallback();
  const currentFlush = currentIdleCallback();
  assert.equal(
    pendingWrites.length,
    1,
    "a stale idle callback must not start a second concurrent state flush",
  );
  completeNextWrite();
  await Promise.all([staleFlush, currentFlush]);
  assert.equal(storedValues.get("stats").totalAnswered, 9);
}

checkReplacementDuringPendingSave()
  .then(checkPersistenceStopBeforeClear)
  .then(() => console.log("State-save race checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
