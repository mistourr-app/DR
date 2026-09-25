const CACHE_NAME = 'dungeon-crawler-v25';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './admin.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './styles.css',
  './main.js',
  './main.js?v=25',
  './state.js',
  './config.js',
  './ui.js',
  './registry.js',
  './run.js',
  './renderer.js',
  './animation.js',
  './combat.js',
  './enemyAI.js',
  './bossAI.js',
  './events.js',
  './utils.js',
  './tutorial.js',
  './assets/manifest.json',
  './assets/loader.js',
];

async function cacheGraphics(cache) {
  try {
    const response = await fetch('./assets/manifest.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const manifest = await response.json();
    const entries = Object.values(manifest.assets || {}).filter((entry) => entry && entry.enabled !== false && typeof entry.src === 'string');
    await Promise.allSettled(entries.map((entry) => cache.add(new URL(entry.src, self.location.href).href)));
  } catch {
    return;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(FILES_TO_CACHE);
        await cacheGraphics(cache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cachedResponse) => cachedResponse || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
