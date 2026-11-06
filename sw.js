// Service worker: permite abrir la app sin conexión una vez instalada.
// Al cambiar cualquier archivo, sube la versión para que el iPhone descargue la nueva.
const CACHE = 'racemeter-v11';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './css/styles.css',
  './js/app.js', './js/util.js', './js/storage.js', './js/fusion.js', './js/speed.js', './js/timing.js',
  './js/stats.js', './js/recorder.js', './js/demo.js', './js/draw.js', './js/ui.js', './js/format.js', './js/platform.js',
];

self.addEventListener('install', (e) => {
  // 'reload': baja los archivos del servidor, no de la caché del navegador (GitHub Pages la deja 10 min)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Red primero (para recibir actualizaciones); si no hay conexión, usa la caché.
// 'no-cache' pregunta siempre al servidor si hay versión nueva en vez de fiarse de la caché del navegador.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache' })
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
