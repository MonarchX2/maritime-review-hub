const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const storageSource = fs.readFileSync("storage-utils.js", "utf8");
const appCoreSource = fs.readFileSync("app-core.js", "utf8");
const deckFetchFailureMessageSource = appCoreSource.match(
  /  function getDeckFetchFailureMessage\(subject, error\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(deckFetchFailureMessageSource, "deck fetch failures should format user-facing messages");
const deckFetchFailureContext = {};
vm.createContext(deckFetchFailureContext);
vm.runInContext(
  `${deckFetchFailureMessageSource}
  globalThis.getDeckFetchFailureMessage = getDeckFetchFailureMessage;`,
  deckFetchFailureContext,
);
assert.equal(
  deckFetchFailureContext.getDeckFetchFailureMessage("Private deck", {
    message: "Incorrect Password.",
  }),
  "Incorrect Password",
  "incorrect-password errors should be shown without deck/database details",
);
assert.equal(
  deckFetchFailureContext.getDeckFetchFailureMessage("Private deck", {
    message: "Service temporarily unavailable.",
  }),
  'Unable to load "Private deck" from the database. Service temporarily unavailable.',
  "other deck errors should retain their diagnostic message",
);

const storageContext = {
  module: { exports: {} },
  console,
  Date,
  Math,
  Promise,
  TextEncoder,
  Uint8Array,
  setTimeout,
  clearTimeout,
};
Object.defineProperty(storageContext, "localStorage", {
  configurable: true,
  get() {
    throw new Error("local storage is blocked");
  },
});
Object.defineProperty(storageContext, "sessionStorage", {
  configurable: true,
  get() {
    throw new Error("session storage is blocked");
  },
});
vm.createContext(storageContext);
vm.runInContext(storageSource, storageContext, {
  filename: "storage-utils.js",
});

const storage = storageContext.module.exports;
assert.equal(storage.setStoredItem("fallback-check", "saved"), true);
assert.equal(storage.getStoredItem("fallback-check"), "saved");
assert.equal(storage.setSessionStoredItem("fallback-check", "session"), true);
assert.equal(storage.getSessionStoredItem("fallback-check"), "session");
const appStorage = storageContext.__mrhNodeStorage;
Object.assign(appStorage, {
  "mrh_device_one:stats": "saved",
  "mrh_device_two:db": "saved",
  mrh_legacy: "saved",
  "__mrh_storage_lock:test": "saved",
  unrelated: "keep",
});
const appSessionStorage = storageContext.__mrhNodeSessionStorage;
Object.assign(appSessionStorage, {
  "mrh_device_three:session": "saved",
  "mrh_device_three:resource_portal_listing_root": "private listing",
  "mrh_device_four:resource_portal_listing_folder": "private listing",
  mrh_resource_portal_listing_legacy: "private listing",
  "mrh_device_four:unrelated": "keep",
});
assert.equal(
  storage.removeSessionStoredItemsByPrefix("resource_portal_listing_"),
  3,
  "obsolete portal listing caches should be removed across app namespaces",
);
assert.equal(
  appSessionStorage["mrh_device_four:unrelated"],
  "keep",
  "targeted resource cache cleanup must preserve unrelated session data",
);
storage.clearAllAppNamespaces();
assert.deepEqual(Object.keys(appStorage), ["unrelated"]);
assert.deepEqual(Object.keys(appSessionStorage), []);
assert.equal(
  storage.setStoredJSON("oversized-unicode", {
    value: "\u{1f6a2}".repeat(70000),
  }),
  false,
  "the JSON storage limit must count UTF-8 bytes, not UTF-16 code units",
);

const networkContext = {
  module: { exports: {} },
  console,
  URL,
  Date,
  Math,
  Promise,
  AbortController,
  crypto: webcrypto,
  TextEncoder,
  Uint8Array,
  setTimeout,
  clearTimeout,
  fetch: async () => new Response("{}", { status: 200 }),
  intervalCallbacks: new Map(),
  nextIntervalId: 0,
  LifecycleUtils: {
    setTimeout,
    clearTimeout,
    setInterval(callback) {
      const id = ++networkContext.nextIntervalId;
      networkContext.intervalCallbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      networkContext.intervalCallbacks.delete(id);
    },
  },
};
networkContext.MRH_CONFIG = { databaseUrl: "https://example.test/backend" };
networkContext.__MRH_APP__ = { version: "mrh-release-10.15.26-6" };
networkContext.__MRH_APP_BASE_PATH = "/mrh/";
networkContext.location = {
  origin: "https://example.test",
  replace(url) {
    networkContext.replacedLocation = url;
  },
};
networkContext.StorageUtils = {
  clearAllAppNamespaces() {
    networkContext.appNamespacesPurged = true;
  },
};
networkContext.indexedDB = {
  deleteDatabase(name) {
    assert.equal(name, "mrh_db");
    const request = {};
    setTimeout(() => request.onsuccess(), 0);
    return request;
  },
};
const deletedCacheNames = [];
networkContext.caches = {
  async keys() {
    return ["mrh-cache-old", "other-app-cache"];
  },
  async delete(name) {
    deletedCacheNames.push(name);
    return true;
  },
};
const unregisteredScopes = [];
networkContext.navigator = {
  serviceWorker: {
    async getRegistrations() {
      return [
        {
          scope: "https://example.test/mrh/",
          async unregister() {
            unregisteredScopes.push(this.scope);
            return true;
          },
        },
        {
          scope: "https://example.test/maritime-review-hub/",
          async unregister() {
            unregisteredScopes.push(this.scope);
            return true;
          },
        },
        {
          scope: "https://example.test/other-app/",
          async unregister() {
            unregisteredScopes.push(this.scope);
            return true;
          },
        },
      ];
    },
  },
};
vm.createContext(networkContext);
vm.runInContext(
  fs.readFileSync("app-core-network.js", "utf8"),
  networkContext,
  { filename: "app-core-network.js" },
);

async function checkBackendErrorHandling() {
  const network = networkContext.module.exports;
  const payload = [[1, "Question", null, "A", "ID"]];
  const payloadFingerprint = await network.getPayloadFingerprint(payload);
  assert.equal(
    payloadFingerprint,
    require("node:crypto")
      .createHash("sha256")
      .update(JSON.stringify(payload), "utf8")
      .digest("hex"),
    "payload fingerprints must use the backend's SHA-256 over compact JSON",
  );
  assert.equal(
    network.isRetryableError(
      Object.assign(new Error("Service unavailable"), {
        isBackendError: true,
        status: 503,
      }),
    ),
    true,
    "backend 5xx responses should be retried",
  );
  assert.equal(
    network.isRetryableError(
      Object.assign(new Error("Rate limited"), {
        isBackendError: true,
        status: 429,
      }),
    ),
    true,
    "backend rate-limit responses should be retried",
  );
  assert.equal(
    network.isRetryableError(
      Object.assign(new Error("Access denied"), {
        isBackendError: true,
        status: 403,
      }),
    ),
    false,
    "permanent backend authorization errors must not be retried",
  );
  assert.equal(
    network.isRetryableError(
      Object.assign(new Error("Server error"), {
        isBackendError: true,
        status: 0,
        code: "SERVER_ERROR",
      }),
    ),
    true,
    "the Apps Script backend's HTTP-200 SERVER_ERROR envelope must retry",
  );
  assert.equal(
    network.isRetryableError(
      Object.assign(new Error("Deck not ready"), {
        isBackendError: true,
        status: 0,
        code: "NOT_READY",
      }),
    ),
    true,
    "transient deck-build errors must retry",
  );
  assert.equal(
    network.isRetryableError(
      Object.assign(new Error("The backend changed during the read."), {
        isBackendError: true,
        status: 0,
        code: "SYNC_RACE",
      }),
    ),
    true,
    "snapshot race responses should be retried",
  );
  assert.equal(
    network.isRetryableError(
      Object.assign(new Error("Deck not found"), {
        isBackendError: true,
        status: 0,
        code: "NOT_FOUND",
      }),
    ),
    false,
    "permanent backend application errors must not retry",
  );
  let retryAttempts = 0;
  const retryResult = await network.retryWithBackoff(
    async () => {
      retryAttempts += 1;
      if (retryAttempts < 3) {
        throw Object.assign(new Error("Service unavailable"), {
          isBackendError: true,
          status: 503,
        });
      }
      return "recovered";
    },
    { maxRetries: 2, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
  );
  assert.equal(retryResult, "recovered");
  assert.equal(retryAttempts, 3, "transient server failures should retry boundedly");

  retryAttempts = 0;
  await assert.rejects(
    network.retryWithBackoff(
      async () => {
        retryAttempts += 1;
        throw Object.assign(new Error("Service unavailable"), {
          isBackendError: true,
          status: 503,
        });
      },
      { maxRetries: 2, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
    ),
    /Service unavailable/,
  );
  assert.equal(retryAttempts, 3, "retry attempts must respect the configured limit");

  let fetchCount = 0;
  let lastPostBody = "";
  networkContext.fetch = async (_input, options) => {
    fetchCount += 1;
    lastPostBody = options.body;
    if (fetchCount < 3) {
      return new Response(
        JSON.stringify({
          status: "error",
          code: "SERVER_ERROR",
          message: "Service temporarily unavailable.",
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  };
  const recoveredRequest = await network.callBackend(
    { type: "get_sync_status" },
    { maxRetries: 2, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
  );
  assert.equal(recoveredRequest.status, "ok");
  assert.equal(fetchCount, 3, "transient HTTP-200 backend envelopes should retry");
  assert.equal(
    JSON.parse(lastPostBody).appVersion,
    networkContext.__MRH_APP__.version,
    "every POST request must include the running app version",
  );

  fetchCount = 0;
  networkContext.fetch = async (_input, options) => {
    fetchCount += 1;
    lastPostBody = options.body;
    return new Response(
      JSON.stringify({
        status: "success",
        folder: { id: "public-root", name: "Shared Resources" },
        breadcrumbs: [{ id: "public-root", name: "Shared Resources" }],
        items: [],
      }),
      { status: 200 },
    );
  };
  const resourcesResponse = await network.callBackend(
    { type: "list_public_resources", folderId: "public-root" },
    { maxRetries: 0 },
  );
  assert.equal(resourcesResponse.status, "success");
  assert.equal(fetchCount, 1);
  assert.deepEqual(
    JSON.parse(lastPostBody),
    {
      type: "list_public_resources",
      folderId: "public-root",
      appVersion: networkContext.__MRH_APP__.version,
    },
    "public-resource listing requests should pass payload validation and include the folder ID",
  );
  const privatePreviewResponse = await network.callBackend(
    { type: "get_resource_preview", fileId: "private-file-id" },
    { maxRetries: 0 },
  );
  assert.equal(privatePreviewResponse.status, "success");
  assert.deepEqual(
    JSON.parse(lastPostBody),
    {
      type: "get_resource_preview",
      fileId: "private-file-id",
      appVersion: networkContext.__MRH_APP__.version,
    },
    "private-resource preview requests should include only the file ID and app version",
  );

  const reviewerEventId = "12345678-1234-4123-8123-123456789abc";
  await network.callBackend(
    { type: "get_reviewer_auth_config" },
    { maxRetries: 0 },
  );
  assert.deepEqual(JSON.parse(lastPostBody), {
    type: "get_reviewer_auth_config",
    appVersion: networkContext.__MRH_APP__.version,
  });
  await network.callBackend(
    {
      type: "verify_reviewer_access",
      idToken: "test-google-id-token",
      eventId: reviewerEventId,
    },
    { maxRetries: 0 },
  );
  assert.deepEqual(JSON.parse(lastPostBody), {
    type: "verify_reviewer_access",
    idToken: "test-google-id-token",
    eventId: reviewerEventId,
    appVersion: networkContext.__MRH_APP__.version,
  });
  await network.callBackend(
    {
      type: "log_module_access",
      idToken: "test-google-id-token",
      eventId: reviewerEventId,
    },
    { maxRetries: 0 },
  );
  assert.deepEqual(JSON.parse(lastPostBody), {
    type: "log_module_access",
    idToken: "test-google-id-token",
    eventId: reviewerEventId,
    appVersion: networkContext.__MRH_APP__.version,
  });
  await network.callBackend(
    {
      type: "get_resource_dashboard",
      eventId: reviewerEventId,
      idToken: "test-google-id-token",
      version: "dashboard-version",
    },
    { maxRetries: 0 },
  );
  assert.deepEqual(JSON.parse(lastPostBody), {
    type: "get_resource_dashboard",
    eventId: reviewerEventId,
    idToken: "test-google-id-token",
    version: "dashboard-version",
    appVersion: networkContext.__MRH_APP__.version,
  });
  await assert.rejects(
    network.callBackend(
      {
        type: "verify_reviewer_access",
        idToken: "test-google-id-token",
        eventId: "not-a-uuid",
      },
      { maxRetries: 0 },
    ),
    /Backend field 'eventId' must be a UUID/,
    "malformed event IDs should be rejected before sending a request",
  );

  networkContext.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "error",
        code: "CLIENT_UPDATE_REQUIRED",
        purgeClientData: true,
        message: "This app version is no longer supported.",
      }),
      { status: 200 },
    );
  await assert.rejects(
    network.callBackend({ type: "get_sync_status" }, { maxRetries: 0 }),
    /This app version is no longer supported/,
  );
  assert.equal(networkContext.appNamespacesPurged, true);
  assert.deepEqual(deletedCacheNames, ["mrh-cache-old"]);
  assert.deepEqual(unregisteredScopes, [
    "https://example.test/mrh/",
    "https://example.test/maritime-review-hub/",
  ]);
  assert.equal(
    networkContext.replacedLocation,
    "https://example.test/mrh/client-update-required.html?cleanup=complete",
  );

  fetchCount = 0;
  networkContext.fetch = async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify({ error: "This deck was not found.", code: "NOT_FOUND" }),
      { status: 200 },
    );
  };

  await assert.rejects(
    networkContext.module.exports.getDeck("missing", "", {
      allowFallback: false,
      maxRetries: 0,
    }),
    /This deck was not found\./,
  );
  assert.equal(fetchCount, 1);

  fetchCount = 0;
  await assert.rejects(
    networkContext.module.exports.getDeck("missing", "", {
      maxRetries: 7,
      baseRetryDelayMs: 0,
      maxRetryDelayMs: 0,
    }),
    /This deck was not found\./,
  );
  assert.equal(
    fetchCount,
    1,
    "a backend application error must not be retried or switched to POST fallback",
  );

  fetchCount = 0;
  await assert.rejects(
    networkContext.module.exports.callBackend(
      { type: "verify_access", subject: "LOCKED", password: "wrong" },
      { maxRetries: 7, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
    ),
    /This deck was not found\./,
  );
  assert.equal(
    fetchCount,
    1,
    "POST application errors must not be retried as transient failures",
  );

  const requestedUrls = [];
  networkContext.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify(
        requestedUrls.length === 1
          ? { status: "ok", cacheVersion: "backend-cache-7" }
          : [],
      ),
      { status: 200 },
    );
  };
  await network.getSyncStatus({ maxRetries: 0 });
  await network.getDeckSummary({ maxRetries: 0 });
  await network.getDeck("COLREGS", "", { maxRetries: 0 });
  assert.equal(
    new URL(requestedUrls[1]).searchParams.get("cv"),
    "backend-cache-7",
    "summary GET requests must bypass intermediary caches when backend payload version changes",
  );
  assert.equal(
    new URL(requestedUrls[1]).searchParams.get("v"),
    networkContext.__MRH_APP__.version,
    "summary GET requests must include the running app version",
  );
  assert.equal(
    new URL(requestedUrls[2]).searchParams.get("cv"),
    "backend-cache-7",
    "deck JSON GET requests must use the latest backend cache version",
  );

  requestedUrls.length = 0;
  networkContext.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify(
        requestedUrls.length === 1 ? { version: "backend-cache-8" } : [],
      ),
      { status: 200 },
    );
  };
  await network.getCacheVersion({ maxRetries: 0 });
  await network.getDeckSummary({ maxRetries: 0 });
  assert.equal(
    new URL(requestedUrls[1]).searchParams.get("cv"),
    "backend-cache-8",
    "the standalone cache-version endpoint must prime cache-busted GET requests",
  );

  requestedUrls.length = 0;
  networkContext.fetch = async (input, options) => {
    requestedUrls.push(String(input));
    assert.equal(options.method, "GET");
    return new Response(
      JSON.stringify({
        status: "ok",
        notModified: true,
        cacheVersion: "backend-cache-8",
        syncTimestamp: "2026-10-15T00:00:00.000Z",
      }),
      { status: 200 },
    );
  };
  const syncSnapshot = await network.getDeckSyncSnapshot({
    since: "2026-10-14T00:00:00.000Z",
    maxRetries: 0,
  });
  assert.equal(syncSnapshot.notModified, true);
  assert.equal(requestedUrls.length, 1);
  const snapshotUrl = new URL(requestedUrls[0]);
  assert.equal(snapshotUrl.searchParams.get("sync"), "1");
  assert.equal(
    snapshotUrl.searchParams.get("since"),
    "2026-10-14T00:00:00.000Z",
  );
  assert.equal(
    snapshotUrl.searchParams.get("v"),
    networkContext.__MRH_APP__.version,
  );

  requestedUrls.length = 0;
  let statusReads = 0;
  let raceLegacyRead = false;
  let raceLegacyCacheRead = false;
  let legacyColdStart = false;
  networkContext.fetch = async (input, options) => {
    requestedUrls.push(String(input));
    if (options.method === "GET") {
      const url = new URL(String(input));
      if (url.searchParams.has("sync")) {
        return new Response(JSON.stringify([{ Subject: "COLREGS" }]), {
          status: 200,
        });
      }
      return new Response(JSON.stringify([{ Subject: "COLREGS" }]), {
        status: 200,
      });
    }

    const read = statusReads++;
    const timestamp =
      raceLegacyRead && read % 2 === 1 ? "legacy-v2" : "legacy-v1";
    const cacheVersion =
      raceLegacyCacheRead && read % 2 === 1
        ? "legacy-cache-v2"
        : "legacy-cache-v1";
    return new Response(
      JSON.stringify({
        status: "ok",
        syncTimestamp: timestamp,
        cacheVersion,
        isColdStart: legacyColdStart,
      }),
      { status: 200 },
    );
  };
  const legacySnapshot = await network.getDeckSyncSnapshot({
    since: "legacy-v0",
    maxRetries: 0,
  });
  assert.equal(legacySnapshot.legacySnapshot, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(legacySnapshot.summary)),
    [{ Subject: "COLREGS" }],
  );
  assert.equal(
    requestedUrls.length,
    4,
    "legacy deployments should use status, summary, then a consistency status check",
  );
  assert.equal(
    new URL(requestedUrls[2]).searchParams.get("cv"),
    "legacy-cache-v1",
    "legacy status metadata should cache-bust the summary request",
  );

  const unchangedLegacySnapshot = await network.getDeckSyncSnapshot({
    since: "legacy-v1",
    maxRetries: 0,
  });
  assert.equal(unchangedLegacySnapshot.notModified, true);
  assert.equal(unchangedLegacySnapshot.legacySnapshot, true);
  assert.equal(
    requestedUrls.length,
    5,
    "unchanged legacy syncs should fetch only status",
  );

  raceLegacyRead = true;
  await assert.rejects(
    network.getDeckSyncSnapshot({ since: "legacy-v0", maxRetries: 0 }),
    (error) => error.code === "SYNC_RACE",
  );
  assert.equal(
    requestedUrls.length,
    8,
    "subsequent legacy syncs should skip the unsupported snapshot endpoint",
  );

  raceLegacyRead = false;
  raceLegacyCacheRead = true;
  await assert.rejects(
    network.getDeckSyncSnapshot({ since: "legacy-v0", maxRetries: 0 }),
    (error) => error.code === "SYNC_RACE",
  );

  legacyColdStart = true;
  const requestsBeforeColdStart = requestedUrls.length;
  const coldStartSnapshot = await network.getDeckSyncSnapshot({
    since: "legacy-v1",
    maxRetries: 0,
  });
  assert.equal(coldStartSnapshot.isColdStart, true);
  assert.equal(
    requestedUrls.length,
    requestsBeforeColdStart + 1,
    "legacy cold starts should not be mistaken for unchanged snapshots",
  );
}

async function checkLegacySnapshotPoolConcurrency() {
  const context = {
    module: { exports: {} },
    console,
    URL,
    Date,
    Math,
    Promise,
    AbortController,
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
    intervalCallbacks: new Map(),
    nextIntervalId: 0,
  };
  context.MRH_CONFIG = { databaseUrl: "https://example.test/backend" };
  context.__MRH_APP__ = { version: "mrh-release-test" };
  context.location = { href: "https://example.test/" };
  context.LifecycleUtils = {
    setTimeout,
    clearTimeout,
    setInterval(callback) {
      const id = ++context.nextIntervalId;
      context.intervalCallbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      context.intervalCallbacks.delete(id);
    },
  };
  context.fetch = async (_input, options) =>
    new Response(
      JSON.stringify(
        options.method === "GET"
          ? [{ Subject: "COLREGS" }]
          : {
              status: "ok",
              syncTimestamp: "legacy-v1",
              cacheVersion: "legacy-cache-v1",
            },
      ),
      { status: 200 },
    );
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("app-core-network.js", "utf8"),
    context,
    { filename: "app-core-network.js" },
  );
  const snapshots = await Promise.all(
    Array.from({ length: 8 }, () =>
      context.module.exports.getDeckSyncSnapshot({
        since: "legacy-v0",
        maxRetries: 0,
      }),
    ),
  );
  assert.equal(snapshots.length, 8);
  assert.ok(snapshots.every((snapshot) => snapshot.legacySnapshot === true));
}

async function checkConnectionPoolConcurrency() {
  const pool = networkContext.module.exports.createConnectionPool({
    maxConnections: 1,
    maxRetries: 0,
    keepAlive: false,
    autoReconnect: false,
    reconnectDelayMs: 20,
  });

  let finishFirst;
  const firstRequest = pool.request(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.getState().activeConnections, 1);

  const reconnecting = pool.reconnect();
  assert.equal(
    pool.reconnect(),
    reconnecting,
    "concurrent callers must share the in-progress reconnect operation",
  );
  const startOrder = [];
  let queuedStartedDuringReconnect = false;
  const duringReconnect = pool.request(async () => {
    queuedStartedDuringReconnect = true;
    startOrder.push("during-reconnect");
    return "after reconnect";
  });
  await Promise.resolve();
  assert.equal(
    queuedStartedDuringReconnect,
    false,
    "requests must await the active reconnect operation",
  );
  await reconnecting;
  assert.equal(
    pool.getState().activeConnections,
    1,
    "reconnect must retain the count of requests that are still running",
  );

  let secondStarted = false;
  const secondRequest = pool.request(async () => {
    secondStarted = true;
    startOrder.push("second");
    return "second";
  });
  let thirdStarted = false;
  const thirdRequest = pool.request(async () => {
    thirdStarted = true;
    startOrder.push("third");
    return "third";
  });
  await Promise.resolve();
  assert.equal(secondStarted, false, "the concurrency limit must be enforced");
  assert.equal(thirdStarted, false, "queued requests must retain FIFO order");
  assert.equal(pool.getState().queueLength, 3);
  assert.equal(pool.getState().activeConnections, 1);

  finishFirst("first");
  assert.equal(await firstRequest, "first");
  assert.equal(await duringReconnect, "after reconnect");
  assert.equal(await secondRequest, "second");
  assert.equal(await thirdRequest, "third");
  assert.equal(secondStarted, true);
  assert.equal(thirdStarted, true);
  assert.deepEqual(startOrder, ["during-reconnect", "second", "third"]);
  pool.destroy();
}

async function checkConnectionPoolCleanupAndHealth() {
  const pool = networkContext.module.exports.createConnectionPool({
    maxConnections: 1,
    maxRetries: 0,
    keepAlive: false,
    autoReconnect: false,
  });
  let finishActive;
  const activeRequest = pool.request(
    () =>
      new Promise((resolve) => {
        finishActive = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const queuedRequest = pool.request(async () => "should not run");
  pool.destroy();
  await assert.rejects(queuedRequest, /Connection pool has been destroyed/);
  await assert.rejects(
    pool.request(async () => "should not run"),
    /Connection pool has been destroyed/,
  );
  finishActive("finished");
  assert.equal(await activeRequest, "finished");
  assert.equal(pool.getState().activeConnections, 0);

  const healthPool = networkContext.module.exports.createConnectionPool({
    keepAlive: false,
    autoReconnect: true,
    reconnectDelayMs: 1000,
    healthCheckIntervalMs: 0,
    healthCheckTimeoutMs: 50,
  });
  const healthCheck = [...networkContext.intervalCallbacks.values()].at(-1);
  networkContext.fetch = async () => new Response("unavailable", { status: 503 });
  const healthCheckRun = healthCheck();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    healthPool.getState().reconnecting,
    true,
    "HTTP failure responses must not be accepted as successful health checks",
  );

  const waitingRequest = healthPool.request(async () => "should not run");
  healthPool.destroy();
  await assert.rejects(waitingRequest, /Connection pool has been destroyed/);
  await healthCheckRun;

  const destroyedHealthPool = networkContext.module.exports.createConnectionPool({
    keepAlive: false,
    autoReconnect: true,
    healthCheckIntervalMs: 0,
    healthCheckTimeoutMs: 50,
  });
  let failHealthCheck;
  networkContext.fetch = () =>
    new Promise((resolve, reject) => {
      failHealthCheck = reject;
    });
  const destroyedHealthCheck = [
    ...networkContext.intervalCallbacks.values(),
  ].at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  destroyedHealthPool.destroy();
  failHealthCheck(new Error("network failure"));
  await destroyedHealthCheck;
  assert.equal(
    destroyedHealthPool.getState().reconnecting,
    false,
    "an in-flight health check must not reconnect a destroyed pool",
  );
}

Promise.all([
  checkBackendErrorHandling(),
  checkLegacySnapshotPoolConcurrency(),
  checkConnectionPoolConcurrency(),
  checkConnectionPoolCleanupAndHealth(),
])
  .then(() => console.log("Runtime reliability checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
