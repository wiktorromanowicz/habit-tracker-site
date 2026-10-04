/* Planner — bottlenecks, monthly and yearly goals -----------------------------
   These three boxes used to live at the bottom of the Habits page, where they
   were only seen when you went looking for habits. They belong on the page you
   open first, so this file is the planner lifted out of index.html and made
   page-agnostic: give a page the right element ids and it wires itself up.

   Storage is the same as before — titan_habits_v1.bottlenecks / .goals["YYYY-MM"]
   / .goalsYear[YYYY] — so nothing you had written moves or needs migrating.

   Every write re-reads the key first and touches only its own fields, because
   the Habits card on the same page writes habit ticks into the same object and
   a cached copy would quietly undo them. */
(function () {
  var KEY = 'titan_habits_v1';
  var yearEd = document.getElementById('yearEditor');
  var goalEd = document.getElementById('goalEditor');
  var bottleEd = document.getElementById('bottleEditor');
  if (!yearEd && !goalEd && !bottleEd) return;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
  function write(mut) {
    var S = read(); mut(S);
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  var curYear = new Date().getFullYear();
  var curMonth = new Date(); curMonth.setDate(1); curMonth.setHours(0, 0, 0, 0);

  function renderYear() {
    var lab = document.getElementById('yearLabel');
    if (lab) lab.textContent = 'Yearly goals · ' + curYear;
    if (yearEd) yearEd.innerHTML = (read().goalsYear || {})[curYear] || '';
  }
  function saveYear() { if (!yearEd) return; var h = yearEd.innerHTML; write(function (S) { S.goalsYear = S.goalsYear || {}; S.goalsYear[curYear] = h; }); }
  function renderGoals() {
    var lab = document.getElementById('monthLabel');
    if (lab) lab.textContent = 'Monthly goals · ' + curMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (goalEd) goalEd.innerHTML = (read().goals || {})[monthKey(curMonth)] || '';
  }
  function saveGoals() { if (!goalEd) return; var h = goalEd.innerHTML, k = monthKey(curMonth); write(function (S) { S.goals = S.goals || {}; S.goals[k] = h; }); }
  function renderBottle() { if (bottleEd) bottleEd.innerHTML = read().bottlenecks || ''; }
  function saveBottle() { if (!bottleEd) return; var h = bottleEd.innerHTML; write(function (S) { S.bottlenecks = h; }); }

  window.shiftYear = function (n) { saveYear(); curYear += n; renderYear(); };
  window.shiftMonth = function (n) { saveGoals(); curMonth.setMonth(curMonth.getMonth() + n); renderGoals(); };
  window.thisMonth = function () { saveGoals(); curMonth = new Date(); curMonth.setDate(1); curMonth.setHours(0, 0, 0, 0); renderGoals(); };

  var editorSaves = new Map();
  if (yearEd) editorSaves.set(yearEd, saveYear);
  if (goalEd) editorSaves.set(goalEd, saveGoals);
  if (bottleEd) editorSaves.set(bottleEd, saveBottle);

  var activeEditor = goalEd || bottleEd || yearEd;
  function saveActive() { var f = editorSaves.get(activeEditor); if (f) f(); }
  editorSaves.forEach(function (saveFn, el) {
    el.addEventListener('focus', function () { activeEditor = el; });
    var t; el.addEventListener('input', function () { clearTimeout(t); t = setTimeout(saveFn, 300); });
    el.addEventListener('blur', saveFn);
  });

  /* each box remembers the height you dragged it to */
  (function persistResize() {
    var sizes = read().editorSizes || {};
    editorSaves.forEach(function (_, el) { if (sizes[el.id]) el.style.height = sizes[el.id] + 'px'; });
    function saveSizes() {
      var changed = false, next = {};
      editorSaves.forEach(function (_, el) {
        if (el.style.height) { var h = parseInt(el.style.height, 10); if (h) { next[el.id] = h; if (sizes[el.id] !== h) changed = true; } }
      });
      if (!changed) return;
      sizes = Object.assign(sizes, next);
      write(function (S) { S.editorSizes = Object.assign(S.editorSizes || {}, next); });
    }
    editorSaves.forEach(function (_, el) {
      el.addEventListener('mouseup', function () { setTimeout(saveSizes, 50); });
      el.addEventListener('pointerup', function () { setTimeout(saveSizes, 50); });
    });
    window.addEventListener('mouseup', function () { setTimeout(saveSizes, 50); });
    if (window.ResizeObserver) {
      var t2; var ro = new ResizeObserver(function () { clearTimeout(t2); t2 = setTimeout(saveSizes, 300); });
      editorSaves.forEach(function (_, el) { ro.observe(el); });
    }
  })();

  /* ---- formatting ---- */
  function ensureActive() { if (!activeEditor || !editorSaves.has(activeEditor)) activeEditor = editorSaves.keys().next().value; }
  /* With the toolbar always on screen you reach for it with the caret sitting in
     a line, not with text selected — and execCommand on a collapsed caret only
     arms the style for whatever you type next, which looks exactly like a dead
     button. If nothing is selected, act on the line the caret is in. */
  function lineOf(node, root) {
    while (node && node !== root) {
      if (node.nodeType === 1 && node.parentNode === root) return node;
      node = node.parentNode;
    }
    return null;
  }
  function withLine(run) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) { run(); return; }
    var r = sel.getRangeAt(0);
    if (!r.collapsed) { run(); return; }
    var line = lineOf(r.startContainer, activeEditor);
    if (!line || !(line.textContent || '').trim()) { run(); return; }
    var keep = r.cloneRange();
    var whole = document.createRange(); whole.selectNodeContents(line);
    sel.removeAllRanges(); sel.addRange(whole);
    run();
    try { sel.removeAllRanges(); sel.addRange(keep); } catch (e) {}
  }
  window.fmt = function (ev, cmd, val) {
    ev.preventDefault(); ensureActive(); activeEditor.focus();
    withLine(function () { document.execCommand(cmd, false, val || null); });
    saveActive();
  };
  function applyColor(c) { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, c); }
  window.fmtColor = function (ev, c) {
    ev.preventDefault(); ensureActive(); activeEditor.focus();
    withLine(function () {
      if (!c) document.execCommand('removeFormat', false, null);
      else applyColor(c);
    });
    saveActive();
  };
  var savedRange = null;
  window.rememberSel = function () {
    var s = window.getSelection();
    if (s.rangeCount && activeEditor && activeEditor.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  };
  /* a small palette instead of the OS colour panel */
  var PAL = ['#232833','#5e6675','#c1362c','#d97706','#15803d','#1a73e8',
             '#7c3aed','#be185d','#0f766e','#a16207','#475569','#0ea5e9'];
  var palEl = null;
  function closePal() { if (palEl) { palEl.remove(); palEl = null; } }
  document.addEventListener('mousedown', function (e) { if (palEl && !palEl.contains(e.target)) closePal(); }, true);
  window.openPalette = function (ev) {
    ev.preventDefault(); rememberSel(); closePal();
    var box = document.createElement('div'); palEl = box; box.className = 'palettepop';
    box.innerHTML = PAL.map(function (c) { return '<button type="button" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>'; }).join('');
    document.body.appendChild(box);
    var r = ev.currentTarget.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left - 60, window.innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = (r.bottom + 6 + box.offsetHeight > window.innerHeight ? r.top - box.offsetHeight - 6 : r.bottom + 6) + 'px';
    box.querySelectorAll('[data-c]').forEach(function (b) {
      b.addEventListener('mousedown', function (e2) {
        e2.preventDefault();
        ensureActive(); activeEditor.focus();
        if (savedRange) { var s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(savedRange); }
        withLine(function () { applyColor(b.dataset.c); }); saveActive(); closePal();
      });
    });
  };

  window.fmtColorCustom = function (c) {
    ensureActive(); activeEditor.focus();
    if (savedRange) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
    applyColor(c); saveActive();
  };

  /* The toolbar used to appear wherever your selection happened to be, which on
     the first line of a card meant across its heading. It now docks to the top of
     whatever you are editing, appears when you put the cursor in a box and leaves
     when you click away — one predictable place instead of a moving target. */
  (function dockedToolbar() {
    var bar = document.getElementById('toolbar'); if (!bar) return;
    var host = null, raf = 0;

    function place() {
      if (!host) return;
      var r = host.getBoundingClientRect();
      bar.style.left = Math.round(r.left) + 'px';
      bar.style.top = Math.round(r.top) + 'px';
      bar.style.width = Math.round(r.width) + 'px';
      // out of sight once the box has scrolled past
      var off = r.bottom < 60 || r.top > window.innerHeight - 20;
      bar.classList.toggle('gone', off);
    }
    function follow() { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); }

    function show(el) {
      host = el; activeEditor = el;
      bar.classList.add('docked');
      place();
      bar.classList.add('show');
    }
    function hide() {
      host = null;
      bar.classList.remove('show', 'gone');
    }

    editorSaves.forEach(function (_, el) {
      el.addEventListener('focus', function () { show(el); });
      el.addEventListener('blur', function () {
        // clicking a toolbar button must not count as leaving the box
        setTimeout(function () {
          var a = document.activeElement;
          if (a && (bar.contains(a) || editorSaves.has(a))) return;
          if (bar.matches(':hover')) return;
          hide();
        }, 120);
      });
    });
    // mousedown on the bar keeps the caret where it is
    bar.addEventListener('mousedown', function (e) { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);

    editorSaves.forEach(function (saveFn, el) {
      el.addEventListener('keydown', function (e) {
        if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
        var bullets = (e.key === '8' || e.code === 'Digit8'), numbers = (e.key === '7' || e.code === 'Digit7');
        if (bullets || numbers) {
          e.preventDefault(); activeEditor = el;
          document.execCommand(bullets ? 'insertUnorderedList' : 'insertOrderedList');
          saveFn();
        }
      });
    });
  })();

  renderBottle(); renderGoals(); renderYear();
  /* another tab (or a sync pull) changed the goals — take the new text */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    if (document.activeElement && editorSaves.has(document.activeElement)) return;   // never yank text from under you
    renderBottle(); renderGoals(); renderYear();
  });
})();
