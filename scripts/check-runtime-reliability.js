const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const storageSource = fs.readFileSync("storage-utils.js", "utf8");
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
vm.createContext(networkContext);
vm.runInContext(
  fs.readFileSync("app-core-network.js", "utf8"),
  networkContext,
  { filename: "app-core-network.js" },
);

async function checkBackendErrorHandling() {
  let fetchCount = 0;
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
  checkConnectionPoolConcurrency(),
  checkConnectionPoolCleanupAndHealth(),
])
  .then(() => console.log("Runtime reliability checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
