const CACHE_NAME = 'ai-sales-bot-v3-live';

// On install, activate immediately
self.addEventListener('install', event => {
  self.skipWaiting();
});

// On activate, delete all previous stale caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy: Always fetch fresh code from server first!
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
