/**
 * SparFuchs Service Worker (PWA Offline Cache)
 * Stellt sicher, dass Einkaufszettel, Supermarkt-Modus und App-Shell auch
 * im Funkloch des Supermarkts (Kühlregal, Keller, Stahlbetonbau) blitzschnell funktionieren.
 */

const CACHE_NAME = 'sparfuchs-v1.0';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/favicon.svg',
  '/manifest.json',
];

// 1. Installation: App-Shell in den Cache laden
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. Aktivierung: Veraltete Caches bereinigen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Cache-First für statische Assets, Network-First für API
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API-Anfragen: Network-First (mit sauberer Fehlerbehandlung im Offline-Fall)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ 
            error: 'Offline', 
            message: 'Du bist aktuell offline. Dein Einkaufszettel bleibt im Browser gespeichert.' 
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // App-Shell & Statische Dateien: Cache-First mit Network-Fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Im Hintergrund frische Version laden (Stale-While-Revalidate)
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        }).catch(() => {
          // Ignorieren im Funkloch
        });
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Fallback auf die Hauptseite bei Navigation
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
