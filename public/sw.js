// Service Worker para Retro Vault PWA
const CACHE_NAME = 'retro-vault-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/favicon.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Las llamadas de API siempre van a la red
  if (e.request.url.includes('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request).catch(() => caches.match('/'));
    })
  );
});
