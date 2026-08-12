const CACHE_PREFIX = "mrh-static";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app-core.js",
  "/admin.js",
  "/discovery.js",
  "/network-utils.js",
  "/question-compat.js",
  "/session-utils.js",
  "/storage-utils.js",
  "/text-utils.js",
  "/ui-core.js",
  "/sw.js",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(`${CACHE_PREFIX}-v1`);
      await cache.addAll(APP_SHELL.filter(Boolean));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clients.claim();
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (name) =>
              name.startsWith(CACHE_PREFIX) && name !== `${CACHE_PREFIX}-v1`,
          )
          .map((name) => caches.delete(name)),
      );
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  try {
    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;
    const isAppAsset =
      sameOrigin ||
      url.origin === "https://cdn.tailwindcss.com" ||
      url.origin === "https://cdnjs.cloudflare.com" ||
      url.origin === "https://cdn.jsdelivr.net";

    if (!sameOrigin && !isAppAsset) return;

    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches
              .open(`${CACHE_PREFIX}-v1`)
              .then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => caches.match("/index.html") || Response.error()),
      );
      return;
    }

    if (
      sameOrigin ||
      url.origin === "https://cdn.tailwindcss.com" ||
      url.origin === "https://cdnjs.cloudflare.com" ||
      url.origin === "https://cdn.jsdelivr.net"
    ) {
      event.respondWith(
        caches.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).catch(
            () => caches.match("/index.html") || Response.error(),
          );
        }),
      );
    }
  } catch (e) {
    return;
  }
});
