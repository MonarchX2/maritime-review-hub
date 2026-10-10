importScripts("./debug-utils.js");

const swLogger = self.DebugUtils || console;
const CACHE_PREFIX = "mrh-cache";
const APP_VERSION = "mrh-release-2026.10.10";
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
  "./manifest.json",
  "./icon.svg",
  "./tailwind.generated.css",
  "./styles.css",
  "./app-entry.js",
  "./app-config.js",
  "./app-core.js",
  "./preferences-core.js",
  "./dashboard-core.js",
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
  "./rendering-core.js",
  "./storage-utils.js",
  "./text-utils.js",
].map(resolveAppUrl);

const APP_SHELL_RESOURCE_NAMES = new Set(
  APP_SHELL.map((url) => new URL(url).pathname.split("/").pop()),
);

const APP_SHELL_INTEGRITY = Object.create(null);

async function hashResponse(response) {
  if (!response || !response.ok) return null;

  const subtleCrypto = self.crypto?.subtle;
  if (!subtleCrypto) return null;

  const digest = await subtleCrypto.digest(
    "SHA-256",
    await response.clone().arrayBuffer(),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function refreshAppShellIntegrity() {
  const nextIntegrity = Object.create(null);

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

        if (!response.ok) return;

        const resourceName = getAppResourceName(url);
        if (!resourceName) return;

        const digest = await hashResponse(response);
        if (digest) {
          nextIntegrity[resourceName] = digest;
        }
      } catch (error) {
        swLogger.warn("[SW] Unable to refresh shell integrity:", url, error);
      }
    }),
  );

  Object.keys(APP_SHELL_INTEGRITY).forEach(
    (key) => delete APP_SHELL_INTEGRITY[key],
  );
  Object.assign(APP_SHELL_INTEGRITY, nextIntegrity);
  return APP_SHELL_INTEGRITY;
}

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

  return (
    (isSameOrigin(url) && url.pathname.startsWith(getAppBasePath())) ||
    isAllowedCdn(url)
  );
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
  return (
    STATIC_DESTINATIONS.has(request.destination) ||
    APP_SHELL_RESOURCE_NAMES.has(url.pathname.split("/").pop())
  );
}

function isAppShellNavigation(request) {
  if (request.method !== "GET" || request.mode !== "navigate") {
    return false;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return false;
  }

  const appBasePath = getAppBasePath();
  const normalizedPath = url.pathname || "/";
  return (
    APP_SHELL_NAVIGATION_PATHS.has(normalizedPath) ||
    normalizedPath.startsWith(appBasePath)
  );
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

async function verifyResponseIntegrity(
  response,
  url,
  expectedHash = APP_SHELL_INTEGRITY[getAppResourceName(url)],
) {
  if (!expectedHash) return;

  const actualHash = await hashResponse(response);
  if (!actualHash) {
    throw new Error(`Web Crypto is unavailable for ${url}`);
  }

  if (actualHash !== expectedHash) {
    swLogger.warn(
      `[SW] Integrity mismatch for ${url}: expected ${expectedHash}, got ${actualHash}`,
    );
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
  await refreshAppShellIntegrity();

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

        const resourceName = getAppResourceName(url);
        const expectedHash = resourceName
          ? APP_SHELL_INTEGRITY[resourceName]
          : null;
        if (expectedHash) {
          await verifyResponseIntegrity(response, url, expectedHash);
        }
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

    if (!response.ok) {
      throw new Error(`Navigation failed with HTTP ${response.status}`);
    }

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
      const cachedHtml = await cached.text();
      const baseElement = `<base href="${getAppBasePath()}">`;
      const appHtml = cachedHtml.replace(
        /<head(?:\s[^>]*)?>/i,
        (head) => `${head}${baseElement}`,
      );
      const appHtmlWithFallbackBase =
        appHtml === cachedHtml
          ? cachedHtml.replace(
              /<html(?:\s[^>]*)?>/i,
              (html) => `${html}<head>${baseElement}`,
            )
          : appHtml;
      if (appHtmlWithFallbackBase === cachedHtml) {
        throw new Error(
          "Cached application entry point has no HTML root element.",
        );
      }

      const headers = new Headers(cached.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(appHtmlWithFallbackBase, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }

    return new Response(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#111217">
    <title>Offline - Maritime Review Hub</title>
    <style>
      body {
        box-sizing: border-box;
        display: grid;
        min-height: 100vh;
        margin: 0;
        padding: 24px;
        place-items: center;
        background: #f8fafc;
        color: #111827;
        font: 16px/1.5 system-ui, sans-serif;
      }
      main { max-width: 440px; }
      h1 { margin: 0 0 12px; font-size: 1.75rem; }
      p { margin: 0 0 16px; }
      button {
        border: 0;
        border-radius: 8px;
        padding: 12px 18px;
        background: #1d4ed8;
        color: white;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <h1>You're offline</h1>
      <p>The app's offline copy isn't available. Clearing app data removes saved app files, so connect to the internet to load the app again.</p>
      <p id="connection-status" role="status" aria-live="polite"></p>
      <button id="retry-button" type="button">Try again</button>
    </main>
    <script>
      const status = document.getElementById("connection-status");
      status.textContent = navigator.onLine
        ? "The connection may be temporarily unavailable. Try loading again."
        : "Waiting for an internet connection...";
      document
        .getElementById("retry-button")
        .addEventListener("click", () => location.reload());
      window.addEventListener("online", () => location.reload());
    </script>
  </body>
</html>`,
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

function getAppShellResourceRequest(request) {
  const url = new URL(request.url);
  if (!isSameOrigin(url)) return request;

  const resourceName = url.pathname.split("/").pop();
  if (!APP_SHELL_RESOURCE_NAMES.has(resourceName)) return request;

  return new Request(resolveAppUrl(`./${resourceName}`), request);
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
    event.respondWith(
      staleWhileRevalidateStatic(getAppShellResourceRequest(request)),
    );
    return;
  }

  // API, fetch(), XHR, JSON, database/network requests, etc.
  // are intentionally NOT intercepted.
});
