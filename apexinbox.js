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
  var STATE = 'apexInbox', REPLIES = 'apexInboxReplies';
  var API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function get(k, f) { try { return JSON.parse(localStorage.getItem(k) || 'null') || f; } catch (e) { return f; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function isApex(w) { var s = String(w || '').trim().toLowerCase(); return s === 'apex' || s === 'claude'; }

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
    return 'Tasks Wiktor has assigned to Apex. Written by the Apex web app; read by Claude.\n' +
      'Reply by writing a separate all-day event titled "' + TITLE_OUT + '" whose description holds the APEX-REPLIES JSON block.\n\n' +
      lines + '\n\n<!--APEX-INBOX v1\n' +
      JSON.stringify({ updated: new Date().toISOString(), tasks: tasks }) + '\n-->';
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
    var tasks = payload(), sig = JSON.stringify(tasks);
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
      try { window.dispatchEvent(new Event('apex-inbox-replies')); } catch (e) {}
      return byId;
    }).catch(function () { return null; });
  }
  function replies() { return (get(REPLIES, {}) || {}).byId || {}; }

  window.ApexInbox = {
    isApex: isApex, payload: payload, push: push, pushSoon: pushSoon,
    pull: pullReplies, replies: replies, TITLE_IN: TITLE_IN, TITLE_OUT: TITLE_OUT,
    state: function () { return get(STATE, {}); }
  };

  /* on a page that has tasks: send what changed, then look for answers */
  if (/tasks\.html/.test(location.pathname) || /^\/?$/.test(location.pathname) === false) {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () { push(false); pullReplies(); }, 2500);
    });
  }
})();
