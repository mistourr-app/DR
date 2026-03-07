const CACHE_NAME = 'dungeon-crawler-v1';
// Список файлов, которые нужно закэшировать. 
// Обязательно добавьте сюда ваши иконки!
const FILES_TO_CACHE = [
  '.', // Используем относительный путь для стартовой страницы
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

// При установке Service Worker'а кэшируем файлы
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// При запросах к сети используем кэш
self.addEventListener('fetch', (evt) => {
  // Мы не кэшируем запросы к tailwindcss, чтобы не было проблем
  if (evt.request.url.includes('cdn.tailwindcss.com')) {
    return;
  }
  evt.respondWith(
    caches.match(evt.request).then((response) => {
      return response || fetch(evt.request);
    })
  );
});