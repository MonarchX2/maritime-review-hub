importScripts("./debug-utils.js");

const swLogger = self.DebugUtils || console;
const CACHE_PREFIX = "mrh-cache";
const APP_VERSION = "mrh-release-2026.09.05";
const FALLBACK_CACHE_VERSION = APP_VERSION;

function getServiceWorkerUrl() {
  return new URL(self.location.href);
}

function getRuntimeCacheVersion() {
  const version = getServiceWorkerUrl().searchParams.get("v");
  return version || FALLBACK_CACHE_VERSION;
}

const CACHE_VERSION = getRuntimeCacheVersion();
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

const APP_BASE_URL = new URL("./", self.location.href);
const APP_BASE_PATH = APP_BASE_URL.pathname || "/";

function resolveAppUrl(pathname) {
  const url = new URL(pathname, APP_BASE_URL);
  url.searchParams.set("v", CACHE_VERSION);
  return url.toString();
}

function getAppBasePath() {
  const basePath = APP_BASE_PATH;
  return basePath === "/"
    ? "/"
    : basePath.endsWith("/")
      ? basePath
      : `${basePath}/`;
}

function getAppShellNavigationPaths() {
  const appBasePath = getAppBasePath();
  const normalizedBasePath =
    appBasePath === "/" ? "/" : appBasePath.replace(/\/+$/, "") || "/";
  const candidates = new Set([
    normalizedBasePath,
    normalizedBasePath === "/" ? "/" : `${normalizedBasePath}/`,
  ]);

  const indexAliases = [
    normalizedBasePath === "/"
      ? "/index.html"
      : `${normalizedBasePath}/index.html`,
    normalizedBasePath === "/"
      ? "/index.htm"
      : `${normalizedBasePath}/index.htm`,
  ];

  for (const alias of indexAliases) {
    candidates.add(alias);
  }

  return candidates;
}

const APP_SHELL_NAVIGATION_PATHS = getAppShellNavigationPaths();

const APP_SHELL = [
  "./index.html",
  "./tailwind.generated.css",
  "./styles.css",
  "./app-entry.js",
  "./app-config.js",
  "./app-core.js",
  "./app-core-state.js",
  "./app-core-network.js",
  "./sync-core.js",
  "./session-core.js",
  "./analytics-core.js",
  "./ui-modal-core.js",
  "./deck-nav-core.js",
  "./deck-review-core.js",
  "./quiz-rendering-core.js",
  "./debug-utils.js",
  "./lifecycle-utils.js",
  "./storage-utils.js",
  "./text-utils.js",
].map(resolveAppUrl);

const APP_SHELL_INTEGRITY = Object.freeze({
  "index.html":
    "d8f077dff5ae87b1c772daa627ff9fc834f32efeaa41439ea1ca6e32e4840416",
  "tailwind.generated.css":
    "b8660785a8ba0756314bcd068fd43e2bd218228a574db158e0c5496d2330d37c",
  "styles.css":
    "098f08286d4a3b083186440224fb054b70c0e4dda472b9b4d2629f413097ce9a",
  "app-entry.js":
    "1e0a4d5f11a6f41d62546217b69c52a98e4733a0f5a684f6e5fa90912ba51ac5",
  "app-config.js":
    "971f3f28cc40cb0b91b581b493436d4934cd6ed27b7349cbd62011f4a7d42dc1",
  "app-core.js":
    "da5768e6e2cf30839ff5bf7786ced2d89f4073898aabbc3b1f6d08464eadcc95",
  "app-core-state.js":
    "38c7394b709b687c97e26ec0ae03d32f11157613e881e4b5eb8de7a77557cd05",
  "app-core-network.js":
    "40d008957a3679d45fca663479f51293c00a92c1c370a7c160b5e73441d6986a",
  "sync-core.js":
    "9ed4adb1964c36eadc259bb82e20791225d53710527eff083d4d59c89f614b49",
  "session-core.js":
    "88b502fe292470e7f6494c0aa12a309790ee0089353ccc35fed55bba43c826a1",
  "analytics-core.js":
    "43df22f3bd7120d670fa1ca5b5d446038917d12aeeab5297e85a93abde37a78d",
  "ui-modal-core.js":
    "346d4465f81519e9541d224f37ce05c09f18b8d2f230d040337791b6fd474b58a",
  "deck-nav-core.js":
    "2805fecd992cea390cba2f90e71219deaa4e4a398ce5e6e5dcb8844fdeabfd5a",
  "deck-review-core.js":
    "11476109878302a0f11528ce6fad99a3eb5edc5559e43bea4f4f72bd991df9ba",
  "quiz-rendering-core.js":
    "c8182f54592ae5f6082cebbbcdc1a4b46d97cd4005dfa32615bf5bb196258b9d",
  "debug-utils.js":
    "825e96cb1ab6be2c4c92d9b63f1c60c5d28260561b6e6637c51955a5303e9961",
  "lifecycle-utils.js":
    "ac5c52a5f255bef28d1243954407149bd54708de67a62be7f2d7dffafa94d82e",
  "storage-utils.js":
    "a55cd7e274d5a3bdfa8099f861f1bcbcd35c6cf37d71f735a6a3f6b2bc8e232b",
  "text-utils.js":
    "8fa073d67b9081e81985ba869c1e89c63f3a652ed65984a39d8db56c64c52654",
});

self.__MRH_SW__ = {
  getRuntimeCacheVersion,
  getAppBasePath,
  resolveAppUrl,
  CACHE_NAME,
};

const CDN_ORIGINS = new Set([
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
]);

const STATIC_DESTINATIONS = new Set([
  "script",
  "style",
  "image",
  "font",
  "manifest",
  "worker",
  "sharedworker",
]);

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isAllowedCdn(url) {
  return CDN_ORIGINS.has(url.origin);
}

function isAppRequest(request) {
  const url = new URL(request.url);

  return isSameOrigin(url) || isAllowedCdn(url);
}

function isStaticRequest(request) {
  if (request.method !== "GET") {
    return false;
  }

  if (request.headers.has("range")) {
    return false;
  }

  const url = new URL(request.url);

  if (!isAppRequest(request)) {
    return false;
  }

  // Cross-origin resources are only treated as static if they come
  // from one of the explicitly allowed CDNs.
  if (!isSameOrigin(url)) {
    return true;
  }

  // For same-origin requests, only intercept actual static resources.
  // fetch()/XHR requests normally have an empty destination and will
  // therefore pass through untouched.
  return STATIC_DESTINATIONS.has(request.destination);
}

function isAppShellNavigation(request) {
  if (request.method !== "GET" || request.mode !== "navigate") {
    return false;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return false;
  }

  return APP_SHELL_NAVIGATION_PATHS.has(url.pathname || "/");
}

async function getCache() {
  return caches.open(CACHE_NAME);
}

function getAppResourceName(url) {
  const path = new URL(url).pathname;
  const basePath = APP_BASE_PATH.endsWith("/")
    ? APP_BASE_PATH
    : `${APP_BASE_PATH}/`;
  const resourceName = path.startsWith(basePath)
    ? path.slice(basePath.length)
    : "";
  return APP_SHELL_NAVIGATION_PATHS.has(path) ? "index.html" : resourceName;
}

async function verifyResponseIntegrity(response, url) {
  const expectedHash = APP_SHELL_INTEGRITY[getAppResourceName(url)];
  if (!expectedHash) return;

  const subtleCrypto = self.crypto?.subtle;
  if (!subtleCrypto) {
    throw new Error(`Web Crypto is unavailable for ${url}`);
  }

  const digest = await subtleCrypto.digest(
    "SHA-256",
    await response.clone().arrayBuffer(),
  );
  const actualHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  if (actualHash !== expectedHash) {
    throw new Error(`Integrity check failed for ${url}`);
  }
}

async function cacheResponse(cache, request, response) {
  if (!response || !response.ok) {
    return;
  }

  // Only cache responses that are safe for this cache.
  if (response.type === "opaque") {
    return;
  }

  await verifyResponseIntegrity(response, request.url);

  try {
    await cache.put(request, response.clone());
  } catch (error) {
    swLogger.warn("[SW] Failed to cache response:", request.url, error);
  }
}

async function precacheAppShell() {
  const cache = await getCache();

  await Promise.all(
    APP_SHELL.map(async (url) => {
      try {
        const response = await fetch(
          new Request(url, {
            method: "GET",
            cache: "no-cache",
            credentials: "same-origin",
          }),
        );

        if (!response.ok) {
          throw new Error(
            `Precache failed with HTTP ${response.status}: ${url}`,
          );
        }

        await verifyResponseIntegrity(response, url);
        await cache.put(url, response);
      } catch (error) {
        swLogger.error("[SW] Failed to precache:", url, error);

        // Abort installation if a required app-shell resource cannot
        // be cached. This prevents installing a worker that cannot
        // provide the complete offline shell.
        throw error;
      }
    }),
  );
}

async function cleanupOldCaches() {
  const keys = await caches.keys();

  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)),
  );
}

async function networkFirstNavigation(event) {
  const cache = await getCache();

  try {
    const preloadResponse = await event.preloadResponse;

    const response = preloadResponse || (await fetch(event.request));

    await verifyResponseIntegrity(response, event.request.url);

    if (response && response.ok && response.type !== "opaque") {
      // Only store the application entry point.
      // Do not cache arbitrary navigation URLs because they may contain
      // dynamic or user-specific HTML.
      const url = new URL(event.request.url);

      if (
        url.origin === self.location.origin &&
        APP_SHELL_NAVIGATION_PATHS.has(url.pathname || "/")
      ) {
        // Do not block navigation on cache persistence. The response can be
        // returned immediately while the service worker stores the fresh shell.
        event.waitUntil(
          cache
            .put(resolveAppUrl("./index.html"), response.clone())
            .catch((error) => {
              swLogger.warn("[SW] Failed to refresh app shell cache:", error);
            }),
        );
      }
    }

    return response;
  } catch (error) {
    swLogger.warn(
      "[SW] Navigation network request failed, using cache:",
      error,
    );

    const appEntryUrl = resolveAppUrl("./index.html");
    const cached =
      (await cache.match(event.request)) || (await cache.match(appEntryUrl));

    if (cached) {
      return cached;
    }

    return new Response(
      '<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head><body><h1>Offline</h1><p>The application is currently unavailable.</p></body></html>',
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}

async function staleWhileRevalidateStatic(request) {
  const cache = await getCache();
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response && response.ok && response.type !== "opaque") {
        await cacheResponse(cache, request, response);
      }
      return response;
    })
    .catch((error) => {
      if (!cached) throw error;
      swLogger.warn(
        "[SW] Static refresh failed; using cached response:",
        request.url,
      );
      return cached;
    });

  if (cached) {
    return cached;
  }

  // First visits still wait for the network and populate the cache.
  return refresh;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheAppShell();

      // Activate the new worker as soon as its installation succeeds.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await cleanupOldCaches();

      // Enable navigation preload where supported.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (error) {
          swLogger.warn("[SW] Navigation preload could not be enabled:", error);
        }
      }

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  // Never interfere with range requests.
  // This avoids breaking media/partial-content semantics.
  if (request.headers.has("range")) {
    return;
  }

  const url = new URL(request.url);

  // Never handle unrelated cross-origin requests.
  if (!isAppRequest(request)) {
    return;
  }

  // Application navigation:
  // NETWORK FIRST -> CACHE FALLBACK
  if (isAppShellNavigation(request)) {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  // Static resources: cached response first, with a background refresh.
  if (isStaticRequest(request)) {
    event.respondWith(staleWhileRevalidateStatic(request));
    return;
  }

  // API, fetch(), XHR, JSON, database/network requests, etc.
  // are intentionally NOT intercepted.
});
