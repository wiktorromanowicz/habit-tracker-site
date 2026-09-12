/* Wiktor-OS PWA bootstrap — injects manifest/meta and registers the service worker.
   Add <script defer src="pwa.js"></script> to each page's <head>. */
(function () {
  function addTag(tag, attrs) {
    if (attrs.rel && document.querySelector('link[rel="' + attrs.rel + '"]')) return;
    if (attrs.name && document.querySelector('meta[name="' + attrs.name + '"]')) return;
    var el = document.createElement(tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    document.head.appendChild(el);
  }
  addTag('link', { rel: 'manifest', href: 'manifest.json' });
  addTag('meta', { name: 'theme-color', content: '#a9741f' });
  addTag('link', { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' });
  addTag('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  addTag('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  addTag('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
  addTag('meta', { name: 'apple-mobile-web-app-title', content: 'Wiktor-OS' });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
