const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const events = new Map();
const calls = {
  deletedCaches: [],
  navigatedClients: [],
  requests: [],
};
const cachedEntries = new Map();
const workerSource = fs.readFileSync("sw.js", "utf8");
const appVersionMatch = workerSource.match(/^const APP_VERSION = "([^"]+)";$/m);
assert.ok(appVersionMatch, "service worker must declare its release version");
const appVersion = appVersionMatch[1];
const appOrigin = "https://example.test";
const appBasePath = "/app/";
let skippedWaiting = false;
let claimedClients = false;

const clients = [
  {
    url: `${appOrigin}/app/`,
    navigate: async (url) => calls.navigatedClients.push(url),
  },
  {
    url: `${appOrigin}/app/deck/one`,
    navigate: async (url) => calls.navigatedClients.push(url),
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

const self = {
  location: {
    href: `${appOrigin}${appBasePath}sw.js?v=old-page-version`,
    origin: appOrigin,
  },
  DebugUtils: { warn() {}, error() {} },
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
  crypto: require("node:crypto").webcrypto,
  async fetch(request, options) {
    calls.requests.push({ request, options });
    const url = typeof request === "string" ? request : request.url;
    if (url === `${appOrigin}${appBasePath}offline`) {
      throw new Error("Simulated offline navigation");
    }
    const pathname = new URL(url).pathname;
    const body =
      pathname === appBasePath || pathname.endsWith("/index.html")
      ? "<!doctype html><html><head><title>App</title></head><body>App</body></html>"
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

  cachedEntries.set("mrh-cache-old-release", new Map());
  await captureWaitUntil(events.get("install"), {});
  assert.ok(skippedWaiting, "successfully precached workers must activate promptly");

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
  assert.ok(claimedClients, "the active worker must take control of open clients");
  assert.deepEqual(calls.deletedCaches, ["mrh-cache-old-release"]);
  assert.deepEqual(calls.navigatedClients.sort(), [
    `${appOrigin}/app/`,
    `${appOrigin}/app/deck/one`,
  ]);

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
    "<!doctype html><html><head><title>App</title></head><body>App</body></html>",
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
  assert.match(await fallback.text(), /<base href="\/app\/">/);

  console.log("Service-worker update lifecycle checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
