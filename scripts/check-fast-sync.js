const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("sync-core.js", "utf8");
const timerCallbacks = new Map();
let nextTimerId = 0;
let storedTimestamp = "2026-10-14T00:00:00.000Z";
let snapshotRequests = 0;
let summaryApplied = 0;
let pendingPayloadRefreshes = 0;
const nextSummary = [
  {
    Subject: "COLREGS",
    QuestionCount: 1,
    PayloadVersion: "a".repeat(64),
  },
];
const context = {
  AbortController,
  Date,
  Map,
  Math,
  Promise,
  console,
  LifecycleUtils: {
    setTimeout(callback) {
      const id = ++nextTimerId;
      timerCallbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timerCallbacks.delete(id);
    },
    setInterval(callback) {
      return this.setTimeout(callback);
    },
    clearInterval(id) {
      timerCallbacks.delete(id);
    },
  },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: "sync-core.js" });

const state = {
  categorySummary: [
    {
      Subject: "COLREGS",
      QuestionCount: 1,
      PayloadVersion: "b".repeat(64),
    },
  ],
};
const controller = context.SyncCore.createController({
  state,
  lifecycle: context.LifecycleUtils,
  appConfig: { backendPayloadSchemaVersion: 2, syncIntervalMs: 60000 },
  network: {
    async getDeckSyncSnapshot(options) {
      snapshotRequests += 1;
      if (snapshotRequests === 1) {
        assert.equal(options.since, storedTimestamp);
        return {
          status: "ok",
          payloadSchemaVersion: 2,
          syncTimestamp: "2026-10-15T00:00:00.000Z",
          summary: nextSummary,
        };
      }
      return {
        status: "ok",
        payloadSchemaVersion: 2,
        syncTimestamp: storedTimestamp,
        notModified: true,
      };
    },
    async getSyncStatus() {
      throw new Error("Fast sync should not issue a separate status request.");
    },
    async getDeckSummary() {
      throw new Error("Fast sync should not issue a separate summary request.");
    },
  },
  logger: { warn() {}, error() {}, info() {} },
  isLeader: () => true,
  hasActiveSession: () => false,
  isImmediateUpdateMode: () => true,
  setSyncConnected() {},
  setColdStart() {},
  normalizeSummaryData: (summary) => summary,
  readStoredSyncStatusTimestamp: () => storedTimestamp,
  persistSyncStatusTimestamp(timestamp) {
    storedTimestamp = timestamp;
  },
  persistSummaryData: async () => true,
  applySummaryData(summary) {
    summaryApplied += 1;
    state.categorySummary = summary;
  },
  setAccessMetadata() {},
  sanitizeDeletedDeckReferences() {},
  updateSyncStatus() {},
  setGlobalLoadingState() {},
  hideConnectionStatusAfterDelay() {},
  renderCategoryProgress() {},
  showColdStartNotification() {},
  getSummarySignature: (summary) => JSON.stringify(summary),
  async refreshPendingPayloads() {
    pendingPayloadRefreshes += 1;
  },
});

async function main() {
  await controller.optimizedBackgroundSync();
  assert.equal(snapshotRequests, 1);
  assert.equal(summaryApplied, 1);
  assert.equal(storedTimestamp, "2026-10-15T00:00:00.000Z");

  await controller.optimizedBackgroundSync();
  assert.equal(snapshotRequests, 2);
  assert.equal(summaryApplied, 1);
  assert.equal(pendingPayloadRefreshes, 1);

  controller.cleanup();
  assert.equal(timerCallbacks.size, 0);

  const cachedState = {
    categorySummary: [
      {
        Subject: "COLREGS",
        QuestionCount: 1,
        PayloadVersion: "b".repeat(64),
      },
    ],
  };
  let initialSyncComplete = false;
  let categoryProgressRenders = 0;
  const renderCachedCategoryProgress = () => {
    categoryProgressRenders += 1;
  };
  const cachedController = context.SyncCore.createController({
    state: cachedState,
    lifecycle: context.LifecycleUtils,
    appConfig: { backendPayloadSchemaVersion: 2, syncIntervalMs: 60000 },
    network: {
      async getDeckSyncSnapshot(options) {
        assert.equal(options.since, storedTimestamp);
        return {
          status: "ok",
          payloadSchemaVersion: 2,
          syncTimestamp: storedTimestamp,
          notModified: true,
        };
      },
      async getSyncStatus() {
        throw new Error("Fast sync should not issue a separate status request.");
      },
      async getDeckSummary() {
        throw new Error("Fast sync should not issue a separate summary request.");
      },
    },
    logger: { warn() {}, error() {}, info() {} },
    isLeader: () => true,
    hasActiveSession: () => false,
    isImmediateUpdateMode: () => true,
    setSyncConnected() {},
    markInitialSyncCompleteFromCache() {
      if (
        initialSyncComplete ||
        !Array.isArray(cachedState.categorySummary) ||
        cachedState.categorySummary.length === 0
      )
        return false;
      initialSyncComplete = true;
      renderCachedCategoryProgress();
      return true;
    },
    setColdStart() {},
    normalizeSummaryData: (summary) => summary,
    readStoredSyncStatusTimestamp: () => storedTimestamp,
    persistSyncStatusTimestamp() {},
    persistSummaryData: async () => true,
    applySummaryData() {
      assert.fail("An unchanged cached summary must not be reapplied.");
    },
    setAccessMetadata() {},
    sanitizeDeletedDeckReferences() {},
    updateSyncStatus() {},
    setGlobalLoadingState() {},
    hideConnectionStatusAfterDelay() {},
    renderCategoryProgress: renderCachedCategoryProgress,
    showColdStartNotification() {},
    getSummarySignature: (summary) => JSON.stringify(summary),
    async refreshPendingPayloads() {},
  });
  await cachedController.optimizedBackgroundSync();
  assert.equal(initialSyncComplete, true);
  assert.equal(categoryProgressRenders, 1);
  cachedController.cleanup();
  assert.equal(timerCallbacks.size, 0);
  console.log("Fast sync snapshot checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
