(function (globalScope) {
  "use strict";

  const legacySyncApi = {
    getSyncStatusVisualState: globalScope.getSyncStatusVisualState,
    setGlobalLoadingState: globalScope.setGlobalLoadingState,
    updateSyncStatus: globalScope.updateSyncStatus,
    hideConnectionStatusAfterDelay: globalScope.hideConnectionStatusAfterDelay,
    optimizedBackgroundSync: globalScope.optimizedBackgroundSync,
    scheduleSyncPoll: globalScope.scheduleSyncPoll,
    applySummaryData: globalScope.applySummaryData,
    scheduleSyncRetry: globalScope.scheduleSyncRetry,
    syncDatabase:
      globalScope.syncDatabaseImplementation || globalScope.syncDatabase,
    showColdStartNotification: globalScope.showColdStartNotification,
  };

  const AppSync = {
    __legacyBridge: true,
    ...Object.fromEntries(
      Object.entries(legacySyncApi).filter(
        ([, implementation]) => typeof implementation === "function",
      ),
    ),
  };

  globalScope.AppSync = AppSync;
  globalScope.SyncCore = AppSync;
})(typeof window !== "undefined" ? window : globalThis);
