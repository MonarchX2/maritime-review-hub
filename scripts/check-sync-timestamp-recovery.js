const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

assert.match(
  fs.readFileSync("app-core.js", "utf8"),
  /const SYNC_STATUS_STORAGE_KEY = "mrh_last_applied_sync_status_timestamp";/,
  "sync must not trust timestamps saved before a summary was applied",
);
assert.match(
  fs.readFileSync("app-core.js", "utf8"),
  /window\.addEventListener\(\s*"online"[\s\S]*?syncScheduler\.handleVisibility\(false\)/,
  "the elected foreground tab should resume background sync when connectivity returns",
);

const timeoutCallbacks = new Map();
const timeoutDelays = new Map();
const intervalCallbacks = new Map();
let nextTimerId = 0;
let summaryFetchCount = 0;
const timestamps = {
  v1: "2026-10-14T00:00:01.000Z",
  v2: "2026-10-14T00:00:02.000Z",
  v3: "2026-10-14T00:00:03.000Z",
  v4: "2026-10-14T00:00:04.000Z",
  v5: "2026-10-14T00:00:05.000Z",
  v6: "2026-10-14T00:00:06.000Z",
};
let storedTimestamp = "";
let currentSyncTimestamp = timestamps.v1;
let changeTimestampDuringSummary = false;
let statusUnavailable = false;
let payloadSchemaVersion = 2;
let malformedSummary = false;
let activeSession = false;
let immediateMode = true;
let pendingSummaryData = null;
let failSummaryPersistence = false;
let pendingPayloadRefreshCount = 0;
const appliedSummaries = [];
const lifecycle = {
  setTimeout(callback, delay = 0) {
    const id = ++nextTimerId;
    timeoutCallbacks.set(id, callback);
    timeoutDelays.set(id, delay);
    return id;
  },
  clearTimeout(id) {
    timeoutCallbacks.delete(id);
    timeoutDelays.delete(id);
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
    backendPayloadSchemaVersion: 2,
  },
  network: {
    async getSyncStatus(options) {
      assert.equal(options?.maxRetries, 0);
      if (statusUnavailable) throw new Error("temporary network failure");
      return {
        status: "ok",
        syncTimestamp: currentSyncTimestamp,
        payloadSchemaVersion,
      };
    },
    async getDeckSummary(options) {
      assert.equal(options?.maxRetries, 0);
      summaryFetchCount += 1;
      if (changeTimestampDuringSummary) {
        changeTimestampDuringSummary = false;
        currentSyncTimestamp = timestamps.v5;
      }
      if (summaryFetchCount === 1) throw new Error("temporary network failure");
      if (malformedSummary) {
        return [{ Subject: "COLREGS", QuestionCount: 1, PayloadVersion: "bad" }];
      }
      return [
        {
          Subject: "COLREGS",
          QuestionCount: 1,
          PayloadVersion: String(summaryFetchCount).padStart(64, "0"),
        },
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
  async refreshPendingPayloads() {
    pendingPayloadRefreshCount += 1;
  },
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
const activeQuizSession = sessionContext.state.session;
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
  assert.equal(storedTimestamp, timestamps.v1);
  assert.equal(appliedSummaries.length, 1);

  await controller.optimizedBackgroundSync();
  assert.equal(
    summaryFetchCount,
    2,
    "a successfully applied timestamp must skip redundant summary downloads",
  );
  assert.equal(pendingPayloadRefreshCount, 1);
  controller.cancel();
  await controller.optimizedBackgroundSync();
  assert.equal(
    timeoutCallbacks.size,
    1,
    "an unchanged healthy timestamp must resume normal polling after a check",
  );
  assert.equal([...timeoutDelays.values()][0], 60000);
  assert.equal(pendingPayloadRefreshCount, 2);

  currentSyncTimestamp = timestamps.v2;
  activeSession = true;
  immediateMode = false;
  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 3);
  assert.equal(
    sessionContext.state.session,
    activeQuizSession,
    "a backend summary update must not replace the in-progress quiz session",
  );
  assert.equal(
    sessionContext.state.session.userAnswers[0],
    "A",
    "background sync must preserve recorded answers",
  );
  assert.equal(
    storedTimestamp,
    timestamps.v1,
    "a deferred session update must not be marked as applied",
  );
  assert.equal(
    pendingSummaryData[0].PayloadVersion,
    String(3).padStart(64, "0"),
    "a changed deck payload fingerprint must be deferred during the active session",
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
    timestamps.v1,
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
  assert.equal(storedTimestamp, timestamps.v2);
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

  currentSyncTimestamp = timestamps.v3;
  failSummaryPersistence = true;
  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 5);
  assert.equal(
    storedTimestamp,
    timestamps.v2,
    "a failed summary persistence must not checkpoint the backend timestamp",
  );

  await controller.optimizedBackgroundSync();
  assert.equal(summaryFetchCount, 6);
  assert.equal(
    storedTimestamp,
    timestamps.v3,
    "a later successful persistence must checkpoint the timestamp",
  );

  currentSyncTimestamp = timestamps.v4;
  changeTimestampDuringSummary = true;
  const appliedBeforeRace = appliedSummaries.length;
  await controller.optimizedBackgroundSync();
  assert.equal(
    appliedSummaries.length,
    appliedBeforeRace,
    "a summary fetched across a backend version change must be discarded",
  );
  assert.equal(storedTimestamp, timestamps.v3);
  assert.equal(timeoutCallbacks.size, 1);

  await controller.optimizedBackgroundSync();
  assert.equal(storedTimestamp, timestamps.v5);
  assert.equal(
    appliedSummaries.length,
    appliedBeforeRace + 1,
    "the stable retry should apply the latest summary exactly once",
  );

  const fetchesBeforeStaleStatus = summaryFetchCount;
  currentSyncTimestamp = timestamps.v4;
  await controller.optimizedBackgroundSync();
  assert.equal(
    summaryFetchCount,
    fetchesBeforeStaleStatus,
    "an older out-of-order status response must not trigger a stale summary write",
  );
  assert.equal(storedTimestamp, timestamps.v5);

  statusUnavailable = true;
  await controller.optimizedBackgroundSync();
  assert.equal(
    timeoutCallbacks.size,
    1,
    "failed status checks with cached data should schedule bounded retry, not the normal poll interval",
  );
  statusUnavailable = false;
  await controller.optimizedBackgroundSync();
  assert.equal(
    timeoutCallbacks.size,
    1,
    "a successful connection check should replace a stale retry with normal polling",
  );
  assert.equal([...timeoutDelays.values()][0], 60000);
  assert.equal(
    storedTimestamp,
    timestamps.v5,
    "recovery with an unchanged timestamp must preserve the applied checkpoint",
  );

  const summariesBeforeInvalid = appliedSummaries.length;
  currentSyncTimestamp = timestamps.v6;
  malformedSummary = true;
  await controller.optimizedBackgroundSync();
  assert.equal(
    appliedSummaries.length,
    summariesBeforeInvalid,
    "malformed payload metadata must not replace the working summary",
  );
  assert.equal(
    storedTimestamp,
    timestamps.v5,
    "malformed payload metadata must not checkpoint the new backend version",
  );
  malformedSummary = false;
  await controller.optimizedBackgroundSync();
  assert.equal(storedTimestamp, timestamps.v6);

  payloadSchemaVersion = 1;
  const summariesBeforeIncompatibleSchema = appliedSummaries.length;
  await controller.optimizedBackgroundSync();
  assert.equal(
    appliedSummaries.length,
    summariesBeforeIncompatibleSchema,
    "an incompatible backend payload schema must not be applied",
  );
  assert.equal(
    [...timeoutDelays.values()][0],
    3000,
    "an incompatible backend schema should retry with bounded backoff",
  );
  payloadSchemaVersion = 2;

  controller.cleanup();
  assert.equal(timeoutCallbacks.size, 0);
  assert.equal(intervalCallbacks.size, 0);
  console.log("Sync timestamp recovery checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
