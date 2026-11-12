// Overvix PWA Service Worker (v1.0)
const CACHE_NAME = 'overvix-pwa-v1.0';

// Core assets to pre-cache for instant standalone launch
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/static/styles.css',
  '/static/favicon.svg',
  '/static/favicon.ico',
  '/static/favicon-192.png',
  '/static/favicon-512.png',
  '/static/favicon-maskable-192.png',
  '/static/favicon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[PWA SW] Precache skipped for:', asset, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Never intercept WebSockets or non-GET requests
  if (req.method !== 'GET' || url.protocol.startsWith('ws')) {
    return;
  }

  // 2. Real-time IBKR endpoints & dynamic state: strictly network-only
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    event.respondWith(fetch(req));
    return;
  }

  // 3. Navigation requests (HTML document): Network-first with cache fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/') || caches.match('/index.html'))
    );
    return;
  }

  // 4. Static assets (CSS, JS, Fonts, Images): Stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
        }
        return resp;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
