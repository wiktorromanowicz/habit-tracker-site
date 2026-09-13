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
    // When an update has been installed, reload once so the page runs the new code right away
    // (cache-first otherwise serves the previous version until the next visit).
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
      hadController = true;
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
        if (!a.title) a.title = 'Drag to reorder';
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

/* ---- Timer keeps running on every Apex page ----------------------------------------------
   The Timer tab stores its state in localStorage ("apexTimer"). When you switch to another tab
   (Tasks, Notes…) the timer page unloads, so this watcher — loaded on every page — takes over:
   it shows a live countdown chip, rings the chosen sound when time is up, and fires the
   desktop notification with its Stop button. Stopping anywhere stops everywhere (storage event). */
(function () {
  if (/timer\.html$/.test(location.pathname)) return;           // the Timer page handles itself
  var KEY = 'apexTimer', chip = null, audio = null, ctx = null, beepTimer = null, primed = false;
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(T) { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) {} }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(s); }
  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement('a'); chip.id = 'apexTimerChip'; chip.href = 'timer.html';
    chip.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:94;display:none;align-items:center;gap:8px;background:#fff;color:#2b2a26;border:1px solid #e7e2d6;border-radius:999px;padding:8px 12px 8px 14px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-decoration:none;box-shadow:0 4px 18px rgba(20,22,35,.12);font-variant-numeric:tabular-nums;';
    var t = document.createElement('span'); t.className = 'tt';
    var b = document.createElement('button'); b.textContent = 'Stop'; b.style.cssText = 'display:none;border:0;background:#c1362c;color:#fff;border-radius:999px;padding:4px 10px;font:600 12px inherit;cursor:pointer;font-family:inherit;';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); stopAll(); });
    chip.appendChild(t); chip.appendChild(b); document.body.appendChild(chip); return chip;
  }
  function beep() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      var t0 = ctx.currentTime + .02;
      for (var i = 0; i < 4; i++) { [880, 1320].forEach(function (f) { var o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0, t0 + i * .19); g.gain.linearRampToValueAtTime(.4, t0 + i * .19 + .01); g.gain.linearRampToValueAtTime(0, t0 + i * .19 + .12); o.connect(g); g.connect(ctx.destination); o.start(t0 + i * .19); o.stop(t0 + i * .19 + .14); }); }
    } catch (e) {}
  }
  function ring(T) {
    var name = { classic: 'alarm-classic.wav', chime: 'alarm-chime.wav', marimba: 'alarm-marimba.wav' }[T.sound] || 'alarm-classic.wav';
    if (!audio || audio.getAttribute('data-src') !== name) { silence(); audio = new Audio(name); audio.loop = true; audio.setAttribute('data-src', name); }
    var p = audio.play();
    if (p && p.catch) p.catch(function () { beep(); beepTimer = setInterval(beep, 1400); });   // autoplay blocked → WebAudio beeps
    try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
  }
  function silence() { if (beepTimer) { clearInterval(beepTimer); beepTimer = null; } if (audio) { try { audio.pause(); audio.currentTime = 0; } catch (e) {} } }
  function notify(T) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: 'Timer finished — click to stop', tag: 'apex-timer', requireInteraction: true, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: location.href }, actions: [{ action: 'stop', title: 'Stop' }] };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(function (r) { r.showNotification('⏰ Time’s up', opts); }).catch(function () {});
    else try { var n = new Notification('⏰ Time’s up', { body: opts.body, tag: opts.tag, requireInteraction: true, icon: opts.icon }); n.onclick = function () { stopAll(); n.close(); }; } catch (e) {}
  }
  function closeNotification() { try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.getNotifications({ tag: 'apex-timer' }); }).then(function (ns) { ns.forEach(function (n) { n.close(); }); }); } catch (e) {} }
  var rang = false;
  window.apexTimerStop = function () { stopAll(); };
  function stopAll() { var T = read(); T.state = 'idle'; delete T.endAt; delete T.remaining; delete T.rang; T.stoppedAt = Date.now(); write(T); silence(); closeNotification(); rang = false; tick(); }
  function tick() {
    var T = read(), c = ensureChip(), tt = c.querySelector('.tt'), btn = c.querySelector('button');
    if (T.state === 'running' && T.endAt && Date.now() >= T.endAt) { T.state = 'done'; write(T); }
    if (T.state === 'running') {
      c.style.display = 'flex'; btn.style.display = 'none'; c.style.background = '#fff'; c.style.color = '#2b2a26';
      tt.textContent = '⏱ ' + fmt((T.endAt - Date.now()) / 1000);
    } else if (T.state === 'paused') {
      c.style.display = 'flex'; btn.style.display = 'none'; c.style.background = '#fff'; tt.textContent = '⏸ ' + fmt(T.remaining || 0);
    } else if (T.state === 'done') {
      // A finished timer that nobody stopped for 10+ minutes is stale — clear it quietly instead of ringing on every page load.
      if (T.endAt && Date.now() - T.endAt > 10 * 60000) { T.state = 'idle'; delete T.endAt; delete T.rang; write(T); c.style.display = 'none'; return; }
      c.style.display = 'flex'; btn.style.display = 'inline-block'; c.style.background = '#fbe9e7'; c.style.color = '#9b2b22'; tt.textContent = '⏰ Time’s up';
      // Ring only once per finished timer (T.rang is shared through localStorage), and only if it just finished.
      if (!rang) { rang = true; if (!T.rang && T.endAt && Date.now() - T.endAt < 2 * 60000) { T.rang = true; write(T); ring(T); notify(T); } }
    } else { c.style.display = 'none'; if (rang) { rang = false; silence(); } }
  }
  var endTO = null;
  function schedule() { clearTimeout(endTO); var T = read(); if (T.state === 'running') endTO = setTimeout(tick, Math.max(0, T.endAt - Date.now()) + 30); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) { var T = read(); if (T.state !== 'done') { silence(); rang = false; } tick(); schedule(); } });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'timer-stop') stopAll(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  function boot() { tick(); setInterval(tick, 500); schedule(); }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();

/* ---- Mirror the timer into the macOS menu bar --------------------------------------------
   If the "Apex Timer" helper app is running on this Mac (see the apex-menubar folder), every
   Apex tab posts the timer state to it on 127.0.0.1 so the countdown shows next to the clock.
   When the helper isn't running the request simply fails and we back off. Loopback only. */
(function () {
  var URL_ = 'http://127.0.0.1:47831/state', KEY = 'apexTimer', delay = 1000, last = '';
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function post() {
    var T = read(), payload = JSON.stringify({ state: T.state || 'idle', endAt: T.endAt || 0, remaining: T.remaining || 0, stoppedAt: T.stoppedAt || 0 });
    if (T.state !== 'running' && payload === last) { delay = 3000; return setTimeout(post, delay); }   // nothing changed while idle
    fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, mode: 'cors', keepalive: true })
      .then(function (r) { return r.json(); })
      .then(function (j) { last = payload; delay = 1000; if (j && j.stop && window.apexTimerStop) window.apexTimerStop(); })
      .catch(function () { delay = Math.min(30000, delay * 2); })
      .then(function () { setTimeout(post, delay); });
  }
  if (location.protocol === 'https:' || location.hostname === 'localhost') post();
})();

/* ---- Drag the window by its header --------------------------------------------------------
   Inside Apex.app (and Chrome app windows that honour app-region) the goal bar, the brand line
   and the empty space between nav tabs act as a title bar: press and drag there to move the
   window. Text fields, tabs and buttons keep working normally. */
(function () {
  var css = '.goalbar,.brand,.nav{-webkit-app-region:drag;app-region:drag}' +
            '.goalbar #focusBar,.goalbar [contenteditable],.nav a,.nav button,.brand a,.brand button,.brand span{-webkit-app-region:no-drag;app-region:no-drag}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apexDrag;
  if (!native) return;
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var t = e.target;
    if (t.closest('a,button,input,textarea,select,[contenteditable],#apexTimerChip')) return;
    if (!t.closest('.goalbar,.brand,.nav')) return;
    e.preventDefault();
    try { native.postMessage('drag'); } catch (err) {}
  }, true);
})();
