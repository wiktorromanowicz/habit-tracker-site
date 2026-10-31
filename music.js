/* Apex music — your own audio files, stored on this device, playable with no network.
   Files live in IndexedDB (localStorage is far too small for audio); playback state
   lives in localStorage so a track carries on across page loads.
   Nothing here talks to any server: the library never leaves the device. */
(function () {
  if (window.ApexMusic) return;
  var DB = 'apexMusic', STORE = 'tracks', SKEY = 'apexMusicState';
  var db = null, audio = null, cur = null, url = null, saveT = 0, armed = false, stopped = false;
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
    else if (m.k === 'trim' && owner) { applyTrim(m.id, m.end); }
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
  function applyTrim(id, end) {
    if (cur && cur.id === id) { if (end) cur.end = end; else delete cur.end; stopped = false; emit('track'); }
  }
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
  /* ---- how long is this file, really? ------------------------------------
     A plain <audio> element is not always right. The files that come out of
     Google's player are FRAGMENTED MP4s: the header carries no table of where
     the audio is (the samples live in 181 separate fragments), so WebKit has
     nothing to read and estimates instead — and estimates exactly double, which
     is how a 30-minute track arrived as an hour with a silent second half.
     The file itself always knows: mvhd/mdhd state the duration outright, and
     when those are zero the fragment index (sidx) or mehd add up. So we read
     the container ourselves and believe it over the browser. */
  function head(blob, off, n) { return blob.slice(off, off + n).arrayBuffer().then(function (b) { return new DataView(b); }); }
  function fourcc(dv, i) { return String.fromCharCode(dv.getUint8(i), dv.getUint8(i + 1), dv.getUint8(i + 2), dv.getUint8(i + 3)); }
  /* walk the top-level boxes without reading the file: 16 bytes per box */
  function topBoxes(blob) {
    var found = {}, off = 0, guard = 0;
    function step() {
      if (off + 8 > blob.size || guard++ > 4000) return Promise.resolve(found);
      return head(blob, off, 16).then(function (dv) {
        if (dv.byteLength < 8) return found;
        var size = dv.getUint32(0), type = fourcc(dv, 4);
        if (size === 1) { if (dv.byteLength < 16) return found; size = Number(dv.getBigUint64(8)); }
        else if (size === 0) size = blob.size - off;
        if (size < 8) return found;
        if (!found[type]) found[type] = { off: off, size: size };
        off += size;
        if (found.moov && found.sidx) return found;     // everything we might need
        return step();
      }).catch(function () { return found; });
    }
    return step();
  }
  function mp4Seconds(blob) {
    if (!blob || !blob.slice || !blob.arrayBuffer) return Promise.resolve(0);
    return topBoxes(blob).then(function (b) {
      if (!b.moov) return 0;
      return blob.slice(b.moov.off, b.moov.off + Math.min(b.moov.size, 4 << 20)).arrayBuffer().then(function (buf) {
        var dv = new DataView(buf), best = 0;
        /* the moov is small; a flat scan for the headers we want is simpler and
           safer than a full tree walk, and a stray match cannot survive the
           sanity checks below */
        for (var i = 4; i + 32 < dv.byteLength; i++) {
          var t = fourcc(dv, i);
          if (t !== 'mvhd' && t !== 'mdhd' && t !== 'mehd') continue;
          var p = i + 4, ver = dv.getUint8(p), ts = 0, du = 0;
          try {
            if (t === 'mehd') { ts = 0; du = ver === 1 ? Number(dv.getBigUint64(p + 4)) : dv.getUint32(p + 4); }
            else if (ver === 1) { ts = dv.getUint32(p + 20); du = Number(dv.getBigUint64(p + 24)); }
            else { ts = dv.getUint32(p + 12); du = dv.getUint32(p + 16); }
          } catch (e) { continue; }
          if (t === 'mehd') continue;                   // needs the movie timescale; mvhd below covers it
          if (!ts || ts > 1e7 || !du || du === 0xFFFFFFFF) continue;
          var secs = du / ts;
          if (secs > 0.5 && secs < 24 * 3600 && secs > best) best = secs;
        }
        if (best) return best;
        return b.sidx ? sidxSeconds(blob, b.sidx) : 0;
      });
    }).catch(function () { return 0; });
  }
  /* no usable header duration: add up the segment index instead */
  function sidxSeconds(blob, box) {
    return blob.slice(box.off, box.off + Math.min(box.size, 1 << 20)).arrayBuffer().then(function (buf) {
      var dv = new DataView(buf), ver = dv.getUint8(8), p = 12;
      var ts = dv.getUint32(p + 4); p += 8;
      p += ver === 0 ? 8 : 16;
      p += 2;
      var n = dv.getUint16(p); p += 2, total = 0;
      for (var i = 0; i < n && p + 12 <= dv.byteLength; i++, p += 12) total += dv.getUint32(p + 4);
      return ts && total ? total / ts : 0;
    }).catch(function () { return 0; });
  }
  var MP4ISH = /\.(mp4|m4a|m4b|m4v|mov|aac)$/i;
  /* the length to store, and the point playback should stop at */
  function measure(file) {
    var isMp4 = /mp4|m4a|quicktime|x-m4a/.test(file.type || '') || MP4ISH.test(file.name || '');
    return Promise.all([duration(file), isMp4 ? mp4Seconds(file) : Promise.resolve(0)]).then(function (r) {
      var heard = r[0], real = r[1];
      if (!real) return { dur: heard, end: 0 };
      // the browser thinks the file is longer than it is: stop where it really ends
      var end = (heard && heard > real * 1.05) ? real : 0;
      return { dur: real, end: end };
    });
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
        return measure(f).then(function (m) {
          var p = nameParts(f.name);
          var rec = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: f.name,
                      title: p.title, artist: p.artist, type: f.type || 'audio/mpeg', size: f.size, dur: m.dur, added: Date.now(), blob: f };
          if (m.end) rec.end = m.end;        // the browser over-reads this file: stop where it really ends
          return put(rec).then(function () { acc.push(rec); return acc; });
        });
      });
    }, Promise.resolve([])).then(function (added) { emit(); return added; });
  }

  function el() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.preload = 'auto'; audio.volume = state.vol;   // 'metadata' made every resume decode twice
    audio.addEventListener('timeupdate', function () {
      if (suspend) return;
      /* a track can declare its own end — a file with half an hour of silence
         glued to it (or a long intro you never want) ends where you said */
      if (cur && cur.end && audio.currentTime >= cur.end - 0.05) {
        if (!stopped) { stopped = true; next(true); }
        return;
      }
      state.pos = audio.currentTime; if (Date.now() - saveT > 900) { saveT = Date.now(); save(); } emit('time'); });
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
  function save() { try { localStorage.setItem(SKEY, JSON.stringify({ id: state.id, pos: state.pos, playing: state.playing, vol: state.vol, shuffle: state.shuffle, repeat: state.repeat, at: Date.now() })); } catch (e) {} }
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
    cur = rec; state.id = rec.id; state.pos = at || 0; stopped = false;
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
  /* Autoplay blocked mid-session: resume on the first click instead. Only ever
     armed by a play we initiated — never by a cold start, or the first thing you
     clicked in the morning would begin playing music. */
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
      /* Looping one song has to be decided BEFORE the end-of-list check, or the
         last track (and a library of one) stopped instead of repeating — which
         is exactly the case where you want a loop. */
      if (auto && state.repeat === 'one') return load(rows[i < 0 ? 0 : i], 0, true);
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
  /* Did this page open from another Apex page, or is this the app starting up?
     Only the first should carry the music over. A tab change throws the <audio>
     away and rebuilds it, so playback has to resume by itself — but opening
     Apex in the morning must never start playing something on its own, which is
     what "it just turns on the music" was. A referrer only exists when one page
     led to another; a cold launch has none. */
  function cameFromApex() {
    try {
      var r = document.referrer;
      if (!r) return false;
      return new URL(r, location.href).origin === location.origin;
    } catch (e) { return false; }
  }
  function boot() {
    askOwner(function (ok) {
      if (!ok) return metaOnly();
      if (!state.id) return;
      // …and the state has to be seconds old, not left over from last night
      var carry = state.playing && cameFromApex() && (Date.now() - (state.at || 0) < 90000);
      if (state.playing && !carry) { state.playing = false; save(); }   // show it paused, because it is
      get(state.id).then(function (rec) {
        if (!rec || !owner) return;
        // one call, with autoplay decided up front — the old two-step (load, then
        // play) added a whole promise turn plus a second metadata wait
        return load(rec, state.pos || 0, carry);
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
    setFlag: function (k, v) { state[k] = v; save();
      if (!owner && remote) remote[k] = v;          // so the button lights up at once, not on the next broadcast
      return cmd('flag', [k, v]); },
    owns: function () { return owner; },
    /* Go back over the library and re-read each file's own header. Anything
       stored from a container the browser mis-read (a fragmented MP4 reported at
       twice its length) is corrected in place, and given an end point so it
       stops where the audio does. Runs once per page load; cheap, because it
       reads headers, not audio. */
    heal: function () {
      return list().then(function (rows) {
        return rows.reduce(function (chain, rec) {
          return chain.then(function (fixed) {
            if (!rec.blob) return fixed;
            return mp4Seconds(rec.blob).then(function (real) {
              var was = rec.dur || 0;
              if (!real || Math.abs(was - real) <= Math.max(2, real * 0.02)) return fixed;
              rec.dur = real;
              // it was being read as longer than it is: stop where the audio does
              if (was > real * 1.05) rec.end = real;
              fixed.push({ name: rec.title || rec.name, was: was, now: real });
              // only rewrite a record we actually changed — these hold the audio itself
              return put(rec).then(function () { return fixed; });
            }).catch(function () { return fixed; });
          });
        }, Promise.resolve([])).then(function (fixed) {
          if (fixed.length) { if (cur) { var c = cur.id; get(c).then(function (r) { if (r && cur && cur.id === c) { cur.dur = r.dur; if (r.end) cur.end = r.end; emit('track'); } }); } emit(); }
          return fixed;
        });
      });
    },
    /* end a track early (or put it back): seconds, or 0 to use the whole file */
    trim: function (id, end) {
      return get(id).then(function (rec) {
        if (!rec) return null;
        if (end) rec.end = Math.max(1, end); else delete rec.end;
        return put(rec).then(function () {
          if (owner) applyTrim(id, end); else post({ k: 'trim', id: id, end: end || 0 });
          emit('track'); return rec;
        });
      });
    },
    now: now, usage: usage, nameParts: nameParts };
  /* Boot immediately. Waiting for DOMContentLoaded meant every tab change left a
     hole in the music while the rest of the page parsed — none of this needs the
     DOM, so the fetch from IndexedDB starts on the first line instead. */
  boot();
})();
