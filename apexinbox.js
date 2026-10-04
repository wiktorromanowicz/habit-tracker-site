/* Apex → Claude inbox (and back) ---------------------------------------------
   Assign a task to "Apex" and it needs a way to leave this browser, because
   Claude cannot read your localStorage and cannot reach Supabase from where it
   runs. What it can reach is your Google Calendar — the same trick that already
   delivers the executive summary, pointed the other way.

   Two private, all-day, free-time events on your primary calendar:
     "Apex inbox"   — written ONLY here, read by Claude
     "Apex replies" — written ONLY by Claude, read here
   Two events rather than one because a single description written from both
   ends is a lost-update bug waiting to happen.

   Both are hidden from the Calendar tab, Today and the Time auto-log the same
   way the summary carrier is. Nothing is sent anywhere else, and a task only
   travels once you have named Apex as its owner. */
(function () {
  var TITLE_IN = 'Apex inbox', TITLE_OUT = 'Apex replies';
  var STATE = 'apexInbox', REPLIES = 'apexInboxReplies', LOG = 'apexInboxLog', MINE_KEY = 'apexInboxMine';
  var API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function get(k, f) { try { return JSON.parse(localStorage.getItem(k) || 'null') || f; } catch (e) { return f; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function isApex(w) { var s = String(w || '').trim().toLowerCase(); return s === 'apex' || s === 'claude'; }

  /* ---- the usage digest -------------------------------------------------
     Claude cannot see how Apex is actually used, so any advice about it is
     guesswork. This sends COUNTS ONLY — how many times a tab was opened, how
     many tasks were added, how many time slots filled. No titles, no text, no
     note or task content, nothing about what any of it was about. It rides
     along in the same inbox event, and the switch on the Apex tab turns it off.
     ---------------------------------------------------------------------- */
  var USAGE_OPT = 'apexInboxUsage';
  function usageOn() {
    try { var raw = localStorage.getItem(USAGE_OPT); return raw === null ? true : JSON.parse(raw) !== false; }
    catch (e) { return true; }
  }
  function setUsage(on) { set(USAGE_OPT, !!on); push(true); }

  function digest() {
    if (!usageOn()) return null;
    var U = get('apexUsage', { d: {} }) || { d: {} }, days = U.d || {};
    var t = today(), from = iso(addDays(t, -29));
    var tot = {}, active = 0, perDay = {};
    Object.keys(days).forEach(function (k) {
      if (k < from) return;
      var row = days[k], any = false;
      Object.keys(row).forEach(function (e) { tot[e] = (tot[e] || 0) + row[e]; any = true; });
      if (any) { active++; perDay[k] = Object.keys(row).reduce(function (n, e) { return n + row[e]; }, 0); }
    });
    if (!active) return null;

    // volume only — how much is in each store, never what is in it
    var T = get('apexTasks', {}) || {}, lists = (T.taskLists || []);
    var openN = 0, doneN = 0, overdue = 0, withDue = 0, assigned = 0;
    var todayIso = iso(t);
    lists.forEach(function (l) { (l.items || []).forEach(function (it) {
      if (it.done) { doneN++; return; }
      openN++; if (it.due) { withDue++; if (it.due < todayIso) overdue++; } if (it.who) assigned++;
    }); });
    var H = get('titan_habits_v1', {}) || {}, habits = (H.habits || []);
    var N = get('wiktorNotes', {}) || {}, notes = (N.notes || []);
    var TM = get('apexTime', {}) || {}, weeks = Object.keys(TM.weeks || {});
    var slots = 0;
    weeks.forEach(function (w) { var wk = TM.weeks[w]; Object.keys(wk).forEach(function (k) {
      if (/^(wake|night)/.test(k)) return; var v = wk[k]; if (v && v.t) slots++; }); });

    return {
      window: { from: from, to: todayIso, activeDays: active },
      events: tot,
      busiestDays: Object.keys(perDay).sort(function (a, b) { return perDay[b] - perDay[a]; }).slice(0, 3)
        .map(function (k) { return { day: k, events: perDay[k] }; }),
      hiddenTabs: (function () { try { var h = JSON.parse(localStorage.getItem('apexNavHidden') || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; } })(),
      volume: {
        lists: lists.filter(function (l) { return !l.stashed; }).length,
        listsPutAway: lists.filter(function (l) { return l.stashed; }).length,
        openTasks: openN, doneTasks: doneN, overdue: overdue, withDueDate: withDue, assigned: assigned,
        habits: habits.filter(function (h) { return !h.hidden; }).length,
        habitsHidden: habits.filter(function (h) { return !!h.hidden; }).length,
        notes: notes.length, notesPrivate: notes.filter(function (n) { return n.private; }).length,
        timeWeeksLogged: weeks.length, timeSlotsFilled: slots
      }
    };
  }

  /* ---- your side of the conversation -----------------------------------
     A reply typed on the Apex tab is kept here until the next run has read it.
     It travels in the same inbox event as everything else, keyed by task id;
     "__weekly" is the thread for the weekly review, which has no task. */
  function mine() { return get(MINE_KEY, {}) || {}; }
  function say(id, text) {
    text = String(text || '').trim(); if (!id || !text) return false;
    var M = mine(); var arr = M[id] = M[id] || [];
    arr.push({ at: new Date().toISOString(), text: text, sent: false });
    while (arr.length > 30) arr.shift();
    set(MINE_KEY, M);
    try { window.dispatchEvent(new Event('apex-inbox-replies')); } catch (e) {}
    pushSoon();
    return true;
  }
  function unsent() {
    var M = mine(), out = {};
    Object.keys(M).forEach(function (id) {
      var a = (M[id] || []).filter(function (x) { return !x.sent; });
      if (a.length) out[id] = a.map(function (x) { return { at: x.at, text: x.text }; });
    });
    return out;
  }
  function markSent() {
    var M = mine(), touched = false;
    Object.keys(M).forEach(function (id) { (M[id] || []).forEach(function (x) { if (!x.sent) { x.sent = true; touched = true; } }); });
    if (touched) set(MINE_KEY, M);
  }

  /* what we would send right now */
  function payload() {
    var S = get('apexTasks', {}), out = [];
    (S.taskLists || []).forEach(function (l) {
      if (l.stashed) return;
      (l.items || []).forEach(function (it) {
        if (it.done || !isApex(it.who)) return;
        out.push({ id: it.id, list: l.name, text: it.text || '', desc: it.desc || '', due: it.due || '', added: it.added || '' });
      });
    });
    out.sort(function (a, b) { return (a.due || '9999').localeCompare(b.due || '9999'); });
    return out;
  }
  function body(tasks) {
    var lines = tasks.length
      ? tasks.map(function (t, i) { return (i + 1) + '. ' + t.text + (t.due ? '  (due ' + t.due + ')' : '') + '  [' + t.list + ']' + (t.desc ? '\n   ' + t.desc : ''); }).join('\n')
      : 'Nothing assigned to Apex right now.';
    var d = digest(), said = unsent(), saidKeys = Object.keys(said);
    var saidText = saidKeys.length ? '\n\nWIKTOR REPLIED — answer these first:\n' + saidKeys.map(function (id) {
      var t = tasks.filter(function (x) { return x.id === id; })[0];
      return '• ' + (id === '__weekly' ? 'on the weekly review' : (t ? '"' + t.text + '"' : 'on task ' + id)) + ': ' +
        said[id].map(function (m) { return m.text; }).join(' / ');
    }).join('\n') : '';
    return 'Tasks Wiktor has assigned to Apex. Written by the Apex web app; read by Claude.\n' +
      'Reply by writing a separate all-day event titled "' + TITLE_OUT + '" whose description holds the APEX-REPLIES JSON block.\n' +
      (d ? 'It also carries a counts-only record of how Apex itself is used — no titles, no text, no content of any kind.\n' : '') +
      '\n' + lines + saidText + '\n\n<!--APEX-INBOX v1\n' +
      JSON.stringify({ updated: new Date().toISOString(), tasks: tasks, usage: d, saidByWiktor: said }) + '\n-->';
  }

  /* find the carrier event, wherever it drifted to */
  function findEvent(title) {
    var t = today();
    var url = API + '?timeMin=' + encodeURIComponent(addDays(t, -60).toISOString()) +
      '&timeMax=' + encodeURIComponent(addDays(t, 60).toISOString()) +
      '&q=' + encodeURIComponent(title) + '&singleEvents=true&maxResults=50';
    return ApexG.fetch(url).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().then(function (j) {
        var hits = (j.items || []).filter(function (e) {
          return e.status !== 'cancelled' && (e.summary || '').trim().toLowerCase() === title.toLowerCase();
        }).sort(function (a, b) { return (b.updated || '').localeCompare(a.updated || ''); });
        return hits[0] || null;
      });
    }).catch(function () { return null; });
  }

  /* ---- outgoing ---- */
  var lastSent = null, pending = null;
  function push(force) {
    if (!window.ApexG) return Promise.resolve(false);
    var tasks = payload(), sig = JSON.stringify(tasks) + '|' + JSON.stringify(unsent()) + '|' + usageOn() + '|' + iso(today());
    var st = get(STATE, {});
    if (!force && sig === (lastSent || st.sig)) return Promise.resolve(false);
    var t = today();
    var ev = {
      summary: TITLE_IN,
      description: body(tasks),
      start: { date: iso(t) }, end: { date: iso(addDays(t, 1)) },
      transparency: 'transparent', visibility: 'private', reminders: { useDefault: false }
    };
    return findEvent(TITLE_IN).then(function (found) {
      var url = found ? API + '/' + encodeURIComponent(found.id) : API;
      return ApexG.fetch(url, {
        method: found ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ev)
      });
    }).then(function (r) {
      if (!r || !r.ok) return false;
      lastSent = sig; set(STATE, { sig: sig, at: Date.now(), n: tasks.length });
      markSent();
      return true;
    }).catch(function () { return false; });
  }
  function pushSoon() { clearTimeout(pending); pending = setTimeout(function () { push(false); }, 2500); }

  /* ---- incoming ---- */
  function pullReplies() {
    if (!window.ApexG) return Promise.resolve(null);
    return findEvent(TITLE_OUT).then(function (ev) {
      if (!ev || !ev.description) return null;
      var m = ev.description.match(/<!--\s*APEX-REPLIES[^\n]*\n([\s\S]*?)-->/);
      var data = null;
      if (m) { try { data = JSON.parse(m[1]); } catch (e) { data = null; } }
      if (!data) return null;
      var byId = {};
      (data.replies || []).forEach(function (r) { if (r && r.id) byId[r.id] = r; });
      set(REPLIES, { at: Date.now(), updated: data.updated || '', byId: byId });
      /* keep what changed, dated, so the Apex tab can show how a task moved over
         days instead of only the sentence that happens to be current */
      var log = get(LOG, {}) || {};
      var day = (data.updated || new Date().toISOString()).slice(0, 10);
      Object.keys(byId).forEach(function (id) {
        var r = byId[id], entries = log[id] = log[id] || [];
        var last = entries[entries.length - 1];
        if (last && last.text === r.text && last.status === r.status) return;   // nothing new to say
        entries.push({ at: data.updated || new Date().toISOString(), day: day, text: r.text || '', status: r.status || '' });
        while (entries.length > 40) entries.shift();
      });
      set(LOG, log);
      try { window.dispatchEvent(new Event('apex-inbox-replies')); } catch (e) {}
      return byId;
    }).catch(function () { return null; });
  }
  function replies() { return (get(REPLIES, {}) || {}).byId || {}; }
  function history(id) { var l = get(LOG, {}) || {}; return id ? (l[id] || []) : l; }

  window.ApexInbox = {
    isApex: isApex, payload: payload, push: push, pushSoon: pushSoon,
    pull: pullReplies, replies: replies, history: history, TITLE_IN: TITLE_IN, TITLE_OUT: TITLE_OUT,
    digest: digest, usageOn: usageOn, setUsage: setUsage,
    say: say, mine: mine, unsent: unsent,
    state: function () { return get(STATE, {}); }
  };

  /* on a page that has tasks: send what changed, then look for answers */
  if (/tasks\.html/.test(location.pathname) || /^\/?$/.test(location.pathname) === false) {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () { push(false); pullReplies(); }, 2500);
    });
  }
})();
