const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const events = new Map();
const calls = {
  deletedCaches: [],
  errors: [],
  navigatedClients: [],
  messages: [],
  requests: [],
};
const cachedEntries = new Map();
const workerSource = fs.readFileSync("sw.js", "utf8");
const releaseMetadata = JSON.parse(fs.readFileSync("version.json", "utf8"));
const appVersionMatch = workerSource.match(/^const APP_VERSION = "([^"]+)";$/m);
assert.ok(appVersionMatch, "service worker must declare its release version");
const appVersion = appVersionMatch[1];
assert.equal(releaseMetadata.buildVersion, appVersion);
const webcrypto = require("node:crypto").webcrypto;
const appOrigin = "https://example.test";
const appBasePath = "/app/";
let skippedWaiting = false;
let claimedClients = false;
let deferStaticRefresh = false;
let finishStaticRefresh = null;
let forceStaticIntegrityMismatch = false;

const clients = [
  {
    id: "client-root",
    appVersion: "mrh-release-old-open-tab",
    url: `${appOrigin}/app/`,
    navigate: async (url) => calls.navigatedClients.push(url),
    postMessage(message) {
      calls.messages.push({ clientId: this.id, message });
      replyToVersionQuery(this, message);
    },
  },
  {
    id: "client-deck",
    appVersion,
    url: `${appOrigin}/app/deck/one`,
    navigate: async (url) => calls.navigatedClients.push(url),
    postMessage(message) {
      calls.messages.push({ clientId: this.id, message });
      replyToVersionQuery(this, message);
    },
  },
  {
    url: `${appOrigin}/application/`,
    navigate: async (url) => calls.navigatedClients.push(url),
  },
  {
    url: "https://outside.test/app/",
    navigate: async (url) => calls.navigatedClients.push(url),
  },
];

function replyToVersionQuery(client, message) {
  if (message.type !== "MRH_QUERY_CLIENT_VERSION") return;
  queueMicrotask(() => {
    events.get("message")({
      data: {
        type: "MRH_CLIENT_VERSION_RESPONSE",
        requestId: message.requestId,
        version: client.appVersion,
      },
      source: client,
    });
  });
}

const self = {
  location: {
    href: `${appOrigin}${appBasePath}sw.js?v=old-page-version`,
    origin: appOrigin,
  },
  crypto: webcrypto,
  DebugUtils: {
    warn() {},
    error(...args) {
      calls.errors.push(args);
    },
  },
  addEventListener(name, handler) {
    events.set(name, handler);
  },
  clients: {
    async matchAll() {
      return clients;
    },
    async claim() {
      claimedClients = true;
    },
  },
  async skipWaiting() {
    skippedWaiting = true;
  },
  setTimeout,
  clearTimeout,
};

const cacheStorage = {
  async open(name) {
    if (!cachedEntries.has(name)) cachedEntries.set(name, new Map());
    const entries = cachedEntries.get(name);
    return {
      async put(request, response) {
        entries.set(
          typeof request === "string" ? request : request.url,
          response.clone(),
        );
      },
      async match(request) {
        const key = typeof request === "string" ? request : request.url;
        return entries.get(key)?.clone();
      },
    };
  },
  async keys() {
    return [...cachedEntries.keys()];
  },
  async delete(name) {
    calls.deletedCaches.push(name);
    return cachedEntries.delete(name);
  },
};

const context = {
  Headers,
  Request,
  Response,
  URL,
  caches: cacheStorage,
  console,
  crypto: webcrypto,
  async fetch(request, options) {
    calls.requests.push({ request, options });
    const url = typeof request === "string" ? request : request.url;
    const parsedUrl = new URL(url);
    if (parsedUrl.pathname.endsWith("/version.json")) {
      return new Response(
        JSON.stringify({
          version: releaseMetadata.version,
          buildVersion: parsedUrl.searchParams.get("check"),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (
      forceStaticIntegrityMismatch &&
      new URL(url).pathname.endsWith("/styles.css")
    ) {
      forceStaticIntegrityMismatch = false;
      return new Response("inconsistent stylesheet");
    }
    if (deferStaticRefresh && new URL(url).pathname.endsWith("/styles.css")) {
      deferStaticRefresh = false;
      return new Promise((resolve) => {
        finishStaticRefresh = resolve;
      });
    }
    if (url === `${appOrigin}${appBasePath}offline`) {
      throw new Error("Simulated offline navigation");
    }
    const pathname = new URL(url).pathname;
    const body =
      pathname === appBasePath || pathname.endsWith("/index.html")
      ? '<!doctype html><html><head><title>App</title></head><body><script src="app-entry.js"></script></body></html>'
      : `fresh:${url}`;
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
  importScripts() {},
  self,
};

function captureWaitUntil(handler, event) {
  let promise;
  handler({
    ...event,
    waitUntil(value) {
      promise = value;
    },
  });
  assert.ok(promise, "service worker event must register its lifetime promise");
  return promise;
}

async function main() {
  vm.runInNewContext(workerSource, context, {
    filename: "sw.js",
  });

  assert.equal(
    self.__MRH_SW__.CACHE_NAME,
    `mrh-cache-${appVersion}`,
    "cache version must come from the worker release, not the page's old query",
  );

  cachedEntries.set(
    "mrh-cache-mrh-release-old-open-tab",
    new Map(),
  );
  cachedEntries.set("mrh-cache-unused-release", new Map());
  await captureWaitUntil(events.get("install"), {});
  assert.ok(skippedWaiting, "successfully precached workers must activate promptly");
  assert.equal(
    calls.requests[0].request.cache,
    "no-store",
    "worker installation must verify fresh release metadata before activation",
  );

  const currentCache = cachedEntries.get(`mrh-cache-${appVersion}`);
  const cachedIndex = currentCache.get(
    `${appOrigin}${appBasePath}index.html?v=${appVersion}`,
  );
  assert.match(await cachedIndex.clone().text(), /<html>/);
  assert.ok(
    cachedIndex,
    "the current app shell must be precached under the new release version",
  );

  await captureWaitUntil(events.get("activate"), {});
  assert.equal(
    claimedClients,
    false,
    "the new worker must not change existing clients' asset controller mid-session",
  );
  assert.deepEqual(
    calls.deletedCaches,
    [],
    "old release caches must remain until open tabs report their versions",
  );
  assert.deepEqual(
    calls.navigatedClients,
    [],
    "activating an update must not forcibly navigate open tabs",
  );
  assert.deepEqual(
    calls.messages
      .filter(({ message }) => message.type === "MRH_UPDATE_AVAILABLE")
      .map(({ clientId }) => clientId),
    ["client-root", "client-deck"],
    "the worker must notify only application tabs in scope",
  );

  await captureWaitUntil(events.get("message"), {
    data: { type: "MRH_CLIENT_VERSION", version: appVersion },
    source: clients[1],
  });
  assert.deepEqual(
    calls.deletedCaches,
    ["mrh-cache-unused-release"],
    "cache cleanup must retain a release still used by an open tab",
  );

  let navigationResponse;
  events.get("fetch")({
    request: {
      method: "GET",
      headers: new Headers(),
      mode: "navigate",
      url: `${appOrigin}${appBasePath}`,
    },
    respondWith(promise) {
      navigationResponse = promise;
    },
    waitUntil() {},
  });
  assert.equal(
    await (await navigationResponse).text(),
    '<!doctype html><html><head><title>App</title></head><body><script src="app-entry.js"></script></body></html>',
  );
  assert.equal(calls.requests.at(-1).options.cache, "no-store");

  let offlineResponse;
  events.get("fetch")({
    request: {
      method: "GET",
      headers: new Headers(),
      mode: "navigate",
      url: `${appOrigin}${appBasePath}offline`,
    },
    respondWith(promise) {
      offlineResponse = promise;
    },
    waitUntil() {},
  });
  const fallback = await offlineResponse;
  assert.equal(fallback.status, 200, "offline navigation must use the cached shell");
  const offlineHtml = await fallback.text();
  assert.match(offlineHtml, /<base href="\/app\/">/);
  assert.match(
    offlineHtml,
    /const appUrl = "https:\/\/monarchx2\.github\.io\/mrh\/";/,
    "offline recovery must use the canonical GitHub Pages URL",
  );
  const offlineScript = offlineHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(offlineScript, "offline recovery must include its retry behavior");
  assert.match(
    offlineScript,
    /addEventListener\("click", retryApp\)[\s\S]*?addEventListener\("online", retryApp\)/,
    "the Retry button and restored connection must navigate to the canonical app URL",
  );
  assert.match(
    offlineScript,
    /performance\.getEntriesByType\("navigation"\)\[0\]\?\.type === "reload"[\s\S]*?retryApp\(\)/,
    "refreshing the offline page while online must retry the canonical app URL",
  );
  assert.doesNotMatch(
    offlineScript,
    /location\.reload\(\)/,
    "offline recovery must not reload a stale or nested URL",
  );

  const staticRequest = new Request(
    `${appOrigin}${appBasePath}styles.css`,
    { method: "GET" },
  );
  let staticResponse;
  let staticRefresh;
  let staticRefreshComplete = false;
  deferStaticRefresh = true;
  events.get("fetch")({
    request: staticRequest,
    respondWith(promise) {
      staticResponse = promise;
    },
    waitUntil(promise) {
      staticRefresh = promise;
    },
  });
  assert.ok(staticRefresh, "cached static refresh must extend worker lifetime");
  staticRefresh.then(() => {
    staticRefreshComplete = true;
  });
  assert.equal((await staticResponse).status, 200);
  await Promise.resolve();
  assert.equal(typeof finishStaticRefresh, "function");
  assert.equal(
    staticRefreshComplete,
    false,
    "the worker lifetime must remain extended while refresh is in flight",
  );
  finishStaticRefresh(
    new Response(
      `fresh:${appOrigin}${appBasePath}styles.css?v=${appVersion}`,
      { headers: { "Content-Type": "text/css" } },
    ),
  );
  await staticRefresh;
  assert.equal(staticRefreshComplete, true);

  forceStaticIntegrityMismatch = true;
  let inconsistentStaticResponse;
  let inconsistentStaticRefresh;
  events.get("fetch")({
    request: staticRequest,
    respondWith(promise) {
      inconsistentStaticResponse = promise;
    },
    waitUntil(promise) {
      inconsistentStaticRefresh = promise;
    },
  });
  assert.equal((await inconsistentStaticResponse).status, 200);
  await inconsistentStaticRefresh;
  assert.ok(
    calls.errors.some((args) =>
      String(args[1]?.message || args[1]).includes("Integrity mismatch"),
    ),
    "the service worker must report and reject inconsistent static resources",
  );
  assert.equal(
    await (
      await currentCache.get(
        `${appOrigin}${appBasePath}styles.css?v=${appVersion}`,
      )
    ).text(),
    `fresh:${appOrigin}${appBasePath}styles.css?v=${appVersion}`,
    "an integrity-mismatched deployment must not replace the cached working asset",
  );

  let vendorResponse;
  events.get("fetch")({
    request: new Request(`${appOrigin}${appBasePath}qr-vendor/jsQR.js`),
    respondWith(promise) {
      vendorResponse = promise;
    },
    waitUntil() {},
  });
  assert.equal((await vendorResponse).status, 200);
  assert.equal(
    new URL(calls.requests.at(-1).request.url).pathname,
    `${appBasePath}qr-vendor/jsQR.js`,
    "nested app-shell assets must preserve their paths when normalized for cache lookup",
  );

  const incompleteVersion = `${appVersion}-incomplete`;
  const incompleteSource = workerSource.replace(
    `const APP_VERSION = "${appVersion}";`,
    `const APP_VERSION = "${incompleteVersion}";`,
  );
  const incompleteEvents = new Map();
  let incompleteWorkerSkippedWaiting = false;
  const incompleteSelf = {
    ...self,
    location: {
      href: `${appOrigin}${appBasePath}sw.js?v=${incompleteVersion}`,
      origin: appOrigin,
    },
    addEventListener(name, handler) {
      incompleteEvents.set(name, handler);
    },
    async skipWaiting() {
      incompleteWorkerSkippedWaiting = true;
    },
  };
  const incompleteContext = {
    ...context,
    self: incompleteSelf,
    async fetch(request, options) {
      const url = typeof request === "string" ? request : request.url;
      if (new URL(url).pathname.endsWith("/styles.css")) {
        throw new Error("Simulated incomplete deployment");
      }
      return context.fetch(request, options);
    },
  };
  vm.runInNewContext(incompleteSource, incompleteContext, {
    filename: "sw-incomplete.js",
  });
  let incompleteInstall;
  incompleteEvents.get("install")({
    waitUntil(promise) {
      incompleteInstall = promise;
    },
  });
  await assert.rejects(
    incompleteInstall,
    /Simulated incomplete deployment/,
    "an incomplete shell must fail installation",
  );
  assert.equal(
    incompleteWorkerSkippedWaiting,
    false,
    "an incomplete release must not replace the active worker",
  );
  assert.ok(
    cachedEntries.has(`mrh-cache-${appVersion}`),
    "the previous working app cache must remain available after failed install",
  );

  const staleMetadataVersion = `${appVersion}-stale-metadata`;
  const staleMetadataEvents = new Map();
  let staleMetadataWorkerSkippedWaiting = false;
  const staleMetadataSelf = {
    ...self,
    location: {
      href: `${appOrigin}${appBasePath}sw.js?v=${staleMetadataVersion}`,
      origin: appOrigin,
    },
    addEventListener(name, handler) {
      staleMetadataEvents.set(name, handler);
    },
    async skipWaiting() {
      staleMetadataWorkerSkippedWaiting = true;
    },
  };
  const staleMetadataContext = {
    ...context,
    self: staleMetadataSelf,
    async fetch(request, options) {
      const url = typeof request === "string" ? request : request.url;
      if (new URL(url).pathname.endsWith("/version.json")) {
        return new Response(
          JSON.stringify({
            version: releaseMetadata.version,
            buildVersion: appVersion,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return context.fetch(request, options);
    },
  };
  vm.runInNewContext(
    workerSource.replace(
      `const APP_VERSION = "${appVersion}";`,
      `const APP_VERSION = "${staleMetadataVersion}";`,
    ),
    staleMetadataContext,
    { filename: "sw-stale-metadata.js" },
  );
  let staleMetadataInstall;
  staleMetadataEvents.get("install")({
    waitUntil(promise) {
      staleMetadataInstall = promise;
    },
  });
  await assert.rejects(
    staleMetadataInstall,
    /Release metadata mismatch/,
    "a worker from a different deployment must not install against stale release metadata",
  );
  assert.equal(
    staleMetadataWorkerSkippedWaiting,
    false,
    "stale deployment metadata must leave the previous worker active",
  );

  console.log("Service-worker update lifecycle checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
