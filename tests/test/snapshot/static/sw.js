// Lunar Link Planner — service worker (offline shell + installability).
// Strategy: cache-first for the app shell and local assets, network-first for
// /api/* (NASA proxies) so fresh data is used when online. Never caches huge
// NASA rasters beyond a small allow-list to keep storage sane.
const CACHE = 'llp-v7-1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './ui.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './solar-system-core.mjs',
  './planet-data-sources.mjs',
  './nav-core.mjs',
  './earth-route-core.mjs',
  './route-core.mjs',
  './terrain-core.mjs',
  './scale-core.mjs',
  './moon-surface-core.mjs',
  './scene-tween.mjs',
  './ui-core.mjs',
  './controls-core.mjs',
  './layers-core.mjs',
  './routing-core.mjs',
  './planets-core.mjs',
  './route-visualizer.mjs',
  './breadcrumb-store.mjs',
  './deep3d.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // NASA proxy + external CDN: network-first, don't cache large binaries.
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return; // let CDN (three.js) go straight to network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
