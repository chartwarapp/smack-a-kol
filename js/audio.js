/* =========================================================================
 * WebAudio synth + recorded SFX bank (slap sounds in assets/sfx/).
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Audio = (function () {
  let ctx = null, master = null, noiseBuf = null;

  /* ---- Real recorded slap SFX bank (Pixabay Content License — free for use) ---- */
  const CROWD_BANK = [
    { id: 'cheer1', file: 'assets/sfx/crowd_crowd1.mp3' },
    { id: 'cheer2', file: 'assets/sfx/crowd_crowd2.mp3' },
    { id: 'victory', file: 'assets/sfx/crowd_victory.mp3' },
  ];
  const crowdBufs = {};
  function loadCrowdBank() {
    if (!ctx) return;
    CROWD_BANK.forEach(b => {
      fetch(b.file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { crowdBufs[b.id] = buf; })
        .catch(() => { /* silent */ });
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
  function loadSlapBank() {
    if (slapLoading || !ctx) return;
    slapLoading = true;
    loadCrowdBank();
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
    master.gain.value = 0.5;
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

  function startMusic() {
    if (musicTimer || !ctx) return;
    musicStep = 0;
    musicTimer = setInterval(musicTick, 150); // 16th notes at ~100bpm
  }
  function stopMusic() {
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
  // Defeat: crowd "oooh" — sympathetic groan
  function crowdLose() {
    if (!ready()) return;
    crowdLayer({ freq: 900, q: 0.5, dur: 1.2, gain: 0.2, attack: 0.2, strength: 1 });
    crowdLayer({ freq: 600, q: 0.5, dur: 1.4, gain: 0.18, attack: 0.25, when: 0.1, strength: 1 });
  }

  return {
    unlock,
    SLAP_BANK,
    slapStyle,
    /** Preview a bank sound in Settings (bypasses nothing — respects sound toggle). */
    previewSlap(id) {
      if (!ready()) return;
      const buf = slapBufs[id];
      if (!buf) return;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(master); src.start();
    },
    startMusic,
    stopMusic,
    slap(strength) {          // strength 0..1+
      if (!ready()) return;
      crowdSlap(strength);  // crowd gasps/cheers on every slap
      if (playSlapBuf(strength)) return;   // real recorded slap
      // synth fallback (bank not loaded yet / fetch failed) — noise only, no tones
      const s = Math.min(1.5, strength);
      noise(0.12 + 0.08 * s, 2200, 0.8, 0.9 * Math.max(0.3, s));
      noise(0.05, 5000, 1.2, 0.5);
      noise(0.15, 180, 0.6, 0.5 * s, 'lowpass');
    },
    whoosh() { if (!ready()) return; const f = noise(0.22, 600, 1.5, 0.25); f.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.2); },
    miss() { if (!ready()) return; tone(400, 0.25, 'triangle', 0.15, 0, 180); },
    perfect() { if (!ready()) return; [880, 1108, 1318].forEach((f, i) => tone(f, 0.3, 'triangle', 0.18, i * 0.05)); },
    coin() { if (!ready()) return; tone(988, 0.08, 'square', 0.12); tone(1318, 0.25, 'square', 0.12, 0.08); },
    click() { if (!ready()) return; tone(660, 0.05, 'square', 0.08); },
    fire() { if (!ready()) return; noise(0.5, 900, 0.6, 0.4, 'lowpass'); tone(220, 0.5, 'sawtooth', 0.15, 0, 880); },
    ko() { if (!ready()) return; tone(520, 0.7, 'sawtooth', 0.2, 0, 90); noise(0.4, 300, 0.7, 0.6, 'lowpass'); },
    win() { if (!ready()) return; [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.2, i * 0.11)); crowdWin(); },
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
    /** Boxing ring bell — three classic dings with metallic partials. */
    bell() {      if (!ready()) return;
      const strike = (when) => {
        const t0 = ctx.currentTime + when;
        // Inharmonic metallic partials of a real ringside bell
        const base = 740;
        [[1, 0.25], [2.76, 0.11], [5.4, 0.06], [8.9, 0.03]].forEach(([ratio, g]) => {
          const o = ctx.createOscillator(); const gn = ctx.createGain();
          o.type = 'sine'; o.frequency.value = base * ratio;
          gn.gain.setValueAtTime(0.0001, t0);
          gn.gain.exponentialRampToValueAtTime(g, t0 + 0.008);
          gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
          o.connect(gn); gn.connect(master); o.start(t0); o.stop(t0 + 1.5);
        });
        // mallet click, delayed with the strike
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4000; f.Q.value = 1.0;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0.15, t0); cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
        src.connect(f); f.connect(cg); cg.connect(master);
        src.start(t0); src.stop(t0 + 0.08);
      };
      strike(0); strike(0.55); strike(1.1);
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
