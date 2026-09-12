/* Apex PWA bootstrap — offline support, an offline-ready indicator,
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
  addTag('meta', { name: 'theme-color', content: '#ffffff' });
  addTag('link', { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' });
  addTag('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  addTag('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  addTag('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
  addTag('meta', { name: 'apple-mobile-web-app-title', content: 'Apex' });

  /* Phone layout: shared tweaks so every tab is comfortable on a small screen. */
  (function () {
    var st = document.createElement('style');
    st.textContent =
      '@media (max-width:700px){' +
      ' body{padding:12px 12px 24px!important}' +
      ' .goalbar{padding:8px 11px;gap:8px;margin-bottom:10px} .goalbar .gl{font-size:11px} .goalbar .gt{font-size:13px}' +
      ' .brand{font-size:14px;margin-bottom:8px}' +
      ' .nav{gap:5px;margin-bottom:12px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}' +
      ' .nav a{padding:7px 11px;font-size:12px;white-space:nowrap;flex-shrink:0}' +
      ' .sheet-inner{padding:0 12px} .sheet-head{padding:14px 0 10px} .sheet-title{font-size:22px}' +
      ' .tlist{flex:0 0 86vw;max-width:86vw}' +
      ' .planner .block{padding:12px}' +
      ' .np{height:auto;min-height:0} .side{height:260px}' +
      '}';
    document.head.appendChild(st);
  })();

  /* Cloud sync (Supabase) — sync-config.js holds the project keys; sync.js does the work. */
  (function () {
    var a = document.createElement('script'); a.src = 'sync-config.js';
    a.onload = function () { var b = document.createElement('script'); b.src = 'sync.js'; document.head.appendChild(b); };
    document.head.appendChild(a);
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  /* Prerender the tab you're about to click (Chrome Speculation Rules) so
     switching sections is instant. Falls back silently where unsupported. */
  try {
    if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
      var sr = document.createElement('script');
      sr.type = 'speculationrules';
      sr.textContent = JSON.stringify({
        prerender: [{ source: 'document', where: { href_matches: '/*.html' }, eagerness: 'moderate' }]
      });
      document.head.appendChild(sr);
    }
  } catch (e) {}

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

    /* ---- nav tabs: drag horizontally to reorder; order is remembered on every page ---- */
    var nav = document.querySelector('.nav');
    if (nav) {
      var NK = 'apexNavOrder';
      var links = function(){ return Array.prototype.slice.call(nav.querySelectorAll('a')); };
      var keyOf = function(a){ return (a.getAttribute('href')||'').replace(/^\.\//,''); };
      try {
        var order = JSON.parse(localStorage.getItem(NK) || 'null');
        if (Array.isArray(order) && order.length) {
          var have = links(); var byKey = {}; have.forEach(function(a){ byKey[keyOf(a)] = a; });
          var placed = {};
          order.forEach(function(k){ if (byKey[k]) { nav.appendChild(byKey[k]); placed[k] = 1; } });
          have.forEach(function(a){ if (!placed[keyOf(a)]) nav.appendChild(a); }); // new tabs go to the end
        }
      } catch (e) {}
      var saveOrder = function(){ try { localStorage.setItem(NK, JSON.stringify(links().map(keyOf))); } catch (e) {} };
      var dragging = null;
      links().forEach(function(a){
        a.draggable = true;
        a.title = 'Drag to reorder';
        a.addEventListener('dragstart', function(e){ dragging = a; a.style.opacity = '.4'; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', keyOf(a)); } catch (_) {} });
        a.addEventListener('dragend', function(){ a.style.opacity = ''; dragging = null; links().forEach(function(x){ x.style.boxShadow = ''; }); });
        a.addEventListener('dragover', function(e){
          if (!dragging || dragging === a) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          var r = a.getBoundingClientRect(); var before = e.clientX < r.left + r.width / 2;
          links().forEach(function(x){ x.style.boxShadow = ''; });
          a.style.boxShadow = before ? '-3px 0 0 0 #a9741f' : '3px 0 0 0 #a9741f';
        });
        a.addEventListener('drop', function(e){
          if (!dragging || dragging === a) return;
          e.preventDefault();
          var r = a.getBoundingClientRect(); var before = e.clientX < r.left + r.width / 2;
          if (before) nav.insertBefore(dragging, a); else nav.insertBefore(dragging, a.nextSibling);
          links().forEach(function(x){ x.style.boxShadow = ''; });
          saveOrder();
        });
      });
      nav.addEventListener('dragover', function(e){ if (dragging) e.preventDefault(); });
      nav.addEventListener('drop', function(e){ if (dragging && e.target === nav) { e.preventDefault(); nav.appendChild(dragging); saveOrder(); } });
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
