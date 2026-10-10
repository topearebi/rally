/**
 * Rally - Offline service worker.
 *
 * Network-first for the app's own files: you always get the latest deploy when online,
 * and a matching cached copy when offline. (Cache-first would mix old and new files
 * after a GitHub Pages deploy.) Bump CACHE_VERSION when the precache list changes.
 */

const CACHE_VERSION = 'rally-v3';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/app.js',
  './js/audio.js',
  './js/config.js',
  './js/dom.js',
  './js/favicon.js',
  './js/peer-sync.js',
  './js/peers-view.js',
  './js/quest-view.js',
  './js/state.js',
  './js/timer.js',
  './js/toast.js',
  './js/ui.js',
  './js/worker.js',
  './vendor/peerjs.min.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (err) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
