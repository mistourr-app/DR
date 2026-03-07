const CACHE_NAME = 'dungeon-crawler-v2';
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
      // Используем addAll, так как все основные файлы должны быть закэшированы для оффлайн-работы.
      // Если какой-то файл не найден, установка Service Worker'а прервется,
      // что явно укажет на проблему (например, опечатку в имени файла).
      return cache.addAll(FILES_TO_CACHE).catch(err => {
        console.error('Failed to cache initial assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// При активации Service Worker'а удаляем старые кэши
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
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