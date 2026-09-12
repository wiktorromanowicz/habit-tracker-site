/* Wiktor-OS PWA bootstrap — offline support, an offline-ready indicator,
   and focus-bar hardening (so the top goal is always editable, even on the
   spreadsheet pages). Add <script defer src="pwa.js"></script> to each page. */
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

  function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    /* ---- focus bar: keep it editable on every page ---- */
    var fb = document.getElementById('focusBar');
    if (fb) {
      // Stop the goal's own key/paste events from reaching page-level handlers
      // (the spreadsheet engine listens on document and would otherwise swallow them).
      ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'paste'].forEach(function (ev) {
        fb.addEventListener(ev, function (e) { e.stopPropagation(); });
      });
      // Click anywhere on the bar to start editing (label / padding included).
      var bar = fb.closest('.goalbar');
      if (bar) {
        bar.style.cursor = 'text';
        bar.addEventListener('mousedown', function (e) {
          if (e.target === fb || fb.contains(e.target)) return;
          e.preventDefault();
          fb.focus();
          try {
            var r = document.createRange(); r.selectNodeContents(fb); r.collapse(false);
            var s = getSelection(); s.removeAllRanges(); s.addRange(r);
          } catch (_) {}
        });
      }
    }

    /* ---- subtle "offline ready" indicator next to the brand ---- */
    var brand = document.querySelector('.brand');
    if (brand && !document.getElementById('offlineChip')) {
      var chip = document.createElement('span');
      chip.id = 'offlineChip';
      chip.style.cssText = 'display:inline-block;margin-left:9px;font-size:11px;font-weight:600;' +
        'padding:2px 9px;border-radius:20px;vertical-align:middle;letter-spacing:.02em;';
      function paint() {
        var on = ('serviceWorker' in navigator) && !!navigator.serviceWorker.controller;
        chip.textContent = on ? '✓ Offline ready' : '… caching';
        chip.style.background = on ? '#dff3e6' : '#eee7d8';
        chip.style.color = on ? '#12855a' : '#9c8f76';
        chip.title = on ? 'This app is saved on your device and works with no internet.' : 'Caching for offline use…';
      }
      paint();
      brand.appendChild(chip);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(paint).catch(function(){});
        navigator.serviceWorker.addEventListener('controllerchange', paint);
        setTimeout(paint, 1500);
      }
    }
  });
})();
