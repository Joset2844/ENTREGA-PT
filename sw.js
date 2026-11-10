/* Service Worker para Control de Entregas */
const VERSION = 'entregas-v3';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32x32.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION).then((cache) => {
      return Promise.all(
        SHELL.map((url) => {
          return fetch(url, { cache: 'reload' })
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) {
                return cache.put(url, res);
              }
            })
            .catch((err) => {
              console.warn('[SW] Shell cache miss:', url, err);
            });
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== VERSION)
          .map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip non-http/https schemes (e.g. chrome-extension:)
  if (!url.protocol.startsWith('http')) return;

  // Never cache Google Sheets, Apps Script, or live sync endpoints
  if (
    url.pathname === '/sw.js' ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('docs.google.com') ||
    url.hostname.includes('googleusercontent.com')
  ) {
    return;
  }

  // Same-origin navigation requests: Network first, fallback to cached index.html
  if (req.mode === 'navigate' || (url.origin === self.location.origin && (url.pathname === '/' || url.pathname.endsWith('.html')))) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          return caches.match(req).then((hit) => {
            return hit || caches.match('/') || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // Same-origin static assets: Cache first, update cache in background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const clone = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // CDN assets (fonts, SheetJS)
  if (
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              const clone = res.clone();
              caches.open(VERSION).then((cache) => cache.put(req, clone));
            }
            return res;
          })
          .catch(() => hit);
        return hit || fetchPromise;
      })
    );
  }
});
