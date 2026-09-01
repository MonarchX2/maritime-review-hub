const CACHE_PREFIX = "mrh-cache-3";
const APP_VERSION = "mrh-release-2026.09.01";
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
  "./app-core.js",
  "./app-core-state.js",
  "./app-core-network.js",
  "./session-core.js",
  "./analytics-core.js",
  "./ui-modal-core.js",
  "./deck-nav-core.js",
  "./deck-review-core.js",
  "./quiz-rendering-core.js",
  "./debug-utils.js",
  "./storage-utils.js",
  "./text-utils.js",
].map(resolveAppUrl);

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

async function cacheResponse(cache, request, response) {
  if (!response || !response.ok) {
    return;
  }

  // Only cache responses that are safe for this cache.
  if (response.type === "opaque") {
    return;
  }

  try {
    await cache.put(request, response.clone());
  } catch (error) {
    console.warn("[SW] Failed to cache response:", request.url, error);
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

        await cache.put(url, response);
      } catch (error) {
        console.error("[SW] Failed to precache:", url, error);

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
              console.warn("[SW] Failed to refresh app shell cache:", error);
            }),
        );
      }
    }

    return response;
  } catch (error) {
    console.warn("[SW] Navigation network request failed, using cache:", error);

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
      console.warn(
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
          console.warn("[SW] Navigation preload could not be enabled:", error);
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
