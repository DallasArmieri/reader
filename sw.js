const CACHE = 'reader-v4';
const ASSETS = [
  '/reader/',
  '/reader/index.html',
  '/reader/css/style.css',
  '/reader/js/storage.js',
  '/reader/js/voiceplus.js',
  '/reader/js/import.js',
  '/reader/js/app.js',
  '/reader/manifest.json',
  '/reader/icon-192.png',
  '/reader/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (
    e.request.url.includes('openai.com') ||
    e.request.url.includes('googleapis.com') ||
    e.request.url.includes('allorigins.win')
  ) return;

  // Network-first: always fetch fresh, fall back to cache when offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(cached => cached || caches.match('/reader/'))
    )
  );
});
