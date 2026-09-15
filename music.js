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
    .then(function () { if (state.id === id) { stop(); state.id = null; state.pos = 0; save(); } emit(); }); }

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
      a.onerror = function () { done(0); };
      a.src = u; setTimeout(function () { done(isFinite(a.duration) ? a.duration : 0); }, 4000);
    });
  }
  /* add File objects (from a drop or a file input) */
  function add(files) {
    var arr = Array.prototype.slice.call(files || []).filter(function (f) { return /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm)$/i.test(f.name); });
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
    audio.preload = 'metadata'; audio.volume = state.vol;
    audio.addEventListener('timeupdate', function () { state.pos = audio.currentTime; if (Date.now() - saveT > 3000) { saveT = Date.now(); save(); } emit('time'); });
    audio.addEventListener('ended', function () { next(true); });
    audio.addEventListener('play', function () { state.playing = true; save(); emit(); });
    audio.addEventListener('pause', function () { state.playing = false; save(); emit(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
    window.addEventListener('beforeunload', save);
    return audio;
  }
  function save() { try { localStorage.setItem(SKEY, JSON.stringify({ id: state.id, pos: state.pos, playing: state.playing, vol: state.vol, shuffle: state.shuffle, repeat: state.repeat })); } catch (e) {} }
  function emit(kind) { try { window.dispatchEvent(new CustomEvent('apex-music', { detail: { kind: kind || 'state' } })); } catch (e) {} }

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
    a.src = url; a.currentTime = 0;
    a.onloadedmetadata = function () { try { a.currentTime = at || 0; } catch (e) {} };
    media(rec); save(); emit('track');
    if (autoplay) return a.play().catch(function () { arm(); });
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

  function now() { return { track: cur, id: state.id, pos: audio ? audio.currentTime : state.pos, dur: cur ? (cur.dur || (audio ? audio.duration : 0)) : 0,
                            playing: !!(audio && !audio.paused), vol: state.vol, shuffle: state.shuffle, repeat: state.repeat }; }
  function setFlag(k, v) { state[k] = v; save(); emit(); }
  function usage() { if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate(); return Promise.resolve(null); }

  /* restore the last track on every page, so playback follows you around the app */
  function boot() {
    if (!state.id) return;
    get(state.id).then(function (rec) { if (!rec) return; load(rec, state.pos || 0, false).then(function () { if (state.playing) play().catch(function () { arm(); }); }); }).catch(function () {});
  }
  window.ApexMusic = { list: list, add: add, remove: del, get: get, put: put, play: play, toggle: toggle, next: next, prev: prev,
                       seek: seek, volume: volume, now: now, setFlag: setFlag, usage: usage, nameParts: nameParts };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
