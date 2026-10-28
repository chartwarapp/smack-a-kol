/* =========================================================================
 * WebAudio synth + recorded SFX bank (slap sounds in assets/sfx/).
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Audio = (function () {
  let ctx = null, master = null, noiseBuf = null;
  // Admin sound controls (LT 2026-10-13) — defined early so all functions can use it
  const soundCfg = {
    master: 0.5, slap: 1.0, crowd: 1.0, react: 1.0,
    reactOn: true, defeatOn: true, commentary: 1.0,
  };
  try {
    const saved = JSON.parse(localStorage.getItem('sak_sound_cfg') || '{}');
    Object.assign(soundCfg, saved);
  } catch (e) {}
  function saveSoundCfg() {
    try { localStorage.setItem('sak_sound_cfg', JSON.stringify(soundCfg)); } catch (e) {}
    if (master) master.gain.value = soundCfg.master;
  }

  /* ---- Custom sound overrides (LT 2026-10-14): upload your own recordings
     via the admin panel. Stored in IndexedDB as blobs, checked before the
     default files on every load. ---- */
  const CUSTOM_DB = 'sak_custom_sounds', CUSTOM_STORE = 'sounds';
  let customDb = null, customIds = [];
  try { customIds = JSON.parse(localStorage.getItem('sak_custom_ids') || '[]'); } catch (e) {}
  function openCustomDb() {
    return new Promise((resolve) => {
      if (customDb) return resolve(customDb);
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open(CUSTOM_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(CUSTOM_STORE);
      req.onsuccess = () => { customDb = req.result; resolve(customDb); };
      req.onerror = () => resolve(null);
    });
  }
  async function getCustomSound(id) {
    const db = await openCustomDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(CUSTOM_STORE, 'readonly');
      const req = tx.objectStore(CUSTOM_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  async function loadCustomInto(id, targetBufs) {
    const blob = await getCustomSound(id);
    if (!blob || !ctx) return false;
    try {
      const ab = await blob.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab);
      targetBufs[id] = buf;
      return true;
    } catch (e) { return false; }
  }

  /* ---- Real recorded slap SFX bank (Pixabay Content License — free for use) ---- */
  const CROWD_BANK = [
    { id: 'cheer1', file: 'assets/sfx/crowd_crowd1.mp3' },
    { id: 'cheer2', file: 'assets/sfx/crowd_crowd2.mp3' },
    { id: 'victory', file: 'assets/sfx/crowd_victory.mp3' },
    { id: 'bell', file: 'assets/sfx/bell_boxing.mp3' },
    { id: 'defeat_dizzy', file: 'assets/sfx/defeat_dizzy.mp3' },
    { id: 'defeat_trombone', file: 'assets/sfx/defeat_trombone.mp3' },
    { id: 'react_boing', file: 'assets/sfx/react_boing.mp3' },
  ];
  const crowdBufs = {};
  function loadCrowdBank() {
    if (!ctx) return;
    CROWD_BANK.forEach(b => {
      // Custom override wins; fall back to the bundled file
      loadCustomInto(b.id, crowdBufs).then(ok => {
        if (ok) return;
        fetch(b.file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
          .then(ab => ctx.decodeAudioData(ab))
          .then(buf => { crowdBufs[b.id] = buf; })
          .catch(() => { /* silent */ });
      });
    });
  }
  function playCrowdBuf(id, gain, when) {
    const buf = crowdBufs[id];
    if (!buf || !ctx) return false;
    const t = ctx.currentTime + (when || 0);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain || 0.5, t);
    src.connect(g); g.connect(master);
    src.start(t);
    return true;
  }
  // Play the real victory cheer recording only — no synth fallback.
  // Waits for the buffer to load (up to 3s), then plays. Silent if it never loads.
  function playRealCheer() {
    if (!ready()) return;
    if (crowdBufs['victory']) {
      playCrowdBuf('victory', 0.6);
      return;
    }
    // Not loaded yet — fetch it now and play when ready
    fetch('assets/sfx/crowd_victory.mp3')
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => {
        crowdBufs['victory'] = buf;
        playCrowdBuf('victory', 0.6);
      })
      .catch(() => { /* silent — no synth fallback */ });
  }
  const SLAP_BANK = [
    { id: 'crack',  name: '🦴 Bone Crack',   file: 'assets/sfx/slap-crack.mp3' },
    { id: 'smack',  name: '👋 Heavy Smack',  file: 'assets/sfx/slap-smack.mp3' },
    { id: 'face',   name: '😲 Face Classic',  file: 'assets/sfx/slap-face.mp3' },
    { id: 'cinema', name: '🎬 Cinematic',    file: 'assets/sfx/slap-cinema.mp3' },
    { id: 'monster', name: '👹 Monster Slap', file: 'assets/sfx/slap_monster.mp3' },
    { id: 'heavy',  name: '💪 Heavy Double', file: 'assets/sfx/slap_heavy.mp3' },
    { id: 'crack2', name: '⚡ Crack Layer',  file: 'assets/sfx/slap_crack.mp3' },
    { id: 'clean',  name: '✨ Clean Slap',   file: 'assets/sfx/slap_clean.mp3' },
  ];
  const slapBufs = {};   // id -> AudioBuffer
  let slapLoading = false;

  function slapStyle() {
    const s = (SAK.Storage.state.settings.slapSound || 'crack');
    return SLAP_BANK.some(b => b.id === s) ? s : 'crack';
  }

  // Preload + decode all slap files once the context exists. Silent failure
  // falls back to the synth slap below.
  let customSlapBuf = null;
  function loadSlapBank() {
    if (slapLoading || !ctx) return;
    slapLoading = true;
    loadCrowdBank();
    loadCommentaryBank();
    loadOpeningBank();
    // A custom slap replaces the entire random bank with the one upload
    loadCustomInto('slap', {}).then(ok => {
      if (ok) getCustomSound('slap').then(async (blob) => {
        try { customSlapBuf = await ctx.decodeAudioData(await blob.arrayBuffer()); } catch (e) {}
      });
    });
    SLAP_BANK.forEach(b => {
      fetch(b.file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { slapBufs[b.id] = buf; })
        .catch(() => { /* keep synth fallback */ });
    });
  }

  /* ---- Synth slap layers: every hit is full — crack on top, thump under, body middle ---- */
  function synthLayer(type, opts) {
    const t = ctx.currentTime + (opts.when || 0);
    const s = opts.strength || 1;
    if (type === 'boom') {
      // Deep sub drop — the weight you feel
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(opts.from || 120, t);
      o.frequency.exponentialRampToValueAtTime(opts.to || 35, t + opts.dur);
      g.gain.setValueAtTime(opts.gain * s, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + opts.dur + 0.05);
    } else {
      // Noise burst — crack / snap / body
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = opts.ftype || 'bandpass'; f.frequency.value = opts.freq; f.Q.value = opts.q || 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(opts.gain * s, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + opts.dur + 0.05);
    }
  }

  // 💥 Thunder Clap — deep flesh impact, no chime
  function synthThunder(strength) {
    // Low thump: filtered noise burst, not sine — punchy, not ringy
    synthLayer('noise', { freq: 150, q: 0.5, dur: 0.25, gain: 0.8, ftype: 'lowpass', strength });
    synthLayer('noise', { freq: 2600, q: 0.7, dur: 0.09, gain: 0.6, ftype: 'bandpass', strength });
    synthLayer('noise', { freq: 750, q: 0.8, dur: 0.18, gain: 0.45, ftype: 'lowpass', strength });
    synthLayer('noise', { freq: 4200, q: 1.2, dur: 0.05, gain: 0.35, ftype: 'highpass', when: 0.01, strength });
    // Flesh smack: mid-range body
    synthLayer('noise', { freq: 1800, q: 1.5, dur: 0.07, gain: 0.5, ftype: 'bandpass', when: 0.005, strength });
  }
  // ⚡ Whip Crack — razor snap, organic
  function synthWhip(strength) {
    synthLayer('noise', { freq: 5200, q: 1.0, dur: 0.045, gain: 0.7, ftype: 'highpass', strength });
    synthLayer('noise', { freq: 180, q: 0.6, dur: 0.12, gain: 0.5, ftype: 'lowpass', strength });
    synthLayer('noise', { freq: 1300, q: 0.9, dur: 0.11, gain: 0.38, ftype: 'bandpass', strength });
    synthLayer('noise', { freq: 2800, q: 2.0, dur: 0.04, gain: 0.45, ftype: 'bandpass', when: 0.003, strength });
  }
  // 🔨 Sledge — massive impact, all flesh
  function synthSledge(strength) {
    synthLayer('noise', { freq: 120, q: 0.5, dur: 0.3, gain: 0.85, ftype: 'lowpass', strength });
    synthLayer('noise', { freq: 480, q: 0.7, dur: 0.22, gain: 0.5, ftype: 'lowpass', strength });
    synthLayer('noise', { freq: 3100, q: 0.8, dur: 0.06, gain: 0.42, ftype: 'bandpass', strength });
    synthLayer('noise', { freq: 900, q: 1.2, dur: 0.1, gain: 0.4, ftype: 'bandpass', when: 0.01, strength });
  }

  const SYNTH_SLAPS = { thunder: synthThunder, whip: synthWhip, sledge: synthSledge };

  // Slap rotation pool: real recordings only — no synth, no chimes.
  const SLAP_POOL = ['monster', 'heavy', 'crack2', 'smack', 'cinema', 'face', 'clean'];

  function playSlapBuf(strength) {
    // Custom uploaded slap replaces the whole bank
    if (customSlapBuf && ctx) {
      const src = ctx.createBufferSource(); src.buffer = customSlapBuf;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      const g = ctx.createGain(); g.gain.value = 0.9 * soundCfg.slap;
      src.connect(g); g.connect(master); src.start();
      return true;
    }
    const pick = SLAP_POOL[Math.floor(Math.random() * SLAP_POOL.length)];
    // Synth slaps first (always available, always full)
    if (SYNTH_SLAPS[pick]) { SYNTH_SLAPS[pick](strength); return true; }
    const buf = slapBufs[pick];
    if (!buf) return false;
    const src = ctx.createBufferSource(); src.buffer = buf;
    // Slight random pitch each hit so repeated slaps never sound identical
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = ctx.createGain();
    const s = Math.min(1.5, strength || 1);
    g.gain.value = 0.9 * Math.max(0.35, s);
    src.connect(g); g.connect(master);
    src.start();
    // Layer a flesh thump under every recorded slap so nothing sounds empty
    // (noise-based lowpass, not sine — keeps it organic)
    synthLayer('noise', { freq: 140, q: 0.5, dur: 0.22, gain: 0.45, ftype: 'lowpass', strength: s });
    return true;
  }

  function enabled() { return SAK.Storage.state.settings.sound; }

  // Must be called from a user gesture (browser autoplay policy).
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); loadSlapBank(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = soundCfg.master; // apply saved admin volume
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    loadSlapBank();
  }

  function ready() { return ctx && enabled(); }

  function noise(dur, freq, q, gain, type) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
    return f;
  }

  function tone(freq, dur, type, gain, when, slideTo) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    const t = ctx.currentTime + (when || 0);
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---- Battle music: synth hype loop (kick/hat/bass), toggled in settings ---- */
  let musicTimer = null, musicStep = 0;
  function musicEnabled() { return SAK.Storage.state.settings.battleMusic; }

  function musicTick() {
    if (!ctx || !musicEnabled() || !enabled()) return;
    const t = ctx.currentTime;
    const step = musicStep % 16;
    // Kick on quarters
    if (step % 4 === 0) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
    }
    // Hats on off-beats
    if (step % 2 === 1) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 0.08);
    }
    // Degen bassline (minor-key pump)
    const bassNotes = [55, 55, 65.4, 49, 55, 55, 73.4, 65.4];
    if (step % 2 === 0) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = bassNotes[(step / 2) | 0];
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
    }
    musicStep++;
  }

  let bgmSrc = null, bgmGain = null;
  function startMusic() {
    if (!ctx || bgmSrc) return;
    // Play the trap BGM on loop
    fetch('assets/sfx/bgm_trap.mp3')
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => {
        if (bgmSrc) return; // already started
        bgmSrc = ctx.createBufferSource();
        bgmSrc.buffer = buf; bgmSrc.loop = true;
        bgmGain = ctx.createGain(); bgmGain.gain.value = 0.35;
        bgmSrc.connect(bgmGain); bgmGain.connect(master);
        bgmSrc.start();
      })
      .catch(() => { /* silent if BGM fails to load */ });
  }
  function stopMusic() {
    if (bgmSrc) { try { bgmSrc.stop(); } catch (e) {} bgmSrc = null; bgmGain = null; }
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  // 🎉 Crowd sounds — synthesized with layered filtered noise (no chimes)
  function crowdLayer(opts) {
    // Crowd = broadband voices: bandpass noise with slow amplitude swell
    const t = ctx.currentTime + (opts.when || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = opts.freq; f.Q.value = opts.q || 0.6;
    const g = ctx.createGain();
    const peak = opts.gain * (opts.strength || 1);
    // Swell up fast, decay slow — like a crowd erupting
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack || 0.08));
    g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + opts.dur + 0.1);
  }
  // Crowd gasp + cheer on slap impact — real recordings, intensity scales volume
  function crowdSlap(intensity) {
    if (!ready()) return;
    const s = Math.min(1.5, intensity || 1);
    const id = Math.random() < 0.5 ? 'cheer1' : 'cheer2';
    // Play a short slice of the cheer (first 1.5s has the eruption)
    const buf = crowdBufs[id];
    if (buf && ctx) {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.45 * s, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
      src.connect(g); g.connect(master);
      src.start(t, Math.random() * 5, 1.6); // random offset into the 22s file
    } else {
      // Synth fallback
      crowdLayer({ freq: 1200, q: 0.5, dur: 0.8, gain: 0.4, attack: 0.08, strength: s });
    }
  }
  // Victory: full crowd eruption — real recording
  function crowdWin() {
    if (!ready()) return;
    if (!playCrowdBuf('victory', 0.6)) {
      crowdLayer({ freq: 1200, q: 0.4, dur: 2.5, gain: 0.5, attack: 0.12, strength: 1.3 });
    }
  }
  // Defeat: random funny KO sound (real recordings, never synthesized)
  // LT 2026-10-24: silly boom removed from the defeat rotation (trombone kept)
  const DEFEAT_SOUNDS = ['defeat_dizzy', 'defeat_trombone'];
  function crowdLose() {
    if (!ready() || !soundCfg.defeatOn) return;
    const pick = DEFEAT_SOUNDS[Math.floor(Math.random() * DEFEAT_SOUNDS.length)];
    if (!playCrowdBuf(pick, 0.7)) {
      // Fallback: fetch and play if not yet loaded
      const entry = CROWD_BANK.find(b => b.id === pick);
      if (entry) fetch(entry.file).then(r => r.arrayBuffer())
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { crowdBufs[pick] = buf; playCrowdBuf(pick, 0.7); })
        .catch(() => {});
    }
  }

  /* ---- Smack King live commentary (LT 2026-10-27, lines 1-24) ----
     LT-requested AI announcer voice lines, played on landed slaps,
     LAYERED over the real slap SFX (never replacing them). These are
     separate from the real-recording slap/crowd bar: if a line isn't
     loaded, stay silent — no synth fallback. Later batches (7-24) slot
     in by adding entries to COMMENTARY_BANK. ---- */
  const COMMENTARY_BANK = [
    { id: 'smackking-01', file: 'assets/sfx/smackking-01.mp3' }, // Slapped the coins right out of his mouth!
    { id: 'smackking-02', file: 'assets/sfx/smackking-02.mp3' }, // Ouch... that was hard!
    { id: 'smackking-03', file: 'assets/sfx/smackking-03.mp3' }, // Damn, that hurt like getting drained!
    { id: 'smackking-04', file: 'assets/sfx/smackking-04.mp3' }, // That slap sent his portfolio to zero!
    { id: 'smackking-05', file: 'assets/sfx/smackking-05.mp3' }, // He felt that one in his seed phrase!
    { id: 'smackking-06', file: 'assets/sfx/smackking-06.mp3' }, // Slapped so hard his wallet disconnected!
    { id: 'smackking-07', file: 'assets/sfx/smackking-07.mp3' }, // Liquidity exited!
    { id: 'smackking-08', file: 'assets/sfx/smackking-08.mp3' }, // He just got rugged by a right hand!
    { id: 'smackking-09', file: 'assets/sfx/smackking-09.mp3' }, // That hand came out of nowhere — just like a rug pull!
    { id: 'smackking-10', file: 'assets/sfx/smackking-10.mp3' }, // Exit liquidity? More like exit consciousness!
    { id: 'smackking-11', file: 'assets/sfx/smackking-11.mp3' }, // He bought the top and got slapped to the bottom!
    { id: 'smackking-12', file: 'assets/sfx/smackking-12.mp3' }, // He got dumped on — literally!
    { id: 'smackking-13', file: 'assets/sfx/smackking-13.mp3' }, // Down he goes — liquidated by a slap!
    { id: 'smackking-14', file: 'assets/sfx/smackking-14.mp3' }, // That was not a slap, that was a margin call!
    { id: 'smackking-15', file: 'assets/sfx/smackking-15.mp3' }, // His chart just crashed — and so did he!
    { id: 'smackking-16', file: 'assets/sfx/smackking-16.mp3' }, // He's seeing red candles now!
    { id: 'smackking-17', file: 'assets/sfx/smackking-17.mp3' }, // Slap of the century! Somebody check his holdings!
    { id: 'smackking-18', file: 'assets/sfx/smackking-18.mp3' }, // He talked a big game, now he's eating canvas!
    { id: 'smackking-19', file: 'assets/sfx/smackking-19.mp3' }, // That's what happens when you shill and don't deliver!
    { id: 'smackking-20', file: 'assets/sfx/smackking-20.mp3' }, // He's wobbling like a memecoin on launch day!
    { id: 'smackking-21', file: 'assets/sfx/smackking-21.mp3' }, // That slap had more impact than his last launch!
    { id: 'smackking-22', file: 'assets/sfx/smackking-22.mp3' }, // No crying in the casino — but he's crying now!
    { id: 'smackking-23', file: 'assets/sfx/smackking-23.mp3' }, // Call the medics — and his broker!
    { id: 'smackking-24', file: 'assets/sfx/smackking-24.mp3' }, // And the crowd goes wild — that's payback!
  ];
  const commentaryBufs = {};
  let commentarySrc = null, commentaryLoading = false, lastCommentaryIdx = -1;
  function loadCommentaryBank() {
    if (!ctx) return;
    COMMENTARY_BANK.forEach(b => {
      fetch(b.file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { commentaryBufs[b.id] = buf; })
        .catch(() => { /* silent — a missing line just never plays */ });
    });
  }
  // One line per landed slap, random (never the same line twice in a row),
  // never overlapping another line. Base gain 0.8 sits just under the slap
  // crack (~0.9) and above the crowd swell (~0.45), times the commentary
  // volume slider (soundCfg.commentary, 0-1.5, admin SOUND EFFECTS);
  // +0.08s delay lets the crack hit first.
  function playCommentary() {
    if (!ready() || commentarySrc || commentaryLoading) return;
    let idx = Math.floor(Math.random() * COMMENTARY_BANK.length);
    if (COMMENTARY_BANK.length > 1 && idx === lastCommentaryIdx) idx = (idx + 1) % COMMENTARY_BANK.length;
    const entry = COMMENTARY_BANK[idx];
    const buf = commentaryBufs[entry.id];
    if (!buf) {
      // Not preloaded yet — fetch on demand, play only if nothing started since.
      commentaryLoading = true;
      fetch(entry.file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(ab => ctx.decodeAudioData(ab))
        .then(b => {
          commentaryBufs[entry.id] = b;
          commentaryLoading = false;
          if (!commentarySrc) playCommentaryBuf(entry.id);
        })
        .catch(() => { commentaryLoading = false; });
      return;
    }
    playCommentaryBuf(entry.id);
  }
  function playCommentaryBuf(id) {
    const buf = commentaryBufs[id];
    if (!buf || !ctx || commentarySrc) return;
    const idx = COMMENTARY_BANK.findIndex(b => b.id === id);
    if (idx >= 0) lastCommentaryIdx = idx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.8 * soundCfg.commentary;
    src.connect(g); g.connect(master);
    commentarySrc = src;
    src.onended = () => { if (commentarySrc === src) commentarySrc = null; };
    src.start(ctx.currentTime + 0.08);
  }

  /* ---- Smack King fight-opening lines (LT 2026-10-27) ----
     SEPARATE bank from the slap COMMENTARY_BANK — one line per fight,
     played at the very start of a fight before the ROUND 1 card, never
     mixed into the slap rotation. Same conventions: respects the sound
     toggle, silent on load failure, no synth fallback. ---- */
  const OPENING_BANK = [
    { id: 'smackking-open-01', file: 'assets/sfx/smackking-open-01.mp3' }, // Prepare to Smack a K-O-L!
    { id: 'smackking-open-02', file: 'assets/sfx/smackking-open-02.mp3' }, // Get your Hand ready!
    { id: 'smackking-open-03', file: 'assets/sfx/smackking-open-03.mp3' }, // The Slap off is starting!
    { id: 'smackking-open-04', file: 'assets/sfx/smackking-open-04.mp3' }, // Let's see who really larping!
    { id: 'smackking-open-05', file: 'assets/sfx/smackking-open-05.mp3' }, // Someone is about to get rugged!
    { id: 'smackking-open-06', file: 'assets/sfx/smackking-open-06.mp3' }, // Who is gonna drain the liquidity!
  ];
  const openingBufs = {};
  let lastOpeningIdx = -1;
  function loadOpeningBank() {
    if (!ctx) return;
    OPENING_BANK.forEach(b => {
      fetch(b.file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { openingBufs[b.id] = buf; })
        .catch(() => { /* silent — a missing line just never plays */ });
    });
  }
  // One line per fight, random (never the same line two fights in a row).
  // Returns a promise resolving when the line ends — the fight intro
  // awaits it, so the line plays BEFORE the bell + ROUND 1 card and never
  // clashes with the bell. Resolves immediately when sound is off, the
  // commentary slider is at 0, or the line fails to load (silent, no
  // synth fallback, no dead air). A duration + 1s safety timeout guards
  // against a hung intro if onended never fires.
  function playOpening() {
    if (!ready() || soundCfg.commentary <= 0) return Promise.resolve();
    let idx = Math.floor(Math.random() * OPENING_BANK.length);
    if (OPENING_BANK.length > 1 && idx === lastOpeningIdx) idx = (idx + 1) % OPENING_BANK.length;
    const entry = OPENING_BANK[idx];
    const buf = openingBufs[entry.id];
    const play = (b) => new Promise((resolve) => {
      lastOpeningIdx = idx;
      const src = ctx.createBufferSource(); src.buffer = b;
      const g = ctx.createGain(); g.gain.value = 0.8 * soundCfg.commentary;
      src.connect(g); g.connect(master);
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      src.onended = fin;
      setTimeout(fin, (b.duration + 1) * 1000);
      src.start();
    });
    if (buf) return play(buf);
    return fetch(entry.file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(ab => ctx.decodeAudioData(ab))
      .then(b => { openingBufs[entry.id] = b; return play(b); })
      .catch(() => { /* silent */ });
  }

  // Funny cartoon reaction on every face slap — random pick, layered OVER the hand slap (never replaces it)
  // LT 2026-10-27: whistle layers cancelled, boing only
  function playSlapReact() {
    const reacts = ['react_boing'];
    const pick = reacts[Math.floor(Math.random() * reacts.length)];
    const buf = crowdBufs[pick] || slapBufs[pick];
    if (!buf) {
      const entry = CROWD_BANK.find(b => b.id === pick);
      if (entry) fetch(entry.file).then(r => r.arrayBuffer())
        .then(ab => ctx.decodeAudioData(ab))
        .then(b => { crowdBufs[pick] = b; playSlapReact(); })
        .catch(() => {});
      return;
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    const g = ctx.createGain(); g.gain.value = 0.45 * soundCfg.react;
    src.connect(g); g.connect(master);
    src.start(ctx.currentTime + 0.05); // slight delay so the slap crack hits first
  }

  return {
    unlock,
    SLAP_BANK,
    soundCfg, saveSoundCfg,
    // Custom sound uploads
    async setCustomSound(id, file) {
      const db = await openCustomDb();
      if (!db || !file) return false;
      // Validate it's decodable audio before storing
      try {
        const ab = await file.arrayBuffer();
        await ctx.decodeAudioData(ab.slice(0));
      } catch (e) { return false; }
      return new Promise((resolve) => {
        const tx = db.transaction(CUSTOM_STORE, 'readwrite');
        tx.objectStore(CUSTOM_STORE).put(file, id);
        tx.oncomplete = () => {
          if (!customIds.includes(id)) {
            customIds.push(id);
            try { localStorage.setItem('sak_custom_ids', JSON.stringify(customIds)); } catch (e) {}
          }
          // Hot-swap into the live buffers so it takes effect immediately
          loadCustomInto(id, id === 'slap' ? {} : crowdBufs).then(() => {
            if (id === 'slap') getCustomSound('slap').then(async (blob) => {
              try { customSlapBuf = await ctx.decodeAudioData(await blob.arrayBuffer()); } catch (e) {}
            });
          });
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      });
    },
    async clearCustomSound(id) {
      const db = await openCustomDb();
      if (!db) return;
      return new Promise((resolve) => {
        const tx = db.transaction(CUSTOM_STORE, 'readwrite');
        tx.objectStore(CUSTOM_STORE).delete(id);
        tx.oncomplete = () => {
          customIds = customIds.filter(x => x !== id);
          try { localStorage.setItem('sak_custom_ids', JSON.stringify(customIds)); } catch (e) {}
          if (id === 'slap') customSlapBuf = null;
          else delete crowdBufs[id];
          // Reload the default file for this sound
          if (id !== 'slap') {
            const entry = CROWD_BANK.find(b => b.id === id);
            if (entry && ctx) fetch(entry.file).then(r => r.arrayBuffer())
              .then(ab => ctx.decodeAudioData(ab))
              .then(buf => { crowdBufs[id] = buf; }).catch(() => {});
          } else { slapLoading = false; loadSlapBank(); }
          resolve();
        };
        tx.onerror = () => resolve();
      });
    },
    hasCustomSound(id) { return customIds.includes(id); },
    slapStyle,
    /** Preview a bank sound in Settings (bypasses nothing — respects sound toggle). */
    previewSlap(id) {
      if (!ready()) return;
      const buf = slapBufs[id] || crowdBufs[id];
      if (!buf) {
        // Try to load it first
        const entry = CROWD_BANK.find(b => b.id === id) || SLAP_BANK.find(b => b.id === id);
        if (entry) fetch(entry.file).then(r => r.arrayBuffer())
          .then(ab => ctx.decodeAudioData(ab))
          .then(b => { crowdBufs[id] = b; SAK.Audio.previewSlap(id); })
          .catch(() => {});
        return;
      }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(master); src.start();
    },
    startMusic,
    stopMusic,
    unlock,
    SLAP_BANK,
    slapStyle,
    previewSlap(id) {
      if (!ready()) return;
      const buf = slapBufs[id] || crowdBufs[id];
      if (!buf) {
        // Try to load it first
        const entry = CROWD_BANK.find(b => b.id === id) || SLAP_BANK.find(b => b.id === id);
        if (entry) fetch(entry.file).then(r => r.arrayBuffer())
          .then(ab => ctx.decodeAudioData(ab))
          .then(b => { crowdBufs[id] = b; SAK.Audio.previewSlap(id); })
          .catch(() => {});
        return;
      }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(master); src.start();
    },
    startMusic,
    stopMusic,
    slap(strength) {          // strength 0..1+
      if (!ready()) return;
      crowdSlap(strength * soundCfg.crowd);  // crowd gasps/cheers on every slap
      if (soundCfg.reactOn) playSlapReact();      // funny cartoon reaction, layered over the slap
      playCommentary();                            // Smack King line, layered over the slap, never overlapping another line
      if (playSlapBuf(strength)) return;   // real recorded slap
      // synth fallback (bank not loaded yet / fetch failed) — noise only, no tones
      const s = Math.min(1.5, strength);
      noise(0.12 + 0.08 * s, 2200, 0.8, 0.9 * Math.max(0.3, s));
      noise(0.05, 5000, 1.2, 0.5);
      noise(0.15, 180, 0.6, 0.5 * s, 'lowpass');
    },
    whoosh() {
      if (!ready()) return;
      // Sword-swing: aggressive air rip — layered noise sweeps, no tones
      const t = ctx.currentTime;
      // Low body whoosh
      const f1 = noise(0.3, 300, 1.0, 0.5, 'lowpass');
      if (f1) f1.frequency.exponentialRampToValueAtTime(1200, t + 0.25);
      // Mid crack of displaced air
      const f2 = noise(0.25, 800, 1.2, 0.45);
      if (f2) f2.frequency.exponentialRampToValueAtTime(4000, t + 0.22);
      // High whistle edge
      const f3 = noise(0.18, 2500, 2.0, 0.35);
      if (f3) f3.frequency.exponentialRampToValueAtTime(6000, t + 0.2);
    },
    miss() { if (!ready()) return; tone(400, 0.25, 'triangle', 0.15, 0, 180); },
    perfect() { if (!ready()) return; [880, 1108, 1318].forEach((f, i) => tone(f, 0.3, 'triangle', 0.18, i * 0.05)); },
    coin() { if (!ready()) return; tone(988, 0.08, 'square', 0.12); tone(1318, 0.25, 'square', 0.12, 0.08); },
    click() { if (!ready()) return; tone(660, 0.05, 'square', 0.08); },
    tick() { if (!ready()) return; tone(1500, 0.03, 'square', 0.06); },
    fire() { if (!ready()) return; noise(0.5, 900, 0.6, 0.4, 'lowpass'); tone(220, 0.5, 'sawtooth', 0.15, 0, 880); },
    ko() {
      if (!ready()) return;
      // KO: heaviest real slap only (LT 2026-10-27: silly boom layer cancelled, new layer options pending)
      const playBuf = (id, vol, delay) => {
        const buf = slapBufs[id] || crowdBufs[id];
        if (!buf) return;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); g.gain.value = vol;
        src.connect(g); g.connect(master); src.start(ctx.currentTime + (delay || 0));
      };
      playBuf('monster', 1.0, 0);          // heavy real slap impact
    },
    win() { if (!ready()) return; [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.2, i * 0.11)); crowdWin(); },
    realCheer() { playRealCheer(); }, // real victory recording only, no synth
    lose() { if (!ready()) return; [392, 330, 262].forEach((f, i) => tone(f, 0.45, 'sine', 0.2, i * 0.18)); crowdLose(); },
    brace() {
      if (!ready()) return;
      // Braced hit: play a real slap at reduced intensity (palm hits guard)
      crowdSlap(0.5);
      if (!playSlapBuf(0.5)) {
        noise(0.1, 1800, 0.8, 0.5);
        noise(0.08, 150, 0.6, 0.3, 'lowpass');
      }
    },
    /** Smack King fight-opening line — one per fight, awaited by the
        fight intro so it plays before the bell + ROUND 1 card. */
    playOpening,
    /** Boxing ring bell — three classic dings with metallic partials. */
    bell() {
      if (!ready()) return;
      // Real boxing bell recording
      const buf = crowdBufs['bell'];
      if (buf && ctx) {
        const t = ctx.currentTime;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); g.gain.value = 0.4;
        src.connect(g); g.connect(master);
        src.start(t);
      } else {
        // Fallback: load on demand
        fetch('assets/sfx/bell_boxing.mp3')
          .then(r => r.arrayBuffer())
          .then(ab => ctx.decodeAudioData(ab))
          .then(b => {
            crowdBufs['bell'] = b;
            const src = ctx.createBufferSource(); src.buffer = b;
            const g = ctx.createGain(); g.gain.value = 0.4;
            src.connect(g); g.connect(master);
            src.start();
          })
          .catch(() => {});
      }
    },
    /** Cartoon pain yelp — louder / lower for bigger hit tiers. */
    yelp(tier) {
      if (!ready()) return;
      const t = tier || 'light';
      if (t === 'light') {
        tone(560, 0.07, 'square', 0.11, 0, 400);
      } else if (t === 'medium') {
        tone(500, 0.1, 'square', 0.15, 0, 320);
        tone(210, 0.12, 'triangle', 0.1, 0.03, 130);
      } else if (t === 'heavy') {
        tone(400, 0.14, 'sawtooth', 0.2, 0, 170);
        noise(0.12, 900, 1.0, 0.28);
        tone(150, 0.2, 'sine', 0.16, 0.05, 70);
      } else { // perfect
        tone(360, 0.18, 'sawtooth', 0.24, 0, 130);
        tone(980, 0.09, 'square', 0.12, 0.03, 520);
        noise(0.16, 700, 0.85, 0.38);
        tone(110, 0.28, 'sine', 0.22, 0.06, 55);
      }
    }
  };
})();
