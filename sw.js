const CACHE_PREFIX = "mrh-static";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((name) => name.startsWith(CACHE_PREFIX))
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clients.claim();
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((name) => name.startsWith(CACHE_PREFIX))
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
    if (url.origin.includes("script.google.com")) return;
  } catch (e) {
    return;
  }

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cached) => cached || Response.error()),
    ),
  );
});
