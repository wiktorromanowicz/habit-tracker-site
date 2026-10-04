/* Apex music — your own audio files, stored on this device, playable with no network.
   Files live in IndexedDB (localStorage is far too small for audio); playback state
   lives in localStorage so a track carries on across page loads.
   Nothing here talks to any server: the library never leaves the device. */
(function () {
  if (window.ApexMusic) return;
  var DB = 'apexMusic', STORE = 'tracks', SKEY = 'apexMusicState';
  var db = null, audio = null, cur = null, url = null, saveT = 0, armed = false;
  var state = { id: null, pos: 0, playing: false, vol: 0.9, shuffle: false, repeat: 'all', order: [] };
  try { var s = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (s) state = Object.assign(state, s); } catch (e) {}

  /* ---- one player, however many windows are open -------------------------
     Every Apex page loads this engine, so every page used to build its own
     <audio> and resume the same track — two windows meant the same song twice,
     a second apart. Now exactly one page owns the sound. The others are remote
     controls: they show what is playing and send commands, and never create an
     <audio> at all. When the owning window closes it hands the music on, so
     playback carries to whatever Apex window is still open. */
  var ME = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var OWNKEY = 'apexMusicOwner', BUSKEY = 'apexMusicBus', LEASE = 8000;
  var owner = false, since = 0, suspend = false, remote = null;
  var claiming = false, sawOwner = false, yielded = false, heard = 0, postT = 0;
  var bus = null;
  try { if (window.BroadcastChannel) bus = new BroadcastChannel('apex-music'); } catch (e) { bus = null; }
  function post(m) {
    m.from = ME;
    if (bus) { try { bus.postMessage(m); return; } catch (e) {} }
    // no BroadcastChannel: relay through a storage event instead
    try { localStorage.setItem(BUSKEY, JSON.stringify({ m: m, n: Math.random() })); } catch (e) {}
  }
  function lease() { try { return JSON.parse(localStorage.getItem(OWNKEY) || 'null'); } catch (e) { return null; } }
  function stamp() { try { localStorage.setItem(OWNKEY, JSON.stringify({ id: ME, t: Date.now(), since: since })); } catch (e) {} }
  function unstamp() { var r = lease(); if (r && r.id === ME) { try { localStorage.removeItem(OWNKEY); } catch (e) {} } }
  function become() { owner = true; since = since || Date.now(); stamp(); post({ k: 'iam', since: since }); }
  function demote() { owner = false; since = 0; unstamp(); hush(); }
  function hush() {                                   // stop making sound without touching the shared state
    if (!audio) return;
    suspend = true;
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
    suspend = false;
    if (url) { try { URL.revokeObjectURL(url); } catch (e) {} url = null; }
    cur = null;
  }
  function snap(kind) {
    var n = now();
    post({ k: 'now', kind: kind || 'state', since: since, n: { id: n.id, pos: n.pos, dur: n.dur, playing: n.playing,
      vol: n.vol, shuffle: n.shuffle, repeat: n.repeat,
      track: n.track ? { id: n.track.id, title: n.track.title, name: n.track.name, artist: n.track.artist, dur: n.track.dur } : null } });
  }
  function onBus(m) {
    if (!m || m.from === ME) return;
    if (m.k === 'who') {
      if (owner) { post({ k: 'iam', since: since }); snap(); }
      else if (claiming && m.from < ME) yielded = true;    // a dead heat: the lower id goes first
      return;
    }
    if (m.k === 'iam' || m.k === 'now') {
      heard = Date.now();
      /* two pages both think they own it (a sleeping window's heartbeat went
         stale, say). The older claim wins, always, from both sides. */
      if (owner && m.since && m.since < since) { demote(); emit(); }
      else if (!owner) { sawOwner = true; if (audio) hush(); }
    }
    if (m.k === 'now' && !owner) {
      remote = m.n;
      state.id = m.n.id; state.pos = m.n.pos || 0; state.playing = !!m.n.playing;
      state.vol = m.n.vol != null ? m.n.vol : state.vol; state.shuffle = !!m.n.shuffle; state.repeat = m.n.repeat || state.repeat;
      emit(m.kind || 'state');
    }
    else if (m.k === 'free' && !owner) { heard = 0; setTimeout(takeover, 30 + Math.random() * 140); }
    else if (m.k === 'cmd' && owner) { apply(m.fn, m.args || []); }
    else if (m.k === 'drop' && owner && state.id === m.id) { stop(); state.id = null; state.pos = 0; save(); emit(); }
  }
  if (bus) bus.onmessage = function (e) { onBus(e.data); };
  window.addEventListener('storage', function (e) {
    if (e.key !== BUSKEY || !e.newValue) return;
    try { onBus(JSON.parse(e.newValue).m); } catch (x) {}
  });
  /* May this page be the one that plays? The lease answers instantly in the
     common case (nothing else open), so a page load starts the music with no
     wait; only a live-looking lease costs the round trip of asking. */
  function askOwner(cb, tries) {
    if (owner) return cb(true);
    var r = lease();
    var fresh = r && r.id !== ME && (Date.now() - (r.t || 0) < LEASE);
    if (!fresh) {
      since = Date.now(); become();
      post({ k: 'who' });        // and confirm: anyone already playing says so and we stand down
      return cb(true);
    }
    sawOwner = false; yielded = false; claiming = true;
    post({ k: 'who' });
    setTimeout(function () {
      claiming = false;
      if (sawOwner || owner) return cb(owner);
      if (yielded && (tries || 0) < 2) return setTimeout(function () { askOwner(cb, (tries || 0) + 1); }, 300);
      since = Date.now(); become(); cb(true);
    }, 260);
  }
  function takeover() {
    if (owner) return;
    askOwner(function (ok) {
      if (!ok || !state.id) return;
      get(state.id).then(function (rec) { if (rec && owner) return load(rec, state.pos || 0, state.playing); }).catch(function () {});
    });
  }
  setInterval(function () { if (owner) stamp(); }, 2500);
  window.addEventListener('pagehide', function () {
    if (!owner) return;
    if (audio) state.pos = audio.currentTime;
    save(); unstamp(); post({ k: 'free' });
  });
  /* a command from a page that is not the owner */
  function apply(fn, args) {
    if (fn === 'play') return play(args[0]);
    if (fn === 'toggle') return toggle();
    if (fn === 'next') return next();
    if (fn === 'prev') return prev();
    if (fn === 'seek') return seek(args[0]);
    if (fn === 'volume') return volume(args[0]);
    if (fn === 'flag') return setFlag(args[0], args[1]);
  }
  function cmd(fn, args) {
    if (owner) { var r = apply(fn, args); return r && r.then ? r : Promise.resolve(); }
    if (Date.now() - heard < 6000) { post({ k: 'cmd', fn: fn, args: args }); return Promise.resolve(); }
    askOwner(function (ok) { if (ok) apply(fn, args); else post({ k: 'cmd', fn: fn, args: args }); });
    return Promise.resolve();
  }

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = function () { db = r.result; res(db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode) { return open().then(function (d) { return d.transaction(STORE, mode).objectStore(STORE); }); }
  function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  function list() { return tx('readonly').then(function (st) { return req(st.getAll()); })
    .then(function (rows) { return rows.sort(function (a, b) { return (a.added || 0) - (b.added || 0); }); }); }
  function get(id) { return tx('readonly').then(function (st) { return req(st.get(id)); }); }
  function put(rec) { return tx('readwrite').then(function (st) { return req(st.put(rec)); }); }
  function del(id) { return tx('readwrite').then(function (st) { return req(st.delete(id)); })
    .then(function () {
      if (state.id === id) { if (owner) stop(); else post({ k: 'drop', id: id }); state.id = null; state.pos = 0; save(); }
      emit();
    }); }

  function nameParts(fn) {
    var base = (fn || 'Track').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
    var m = base.split(/\s+[-–—]\s+/);
    if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
    return { artist: '', title: base };
  }
  function duration(file) {
    return new Promise(function (res) {
      var a = document.createElement('audio'), u = URL.createObjectURL(file), done = function (v) { URL.revokeObjectURL(u); res(v); };
      a.preload = 'metadata';
      a.onloadedmetadata = function () { done(isFinite(a.duration) ? a.duration : 0); };
      a.onerror = function () { done(0); };        // unknown length is fine: the player reads it on play
      a.src = u; setTimeout(function () { done(isFinite(a.duration) ? a.duration : 0); }, 4000);
    });
  }
  /* add File objects (from a drop or a file input) */
  function add(files) {
    /* An .mp4 is a container, not a format: most "audio" downloads arrive as mp4
       or mov and <audio> plays the sound track out of them perfectly well. The
       old filter looked at the MIME type, saw video/mp4 and dropped the file
       without a word — which is why brain.fm.mp4 could not be added. */
    var all = Array.prototype.slice.call(files || []);
    var PLAYABLE = /\.(mp3|m4a|m4b|aac|wav|flac|ogg|oga|opus|webm|mp4|m4v|mov|aiff?|caf|wma)$/i;
    var arr = all.filter(function (f) { return /^(audio|video)\//.test(f.type) || PLAYABLE.test(f.name); });
    var rejected = all.filter(function (f) { return arr.indexOf(f) < 0; });
    if (rejected.length) { try { window.dispatchEvent(new CustomEvent('apex-music-rejected', { detail: rejected.map(function (f) { return f.name; }) })); } catch (e) {} }
    if (!arr.length) return Promise.resolve([]);
    return arr.reduce(function (chain, f) {
      return chain.then(function (acc) {
        return duration(f).then(function (dur) {
          var p = nameParts(f.name);
          var rec = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: f.name,
                      title: p.title, artist: p.artist, type: f.type || 'audio/mpeg', size: f.size, dur: dur, added: Date.now(), blob: f };
          return put(rec).then(function () { acc.push(rec); return acc; });
        });
      });
    }, Promise.resolve([])).then(function (added) { emit(); return added; });
  }

  function el() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.preload = 'auto'; audio.volume = state.vol;   // 'metadata' made every resume decode twice
    audio.addEventListener('timeupdate', function () { if (suspend) return; state.pos = audio.currentTime; if (Date.now() - saveT > 900) { saveT = Date.now(); save(); } emit('time'); });
    audio.addEventListener('ended', function () { if (!suspend) next(true); });
    audio.addEventListener('play', function () { if (suspend) return; state.playing = true; save(); emit(); });
    audio.addEventListener('pause', function () { if (suspend) return; state.playing = false; save(); emit(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && owner) save(); });
    window.addEventListener('beforeunload', function () { if (owner) save(); });
    /* beforeunload is not guaranteed on a navigation (and WKWebView is the worst
       for it); pagehide is. Without an exact position here the next page resumes
       from the last 3-second checkpoint. */
    window.addEventListener('pagehide', function () { if (!owner) return; if (audio) state.pos = audio.currentTime; save(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && owner && audio) { state.pos = audio.currentTime; save(); } });
    return audio;
  }
  function save() { try { localStorage.setItem(SKEY, JSON.stringify({ id: state.id, pos: state.pos, playing: state.playing, vol: state.vol, shuffle: state.shuffle, repeat: state.repeat })); } catch (e) {} }
  function emit(kind) {
    try { window.dispatchEvent(new CustomEvent('apex-music', { detail: { kind: kind || 'state' } })); } catch (e) {}
    if (!owner) return;
    if (kind === 'time' && Date.now() - postT < 400) return;   // 4/s is plenty for a progress bar
    postT = Date.now(); snap(kind);
  }

  function media(rec) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: rec.title || rec.name, artist: rec.artist || 'Apex', album: 'Apex' });
      navigator.mediaSession.setActionHandler('play', function () { toggle(); });
      navigator.mediaSession.setActionHandler('pause', function () { toggle(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { next(); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { prev(); });
    } catch (e) {}
  }
  function load(rec, at, autoplay) {
    var a = el();
    if (url) { URL.revokeObjectURL(url); url = null; }
    url = URL.createObjectURL(rec.blob);
    cur = rec; state.id = rec.id; state.pos = at || 0;
    /* A media fragment makes the browser start decoding AT the offset. Setting
       currentTime after metadata instead meant decoding from zero and then
       seeking — the audible stumble on every page change. */
    var at0 = Math.max(0, at || 0);
    a.src = at0 > 0.25 ? (url + '#t=' + at0.toFixed(2)) : url;
    var seeked = false;
    var fix = function () {
      if (seeked) return; seeked = true;
      if (at0 > 0.25 && Math.abs(a.currentTime - at0) > 0.6) { try { a.currentTime = at0; } catch (e) {} }
    };
    a.onloadedmetadata = fix;
    media(rec); save(); emit('track');
    if (autoplay) {
      // do not wait for metadata: play() resolves once it can, and the fragment
      // has already put the playhead in the right place
      return a.play().then(fix).catch(function () { arm(); });
    }
    return Promise.resolve();
  }
  /* autoplay is blocked without a gesture: resume on the first click/keypress instead */
  function arm() {
    if (armed) return; armed = true;
    var go = function () { document.removeEventListener('pointerdown', go); document.removeEventListener('keydown', go); armed = false;
      if (state.playing && audio && audio.paused) audio.play().catch(function () {}); };
    document.addEventListener('pointerdown', go); document.addEventListener('keydown', go);
  }
  function play(id) {
    if (id && (!cur || cur.id !== id)) return get(id).then(function (rec) { if (rec) return load(rec, 0, true); });
    var a = el();
    if (!cur && state.id) return get(state.id).then(function (rec) { if (rec) return load(rec, state.pos, true); });
    return a.play().catch(function () { arm(); });
  }
  function toggle() { var a = el(); if (a.paused) return play(); a.pause(); return Promise.resolve(); }
  function stop() { if (audio) { audio.pause(); audio.removeAttribute('src'); } if (url) { URL.revokeObjectURL(url); url = null; } cur = null; }
  function seek(t) { var a = el(); try { a.currentTime = t; } catch (e) {} state.pos = t; save(); emit('time'); }
  function volume(v) { state.vol = Math.max(0, Math.min(1, v)); el().volume = state.vol; save(); emit(); }
  function step(dir, auto) {
    return list().then(function (rows) {
      if (!rows.length) return;
      var i = rows.findIndex(function (r) { return r.id === state.id; });
      var n;
      if (state.shuffle && rows.length > 1) { do { n = Math.floor(Math.random() * rows.length); } while (n === i); }
      else n = i < 0 ? 0 : i + dir;
      if (n >= rows.length) { if (auto && state.repeat !== 'all') { state.playing = false; save(); emit(); return; } n = 0; }
      if (n < 0) n = rows.length - 1;
      if (state.repeat === 'one' && auto) n = i;
      return load(rows[n], 0, true);
    });
  }
  function next(auto) { return step(1, auto); }
  function prev() { var a = el(); if (a.currentTime > 3) { seek(0); return Promise.resolve(); } return step(-1); }

  function now() {
    if (!owner && remote) return { track: remote.track || null, id: remote.id, pos: remote.pos || 0, dur: remote.dur || 0,
      playing: !!remote.playing, vol: remote.vol != null ? remote.vol : state.vol,
      shuffle: !!remote.shuffle, repeat: remote.repeat || state.repeat };
    return { track: cur, id: state.id, pos: audio ? audio.currentTime : state.pos, dur: cur ? (cur.dur || (audio ? audio.duration : 0)) : 0,
                            playing: !!(audio && !audio.paused), vol: state.vol, shuffle: state.shuffle, repeat: state.repeat }; }
  function setFlag(k, v) { state[k] = v; save(); emit(); }
  function usage() { if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate(); return Promise.resolve(null); }

  /* Restore the last track — but only in the one page that owns the sound.
     The others fetch just the title so the mini-player has something to show. */
  function metaOnly() {
    if (!state.id || owner) return;
    get(state.id).then(function (rec) {
      if (!rec || owner || remote) return;
      remote = { id: rec.id, pos: state.pos || 0, dur: rec.dur || 0, playing: false, vol: state.vol,
                 shuffle: state.shuffle, repeat: state.repeat,
                 track: { id: rec.id, title: rec.title, name: rec.name, artist: rec.artist, dur: rec.dur } };
      emit('track');
    }).catch(function () {});
  }
  function boot() {
    askOwner(function (ok) {
      if (!ok) return metaOnly();
      if (!state.id) return;
      var wasPlaying = state.playing;
      get(state.id).then(function (rec) {
        if (!rec || !owner) return;
        // one call, with autoplay decided up front — the old two-step (load, then
        // play) added a whole promise turn plus a second metadata wait
        return load(rec, state.pos || 0, wasPlaying);
      }).catch(function () {});
    });
  }
  /* The public API goes through the owner: on the playing page these run here,
     on any other page they travel over the channel. */
  window.ApexMusic = { list: list, add: add, remove: del, get: get, put: put,
    play: function (id) { return cmd('play', [id]); },
    toggle: function () { return cmd('toggle', []); },
    next: function () { return cmd('next', []); },
    prev: function () { return cmd('prev', []); },
    seek: function (t) { if (!owner && remote) { remote.pos = t; emit('time'); } return cmd('seek', [t]); },
    volume: function (v) { state.vol = Math.max(0, Math.min(1, v)); save(); return cmd('volume', [v]); },
    setFlag: function (k, v) { state[k] = v; save(); return cmd('flag', [k, v]); },
    owns: function () { return owner; },
    now: now, usage: usage, nameParts: nameParts };
  /* Boot immediately. Waiting for DOMContentLoaded meant every tab change left a
     hole in the music while the rest of the page parsed — none of this needs the
     DOM, so the fetch from IndexedDB starts on the first line instead. */
  boot();
})();
