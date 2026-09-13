/* Apex cloud sync — keeps every tab's data identical across your devices.
   Backend: Supabase (email + password login, one table, row-level security).
   Strategy: local-first. Pages keep using localStorage; this file mirrors the
   synced keys to the cloud (last write wins) and pulls other devices' changes. */
(function () {
  var cfg = window.APEX_SUPABASE || {};
  if (!cfg.url || !cfg.key) return;               // not configured yet → app works exactly as before

  /* localStorage keys that hold Apex data (per tab) */
  var KEYS = ['titan_habits_v1', 'apexTasks', 'wiktorNotes', 'finState', 'wiktorAssets', 'wiktorIdeas',
              'wiktorOsFocus', 'apexNavOrder', 'apexNotesSide', 'apexTimer', 'apexLift', 'finRules', 'apexCalPrefs'];
  var isYearKey = function (k) { return /^wiktorMetrics_\d{4}$/.test(k); };
  var synced = function (k) { return KEYS.indexOf(k) >= 0 || isYearKey(k); };

  var META_KEY = 'apexSyncMeta';                    // { key: { ts } } local write timestamps
  var meta = {}; try { meta = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (e) {}
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }

  var sb = null, user = null, pushTimers = {}, pulling = false, chip = null, panel = null, channel = null;
  var rawSet = localStorage.setItem.bind(localStorage), rawRemove = localStorage.removeItem.bind(localStorage);

  /* ---- watch local writes ---- */
  localStorage.setItem = function (k, v) {
    rawSet(k, v);
    if (!synced(k) || pulling) return;
    meta[k] = { ts: Date.now() }; saveMeta();
    schedulePush(k);
  };
  function schedulePush(k) {
    if (!sb || !user) return;
    clearTimeout(pushTimers[k]);
    pushTimers[k] = setTimeout(function () { push(k); }, 600);
  }
  function push(k) {
    if (!sb || !user) return;
    var v = localStorage.getItem(k); if (v == null) return;
    var ts = (meta[k] && meta[k].ts) || Date.now();
    setChip('syncing');
    sb.from('apex_state').upsert({ user_id: user.id, key: k, value: v, updated_at: new Date(ts).toISOString() }, { onConflict: 'user_id,key' })
      .then(function (r) { if (r.error) { console.warn('[apex sync] push failed', k, r.error.message); setChip('error'); } else setChip('ok'); });
  }
  function pushAll() {
    KEYS.forEach(function (k) { if (localStorage.getItem(k) != null) push(k); });
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (isYearKey(k)) push(k); }
  }

  /* ---- pull: newer copy wins ---- */
  var changedKeys = [];
  function applyRemote(row) {
    var k = row.key; if (!synced(k)) return false;
    var remoteTs = Date.parse(row.updated_at) || 0;
    var localTs = (meta[k] && meta[k].ts) || 0;
    if (localStorage.getItem(k) == null || remoteTs > localTs) {
      if (localStorage.getItem(k) === row.value) { meta[k] = { ts: remoteTs }; saveMeta(); return false; }
      pulling = true; rawSet(k, row.value); pulling = false;
      meta[k] = { ts: remoteTs }; saveMeta();
      return true;
    }
    if (localTs > remoteTs && localStorage.getItem(k) !== row.value) schedulePush(k); // we are newer → send ours
    return false;
  }
  function pullAll() {
    if (!sb || !user) return Promise.resolve();
    setChip('syncing');
    return sb.from('apex_state').select('key,value,updated_at').eq('user_id', user.id).then(function (r) {
      if (r.error) { console.warn('[apex sync] pull failed', r.error.message); setChip('error'); return; }
      var changed = false, have = {};
      (r.data || []).forEach(function (row) { have[row.key] = 1; if (applyRemote(row)) changed = true; });
      // keys we have locally that the cloud has never seen → upload
      KEYS.forEach(function (k) { if (!have[k] && localStorage.getItem(k) != null) push(k); });
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (isYearKey(k) && !have[k]) push(k); }
      setChip('ok');
      if (changed) refreshPage();
    });
  }
  var refreshPending = false;
  function refreshPage() {
    // data changed underneath the page: reload when it is safe (not mid-typing / not focused)
    if (refreshPending) return; refreshPending = true;
    var go = function () { location.reload(); };
    if (document.hidden || !document.hasFocus()) return go();
    var ae = document.activeElement, typing = ae && (ae.isContentEditable || /INPUT|TEXTAREA/.test(ae.tagName));
    if (!typing) return setTimeout(go, 400);
    showRefreshHint();
  }
  function showRefreshHint() {
    if (document.getElementById('apexRefresh')) return;
    var d = document.createElement('div'); d.id = 'apexRefresh';
    d.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:95;background:#2b2a26;color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;display:flex;gap:12px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.25);font-family:inherit;';
    d.innerHTML = '<span>Updated on another device</span><button style="background:#a9741f;color:#fff;border:none;border-radius:7px;padding:5px 10px;font-weight:600;cursor:pointer;font-family:inherit">Refresh</button>';
    d.querySelector('button').onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }

  /* ---- realtime: other devices' writes arrive within a second ---- */
  function subscribe() {
    if (!sb || !user || channel) return;
    channel = sb.channel('apex-state-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'apex_state', filter: 'user_id=eq.' + user.id },
        function (payload) { var row = payload.new; if (row && applyRemote(row)) refreshPage(); })
      .subscribe();
  }

  /* ---- account chip + sign-in panel ---- */
  function setChip(state) {
    if (!chip) return;
    var map = { off: ['Sign in to sync', '#eee7d8', '#9c8f76'], syncing: ['… syncing', '#fff3d6', '#8a5a0f'], ok: ['● synced', '#dff3e6', '#12855a'], error: ['sync error', '#fdeaea', '#c1362c'] };
    var m = map[state] || map.off;
    chip.textContent = m[0]; chip.style.background = m[1]; chip.style.color = m[2];
    chip.title = user ? (user.email + ' — click for account') : 'Sign in to see the same data on your phone';
  }
  function mountChip() {
    var brand = document.querySelector('.brand'); if (!brand || chip) return;
    chip = document.createElement('span');
    chip.style.cssText = 'display:inline-block;margin-left:7px;font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;vertical-align:middle;letter-spacing:.02em;cursor:pointer;';
    chip.addEventListener('click', openPanel);
    brand.appendChild(chip); setChip(user ? 'ok' : 'off');
  }
  function openPanel() {
    if (panel) { panel.remove(); panel = null; return; }
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;z-index:96;background:rgba(30,28,22,.35);display:flex;align-items:center;justify-content:center;padding:20px;';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:14px;padding:22px 24px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:inherit;color:#2b2a26;';
    if (user) {
      card.innerHTML = '<h3 style="margin:0 0 6px;font-size:16px">Apex sync</h3><div style="font-size:13px;color:#6f6858;margin-bottom:16px">Signed in as <b>' + esc(user.email) + '</b>. Every device signed in with this email sees the same data.</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button data-a="sync" style="' + btn('#f3efe4', '#2b2a26') + '">Sync now</button><button data-a="out" style="' + btn('#2b2a26', '#fff') + '">Sign out</button></div>';
      card.querySelector('[data-a=sync]').onclick = function () { pullAll(); pushAll(); };
      card.querySelector('[data-a=out]').onclick = function () { sb.auth.signOut().then(function () { location.reload(); }); };
    } else {
      card.innerHTML = '<h3 style="margin:0 0 6px;font-size:16px">Sign in to Apex</h3>' +
        '<div style="font-size:13px;color:#6f6858;margin-bottom:14px">Use the same email + password on your phone and laptop. First time? Enter the details and press <b>Create account</b>.</div>' +
        '<form id="apexForm" autocomplete="on">' +
        '<input name="email" id="apexEmail" type="email" placeholder="Email" autocomplete="username" style="' + inp() + '">' +
        '<input name="password" id="apexPass" type="password" placeholder="Password (6+ characters)" autocomplete="current-password" style="' + inp() + '">' +
        '<div id="apexMsg" style="font-size:12px;color:#c1362c;min-height:16px;margin:2px 0 10px"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
        '<button type="button" data-a="up" style="' + btn('#f3efe4', '#2b2a26') + '">Create account</button>' +
        '<button type="submit" data-a="in" style="' + btn('#a9741f', '#fff') + '">Sign in</button></div></form>';
      var form = card.querySelector('#apexForm');
      var msg = card.querySelector('#apexMsg');
      var busy = false;
      var go = function (mode) {
        if (busy) return;
        var email = (form.elements.email.value || '').trim();
        var pass = form.elements.password.value || '';
        if (!sb) { msg.style.color = '#c1362c'; msg.textContent = 'Sync service could not load — check your connection and reopen this panel.'; return; }
        if (!email || email.indexOf('@') < 0) { msg.style.color = '#c1362c'; msg.textContent = 'Enter your email address.'; form.elements.email.focus(); return; }
        if (pass.length < 6) { msg.style.color = '#c1362c'; msg.textContent = 'Password needs at least 6 characters.'; form.elements.password.focus(); return; }
        busy = true;
        msg.style.color = '#6f6858'; msg.textContent = mode === 'up' ? 'Creating account\u2026' : 'Signing in\u2026';
        var p = mode === 'up' ? sb.auth.signUp({ email: email, password: pass }) : sb.auth.signInWithPassword({ email: email, password: pass });
        p.then(function (res) {
          busy = false;
          if (res.error) {
            msg.style.color = '#c1362c';
            var m = res.error.message || 'Something went wrong.';
            if (/already registered|already exists/i.test(m)) m = 'That email already has an account \u2014 press Sign in instead.';
            else if (/Invalid login/i.test(m)) m = 'No account with that email and password yet \u2014 press Create account first.';
            msg.textContent = m;
            return;
          }
          if (mode === 'up' && !(res.data && res.data.session)) {
            msg.style.color = '#8a5a0f';
            msg.textContent = 'Account created \u2014 open the confirmation email, then press Sign in.';
            return;
          }
          location.reload();
        }).catch(function (err) {
          busy = false; msg.style.color = '#c1362c';
          msg.textContent = 'Could not reach the sync service: ' + (err && err.message ? err.message : err);
        });
      };
      form.addEventListener('submit', function (e) { e.preventDefault(); go('in'); });
      card.querySelector('[data-a=up]').addEventListener('click', function () { go('up'); });
      ['keydown', 'keypress', 'keyup', 'input', 'paste'].forEach(function (ev) {
        card.addEventListener(ev, function (e) { e.stopPropagation(); });
      });
    }
    panel.appendChild(card); document.body.appendChild(panel);
    panel.addEventListener('mousedown', function (e) { if (e.target === panel) { panel.remove(); panel = null; } });
    var first = card.querySelector('input'); if (first) first.focus();
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function btn(bg, fg) { return 'background:' + bg + ';color:' + fg + ';border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit'; }
  function inp() { return 'display:block;width:100%;box-sizing:border-box;border:1px solid #e7e2d6;border-radius:8px;padding:9px 11px;font-size:14px;margin-bottom:8px;font-family:inherit;outline:none'; }

  /* ---- boot: load the Supabase client, restore session ---- */
  function boot() {
    if (!window.supabase || !window.supabase.createClient) { setTimeout(boot, 100); return; }
    sb = window.supabase.createClient(cfg.url, cfg.key);
    window.apexSync = { client: function () { return sb; }, user: function () { return user; } };
    sb.auth.getSession().then(function (r) {
      user = r.data && r.data.session ? r.data.session.user : null;
      mountChip();
      if (user) { pullAll().then(subscribe); }
    });
    sb.auth.onAuthStateChange(function (ev, session) {
      var u = session ? session.user : null;
      if ((u && u.id) !== (user && user.id)) { user = u; setChip(user ? 'ok' : 'off'); if (user) { pullAll().then(subscribe); } }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && user) pullAll(); });
    window.addEventListener('online', function () { if (user) { pullAll(); pushAll(); } });
  }
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  s.onload = boot; s.onerror = function () { console.warn('[apex sync] could not load supabase-js'); };
  document.head.appendChild(s);
  if (document.readyState !== 'loading') mountChip(); else document.addEventListener('DOMContentLoaded', mountChip);
})();
