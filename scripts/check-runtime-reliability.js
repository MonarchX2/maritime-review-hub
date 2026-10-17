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
const networkDiagnostics = [];
networkContext.DebugUtils = {
  createDebugLogger() {
    return {
      warn: (...args) => networkDiagnostics.push(args),
      error: (...args) => networkDiagnostics.push(args),
    };
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
let requestedAppUpdateCount = 0;
networkContext.__MRH_REQUEST_APP_UPDATE = async () => {
  requestedAppUpdateCount += 1;
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
  function getPostBodyWithoutRequestId() {
    const body = JSON.parse(lastPostBody);
    assert.match(
      body.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "backend POST requests should include a privacy-safe correlation ID",
    );
    delete body.requestId;
    return body;
  }
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
    getPostBodyWithoutRequestId().appVersion,
    networkContext.__MRH_APP__.version,
    "every POST request must include the running app version",
  );
  let dashboardAttempts = 0;
  const dashboardRequestIds = [];
  networkContext.fetch = async (input, options) => {
    dashboardAttempts += 1;
    assert.equal(input, "https://example.test/backend");
    assert.equal(options.redirect, "follow");
    const requestId = JSON.parse(options.body).requestId;
    dashboardRequestIds.push(requestId);
    if (dashboardAttempts === 1) {
      return {
        ok: true,
        status: 200,
        redirected: true,
        url: "https://script.googleusercontent.com/macros/echo",
        async text() {
          return JSON.stringify({
            status: "error",
            code: "SERVER_ERROR",
            message: "Server error.",
            correlationId: requestId,
          });
        },
      };
    }
    return {
      ok: true,
      status: 200,
      redirected: true,
      url: "https://script.googleusercontent.com/macros/echo",
      async text() {
        return JSON.stringify({ status: "success", tab: { rows: [] } });
      },
    };
  };
  const recoveredDashboard = await network.callBackend(
    {
      type: "get_reviewer_dashboard",
      eventId: "12345678-1234-4123-8123-123456789abc",
      idToken: "sensitive-token-do-not-log",
      sessionId: "sensitive-session-do-not-log",
    },
    {
      maxRetries: 2,
      baseRetryDelayMs: 0,
      maxRetryDelayMs: 0,
    },
  );
  assert.equal(recoveredDashboard.status, "success");
  assert.equal(
    dashboardAttempts,
    2,
    "a read-only dashboard request should recover from one transient server error",
  );
  assert.match(
    dashboardRequestIds[0],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(
    dashboardRequestIds[1],
    dashboardRequestIds[0],
    "safe retries should reuse the same request correlation ID",
  );
  const diagnosticLogText = JSON.stringify(networkDiagnostics);
  assert.match(diagnosticLogText, new RegExp(dashboardRequestIds[0]));
  assert.match(diagnosticLogText, /get_reviewer_dashboard/);
  assert.match(diagnosticLogText, /"durationMs":\d+/);
  assert.match(diagnosticLogText, /"timestamp":"[^"]+"/);
  assert.match(
    diagnosticLogText,
    new RegExp(`appVersion.*${networkContext.__MRH_APP__.version}`),
  );
  assert.doesNotMatch(
    diagnosticLogText,
    /sensitive-token|sensitive-session/,
    "network diagnostics must not include access tokens or session IDs",
  );

  let notFoundAttempts = 0;
  networkContext.fetch = async (_input, options) => {
    notFoundAttempts += 1;
    lastPostBody = options.body;
    return {
      ok: false,
      status: 404,
      redirected: true,
      url: "https://script.googleusercontent.com/macros/echo",
      async text() {
        return JSON.stringify({
          status: "error",
          code: "NOT_FOUND",
          message: "Dashboard index not found.",
        });
      },
    };
  };
  await assert.rejects(
    network.callBackend(
      {
        type: "get_reviewer_dashboard",
        eventId: "22345678-1234-4123-8123-123456789abc",
        idToken: "sensitive-token-do-not-log",
        sessionId: "sensitive-session-do-not-log",
      },
      { maxRetries: 2, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
    ),
    (error) =>
      error.status === 404 &&
      error.code === "NOT_FOUND" &&
      error.correlationId === JSON.parse(lastPostBody).requestId,
  );
  assert.equal(
    notFoundAttempts,
    1,
    "permanent dashboard 404 responses must fail explicitly without retrying",
  );
  networkContext.fetch = async (_input, options) => {
    lastPostBody = options.body;
    return {
      ok: false,
      status: 404,
      redirected: true,
      url: "https://script.googleusercontent.com/macros/echo",
      async text() {
        return "<html>private-session-do-not-show</html>";
      },
    };
  };
  await assert.rejects(
    network.callBackend(
      {
        type: "get_reviewer_dashboard",
        eventId: "32345678-1234-4123-8123-123456789abc",
        idToken: "sensitive-token-do-not-log",
        sessionId: "sensitive-session-do-not-log",
      },
      { maxRetries: 2, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
    ),
    (error) =>
      error.status === 404 &&
      error.code === "NON_JSON_RESPONSE" &&
      error.message === "Backend returned a non-JSON response.",
  );
  assert.doesNotMatch(
    JSON.stringify(networkDiagnostics),
    /private-session-do-not-show|sensitive-token|sensitive-session/,
    "non-JSON 404 diagnostics must not expose response bodies or credentials",
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
    getPostBodyWithoutRequestId(),
    {
      type: "list_public_resources",
      folderId: "public-root",
      appVersion: networkContext.__MRH_APP__.version,
    },
    "public-resource listing requests should pass payload validation and include the folder ID",
  );
  await network.callBackend(
    {
      type: "list_public_resources",
      folderId: "public-root",
      pageToken: "next_page_token",
    },
    { maxRetries: 0 },
  );
  assert.deepEqual(
    getPostBodyWithoutRequestId(),
    {
      type: "list_public_resources",
      folderId: "public-root",
      pageToken: "next_page_token",
      appVersion: networkContext.__MRH_APP__.version,
    },
    "folder-pagination tokens should pass backend request payload validation",
  );
  const privatePreviewResponse = await network.callBackend(
    { type: "get_resource_preview", fileId: "private-file-id" },
    { maxRetries: 0 },
  );
  assert.equal(privatePreviewResponse.status, "success");
  assert.deepEqual(
    getPostBodyWithoutRequestId(),
    {
      type: "get_resource_preview",
      fileId: "private-file-id",
      appVersion: networkContext.__MRH_APP__.version,
    },
    "private-resource preview requests should include only the file ID and app version",
  );
  await network.callBackend(
    {
      type: "get_resource_preview",
      fileId: "private-file-id",
      previewMode: "drive",
    },
    { maxRetries: 0 },
  );
  assert.deepEqual(
    getPostBodyWithoutRequestId(),
    {
      type: "get_resource_preview",
      fileId: "private-file-id",
      previewMode: "drive",
      appVersion: networkContext.__MRH_APP__.version,
    },
    "native Drive preview requests should pass request validation without sending file bytes",
  );

  const reviewerEventId = "12345678-1234-4123-8123-123456789abc";
  await network.callBackend(
    { type: "get_reviewer_auth_config" },
    { maxRetries: 0 },
  );
  assert.deepEqual(getPostBodyWithoutRequestId(), {
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
  assert.deepEqual(getPostBodyWithoutRequestId(), {
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
  assert.deepEqual(getPostBodyWithoutRequestId(), {
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
  assert.deepEqual(getPostBodyWithoutRequestId(), {
    type: "get_resource_dashboard",
    eventId: reviewerEventId,
    idToken: "test-google-id-token",
    version: "dashboard-version",
    appVersion: networkContext.__MRH_APP__.version,
  });
  await network.callBackend(
    {
      type: "log_resource_dashboard_action",
      eventId: reviewerEventId,
      resourceArea: "MODULES",
      action: "FILTER_YEAR",
      detail: "3",
      course: "NAV6",
      year: "3",
      semester: "2",
      category: "FINALS",
    },
    { maxRetries: 0 },
  );
  assert.deepEqual(getPostBodyWithoutRequestId(), {
    type: "log_resource_dashboard_action",
    eventId: reviewerEventId,
    resourceArea: "MODULES",
    action: "FILTER_YEAR",
    detail: "3",
    course: "NAV6",
    year: "3",
    semester: "2",
    category: "FINALS",
    appVersion: networkContext.__MRH_APP__.version,
  });
  await network.callBackend(
    {
      type: "log_resource_file_click",
      eventId: reviewerEventId,
      resourceArea: "SYLLABUS",
      fileName: "NAV6 Syllabus",
      fileId: "012345678901234567890",
      course: "NAV6",
      year: "3",
      semester: "2",
      category: "SYLLABUS",
    },
    { maxRetries: 0 },
  );
  assert.deepEqual(getPostBodyWithoutRequestId(), {
    type: "log_resource_file_click",
    eventId: reviewerEventId,
    resourceArea: "SYLLABUS",
    fileName: "NAV6 Syllabus",
    fileId: "012345678901234567890",
    course: "NAV6",
    year: "3",
    semester: "2",
    category: "SYLLABUS",
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
  assert.equal(requestedAppUpdateCount, 1);
  assert.equal(networkContext.appNamespacesPurged, undefined);
  assert.deepEqual(deletedCacheNames, []);
  assert.deepEqual(unregisteredScopes, []);
  assert.equal(networkContext.replacedLocation, undefined);

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
    sinceCacheVersion: "backend-cache-8",
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
    snapshotUrl.searchParams.get("sinceCacheVersion"),
    "backend-cache-8",
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
    sinceCacheVersion: "legacy-cache-v1",
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

  const priorityPool = networkContext.module.exports.createConnectionPool({
    maxConnections: 1,
    maxRetries: 0,
    keepAlive: false,
    autoReconnect: false,
  });
  let releasePriorityBlocker;
  const blocker = priorityPool.request(
    () =>
      new Promise((resolve) => {
        releasePriorityBlocker = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const priorityOrder = [];
  const standardRequest = priorityPool.request(async () => {
    priorityOrder.push("standard");
  });
  const authRequest = priorityPool.request(
    async () => {
      priorityOrder.push("auth");
    },
    { priority: true },
  );
  releasePriorityBlocker();
  await Promise.all([blocker, standardRequest, authRequest]);
  assert.deepEqual(
    priorityOrder,
    ["auth", "standard"],
    "priority auth requests should bypass queued non-auth backend work",
  );
  priorityPool.destroy();
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
