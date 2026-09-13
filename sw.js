/* Apex service worker — instant, offline-first loading.
   Cache-first for everything (served from disk in ~1ms), revalidated in the
   background. Bump CACHE when files change so clients pick up the new version. */
const CACHE = 'wiktoros-v35';
const ASSETS = [
  './', './index.html', './today.html', './time.html', './shell.js', './shell.css', './timecats.js', './tasks.html', './calendar.html', './cal-config.js', './notes.html', './timer.html', './lift.html', './finances.html', './metrics.html', './assets.html', './ideas.html',
  './grid.js', './grid.css', './pwa.js', './sync-config.js', './sync.js', './import.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/xlsx.full.min.js', './manifest.json', './alarm-classic.wav', './alarm-chime.wav', './alarm-marimba.wav',
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
  if (url.origin !== location.origin) return; // let cross-origin hit the network

  // Page navigations: serve the cached page INSTANTLY, refresh cache in the background.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cached => {
        const net = fetch(req).then(res => {
          if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copy)); }
          return res;
        }).catch(() => cached);
        return cached || net || caches.match('./index.html');
      })
    );
    return;
  }

  // Assets (js/css/icons): cache-first, refresh in the background.
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

/* Timer notification: clicking it (or its Stop button) stops the alarm in the open Apex tab, or opens the timer. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    list.forEach(c => c.postMessage({ type: 'timer-stop' }));
    const timerTab = list.find(c => /timer\.html/.test(c.url)) || list[0];
    if (timerTab && 'focus' in timerTab) return timerTab.focus();
    return self.clients.openWindow('./timer.html');
  }));
});
