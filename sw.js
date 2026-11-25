/**
 * UP · Service worker de demostración (FASE U6).
 * Sólo recursos del mismo origen. Nunca intercepta /api/* ni guarda datos personales.
 * Precarga el app shell mínimo; el resto de módulos se cachean al navegar.
 */
const CACHE = 'up-static-v6';

const CORE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './styles.css',
  './data/demo.js',
  './data/product-images.js',
  './assets/brand/up-logo.jpeg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/fonts/inter-latin.woff2',
  './assets/fonts/libre-caslon-text-400.woff2',
  './assets/fonts/libre-caslon-text-700.woff2',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
];

const PRECACHE = [...new Set(CORE.map((path) => new URL(path, self.registration.scope).href))];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Los precios dinámicos nunca se sirven desde caché ni se almacenan.
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./offline.html')) || Response.error();
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached || Response.error());
    })
  );
});
