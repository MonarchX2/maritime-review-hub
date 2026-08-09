const CACHE_NAME = "1";

const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./app.js",
  "./admin.js",
  "./styles.css",
  "https://cdn.tailwindcss.com",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd.js",
];

// Install: cache core assets
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
  );
});

// Activate: claim clients and remove old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clients.claim();
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) =>
          name !== CACHE_NAME ? caches.delete(name) : Promise.resolve(),
        ),
      );
    })(),
  );
});

// Fetch: cache-first with background update; ignore non-GET requests and Google Scripts
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  try {
    const url = new URL(request.url);
    if (url.origin.includes("script.google.com")) return;
  } catch (e) {
    // If URL parsing fails, fall back to network
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      // Start network fetch in background to update cache
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      // Prefer cached response if available, otherwise wait for network
      return cached || networkFetch;
    })(),
  );
});
