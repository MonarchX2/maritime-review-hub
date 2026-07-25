const CACHE_NAME = '2'; // Bumped version to force update
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './app.js',
    './admin.js',
    './styles.css',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd.js'
];

self.addEventListener('install', (event) => {
    // skipWaiting forces the waiting Service Worker to become the active Service Worker immediately.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('activate', (event) => {
    // clients.claim() tells the Service Worker to take control of the page immediately.
    event.waitUntil(clients.claim());
    
    // Clean up old caches
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Network-First Strategy
self.addEventListener('fetch', (event) => {
    // FIX: The Cache API strictly requires GET requests. Ignore POST/PUT etc.
    if (event.request.method !== 'GET') {
        return; 
    }

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // FIX: Only cache successful network responses to avoid caching errors
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // If the network fails (offline), fall back to the cache
                return caches.match(event.request);
            })
    );
});