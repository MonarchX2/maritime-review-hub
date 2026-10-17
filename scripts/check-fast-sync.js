const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("sync-core.js", "utf8");
const timerCallbacks = new Map();
let nextTimerId = 0;
let storedTimestamp = "2026-10-14T00:00:00.000Z";
let storedCacheVersion = "cache-v1";
let snapshotRequests = 0;
let summaryApplied = 0;
let pendingPayloadRefreshes = 0;
const syncSuccesses = [];
const syncStatusUpdates = [];
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
        assert.equal(options.sinceCacheVersion, storedCacheVersion);
        return {
          status: "ok",
          payloadSchemaVersion: 2,
          syncTimestamp: "2026-10-15T00:00:00.000Z",
          cacheVersion: "cache-v2",
          summary: nextSummary,
        };
      }
      assert.equal(options.sinceCacheVersion, storedCacheVersion);
      if (storedCacheVersion !== "cache-v2")
        return {
          status: "ok",
          payloadSchemaVersion: 2,
          syncTimestamp: "2026-10-14T00:00:00.000Z",
          cacheVersion: "cache-v2",
          summary: [
            {
              Subject: "COLREGS",
              QuestionCount: 2,
              PayloadVersion: "c".repeat(64),
            },
          ],
        };
      return {
        status: "ok",
        payloadSchemaVersion: 2,
        syncTimestamp: storedTimestamp,
        cacheVersion: "cache-v2",
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
  onSyncSuccess(status) {
    syncSuccesses.push(status);
  },
  isLeader: () => true,
  hasActiveSession: () => false,
  isImmediateUpdateMode: () => true,
  setSyncConnected() {},
  setColdStart() {},
  normalizeSummaryData: (summary) => summary,
  readStoredSyncStatusTimestamp: () => storedTimestamp,
  readStoredSyncStatusCacheVersion: () => storedCacheVersion,
  persistSyncStatusTimestamp(timestamp, cacheVersion) {
    storedTimestamp = timestamp;
    storedCacheVersion = cacheVersion;
  },
  persistSummaryData: async () => true,
  applySummaryData(summary) {
    summaryApplied += 1;
    state.categorySummary = summary;
  },
  setAccessMetadata() {},
  sanitizeDeletedDeckReferences() {},
  updateSyncStatus(message, tone) {
    syncStatusUpdates.push({ message, tone });
  },
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
  assert.equal(storedCacheVersion, "cache-v2");
  assert.equal(
    JSON.stringify(syncSuccesses[0]),
    JSON.stringify({
      syncTimestamp: "2026-10-15T00:00:00.000Z",
      cacheVersion: "cache-v2",
      payloadSchemaVersion: 2,
    }),
  );

  await controller.optimizedBackgroundSync();
  assert.equal(snapshotRequests, 2);
  assert.equal(summaryApplied, 1);
  assert.equal(pendingPayloadRefreshes, 1);
  assert.equal(
    syncSuccesses.length,
    2,
    "unchanged backend snapshots should still publish a connected state",
  );
  assert.equal(
    syncStatusUpdates.at(-1).tone,
    "success",
    "an unchanged startup snapshot must clear the loading sync indicator",
  );

  storedCacheVersion = "cache-v1";
  await controller.optimizedBackgroundSync();
  assert.equal(snapshotRequests, 3);
  assert.equal(
    summaryApplied,
    2,
    "a changed cache version must refresh data even when its timestamp is older",
  );
  assert.equal(storedTimestamp, "2026-10-14T00:00:00.000Z");
  assert.equal(storedCacheVersion, "cache-v2");

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
        assert.equal(options.sinceCacheVersion, storedCacheVersion);
        return {
          status: "ok",
          payloadSchemaVersion: 2,
          syncTimestamp: storedTimestamp,
          cacheVersion: storedCacheVersion,
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
    readStoredSyncStatusCacheVersion: () => storedCacheVersion,
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

  let redundantSnapshotRequests = 0;
  let prefetchedSummaryApplications = 0;
  let prefetchedSyncTimestamp = "";
  let prefetchedSyncSuccesses = 0;
  const prefetchedController = context.SyncCore.createController({
    state: { categorySummary: [] },
    lifecycle: context.LifecycleUtils,
    appConfig: { backendPayloadSchemaVersion: 2 },
    network: {
      async getDeckSyncSnapshot() {
        redundantSnapshotRequests += 1;
        throw new Error("A prefetched snapshot must not be fetched again.");
      },
      async getSyncStatus() {
        assert.fail("A prefetched snapshot must not request status separately.");
      },
      async getDeckSummary() {
        assert.fail("A prefetched snapshot must not request summary separately.");
      },
    },
    logger: { warn() {}, error() {}, info() {} },
    onSyncSuccess() {
      prefetchedSyncSuccesses += 1;
    },
    isLeader: () => false,
    hasActiveSession: () => false,
    isImmediateUpdateMode: () => true,
    setSyncConnected() {},
    setColdStart() {},
    normalizeSummaryData: (summary) => summary,
    readStoredSyncStatusTimestamp: () => "",
    persistSyncStatusTimestamp(timestamp) {
      prefetchedSyncTimestamp = timestamp;
    },
    persistSummaryData: async () => true,
    applySummaryData() {
      prefetchedSummaryApplications += 1;
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
  await prefetchedController.syncPrefetchedSnapshot({
    status: "ok",
    payloadSchemaVersion: 2,
    syncTimestamp: "snapshot-stamp",
    cacheVersion: "snapshot-cache",
    summary: nextSummary,
  });
  assert.equal(redundantSnapshotRequests, 0);
  assert.equal(prefetchedSummaryApplications, 1);
  assert.equal(prefetchedSyncTimestamp, "snapshot-stamp");
  assert.equal(prefetchedSyncSuccesses, 1);
  await prefetchedController.syncPrefetchedSnapshot({
    status: "ok",
    payloadSchemaVersion: 2,
    syncTimestamp: "snapshot-stamp",
    cacheVersion: "snapshot-cache",
    notModified: true,
  });
  assert.equal(redundantSnapshotRequests, 0);
  assert.equal(
    prefetchedSummaryApplications,
    1,
    "a prefetched not-modified snapshot should not attempt a second summary request",
  );
  assert.equal(prefetchedSyncSuccesses, 2);
  prefetchedController.cleanup();
  assert.equal(timerCallbacks.size, 0);
  console.log("Fast sync snapshot checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
