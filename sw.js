/* Wiktor-OS service worker — makes the app work offline / after reboot.
   Bump CACHE when files change so clients pick up the new version. */
const CACHE = 'wiktoros-v2';
const ASSETS = [
  './', './index.html', './finances.html', './metrics.html', './assets.html', './ideas.html',
  './grid.js', './grid.css', './pwa.js', './manifest.json',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // let cross-origin (fonts) hit the network

  // Page navigations: try network (fresh), fall back to cache (offline / reboot)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then(r => r || caches.match(url.pathname) || caches.match('./index.html'))
      )
    );
    return;
  }

  // Everything else (js/css/icons): serve cache instantly, refresh in the background
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
