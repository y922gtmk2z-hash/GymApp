// Service worker: versioned precache, cache-first, update on next load.
// Bump VERSION whenever any file in SHELL changes (see CLAUDE.md).
const VERSION = 7;
const CACHE = `gym-v${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './js/app.js',
  './js/charts.js',
  './js/db.js',
  './js/schema.js',
  './js/sample.js',
  './js/share.js',
  './js/store.js',
  './js/ui.js',
  './js/util.js',
  './js/data.js',
  './js/engine.js',
  './js/ics.js',
  './js/stats.js',
  './js/timer.js',
  './js/units.js',
  './js/wakelock.js',
  './js/weight.js',
  './js/views/banners.js',
  './js/views/common.js',
  './js/views/today.js',
  './js/views/workout.js',
  './js/views/plan.js',
  './js/views/progress.js',
  './js/views/more.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('gym-v') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
