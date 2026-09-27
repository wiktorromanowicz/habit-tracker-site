/* Apex — shared Google access token.
   ---------------------------------------------------------------------------
   The problem this solves: a Google access token lives about an hour, and until
   now only calendar.html knew how to renew one. Every other page just read
   `apexGTok` out of localStorage and gave up when it had gone stale — which is
   why the executive summary, the Time tab's calendar fill and the Notes brief
   all worked right after you visited Calendar and silently stopped working an
   hour later.

   This file gives every page the same renewal machinery the Calendar tab has:
     ApexG.token()      -> Promise<string|null>, a token that is valid right now
     ApexG.connected()  -> boolean, true when we hold an unexpired token
     ApexG.ready        -> Promise, resolves once the first attempt has settled

   It never shows a popup or a consent screen on its own. A silent renewal
   either works (because you are signed in to Google in this browser) or it
   fails quietly and the caller falls back to whatever cache it has. The only
   place that asks you to connect is still the Calendar tab.

   calendar.html sets window.APEX_G_OWNER before its scripts run, so this file
   stands aside there and never creates a second token client. */
(function () {
  if (window.ApexG || window.APEX_G_OWNER) return;

  var KEY = 'apexGTok';
  var SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
  var cfg = window.APEX_GCAL || {};

  var tok = null, exp = 0;                 // in-memory copy of the stored token
  var client = null, busy = false, lastTry = 0, waiters = [];
  var readyDone = null;
  var ready = new Promise(function (r) { readyDone = r; });
  setTimeout(function () { if (readyDone) { readyDone(false); readyDone = null; } }, 9000);

  function settle(v) { if (readyDone) { readyDone(v); readyDone = null; } }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.t && s.e > Date.now() + 30000) { tok = s.t; exp = s.e; return true; }
    } catch (e) {}
    return false;
  }
  function store(r) {
    tok = r.access_token;
    exp = Date.now() + ((r.expires_in || 3600) * 1000) - 60000;   // renew a minute early
    try { localStorage.setItem(KEY, JSON.stringify({ t: tok, e: exp })); } catch (e) {}
  }
  function fresh() { return !!(tok && exp > Date.now()); }

  function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
  function loadGis() {
    if (document.querySelector('script[data-apex-gis]')) return;
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true; s.setAttribute('data-apex-gis', '1');
    document.head.appendChild(s);
  }

  function makeClient() {
    if (client || !gisReady() || !cfg.clientId) return client;
    try {
      client = google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId, scope: SCOPE, prompt: '',
        callback: function () {}, error_callback: function () {}
      });
    } catch (e) { client = null; }
    return client;
  }

  /* one silent attempt; resolves true/false, never throws, never prompts */
  function silent() {
    if (busy) return new Promise(function (res) { waiters.push(res); });
    if (!makeClient()) return Promise.resolve(false);
    busy = true; lastTry = Date.now();
    return new Promise(function (res) {
      var settled = false;
      var done = function (v) {
        if (settled) return; settled = true; busy = false;
        res(v); waiters.splice(0).forEach(function (f) { f(v); });
      };
      var prevCb = client.callback, prevErr = client.error_callback;
      client.callback = function (r) {
        client.callback = prevCb; client.error_callback = prevErr;
        if (r && r.access_token) { store(r); done(true); } else done(false);
      };
      client.error_callback = function () {
        client.callback = prevCb; client.error_callback = prevErr; done(false);
      };
      try { client.requestAccessToken({ prompt: '' }); } catch (e) { done(false); }
      setTimeout(function () { done(false); }, 8000);
    });
  }

  function token() {
    if (fresh()) return Promise.resolve(tok);
    if (load()) return Promise.resolve(tok);
    // the Google script arrives over the network — wait for the first boot attempt
    // to settle before deciding there is no token, or every early caller loses the race
    return ready.then(function () {
      if (fresh() || load()) return tok;
      return silent().then(function (ok) { return ok ? tok : null; });
    });
  }

  window.ApexG = {
    token: token,
    connected: function () { return fresh() || load(); },
    ready: ready,
    /* a fetch that carries the token and retries once after a 401 */
    fetch: function (url, opts) {
      return token().then(function (t) {
        if (!t) return null;
        var o = Object.assign({}, opts || {});
        o.headers = Object.assign({ Authorization: 'Bearer ' + t }, o.headers || {});
        return fetch(url, o).then(function (r) {
          if (r.status !== 401) return r;
          tok = null; exp = 0;
          return silent().then(function (ok) {
            if (!ok) return r;
            var o2 = Object.assign({}, opts || {});
            o2.headers = Object.assign({ Authorization: 'Bearer ' + tok }, o2.headers || {});
            return fetch(url, o2);
          });
        });
      });
    }
  };

  /* boot: use what we have, otherwise try once quietly */
  (function boot() {
    if (!cfg.clientId) { settle(false); return; }
    loadGis();
    if (load()) { settle(true); }
    var waited = 0;
    var tick = function () {
      if (gisReady()) {
        if (fresh()) { settle(true); return; }
        silent().then(function (ok) { settle(ok); });
        return;
      }
      waited += 150;
      if (waited > 8000) { settle(false); return; }
      setTimeout(tick, 150);
    };
    tick();
  })();

  /* keep it warm: renew a few minutes before expiry, and take the chance on a
     first gesture after a failed silent attempt (gesture-backed popups are not
     blocked, so this is the one that rescues a long-lived Apex.app window) */
  setInterval(function () {
    if (!client || busy) return;
    if (tok && exp - Date.now() < 5 * 60000 && Date.now() - lastTry > 60000) silent();
  }, 60000);
  ['pointerdown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (!client || busy) return;
      var expiring = !fresh() || (exp - Date.now() < 5 * 60000);
      if (expiring && Date.now() - lastTry > 20000) silent();
    }, true);
  });
  /* another tab refreshed it → adopt it rather than asking Google again */
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) load();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !fresh()) { if (!load()) token(); }
  });
})();
