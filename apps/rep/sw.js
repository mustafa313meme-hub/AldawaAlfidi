// Offline shell: precache every app file, serve them cache-first, never touch /api. A new version waits until the app is closed
// (no skipWaiting) so a running page never mixes old and new modules. Bump VERSION on every release.
const VERSION = 'rep-v1';
const SHELL = [
  './',
  'config.js',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'js/api.js',
  'js/app.js',
  'js/db.js',
  'js/dom.js',
  'js/logic.js',
  'js/pages/customers.js',
  'js/pages/forms.js',
  'js/pages/home.js',
  'js/pages/more.js',
  'js/pages/outbox.js',
  'js/pricing.js',
  'js/session.js',
  'js/sync.js',
  'manifest.webmanifest'
];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch (err) {
      if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
