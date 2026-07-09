// Service Worker deactivation and cache-clearing script
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          console.log('Deleting cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      console.log('Registration unregistering...');
      return self.registration.unregister();
    }).then(() => {
      return self.clients.matchAll();
    }).then((clients) => {
      clients.forEach(client => {
        if (client.navigate) {
          client.navigate(client.url);
        }
      });
    })
  );
});

// Immediately return fetch requests directly from the network
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
