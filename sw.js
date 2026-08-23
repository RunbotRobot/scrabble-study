'use strict';
/**
 * Service worker: makes the app installable and usable offline once
 * you've opened it at least once online.
 *
 * Two strategies:
 *  - App shell (HTML/CSS/JS): network-first, falling back to cache when
 *    offline. This means an online visit always picks up whatever's
 *    actually deployed rather than a stale cached copy, while an offline
 *    visit still works from whatever was last cached.
 *  - Big, rarely-changing assets (the dictionary, icons): cache-first,
 *    since re-fetching an ~11MB file on every load would be wasteful and
 *    it essentially never changes between visits.
 */

const SHELL_CACHE = 'scrabble-study-shell-v1';
const DATA_CACHE = 'scrabble-study-data-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/cards.js',
  './js/dictionary.js',
  './js/jumble.js',
  './js/queue-ui.js',
  './js/srs.js',
  './js/store.js',
  './js/streak.js',
  './js/sync-ui.js',
  './js/sync.js',
];

const DATA_ASSETS = ['./data/dictionary.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL_ASSETS);
      const data = await caches.open(DATA_CACHE);
      await data.addAll(DATA_ASSETS);
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isDataAsset(pathname) {
  return DATA_ASSETS.some((path) => pathname.endsWith(path.replace('./', '/')));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isDataAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        cache.put(event.request, response.clone());
        return response;
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(event.request, response.clone());
        return response;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(event.request);
        return cached || cache.match('./index.html');
      }
    })()
  );
});
