// rapp-zoo PWA service worker — minimal app-shell cache + network-first
// for the upstream catalog. The point: open the page on iOS, "Add to
// Home Screen", and the app launches even without network — last-known
// catalog still browsable.

const CACHE = 'rapp-zoo-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  // JSZip from CDN (used by the Inspect tab) — caching it makes
  // egg-inspection work offline once you've used it once.
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Strategy:
// - Same-origin GETs (the app shell) → cache-first; falls back to network.
// - Catalog fetches (raw.githubusercontent.com) → network-first; cache as
//   fallback so offline users still see the last-fetched catalog.
// - Brainstem fetches (localhost) → never cache (live state).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Don't intercept chats with the local brainstem.
  if (/^localhost($|:)|^127\.0\.0\.1($|:)/.test(url.host)) return;

  // raw.githubusercontent.com → network-first, cache fallback
  if (url.host === 'raw.githubusercontent.com') {
    e.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // App shell → cache-first
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(resp => {
      if (resp && resp.ok && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return resp;
    }))
  );
});
