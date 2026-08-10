const CACHE_PREFIX = "mrh-static";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./app.js",
  "./admin.js",
  "./styles.css",
];

let CACHE_NAME = `${CACHE_PREFIX}-v0`;

async function computeAssetFingerprint() {
  const bodyParts = [];

  for (const asset of ASSETS_TO_CACHE) {
    try {
      const response = await fetch(asset, { cache: "no-cache" });
      if (!response || !response.ok) continue;
      const text = await response.text();
      bodyParts.push(text);
    } catch (e) {
      // Ignore assets that are not fetchable during worker setup.
    }
  }

  const fingerprintSource = bodyParts.join("\n---asset-separator---");
  const data = new TextEncoder().encode(fingerprintSource);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  const hash = bytes
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);

  return hash;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const fingerprint = await computeAssetFingerprint();
      CACHE_NAME = `${CACHE_PREFIX}-${fingerprint}`;
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS_TO_CACHE);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clients.claim();
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) => {
          if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
            return caches.delete(name);
          }
          return Promise.resolve();
        }),
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
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      return cached || networkFetch;
    })(),
  );
});
