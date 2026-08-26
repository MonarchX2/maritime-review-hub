const CACHE_PREFIX = "mrh-static";
const CACHE_VERSION = "v7";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

const APP_SHELL = [
  "/index.html",
  "/tailwind.generated.css",
  "/styles.css",
  "/app-entry.js",
  "/app-core-state.js",
  "/app-core-network.js",
  "/app-core.js",
  "/state-core.js",
  "/session-core.js",
  "/ui-modal-core.js",
  "/deck-nav-core.js",
  "/deck-review-core.js",
  "/analytics-core.js",
  "/quiz-rendering-core.js",
  "/network-utils.js",
  "/question-compat.js",
  "/session-utils.js",
  "/storage-utils.js",
  "/text-utils.js",
  "/ui-core.js",
];

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

  return (
    isSameOrigin(url) &&
    (url.pathname === "/" || url.pathname === "/index.html")
  );
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
        (url.pathname === "/" || url.pathname === "/index.html")
      ) {
        await cache.put("/index.html", response.clone());
      }
    }

    return response;
  } catch (error) {
    console.warn("[SW] Navigation network request failed, using cache:", error);

    const cached =
      (await cache.match(event.request)) || (await cache.match("/index.html"));

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
