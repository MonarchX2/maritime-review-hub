const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

assert.match(
  fs.readFileSync("app-core.js", "utf8"),
  /const SYNC_STATUS_STORAGE_KEY = "mrh_last_applied_sync_status_timestamp";/,
  "sync must not trust timestamps saved before a summary was applied",
);

const timeoutCallbacks = new Map();
const intervalCallbacks = new Map();
let nextTimerId = 0;
let summaryFetchCount = 0;
let storedTimestamp = "";
let currentSyncTimestamp = "backend-v1";
let activeSession = false;
let immediateMode = true;
let pendingSummaryData = null;
let failSummaryPersistence = false;
const appliedSummaries = [];
const lifecycle = {
  setTimeout(callback) {
    const id = ++nextTimerId;
    timeoutCallbacks.set(id, callback);
    return id;
  },
  clearTimeout(id) {
    timeoutCallbacks.delete(id);
  },
  setInterval(callback) {
    const id = ++nextTimerId;
    intervalCallbacks.set(id, callback);
    return id;
  },
  clearInterval(id) {
    intervalCallbacks.delete(id);
  },
  registerCleanup() {},
};
const context = {
  AbortController,
  Date,
  Map,
  Math,
  Promise,
  console,
  LifecycleUtils: lifecycle,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("sync-core.js", "utf8"), context, {
  filename: "sync-core.js",
});

const state = { categorySummary: [] };
function applySummaryData(summary) {
  state.categorySummary = summary;
  appliedSummaries.push(summary);
  if (pendingSummaryData) {
    Promise.resolve(failSummaryPersistence ? false : true).then((saved) => {
      if (saved !== false && pendingSummaryData) {
        pendingSummaryData = null;
        controller.confirmPendingSummaryApplied();
      }
    });
  }
}

const controller = context.SyncCore.createController({
  state,
  lifecycle,
  appConfig: {
    syncIntervalMs: 60000,
    syncRetryIntervalMs: 3000,
    syncRetryMaxDelayMs: 60000,
    syncRequestTimeoutMs: 60000,
  },
  network: {
    async getSyncStatus() {
      return { status: "ok", syncTimestamp: currentSyncTimestamp };
    },
    async getDeckSummary() {
      summaryFetchCount += 1;
      if (summaryFetchCount === 1) throw new Error("temporary network failure");
      return [
        { Subject: summaryFetchCount >= 3 ? "STABILITY" : "COLREGS" },
      ];
    },
  },
  logger: { warn() {}, error() {}, info() {} },
  isLeader: () => true,
  hasActiveSession: () => activeSession,
  isImmediateUpdateMode: () => immediateMode,
  setSyncConnected() {},
  setColdStart() {},
  normalizeSummaryData: (summary) => summary,
  readStoredSyncStatusTimestamp: () => storedTimestamp,
  persistSyncStatusTimestamp(timestamp) {
    storedTimestamp = timestamp;
  },
  async persistSummaryData() {
    if (failSummaryPersistence) {
      failSummaryPersistence = false;
      return false;
    }
    return true;
  },
  applySummaryData,
  setPendingSummaryData(summary) {
    pendingSummaryData = summary;
  },
  setAccessMetadata() {},
  sanitizeDeletedDeckReferences() {},
  updateSyncStatus() {},
  setGlobalLoadingState() {},
  hideConnectionStatusAfterDelay() {},
  renderCategoryProgress() {},
  showColdStartNotification() {},
  getSummarySignature: (summary) => JSON.stringify(summary),
});

const sessionContext = {
  AbortController,
  Date,
  LifecycleUtils: lifecycle,
  state: {
    session: {
      active: true,
      questions: [{ Subject: "COLREGS" }],
      currentIndex: 0,
      userAnswers: { 0: "A" },
    },
    prefs: {},
  },
  applySummaryData,
  saveState: () => Promise.resolve(true),
  setStoredJSON: () => true,
  removeStoredItem: () => true,
  updateSyncStatus() {},
};
Object.defineProperty(sessionContext, "pendingSummaryData", {
  get: () => pendingSummaryData,
  set: (summary) => {
    pendingSummaryData = summary;
  },
});
vm.createContext(sessionContext);
vm.runInContext(fs.readFileSync("session-core.js", "utf8"), sessionContext, {
  filename: "session-core.js",
});
async function main() {
  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 1);
  assert.equal(
    storedTimestamp,
    "",
    "a failed summary fetch must not checkpoint the backend timestamp",
  );

  await controller.optimizedBackgroundSync();
  assert.equal(
    summaryFetchCount,
    2,
    "the unchanged backend timestamp must still retry after the prior fetch failed",
  );
  assert.equal(storedTimestamp, "backend-v1");
  assert.equal(appliedSummaries.length, 1);

  await controller.optimizedBackgroundSync();
  assert.equal(
    summaryFetchCount,
    2,
    "a successfully applied timestamp must skip redundant summary downloads",
  );

  currentSyncTimestamp = "backend-v2";
  activeSession = true;
  immediateMode = false;
  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 3);
  assert.equal(
    storedTimestamp,
    "backend-v1",
    "a deferred session update must not be marked as applied",
  );

  await controller.optimizedBackgroundSync();
  assert.equal(
    summaryFetchCount,
    3,
    "a deferred summary must not be downloaded repeatedly during the same session",
  );

  activeSession = false;
  immediateMode = true;
  failSummaryPersistence = true;
  sessionContext.SessionCore.endSession(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionContext.state.session.active, false);
  assert.notEqual(pendingSummaryData, null);
  assert.notEqual(controller.getStatus().pendingSummaryData, null);
  assert.equal(
    storedTimestamp,
    "backend-v1",
    "a failed session-end persistence must leave the timestamp uncheckpointed",
  );
  assert.equal(
    appliedSummaries.length,
    2,
    "the real session-end flow must apply the deferred summary",
  );

  failSummaryPersistence = false;
  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 4);
  assert.equal(storedTimestamp, "backend-v2");
  assert.equal(pendingSummaryData, null);
  assert.equal(controller.getStatus().pendingSummaryData, null);
  assert.equal(
    appliedSummaries.length,
    3,
    "a failed deferred persistence must be retried and applied",
  );

  await controller.optimizedBackgroundSync();
  assert.equal(
    summaryFetchCount,
    4,
    "a successfully applied timestamp must skip redundant summary downloads",
  );

  currentSyncTimestamp = "backend-v3";
  failSummaryPersistence = true;
  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 5);
  assert.equal(
    storedTimestamp,
    "backend-v2",
    "a failed summary persistence must not checkpoint the backend timestamp",
  );

  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 6);
  assert.equal(
    storedTimestamp,
    "backend-v3",
    "a later successful persistence must checkpoint the timestamp",
  );

  controller.cleanup();
  assert.equal(timeoutCallbacks.size, 0);
  assert.equal(intervalCallbacks.size, 0);
  console.log("Sync timestamp recovery checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
