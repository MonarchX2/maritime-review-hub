const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("sync-core.js", "utf8");
const timerCallbacks = new Map();
const timeoutDelays = new Map();
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
    setTimeout(callback, delay = 0) {
      const id = ++nextTimerId;
      timerCallbacks.set(id, callback);
      timeoutDelays.set(id, delay);
      return id;
    },
    clearTimeout(id) {
      timerCallbacks.delete(id);
      timeoutDelays.delete(id);
    },
    setInterval(callback, delay = 0) {
      const id = ++nextTimerId;
      timerCallbacks.set(id, callback);
      return id;
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

  let concurrentSnapshotRequests = 0;
  let releaseConcurrentSnapshot;
  const concurrentSyncController = context.SyncCore.createController({
    state: { categorySummary: [] },
    lifecycle: context.LifecycleUtils,
    appConfig: { backendPayloadSchemaVersion: 2 },
    network: {
      getDeckSyncSnapshot() {
        concurrentSnapshotRequests += 1;
        return new Promise((resolve) => {
          releaseConcurrentSnapshot = resolve;
        });
      },
    },
    logger: { warn() {}, error() {}, info() {} },
    isLeader: () => true,
    hasActiveSession: () => false,
    readStoredSyncStatusTimestamp: () => "same-timestamp",
    readStoredSyncStatusCacheVersion: () => "same-cache-version",
    refreshPendingPayloads: async () => {},
    updateSyncStatus() {},
    setSyncConnected() {},
    setColdStart() {},
    onSyncSuccess() {},
  });
  const concurrentSyncStartedAt = performance.now();
  const concurrentSyncRuns = Array.from({ length: 32 }, () =>
    concurrentSyncController.optimizedBackgroundSync(),
  );
  await Promise.resolve();
  assert.equal(
    concurrentSnapshotRequests,
    1,
    "concurrent same-tab sync triggers must share a single in-flight snapshot request",
  );
  releaseConcurrentSnapshot({
    status: "ok",
    payloadSchemaVersion: 2,
    syncTimestamp: "same-timestamp",
    cacheVersion: "same-cache-version",
  });
  await Promise.all(concurrentSyncRuns);
  assert.equal(concurrentSnapshotRequests, 1);
  console.log(
    JSON.stringify({
      test: "concurrent sync trigger coalescing",
      triggers: concurrentSyncRuns.length,
      snapshotRequests: concurrentSnapshotRequests,
      elapsedMs: Math.round(performance.now() - concurrentSyncStartedAt),
    }),
  );
  concurrentSyncController.cleanup();

  const broadcastChannels = [];
  context.BroadcastChannel = class {
    constructor(name) {
      this.name = name;
      this.closed = false;
      broadcastChannels.push(this);
    }

    postMessage(data) {
      broadcastChannels.forEach((peer) => {
        if (!peer.closed && peer !== this && peer.name === this.name)
          peer.onmessage?.({ data });
      });
    }

    close() {
      this.closed = true;
    }
  };
  const incumbentCoordinator = context.SyncCore.createLeaderCoordinator({
    lifecycle: context.LifecycleUtils,
    tabId: "tab_zzzzzzzz",
  });
  const lateCoordinator = context.SyncCore.createLeaderCoordinator({
    lifecycle: context.LifecycleUtils,
    tabId: "tab_aaaaaaaa",
  });
  incumbentCoordinator.start();
  lateCoordinator.start();
  assert.equal(incumbentCoordinator.isLeader(), false);
  assert.equal(
    lateCoordinator.isLeader(),
    true,
    "a late-joining lexicographically preferred tab should become the sole leader immediately",
  );
  incumbentCoordinator.cleanup();
  lateCoordinator.cleanup();
  delete context.BroadcastChannel;

  const originalRandom = context.Math.random;
  const retryControllers = [];
  try {
    context.Math.random = () => 0.25;
    const firstRetryController = context.SyncCore.createController({
      state: { categorySummary: [] },
      lifecycle: context.LifecycleUtils,
      appConfig: { syncRetryIntervalMs: 3000, syncRetryMaxDelayMs: 60000 },
      isLeader: () => true,
      hasActiveSession: () => false,
      setSyncConnected() {},
      updateSyncStatus() {},
      logger: { warn() {}, error() {}, info() {} },
    });
    retryControllers.push(firstRetryController);
    firstRetryController.scheduleSyncRetry();
    const firstRetryDelay = [...timeoutDelays.values()].at(-1);

    context.Math.random = () => 0.75;
    const secondRetryController = context.SyncCore.createController({
      state: { categorySummary: [] },
      lifecycle: context.LifecycleUtils,
      appConfig: { syncRetryIntervalMs: 3000, syncRetryMaxDelayMs: 60000 },
      isLeader: () => true,
      hasActiveSession: () => false,
      setSyncConnected() {},
      updateSyncStatus() {},
      logger: { warn() {}, error() {}, info() {} },
    });
    retryControllers.push(secondRetryController);
    secondRetryController.scheduleSyncRetry();
    const retryDelays = [...timeoutDelays.values()].slice(-2);
    assert.equal(retryDelays[0], firstRetryDelay);
    assert.ok(
      retryDelays[1] > retryDelays[0],
      "first retries from separate clients should be jittered above the shared minimum delay",
    );
    console.log(
      JSON.stringify({
        test: "retry jitter above minimum delay",
        delaysMs: retryDelays,
      }),
    );
  } finally {
    context.Math.random = originalRandom;
    retryControllers.forEach((retryController) => retryController.cleanup());
  }

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
