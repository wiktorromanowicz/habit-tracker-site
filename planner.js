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
  window.fmt = function (ev, cmd, val) { ev.preventDefault(); ensureActive(); activeEditor.focus(); document.execCommand(cmd, false, val || null); saveActive(); };
  function applyColor(c) { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, c); }
  window.fmtColor = function (ev, c) { ev.preventDefault(); ensureActive(); activeEditor.focus(); applyColor(c); saveActive(); };
  var savedRange = null;
  window.rememberSel = function () {
    var s = window.getSelection();
    if (s.rangeCount && activeEditor && activeEditor.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  };
  window.fmtColorCustom = function (c) {
    ensureActive(); activeEditor.focus();
    if (savedRange) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
    applyColor(c); saveActive();
  };

  /* floating toolbar, shown only while text is selected inside one of the boxes */
  (function selectionToolbar() {
    var bar = document.getElementById('toolbar'); if (!bar) return;
    function selInEditor() {
      var s = window.getSelection();
      if (!s || s.rangeCount === 0 || s.isCollapsed) return null;
      var hit = null;
      editorSaves.forEach(function (_, el) { if (!hit && el.contains(s.anchorNode) && el.contains(s.focusNode)) hit = el; });
      return hit;
    }
    function updateBar() {
      var el = selInEditor();
      if (!el) { bar.classList.remove('show'); return; }
      activeEditor = el;
      var r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { bar.classList.remove('show'); return; }
      bar.classList.add('show');                       // measure it at full size
      var w = bar.offsetWidth || 240, h = bar.offsetHeight || 32;
      /* keep it on screen, and drop it below the selection rather than letting it
         sit on top of the card heading when there is no room above */
      var cx = Math.round(r.left + r.width / 2);
      bar.style.left = Math.max(w / 2 + 8, Math.min(cx, window.innerWidth - w / 2 - 8)) + 'px';
      /* "Above" has to clear the card's own heading too, not just the window —
         selecting the first line used to park the bar across "MONTHLY GOALS". */
      var guard = 8;
      var card = el.closest && el.closest('.card, .block');
      var head = card && card.querySelector('h2, .block-head');
      if (head) guard = Math.max(guard, head.getBoundingClientRect().bottom + 4);
      var above = r.top - h - 12 > guard;
      bar.classList.toggle('below', !above);
      bar.style.top = (above ? Math.round(r.top) : Math.round(r.bottom)) + 'px';
    }
    document.addEventListener('selectionchange', function () { requestAnimationFrame(updateBar); });
    document.addEventListener('scroll', function () { if (bar.classList.contains('show')) updateBar(); }, true);
    window.addEventListener('resize', function () { if (bar.classList.contains('show')) updateBar(); });
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
