const CACHE_NAME = 'dungeon-crawler-v2';
// Список файлов, которые нужно закэшировать. 
// Обязательно добавьте сюда ваши иконки!
const RELATIVE_FILES_TO_CACHE = [
  '.', // Используем относительный путь для стартовой страницы
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'main.js',
  'state.js',
  'config.js',
  'ui.js',
  'registry.js',
  'run.js',
  'renderer.js',
  'animation.js'
];
// Преобразуем относительные пути в абсолютные URL, чтобы избежать проблем с сопоставлением
const FILES_TO_CACHE = RELATIVE_FILES_TO_CACHE.map(p => new URL(p, self.location).href);

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

  // Стратегия "Cache, then network"
  evt.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Сначала пытаемся получить ответ из кэша
      const cachedResponse = await cache.match(evt.request);
      
      // В фоне делаем запрос к сети
      const fetchedResponsePromise = fetch(evt.request).then((networkResponse) => {
        // Если запрос успешен, обновляем кэш
        if (networkResponse.ok) {
          cache.put(evt.request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => {
        // Если сеть недоступна, ничего страшного, у нас есть кэш
      });

      // Возвращаем ответ из кэша, если он есть,
      // или ждем ответа от сети, если в кэше ничего не нашлось.
      return cachedResponse || fetchedResponsePromise;
    })
  );
});