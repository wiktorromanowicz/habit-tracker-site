/* Apex shell — sidebar, command palette (⌘K), shortcuts (?), dark mode, sidebar timer.
   Runs on every page after pwa.js. It reads the page's own .nav links, so pages stay the source of truth. */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var ls = { get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
             set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  var html = document.documentElement;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  var MOD = isMac ? '⌘' : 'Ctrl';

  /* ---- theme & sidebar state (applied ASAP to avoid flashes) ---- */
  var theme = ls.get('apexTheme', 'light'); if (theme === 'dark') html.setAttribute('data-theme', 'dark');
  if (ls.get('apexSideMin', false)) html.setAttribute('data-sb', 'min');
  function setTheme(t) { theme = t; ls.set('apexTheme', t); if (t === 'dark') html.setAttribute('data-theme', 'dark'); else html.removeAttribute('data-theme'); paintFoot(); }
  function toggleTheme() { setTheme(theme === 'dark' ? 'light' : 'dark'); }
  function toggleSide() { var min = html.getAttribute('data-sb') === 'min'; if (min) html.removeAttribute('data-sb'); else html.setAttribute('data-sb', 'min'); ls.set('apexSideMin', !min); }

  /* ---- nav model from the page ---- */
  var here = (location.pathname.split('/').pop() || 'index.html');
  function splitLabel(txt) { var m = txt.trim().match(/^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u); return m ? { em: m[1], lb: m[2] } : { em: '•', lb: txt.trim() }; }
  function pageLinks() {
    var nav = $('.nav'); if (!nav) return [];
    return Array.prototype.map.call(nav.querySelectorAll('a'), function (a) {
      var href = (a.getAttribute('href') || '').replace(/^\.\//, ''); var s = splitLabel(a.textContent || a.title || href);
      return { href: href, em: s.em, lb: s.lb, active: href === here || a.classList.contains('active') };
    });
  }
  var links = pageLinks();
  (function () { var order = ls.get('apexNavOrder', null); if (!Array.isArray(order)) return; var by = {}; links.forEach(function (l) { by[l.href] = l; }); var out = []; order.forEach(function (h) { if (by[h]) { out.push(by[h]); delete by[h]; } }); links.forEach(function (l) { if (by[l.href]) out.push(l); }); links = out; })();
  // Today is the home screen: it always sits first
  (function () { var i = links.findIndex(function (l) { return l.href === 'today.html'; }); if (i > 0) links.unshift(links.splice(i, 1)[0]); })();

  /* ---- sidebar ---- */
  var side, navEl, foot, tw;
  function buildSide() {
    if (!links.length) return;
    side = document.createElement('aside'); side.id = 'apexSide';
    side.innerHTML =
      '<div class="sb-top"><div class="sb-brand">⚡ Apex</div><button class="sb-min" title="Collapse sidebar (`)">⟨</button></div>' +
      '<nav></nav>' +
      '<div class="sb-foot">' +
        '<div class="tw" id="apexTw"></div>' +
        '<div class="sb-chips" id="apexChips"></div>' +
        '<div class="sb-row"><button class="sb-btn" id="apexPalBtn" title="Command palette"><span>Search</span><kbd>' + MOD + 'K</kbd></button>' +
        '<button class="sb-btn" id="apexThemeBtn" title="Dark / light"><span id="apexThemeLbl"></span></button>' +
        '<button class="sb-btn" id="apexKeysBtn" title="Keyboard shortcuts"><kbd>?</kbd></button></div>' +
      '</div>';
    document.body.appendChild(side);
    navEl = $('nav', side); foot = $('.sb-foot', side); tw = $('#apexTw', side);
    renderNav();
    $('.sb-min', side).addEventListener('click', toggleSide);
    $('#apexPalBtn', side).addEventListener('click', openPalette);
    $('#apexThemeBtn', side).addEventListener('click', toggleTheme);
    $('#apexKeysBtn', side).addEventListener('click', openKeys);
    paintFoot();
    // phone: the sidebar footer is hidden, so sync chips / theme / search get a slim bar above the page
    var phone = document.createElement('div'); phone.id = 'apexPhoneBar';
    phone.innerHTML = '<div class="pb-chips" id="apexPhoneChips"></div><button class="sb-btn" id="apexPhonePal">Search</button><button class="sb-btn" id="apexPhoneTheme">' + (theme === 'dark' ? '☀︎' : '☾') + '</button>';
    document.body.insertBefore(phone, document.body.firstChild);
    $('#apexPhonePal', phone).addEventListener('click', openPalette);
    $('#apexPhoneTheme', phone).addEventListener('click', function () { toggleTheme(); this.textContent = theme === 'dark' ? '☀︎' : '☾'; });
    // chips that other scripts mount into the (hidden) .brand move down here (and into the phone bar)
    var brand = $('.brand');
    if (brand) {
      var isPhone = function () { return window.matchMedia('(max-width:700px)').matches; };
      var move = function () { Array.prototype.slice.call(brand.querySelectorAll('span')).forEach(function (s) { (isPhone() ? $('#apexPhoneChips', phone) : $('#apexChips', side)).appendChild(s); }); };
      move(); new MutationObserver(move).observe(brand, { childList: true });
    }
  }
  function renderNav() {
    navEl.innerHTML = '';
    links.forEach(function (l, i) {
      var a = document.createElement('a'); a.href = l.href; a.className = l.active ? 'active' : ''; a.draggable = true; a.dataset.href = l.href;
      a.innerHTML = '<span class="em">' + l.em + '</span><span class="lb">' + l.lb + '</span>' + (i < 9 ? '<span class="kb">' + MOD + (i + 1) + '</span>' : '');
      a.title = l.lb; navEl.appendChild(a);
    });
    wireReorder();
  }
  function paintFoot() { var l = $('#apexThemeLbl', side); if (l) l.textContent = theme === 'dark' ? '☀︎ Light' : '☾ Dark'; }

  // vertical drag-to-reorder, saved in the same key the old tab row used
  function wireReorder() {
    var dragging = null;
    var all = function () { return Array.prototype.slice.call(navEl.querySelectorAll('a')); };
    var clear = function () { all().forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); }); };
    all().forEach(function (a) {
      a.addEventListener('dragstart', function (e) { dragging = a; a.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', a.dataset.href); } catch (_) {} });
      a.addEventListener('dragend', function () { a.classList.remove('dragging'); dragging = null; clear(); });
      a.addEventListener('dragover', function (e) { if (!dragging || dragging === a) return; e.preventDefault(); var r = a.getBoundingClientRect(); clear(); a.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after'); });
      a.addEventListener('drop', function (e) { if (!dragging || dragging === a) return; e.preventDefault(); var r = a.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) navEl.insertBefore(dragging, a); else navEl.insertBefore(dragging, a.nextSibling); clear();
        ls.set('apexNavOrder', all().map(function (x) { return x.dataset.href; })); links = all().map(function (x) { return links.filter(function (l) { return l.href === x.dataset.href; })[0]; }); renderNav(); });
    });
  }

  /* ---- sidebar timer widget (shares apexTimer with the Timer tab and the watcher in pwa.js) ---- */
  var TK = 'apexTimer';
  function rt() { return ls.get(TK, {}) || {}; }
  function wt(T) { ls.set(TK, T); try { window.dispatchEvent(new Event('apex-timer-change')); } catch (e) {} }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(s) { s = Math.max(0, Math.round(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(x); }
  function startTimer(min) { var T = rt(); T.duration = min * 60; T.endAt = Date.now() + min * 60000; T.state = 'running'; delete T.rang; delete T.remaining; wt(T); if (window.apexTimerRefresh) window.apexTimerRefresh(); paintTw(); }
  function pauseTimer() { var T = rt(); if (T.state === 'running') { T.remaining = Math.max(0, (T.endAt - Date.now()) / 1000); T.state = 'paused'; } else if (T.state === 'paused') { T.endAt = Date.now() + (T.remaining || 0) * 1000; T.state = 'running'; } wt(T); paintTw(); }
  function stopTimer() { if (window.apexTimerStop) window.apexTimerStop(); else { var T = rt(); T.state = 'idle'; delete T.endAt; delete T.rang; T.stoppedAt = Date.now(); wt(T); } paintTw(); }
  var lastTw = '';
  function paintTw() {
    if (!tw) return;
    var T = rt(), h;
    if (T.state === 'running') h = '<div class="tw-time">⏱ ' + fmt((T.endAt - Date.now()) / 1000) + '</div><div class="tw-row"><button data-a="pause">Pause</button><button data-a="stop">Stop</button></div>';
    else if (T.state === 'paused') h = '<div class="tw-time">⏸ ' + fmt(T.remaining || 0) + '</div><div class="tw-row"><button data-a="pause">Resume</button><button data-a="stop">Stop</button></div>';
    else if (T.state === 'done') h = '<div class="tw-time">⏰ Time’s up</div><div class="tw-row"><button class="stop" data-a="stop">Stop</button></div>';
    else h = '<div class="tw-lbl">Timer</div><div class="tw-row">' + [25, 5, 45, 15].map(function (m) { return '<button data-m="' + m + '" title="Start ' + m + ' min">' + m + '</button>'; }).join('') + '</div>';
    if (h !== lastTw) { tw.innerHTML = h; lastTw = h; tw.classList.toggle('done', T.state === 'done'); }
  }
  window.addEventListener('apex-timer-change', paintTw);
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#apexTw button'); if (!b) return;
    if (b.dataset.m) startTimer(+b.dataset.m); else if (b.dataset.a === 'pause') pauseTimer(); else if (b.dataset.a === 'stop') stopTimer();
  });
  setInterval(paintTw, 500);
  window.addEventListener('storage', function (e) { if (e.key === TK) paintTw(); });

  /* ---- command palette ---- */
  var ov = null;
  function closeOv() { if (ov) { ov.remove(); ov = null; } }
  function actions(q) {
    var out = [];
    links.forEach(function (l) { out.push({ g: 'Go to', em: l.em, t: l.lb, sub: 'tab', run: function () { location.href = l.href; } }); });
    out.push({ g: 'Actions', em: '➕', t: 'New task', sub: 'Tasks', run: function () { location.href = 'tasks.html?new=1'; } });
    out.push({ g: 'Actions', em: '📝', t: 'New note', sub: 'Notes', run: function () { location.href = 'notes.html?new=1'; } });
    out.push({ g: 'Actions', em: '📅', t: 'New event', sub: 'Calendar', run: function () { location.href = 'calendar.html?new=1'; } });
    [25, 5, 45, 15].forEach(function (m) { out.push({ g: 'Actions', em: '⏱', t: 'Start ' + m + '-minute timer', sub: 'Timer', run: function () { startTimer(m); } }); });
    out.push({ g: 'Actions', em: theme === 'dark' ? '☀︎' : '☾', t: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', run: toggleTheme });
    out.push({ g: 'Actions', em: '⌨', t: 'Keyboard shortcuts', sub: '?', run: openKeys });
    // notes & tasks search
    var qq = q.trim().toLowerCase();
    if (qq.length >= 2) {
      var notes = ls.get('wiktorNotes', {}); var narr = (notes && notes.notes) || [];
      narr.forEach(function (n) { var title = (n.title || '').trim() || 'Untitled'; var body = (n.body || '').replace(/<[^>]+>/g, ' '); if ((title + ' ' + body).toLowerCase().indexOf(qq) >= 0) out.push({ g: 'Notes', em: '📝', t: title, sub: 'open note', run: function () { location.href = 'notes.html?open=' + encodeURIComponent(n.id); } }); });
      var tasks = ls.get('apexTasks', {}); ((tasks && tasks.taskLists) || []).forEach(function (l) { (l.items || []).forEach(function (it) { if (!it.done && (it.text || '').toLowerCase().indexOf(qq) >= 0) out.push({ g: 'Tasks', em: '✅', t: it.text, sub: l.name, run: function () { location.href = 'tasks.html?focus=' + encodeURIComponent(it.id); } }); }); });
    }
    return out;
  }
  function score(item, q) { if (!q) return 1; var t = (item.t + ' ' + (item.sub || '')).toLowerCase(); if (t.indexOf(q) === 0) return 3; if (t.indexOf(q) >= 0) return 2; // subsequence
    var i = 0; for (var c = 0; c < t.length && i < q.length; c++) if (t[c] === q[i]) i++; return i === q.length ? 1 : 0; }
  function openPalette() {
    closeOv(); ov = document.createElement('div'); ov.className = 'apx-ov';
    ov.innerHTML = '<div class="apx-pal"><input placeholder="Jump to a tab, start a timer, search notes & tasks…" spellcheck="false"><ul></ul></div>';
    document.body.appendChild(ov);
    var inp = $('input', ov), list = $('ul', ov), items = [], idx = 0;
    function paint() {
      var q = inp.value.trim().toLowerCase();
      items = actions(q).map(function (it) { return { it: it, s: score(it, q) }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.it; }).slice(0, 40);
      idx = 0; var h = '', g = '';
      items.forEach(function (it, i) { if (it.g !== g) { g = it.g; h += '<div class="grp">' + g + '</div>'; } h += '<li data-i="' + i + '" class="' + (i === 0 ? 'on' : '') + '"><span class="em">' + it.em + '</span><span>' + esc(it.t) + '</span>' + (it.sub ? '<span class="sub">' + esc(it.sub) + '</span>' : '') + '</li>'; });
      list.innerHTML = h || '<div class="empty">Nothing matches</div>';
    }
    function mark() { var lis = list.querySelectorAll('li'); lis.forEach(function (li, i) { li.classList.toggle('on', i === idx); }); var on = lis[idx]; if (on) on.scrollIntoView({ block: 'nearest' }); }
    function go() { var it = items[idx]; if (it) { closeOv(); it.run(); } }
    inp.addEventListener('input', paint);
    inp.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); mark(); } else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); mark(); } else if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') closeOv(); });
    list.addEventListener('click', function (e) { var li = e.target.closest('li'); if (li) { idx = +li.dataset.i; go(); } });
    list.addEventListener('mousemove', function (e) { var li = e.target.closest('li'); if (li && +li.dataset.i !== idx) { idx = +li.dataset.i; mark(); } });
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeOv(); });
    paint(); inp.focus();
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---- shortcuts overlay ---- */
  var PAGE_KEYS = {
    'notes.html': [['New note', MOD + 'N'], ['Delete line', MOD + '⌫'], ['Delete note', MOD + '⇧⌫'], ['Toggle note list', MOD + '\\'], ['Shortcuts panel', MOD + '/']],
    'tasks.html': [['Add task', 'Enter'], ['Indent / outdent', 'Tab / ⇧Tab'], ['Description', '⇧Enter'], ['Date, repeat, more', 'Right-click']],
    'calendar.html': [['Today', 'T'], ['Previous / next', '← →'], ['Day · Week · Month · Agenda', 'D W M A'], ['New event', 'N']],
    'time.html': [['Next slot / next day', 'Enter / Tab'], ['Category', MOD + '1–8'], ['Clear slot', MOD + '⌫'], ['Previous / next week', '← →'], ['This week', 'T']],
    'timer.html': [['Start / pause', 'Space'], ['Presets', '1–4']],
    'metrics.html': [['Select columns', '⇧-click / drag headers'], ['Hide selected', 'H']],
  };
  function openKeys() {
    closeOv(); ov = document.createElement('div'); ov.className = 'apx-ov';
    var glob = [['Command palette', MOD + 'K'], ['Jump to tab 1–9', MOD + '1–9'], ['Previous / next tab', '[ ]'], ['Collapse sidebar', '`'], ['Dark / light', MOD + '⇧L'], ['This overlay', '?'], ['Close', 'Esc']];
    var page = (window.apexShortcuts || PAGE_KEYS[here] || []);
    var row = function (k) { return '<div class="k"><span>' + esc(k[0]) + '</span><span>' + k[1].split(' ').map(function (x) { return '<kbd>' + esc(x) + '</kbd>'; }).join('') + '</span></div>'; };
    ov.innerHTML = '<div class="apx-keys"><h2>Keyboard shortcuts</h2><div class="cols"><div><h4>Everywhere</h4>' + glob.map(row).join('') + '</div><div><h4>This page</h4>' + (page.length ? page.map(row).join('') : '<div class="k" style="color:var(--muted)">Mouse only here</div>') + '</div></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeOv(); });
  }

  /* ---- global keys ---- */
  document.addEventListener('keydown', function (e) {
    var mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopPropagation(); if (ov && $('.apx-pal', ov)) closeOv(); else openPalette(); return; }
    if (e.key === 'Escape' && ov) { e.stopPropagation(); closeOv(); return; }
    if (ov) return;   // palette / overlay open: page shortcuts stay quiet
    var editing = e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
    if (mod && e.shiftKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); e.stopPropagation(); toggleTheme(); return; }
    if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && !editing) { var l = links[+e.key - 1]; if (l) { e.preventDefault(); location.href = l.href; } return; }
    if (editing || mod || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); e.stopPropagation(); openKeys(); }
    else if (e.key === '`') { e.preventDefault(); e.stopPropagation(); toggleSide(); }
    else if (e.key === '[' || e.key === ']') { var i = links.findIndex(function (l) { return l.active; }); if (i < 0) return; var n = (i + (e.key === ']' ? 1 : -1) + links.length) % links.length; location.href = links[n].href; }
  }, true);

  if (document.body) buildSide(); else document.addEventListener('DOMContentLoaded', buildSide);
  paintTw();
})();
