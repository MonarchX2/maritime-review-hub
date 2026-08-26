(function (globalScope) {
  "use strict";

  const root =
    globalScope || (typeof window !== "undefined" ? window : globalThis);

  function createDelegatingApi() {
    const api = {
      getSyncStatusVisualState:
        typeof root.getSyncStatusVisualState === "function"
          ? root.getSyncStatusVisualState.bind(root)
          : () => ({
              panelClass: "",
              badgeClass: "",
              title: "Database connection",
              overlayTitle: "Syncing database",
              overlayDetail: "Preparing the latest data...",
            }),
      setGlobalLoadingState:
        typeof root.setGlobalLoadingState === "function"
          ? root.setGlobalLoadingState.bind(root)
          : () => false,
      updateSyncStatus:
        typeof root.updateSyncStatus === "function"
          ? root.updateSyncStatus.bind(root)
          : () => undefined,
      hideConnectionStatusAfterDelay:
        typeof root.hideConnectionStatusAfterDelay === "function"
          ? root.hideConnectionStatusAfterDelay.bind(root)
          : () => undefined,
      scheduleSyncPoll:
        typeof root.scheduleSyncPoll === "function"
          ? root.scheduleSyncPoll.bind(root)
          : () => undefined,
      applySummaryData:
        typeof root.applySummaryData === "function"
          ? root.applySummaryData.bind(root)
          : () => false,
      scheduleSyncRetry:
        typeof root.scheduleSyncRetry === "function"
          ? root.scheduleSyncRetry.bind(root)
          : () => undefined,
      syncDatabase:
        typeof root.syncDatabase === "function"
          ? root.syncDatabase.bind(root)
          : async () => false,
      showColdStartNotification:
        typeof root.showColdStartNotification === "function"
          ? root.showColdStartNotification.bind(root)
          : () => false,
    };

    root.SyncCore = api;
    root.AppSync = api;
    root.getSyncStatusVisualState = api.getSyncStatusVisualState;
    root.setGlobalLoadingState = api.setGlobalLoadingState;
    root.updateSyncStatus = api.updateSyncStatus;
    root.hideConnectionStatusAfterDelay = api.hideConnectionStatusAfterDelay;
    root.scheduleSyncPoll = api.scheduleSyncPoll;
    root.applySummaryData = api.applySummaryData;
    root.scheduleSyncRetry = api.scheduleSyncRetry;
    root.syncDatabase = api.syncDatabase;
    root.showColdStartNotification = api.showColdStartNotification;
    return api;
  }

  // This file is intentionally obsolete: the canonical sync logic lives in app-core.js.
  // Keep a tiny compatibility layer so older references continue to work without
  // duplicating stateful sync behavior.
  const SyncCore = createDelegatingApi();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SyncCore;
  }
})(typeof window !== "undefined" ? window : globalThis);
