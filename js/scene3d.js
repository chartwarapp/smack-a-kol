/* =========================================================================
 * 3D arena + low-poly fighters (Three.js r158, classic script build).
 * -------------------------------------------------------------------------
 * Layout (world space):
 *   - table centred at origin, long axis on X
 *   - PLAYER stands at z=+0.8 facing -z (back three-quarters to camera)
 *   - KOL    stands at z=-0.8 facing +z (face towards camera)
 *   - camera sits front-right so both faces/slapping arms read clearly
 * Public API (SAK.Scene3D): init, setPlayer, applyAvatar, createPreview, setOpponent, resetFight,
 *   setRoleCam, slap, knockout, setFireArmed, setBrace, screenPos, setMode
 * Camera: default fight view while the local player ATTACKS; orbit onto the
 *   local player's face while they BRACE; every slap swings onto the struck
 *   fighter's face then eases back; KO follow-cam tracks the loser.
 * ========================================================================= */
window.SAK = window.SAK || {};

/* ------------------------------------------------------------------ tween */
SAK.Ease = {
  linear: t => t,
  inCubic: t => t * t * t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};

SAK.Tween = (function () {
  let list = [];
  /** Animate numeric props of `obj` to `to` over `dur` seconds. Returns a Promise. */
  function to(obj, target, dur, ease) {
    return new Promise(resolve => {
      const from = {};
      for (const k in target) from[k] = obj[k];
      list.push({ obj, from, target, dur: Math.max(0.0001, dur), t: 0, ease: ease || SAK.Ease.inOutQuad, resolve });
    });
  }
  function update(dt) {
    if (!list.length) return;
    const done = [];
    for (const tw of list) {
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur), e = tw.ease(p);
      for (const k in tw.target) tw.obj[k] = tw.from[k] + (tw.target[k] - tw.from[k]) * e;
      if (p >= 1) done.push(tw);
    }
    if (done.length) { list = list.filter(t => !done.includes(t)); done.forEach(t => t.resolve()); }
  }
  function clear() { list = []; }
  return { to, update, clear };
})();

/* --------------------------------------------------------------- the scene */
SAK.Scene3D = (function () {
  const T = window.THREE;
  let renderer, scene, camera, container, clock;
  let player = null, kol = null;
  let particles = [], rings = [], floaters = [];
  let timeScale = 1, slowMoT = 0; // V2: dramatic slow-mo on heavy hits
  let candles = [], coins = [], chartDomeCandles = [], chartDumpT = 0;
  let shake = 0, time = 0, mode = 'menu';
  let koCam = null; // { track:Fighter, offset:Vector3, until:number } — follow loser fly-out + land
  let hitCam = null; // { target:Fighter, w:0..1, peak, aw:0..1 } — face-cam onto the slapped fighter + wind-up stage weight back to the wide view
  let roleCam = { role: 'attack', w: 0 }; // local role framing: 0 = default fight view, 1 = local player's brace face-cam
  let camK = 1;      // aspect pull-back factor from frameCamera (narrow screens > 1)
  let lastSlapTier = null; // tier of the most recent slap — picks the KO variation
  const camBase = { pos: new T.Vector3(), look: new T.Vector3() };
  const camCur = { pos: new T.Vector3(), look: new T.Vector3() };
  const camFight = { pos: new T.Vector3(), look: new T.Vector3() }; // resting fight framing

  const matCache = {};
  /* V2: toon gradient for cel-shaded cartoon materials (4 tone steps). */
  const toonGrad = (() => {
    const d = new Uint8Array([110, 170, 235, 255]);
    const t = new T.DataTexture(d, 4, 1, T.RedFormat);
    t.needsUpdate = true;
    return t;
  })();
  function mat(color, opts) {
    if (opts) return new T.MeshToonMaterial(Object.assign({ color, gradientMap: toonGrad }, opts));
    if (!matCache[color]) matCache[color] = new T.MeshToonMaterial({ color, gradientMap: toonGrad });
    return matCache[color];
  }
  function mesh(geo, material, x, y, z) {
    const m = new T.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  const wait = s => new Promise(r => setTimeout(r, s * 1000));

  /* Slapstick KO landing poses — cartoon meme energy, no gore.
   * rx/ry/rz = root euler; y = root height; t* / h* = torso/head; arm* = [lift,swing,elbow]. */
  const LAND_POSES = [
    { id: 'faceplant', rx: Math.PI * 0.52, ry: 0.12, rz: 0.18, y: 0.42,
      tx: 0.28, ty: 0.1, tz: 0.08, hx: 0.9, hy: 0.35, hz: 0.1,
      armL: [1.55, -1.15, 0.25], armR: [1.5, 1.25, 0.2] },
    { id: 'akimbo', rx: -Math.PI * 0.5, ry: 0.45, rz: 0.25, y: 0.4,
      tx: -0.2, ty: 0.55, tz: 0.35, hx: -0.45, hy: -0.7, hz: 0.45,
      armL: [1.85, 1.45, 1.7], armR: [1.75, -1.55, 1.85] },
    { id: 'headstuck', rx: Math.PI * 0.95, ry: 0.25, rz: 0.2, y: 1.55,
      tx: 0.15, ty: 0.1, tz: 0.05, hx: 0.35, hy: 0.15, hz: 0.1,
      armL: [0.45, 0.9, 1.85], armR: [0.55, -0.95, 1.7] },
    { id: 'pretzel', rx: Math.PI * 0.38, ry: 1.15, rz: Math.PI * 0.58, y: 0.36,
      tx: 0.65, ty: 0.95, tz: -0.55, hx: 0.55, hy: 1.25, hz: 0.45,
      armL: [2.05, -0.35, 2.15], armR: [0.35, 1.85, 0.45] },
    { id: 'buttup', rx: Math.PI * 0.72, ry: 0.08, rz: 0.12, y: 0.52,
      tx: 0.85, ty: 0.05, tz: 0.1, hx: 1.15, hy: 0.1, hz: 0.25,
      armL: [1.25, -0.55, 0.35], armR: [1.3, 0.55, 0.3] },
    { id: 'oneleg', rx: 0.28, ry: 0.2, rz: Math.PI * 0.55, y: 0.26,
      tx: 0.25, ty: -0.35, tz: 0.65, hx: 0.45, hy: 0.55, hz: 0.85,
      armL: [0.25, 0.25, 0.15], armR: [1.95, -1.25, 1.55] },
    { id: 'superman', rx: Math.PI * 0.5, ry: 0.05, rz: 0.05, y: 0.38,
      tx: -0.18, ty: 0, tz: 0, hx: -0.35, hy: 0.05, hz: 0,
      armL: [0.25, -1.65, 0.12], armR: [0.25, 1.65, 0.12] },
    { id: 'starfished', rx: -Math.PI * 0.5, ry: 0.1, rz: 0.08, y: 0.4,
      tx: 0.05, ty: 0.1, tz: 0.05, hx: -0.25, hy: 0.15, hz: 0.1,
      armL: [1.95, 0.25, 0.2], armR: [1.95, -0.25, 0.2] },
    { id: 'sideflop', rx: 0.18, ry: 0.55, rz: Math.PI * 0.48, y: 0.3,
      tx: 0.4, ty: 0.25, tz: 0.2, hx: 0.65, hy: 0.45, hz: 0.55,
      armL: [1.65, 0.85, 1.25], armR: [0.18, -0.35, 0.25] },
    { id: 'heap', rx: Math.PI * 0.42, ry: 0.75, rz: Math.PI * 0.38, y: 0.28,
      tx: 0.75, ty: 0.45, tz: -0.45, hx: 0.95, hy: -0.55, hz: 0.65,
      armL: [1.45, 1.05, 2.05], armR: [1.85, -0.45, 1.75] },
  ];
  function pickLandPose() { return LAND_POSES[(Math.random() * LAND_POSES.length) | 0]; }

  /* Randomized "ouch" faces: a wince style is picked fresh on every landed
   * slap and jittered, so the pain reaction never repeats. Values are
   * multipliers on the tier's mouth/eye scales (tier still sets intensity). */
  const OUCH_FACES = [
    { mx: 1.00, my: 1.00, ex: 1.00, ey: 1.00 }, // classic tier face
    { mx: 0.72, my: 1.28, ex: 0.92, ey: 0.68 }, // grimace: tight squint, tall grimace
    { mx: 1.32, my: 0.85, ex: 1.18, ey: 1.22 }, // scream: wide mouth, popping eyes
    { mx: 0.88, my: 1.12, ex: 1.22, ey: 0.58 }, // shocked yelp: squint + open jaw
    { mx: 1.15, my: 1.35, ex: 0.85, ey: 0.75 }, // bawl: scrunched eyes, big wail
  ];
  const HIT_REACT = {
    /* light  = weak / outer zone — small flinch, mild wince
     * medium = good / mid yellow — bigger head snap + wobble
     * heavy  = inner good / fire-boosted — strong recoil, stars, scream
     * perfect = green centre — max slapstick pain (no gore) */
    light: {
      yaw: 5.5, roll: 3.2, lean: 0.14, mouthX: 1.08, mouthY: 2.0, mouthMs: 220,
      eyeSx: 1.05, eyeSy: 0.72, sx: 1.18, sy: 0.82, sz: 1.12, squashDur: 0.24,
      stars: 0, burstN: 9, burstSpd: 2.5, shake: 0.15, hitStop: 0.03, hop: 0,
      blushAdd: 0.12, colors: ['#ffffff', '#fff27a'], ring: '#ffffff', yelpDelay: 0
    },
    medium: {
      yaw: 9.5, roll: 5.8, lean: 0.24, mouthX: 1.2, mouthY: 2.7, mouthMs: 340,
      eyeSx: 1.12, eyeSy: 0.62, sx: 1.3, sy: 0.7, sz: 1.2, squashDur: 0.34,
      stars: 2, burstN: 18, burstSpd: 3.5, shake: 0.26, hitStop: 0.055, hop: 0.08,
      blushAdd: 0.22, colors: ['#ffffff', '#ffd23f', '#ff9a1f'], ring: '#ffd23f', yelpDelay: 0.02
    },
    heavy: {
      yaw: 14.5, roll: 9.2, lean: 0.36, mouthX: 1.55, mouthY: 3.6, mouthMs: 440,
      eyeSx: 1.28, eyeSy: 1.38, sx: 1.42, sy: 0.55, sz: 1.28, squashDur: 0.45,
      stars: 4, burstN: 28, burstSpd: 4.6, shake: 0.4, hitStop: 0.09, hop: 0.18,
      blushAdd: 0.38, colors: ['#ffd23f', '#ff9a1f', '#ff4fd8', '#ffffff'], ring: '#ff9a1f', yelpDelay: 0.04
    },
    perfect: {
      yaw: 19, roll: 12.5, lean: 0.45, mouthX: 1.8, mouthY: 4.1, mouthMs: 560,
      eyeSx: 1.4, eyeSy: 1.55, sx: 1.58, sy: 0.45, sz: 1.38, squashDur: 0.58,
      stars: 6, burstN: 40, burstSpd: 5.8, shake: 0.58, hitStop: 0.13, hop: 0.32,
      blushAdd: 0.55, colors: ['#39ff88', '#ffd23f', '#ffffff', '#ff4fd8', '#ff7a9a'], ring: '#39ff88', yelpDelay: 0.06
    }
  };

  /* Slap styles by meter strength — Slap Kings motion language: HUGE readable
   * wind-up (arm high above/behind the head, body coiled), full-body twist and
   * forward lunge into the hit, snappy fast strike with follow-through.
   * Weaker styles are smaller versions of the same language.
   * wind  = wind-up pose target (twist is multiplied by armSide at use time)
   * strike = contact pose target; hand = slap-hand scale at contact
   * peak  = hitCam push-in (kept ≤0.7 so contact stays visible) */
  const SLAP_STYLES = {
    whiff: { // miss: wild over-swing, no contact
      windupMul: 1.1, squash: 1.04,
      wind:   { lift: 3.3, swing: 1.7, elbow: 1.8, twist: 0.95, lean: -0.24 },
      strike: { lift: 1.9, swing: -2.7, elbow: 0.05, twist: -0.95, lean: 0.34, lunge: 0.5 },
      strikeDur: 0.14, hand: [1.15, 0.8, 1.25], peak: 0.3, fx: 0, hop: 0
    },
    limp: { // weak / red zone: half-hearted, floppy wrist
      windupMul: 0.75, squash: 1.03,
      wind:   { lift: 2.2, swing: 0.7, elbow: 1.1, twist: 0.4, lean: -0.08 },
      strike: { lift: 2.45, swing: -1.5, elbow: 0.5, twist: -0.3, lean: 0.1, lunge: 0.1 },
      strikeDur: 0.2, hand: [1.15, 0.85, 1.25], peak: 0.5, fx: 0.5, hop: 0
    },
    standard: { // good outer: solid readable slap
      windupMul: 1.0, squash: 1.07,
      wind:   { lift: 3.15, swing: 1.25, elbow: 1.55, twist: 0.8, lean: -0.18 },
      strike: { lift: 2.3, swing: -2.15, elbow: 0.1, twist: -0.62, lean: 0.24, lunge: 0.38 },
      strikeDur: 0.15, hand: [1.35, 0.55, 1.5], peak: 0.55, fx: 1, hop: 0
    },
    heavy: { // good inner: deep coil, big twist, driving lunge
      windupMul: 1.2, squash: 1.1,
      wind:   { lift: 3.4, swing: 1.5, elbow: 1.7, twist: 1.05, lean: -0.24 },
      strike: { lift: 2.35, swing: -2.35, elbow: 0.08, twist: -0.85, lean: 0.3, lunge: 0.6 },
      strikeDur: 0.13, hand: [1.45, 0.5, 1.6], peak: 0.65, fx: 1.5, hop: 0.12
    },
    devastating: { // perfect dead-center: maximum everything, hop into the hit
      windupMul: 1.35, squash: 1.12,
      wind:   { lift: 3.6, swing: 1.65, elbow: 1.8, twist: 1.2, lean: -0.3 },
      strike: { lift: 2.4, swing: -2.5, elbow: 0.05, twist: -1.0, lean: 0.36, lunge: 0.85 },
      strikeDur: 0.12, hand: [1.55, 0.45, 1.7], peak: 0.7, fx: 2, hop: 0.22
    }
  };

  /** Map meter grade (+ fire / distance) → light|medium|heavy|perfect. */
  function reactTier(grade, fire, dist) {
    if (!grade || grade === 'miss') return null;
    if (grade === 'perfect') return 'perfect';
    if (grade === 'weak') return fire ? 'medium' : 'light';
    if (grade === 'good') {
      if (fire) return 'heavy';
      if (dist != null && dist < 20) return 'heavy'; // inner yellow → heavy
      return 'medium';
    }
    return 'medium';
  }



  /* Body presets (avatar.body). w/d = torso width/depth, h = torso height,
   * sh = shoulder x, arm = arm thickness, head = head scale, taper = top/bottom radius ratio. */
  const BODY = {
    classic: { w: 1,    d: 1,    h: 1,    sh: 0.55, arm: 1,    head: 1,    taper: 1 },
    chonk:   { w: 1.28, d: 1.3,  h: 0.96, sh: 0.66, arm: 1.18, head: 1,    taper: 0.92, belly: true },
    gymbro:  { w: 1.2,  d: 1.05, h: 1.04, sh: 0.7,  arm: 1.4,  head: 0.92, taper: 1.3 },
    noodle:  { w: 0.78, d: 0.85, h: 1.12, sh: 0.45, arm: 0.78, head: 1.04, taper: 1 },
    smol:    { w: 0.95, d: 1,    h: 0.8,  sh: 0.52, arm: 0.95, head: 1.2,  taper: 1 }
  };

  /* ================================================================ Fighter */
  class Fighter {
    /**
     * @param look   colours/accessory (see config.js)
     * @param facing +1 faces +z (KOL), -1 faces -z (player)
     * @param armSide local x side of the slapping arm (+1 / -1)
     */
    constructor(look, facing, armSide) {
      this.look = look; this.facing = facing; this.armSide = armSide;
      this.root = new T.Group();
      this.root.rotation.y = facing > 0 ? 0 : Math.PI;
      this.homeZ = facing > 0 ? -0.8 : 0.8;
      this.root.position.set(0, 0, this.homeZ);
      // animated pose values (tweened), applied every frame
      this.pose = { lift: 0.12, swing: 0, elbow: 0.15, twist: 0, lean: 0, lunge: 0, guard: 0 };
      // damped springs for hit reactions
      this.yaw = { x: 0, v: 0 }; this.roll = { x: 0, v: 0 };
      this.ko = null;               // knockout physics state
      this.fire = false;
      this.idlePhase = Math.random() * 10;
      this.build();
    }

    build() {
      const L = this.look;
      const skin = mat(L.skin), shirt = mat(L.shirt), pants = mat(L.pants), hair = mat(L.hair);
      const B = BODY[L.body] || BODY.classic;
      this.body = B;
      this.brows = []; // rebuilt with the head (rebuild() disposes old meshes)

      // legs
      for (const sx of [-0.22, 0.22]) {
        this.root.add(mesh(new T.CylinderGeometry(0.15, 0.13, 0.95, 6), pants, sx, 0.475, 0));
        this.root.add(mesh(new T.BoxGeometry(0.26, 0.12, 0.38), mat('#222'), sx, 0.06, 0.06));
      }
      // torso pivot at hips
      this.torso = new T.Group(); this.torso.position.y = 0.95; this.root.add(this.torso);
      const body = mesh(new T.CylinderGeometry(0.5 * B.w * Math.min(1.25, B.taper), 0.42 * B.w / Math.max(1, B.taper * 0.85), 0.88 * B.h, 7), shirt, 0, 0.44 * B.h, 0);
      body.scale.z = 0.68 * B.d; this.torso.add(body);
      if (B.belly) { const belly = mesh(new T.IcosahedronGeometry(0.42, 1), shirt, 0, 0.3, 0.28); belly.scale.set(1.15, 0.9, 0.85); this.torso.add(belly); }
      this.torso.add(mesh(new T.BoxGeometry(0.86 * Math.max(B.w / Math.max(1, B.taper * 0.85), 0.8), 0.1, 0.42 * B.d), pants, 0, 0.03, 0)); // belt
      this.buildOutfit();
      this.torso.add(mesh(new T.CylinderGeometry(0.14, 0.16, 0.18, 6), skin, 0, 0.92 * B.h, 0)); // neck

      // head
      this.head = new T.Group(); this.head.position.y = 0.98 * B.h; this.head.scale.setScalar(B.head * 1.18); this.torso.add(this.head); // V2: bigger cartoon heads
      const skull = mesh(new T.IcosahedronGeometry(0.5, 1), skin, 0, 0.42, 0);
      skull.scale.set(1, 1.06, 0.98); this.head.add(skull);
      this.skull = skull;
      this.skullBase = new T.Vector3(1, 1.06, 0.98);
      this.hitFX = null; // { until, dur, sx, sy, sz, stars }
      this.buildHair(hair);
      // ears
      for (const sx of [-1, 1]) this.head.add(mesh(new T.IcosahedronGeometry(0.1, 0), skin, sx * 0.5, 0.4, 0));
      // eyes
      this.eyes = new T.Group(); this.head.add(this.eyes);
      const eyeStyle = L.eyes || 'round', pupil = mat(L.eyeColor || '#1a1a1a');
      for (const sx of [-1, 1]) {
        if (eyeStyle === 'dot') {
          this.eyes.add(mesh(new T.SphereGeometry(0.07, 7, 5), pupil, sx * 0.18, 0.5, 0.46));
        } else {
          const big = eyeStyle === 'big';
          this.eyes.add(mesh(new T.SphereGeometry(big ? 0.13 : 0.1, 8, 6), mat('#ffffff'), sx * 0.18, 0.5, big ? 0.41 : 0.42));
          const pr = big ? 0.068 : eyeStyle === 'angry' ? 0.045 : 0.055, pz = big ? 0.535 : 0.51;
          this.eyes.add(mesh(new T.SphereGeometry(pr, 6, 5), pupil, sx * 0.18, 0.5, pz));
          const hl = mesh(new T.SphereGeometry(pr * 0.38, 6, 5), new T.MeshBasicMaterial({ color: '#ffffff' }), sx * 0.18 - pr * 0.35, 0.5 + pr * 0.42, pz + pr * 0.92);
          hl.castShadow = false; this.eyes.add(hl); // V2: specular catchlight
          if (eyeStyle === 'sleepy') this.eyes.add(mesh(new T.BoxGeometry(0.25, 0.11, 0.1), skin, sx * 0.18, 0.565, 0.49)); // heavy lids
        }
        const angry = eyeStyle === 'angry';
        const brow = mesh(new T.BoxGeometry(0.27, 0.075, 0.06), hair, sx * 0.19, angry ? 0.63 : 0.67, 0.45); // V2: thicker brows
        brow.rotation.z = sx * (angry ? 0.42 : -0.18); this.head.add(brow);
        brow.userData.baseY = brow.position.y; brow.userData.baseRotZ = brow.rotation.z;
        this.brows.push(brow);
      }
      // KO "X" eyes (hidden until knocked out)
      this.xEyes = new T.Group(); this.xEyes.visible = false; this.head.add(this.xEyes);
      for (const sx of [-1, 1]) for (const r of [0.785, -0.785]) {
        const b = mesh(new T.BoxGeometry(0.2, 0.045, 0.04), mat('#1a1a1a'), sx * 0.18, 0.5, 0.5);
        b.rotation.z = r; this.xEyes.add(b);
      }
      // nose + mouth — chunkier to read in close-ups
      this.head.add(mesh(new T.IcosahedronGeometry(0.1, 0), skin, 0, 0.36, 0.53));
      this.mouth = mesh(new T.BoxGeometry(0.22, 0.07, 0.05), mat('#6b1d1d'), 0, 0.2, 0.46);
      this.head.add(this.mouth);
      // --- Expression system: morphable mouth + eyelids + brow control ---
      // Mouth shapes: neutral (thin line), open (shock "O"), grimace (pain), grin (taunt)
      this.mouthShapes = {
        neutral: { sx: 0.22, sy: 0.07, y: 0.2 },
        open:    { sx: 0.16, sy: 0.22, y: 0.16 },  // shock "O"
        grimace: { sx: 0.3, sy: 0.05, y: 0.2 },     // pain grimace (wide, thin)
        grin:    { sx: 0.28, sy: 0.1, y: 0.2 },     // taunt grin
      };
      this.expr = 'neutral';
      // Eyelids for squint/wide — thin boxes above eyes that scale
      this.lids = [];
      for (const sx of [-1, 1]) {
        const lid = mesh(new T.BoxGeometry(0.24, 0.02, 0.08), skin, sx * 0.18, 0.62, 0.47);
        lid.visible = false; this.head.add(lid); this.lids.push(lid);
      }
      // cheeks: blush grows with damage taken (both cheeks so it reads from any angle)
      this.blushMat = new T.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0, depthWrite: false });
      for (const sx of [-1, 1]) {
        const c = new T.Mesh(new T.SphereGeometry(0.13, 8, 6), this.blushMat);
        c.position.set(sx * 0.33, 0.3, 0.36); c.scale.set(1, 0.7, 0.4); this.head.add(c);
      }
      // Progressive battle damage: black-eye ring + cheek scratch, revealed as hits land (cartoon, no gore).
      // Sized to read clearly in face close-ups (hit-cam + loser-face zoom).
      this.bruiseLevel = 0;
      this.bruiseMat = new T.MeshBasicMaterial({ color: '#3d1d55', transparent: true, opacity: 0, depthWrite: false });
      const bruise = new T.Mesh(new T.SphereGeometry(0.185, 10, 8), this.bruiseMat);
      bruise.position.set(0.18, 0.5, 0.44); bruise.scale.set(1, 0.9, 0.45); this.head.add(bruise);
      this.cutMat = new T.MeshBasicMaterial({ color: '#d42a2a', transparent: true, opacity: 0, depthWrite: false });
      const cut1 = new T.Mesh(new T.BoxGeometry(0.05, 0.21, 0.02), this.cutMat);
      cut1.position.set(-0.3, 0.26, 0.44); cut1.rotation.z = 0.45; this.head.add(cut1);
      const cut2 = new T.Mesh(new T.BoxGeometry(0.05, 0.15, 0.02), this.cutMat);
      cut2.position.set(-0.26, 0.3, 0.44); cut2.rotation.z = -0.5; this.head.add(cut2);
      this.buildAccessory();
      // ⛑ Defense Helmet power-up (hidden until used)
      this.helmet = new T.Group(); this.helmet.visible = false; this.head.add(this.helmet);
      const hm = mat('#ffd23f', {}); hm.emissive = new T.Color('#4a3300');
      this.helmet.add(mesh(new T.SphereGeometry(0.58, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hm, 0, 0.55, 0));
      this.helmet.add(mesh(new T.CylinderGeometry(0.66, 0.66, 0.05, 12), hm, 0, 0.56, 0.05));
      this.helmet.add(mesh(new T.BoxGeometry(0.1, 0.12, 0.62), mat('#ff3b5c'), 0, 1.1, 0));
      // 😤 Degen Rage aura (hidden until used)
      this.rage = new T.Mesh(new T.SphereGeometry(0.8, 12, 8), new T.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.22, depthWrite: false }));
      this.rage.position.y = 0.45; this.rage.visible = false; this.head.add(this.rage);

      // arms
      this.arms = {};
      for (const side of [-1, 1]) {
        const shoulder = new T.Group(); shoulder.position.set(side * B.sh, 0.78 * B.h, 0); this.torso.add(shoulder);
        shoulder.add(mesh(new T.IcosahedronGeometry(0.16 * B.arm, 0), shirt, 0, 0, 0));
        shoulder.add(mesh(new T.CylinderGeometry(0.13 * B.arm, 0.11 * B.arm, 0.55, 6), shirt, 0, -0.27, 0));
        const elbow = new T.Group(); elbow.position.y = -0.55; shoulder.add(elbow);
        elbow.add(mesh(new T.CylinderGeometry(0.105 * B.arm, 0.09 * B.arm, 0.45, 6), skin, 0, -0.22, 0));
        const handMat = mat(L.skin, {}); // own material so it can turn golden
        // Open palm with individual fingers (Slap Kings-style readability) —
        // a Group so the slap squash-scale still flattens the whole hand.
        const hand = new T.Group(); hand.position.set(0, -0.52, 0); hand.scale.setScalar(1.2); elbow.add(hand); // 20% bigger hands
        hand.add(mesh(new T.BoxGeometry(0.2, 0.16, 0.09), handMat, 0, -0.02, 0)); // palm
        // Knuckle ridge for definition
        hand.add(mesh(new T.BoxGeometry(0.19, 0.04, 0.08), handMat, 0, -0.09, 0.01));
        const fingerLen = [0.13, 0.155, 0.15, 0.12]; // index..pinky, middle longest
        for (let f = 0; f < 4; f++) {
          const fg = new T.Group();
          fg.position.set((f - 1.5) * 0.055, -0.11, 0);
          fg.rotation.z = (f - 1.5) * 0.1; // fan out
          fg.rotation.x = -0.15; // slight natural curl
          hand.add(fg);
          // Two-segment fingers for a more natural look
          fg.add(mesh(new T.CylinderGeometry(0.026, 0.03, fingerLen[f] * 0.6, 6), handMat, 0, -fingerLen[f] * 0.3, 0));
          const tip = new T.Group(); tip.position.set(0, -fingerLen[f] * 0.6, 0); tip.rotation.x = -0.2; fg.add(tip);
          tip.add(mesh(new T.CylinderGeometry(0.022, 0.026, fingerLen[f] * 0.45, 6), handMat, 0, -fingerLen[f] * 0.22, 0));
          tip.add(mesh(new T.SphereGeometry(0.024, 6, 5), handMat, 0, -fingerLen[f] * 0.45, 0)); // fingertip
        }
        const th = new T.Group(); // thumb on the inner side
        th.position.set(-side * 0.1, -0.03, 0.01);
        th.rotation.z = -side * 0.85; th.rotation.x = -0.2;
        hand.add(th);
        th.add(mesh(new T.CylinderGeometry(0.023, 0.028, 0.11, 5), handMat, 0, -0.055, 0));
        th.add(mesh(new T.SphereGeometry(0.023, 5, 4), handMat, 0, -0.11, 0));
        this.arms[side] = { shoulder, elbow, hand, handMat, side };
      }
      this.buildGloves();
      this.root.traverse(o => { o.userData.fighter = this; });
    }

    /** NFT trait: glove variants. Each wraps the hand with distinct geometry. */
    buildGloves() {
      const gloveType = (this.look && this.look.gloves) || 'wrap';
      const gm = (c, opts) => mat(c, opts);
      for (const side of [-1, 1]) {
        const arm = this.arms[side];
        if (!arm || !arm.hand) continue;
        const hand = arm.hand;
        // Remove old glove meshes
        const toRemove = [];
        hand.children.forEach(ch => { if (ch.userData.glove) toRemove.push(ch); });
        toRemove.forEach(ch => hand.remove(ch));
        const add = (geo, material, x, y, z) => {
          const m = mesh(geo, material, x, y, z);
          m.userData.glove = true; hand.add(m); return m;
        };
        switch (gloveType) {
          case 'wrap': {
            // Cloth hand wraps — bands around palm and wrist
            const wrapMat = gm('#e8e0d0');
            add(new T.BoxGeometry(0.22, 0.06, 0.11), wrapMat, 0, -0.02, 0);
            add(new T.BoxGeometry(0.22, 0.05, 0.11), wrapMat, 0, -0.08, 0);
            add(new T.CylinderGeometry(0.07, 0.075, 0.12, 8), wrapMat, 0, 0.06, 0); // wrist wrap
            break;
          }
          case 'mma': {
            // MMA gloves — padded knuckles, open fingers
            const mmaMat = gm('#2a2a35');
            add(new T.BoxGeometry(0.23, 0.1, 0.12), mmaMat, 0, -0.04, 0); // knuckle pad
            add(new T.CylinderGeometry(0.07, 0.075, 0.14, 8), mmaMat, 0, 0.05, 0); // wrist strap
            break;
          }
          case 'boxing': {
            // Big puffy boxing gloves — cover the whole hand
            const boxMat = gm('#d42a2a');
            const glove = add(new T.SphereGeometry(0.19, 12, 10), boxMat, 0, -0.08, 0);
            glove.scale.set(1, 1.25, 0.9);
            add(new T.CylinderGeometry(0.08, 0.09, 0.14, 8), gm('#ffffff'), 0, 0.08, 0); // cuff
            // Hide fingers inside the big glove
            arm.hand.children.forEach(ch => { if (!ch.userData.glove && ch.type === 'Group') ch.visible = false; });
            break;
          }
          case 'gold': {
            // Golden fists — metallic gold material on knuckles
            const goldMat = new T.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.85, roughness: 0.25 });
            add(new T.BoxGeometry(0.22, 0.09, 0.11), goldMat, 0, -0.03, 0);
            const g = gm('#ffd23f'); g.metalness = 0.7; g.roughness = 0.3;
            break;
          }
          case 'spike': {
            // Spiked knuckles — metal band with spikes
            const spikeMat = gm('#3a3a45');
            add(new T.BoxGeometry(0.23, 0.07, 0.11), spikeMat, 0, -0.04, 0);
            for (let s = 0; s < 4; s++) {
              const spike = add(new T.ConeGeometry(0.025, 0.07, 6), gm('#c0c0d0'), (s - 1.5) * 0.055, -0.1, 0.02);
              spike.rotation.x = Math.PI; // point outward
            }
            break;
          }
          case 'diamond': {
            // Diamond fists — sparkling crystalline material
            const diaMat = new T.MeshStandardMaterial({
              color: '#b8f0ff', metalness: 0.1, roughness: 0.05,
              transparent: true, opacity: 0.92,
              emissive: new T.Color('#4fa8ff'), emissiveIntensity: 0.35,
            });
            const d = add(new T.OctahedronGeometry(0.13), diaMat, 0, -0.04, 0);
            d.scale.set(1.1, 0.7, 0.8);
            // Sparkle points
            for (let s = 0; s < 3; s++) {
              const sp = add(new T.OctahedronGeometry(0.03),
                new T.MeshBasicMaterial({ color: '#ffffff' }),
                (Math.random() - 0.5) * 0.15, -0.04 + (Math.random() - 0.5) * 0.08, 0.06);
            }
            break;
          }
        }
      }
    }

    /** NFT trait: outfit variants layered over the base torso. */
    buildOutfit() {
      const outfit = (this.look && this.look.outfit) || 'tee';
      if (outfit === 'tee') return; // default shirt is the tee
      const om = (c, opts) => mat(c, opts);
      const add = (geo, material, x, y, z) => {
        const m = mesh(geo, material, x, y, z);
        m.userData.outfit = true; this.torso.add(m); return m;
      };
      switch (outfit) {
        case 'tank': {
          // Tank top — trim the shoulders (visual: white trim on collar/arms)
          add(new T.TorusGeometry(0.16, 0.025, 6, 16), om('#ffffff'), 0, 0.82, 0).rotation.x = Math.PI / 2;
          break;
        }
        case 'hoodie': {
          // Hoodie — hood resting on back + pocket + drawstrings
          const hood = add(new T.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), om('#3a3a4a'), 0, 0.78, -0.3);
          hood.rotation.x = 0.5;
          add(new T.BoxGeometry(0.3, 0.18, 0.06), om('#2a2a35'), 0, 0.25, 0.32); // kangaroo pocket
          for (const sx of [-0.08, 0.08])
            add(new T.CylinderGeometry(0.012, 0.012, 0.18, 5), om('#ffffff'), sx, 0.68, 0.33); // drawstrings
          break;
        }
        case 'gi': {
          // Fight gi — white with black belt
          add(new T.BoxGeometry(0.5, 0.5, 0.06), om('#f5f5f5'), 0, 0.55, 0.28); // gi lapel
          add(new T.BoxGeometry(0.9, 0.12, 0.45), om('#1a1a1a'), 0, 0.05, 0); // black belt
          const knot = add(new T.BoxGeometry(0.12, 0.12, 0.08), om('#1a1a1a'), 0, 0.05, 0.24);
          break;
        }
        case 'suit': {
          // Suit — lapels + tie
          for (const sx of [-1, 1]) {
            const lapel = add(new T.BoxGeometry(0.14, 0.4, 0.04), om('#1f1f2e'), sx * 0.12, 0.6, 0.3);
            lapel.rotation.z = sx * 0.25;
          }
          add(new T.BoxGeometry(0.09, 0.35, 0.03), om('#ff3b5c'), 0, 0.58, 0.32); // tie
          break;
        }
        case 'gold': {
          // Gold lamé — shiny metallic gold overlay
          const goldMat = new T.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.9, roughness: 0.2 });
          const overlay = add(new T.CylinderGeometry(0.42, 0.36, 0.7, 8), goldMat, 0, 0.44, 0);
          overlay.scale.z = 0.7;
          break;
        }
        case 'royal': {
          // Royal robe — flowing cape + fur trim + gold chain
          const cape = add(new T.PlaneGeometry(0.9, 1.1), new T.MeshStandardMaterial({ color: '#6b1d5e', roughness: 0.8, side: T.DoubleSide }), 0, 0.3, -0.35);
          cape.rotation.x = 0.15;
          add(new T.TorusGeometry(0.2, 0.05, 6, 14), om('#ffffff'), 0, 0.82, 0).rotation.x = Math.PI / 2; // fur collar
          add(new T.TorusGeometry(0.18, 0.02, 6, 16), om('#ffd23f'), 0, 0.65, 0.15).rotation.x = Math.PI / 2.3; // gold chain
          break;
        }
      }
    }

    /** Hair style (avatar.hairStyle); KOLs without one keep the classic cap. */
    buildHair(hair) {
      const H = this.head, add = (geo, x, y, z, fn) => { const m = mesh(geo, hair, x, y, z); if (fn) fn(m); H.add(m); return m; };
      const cap = (r, arc) => add(new T.SphereGeometry(r, 9, 6, 0, Math.PI * 2, 0, Math.PI * arc), 0, 0.47, -0.04, m => { m.rotation.x = -0.35; });
      let style = this.look.hairStyle || 'short';
      // tall styles get squashed under a hat (no clipping through cap/beanie/top hat)
      if (['cap', 'beanie', 'tophat'].includes(this.look.accessory) && ['spiky', 'mohawk', 'afro', 'bun'].includes(style)) style = 'short';
      switch (style) {
        case 'bald': break;
        case 'buzz': cap(0.515, 0.42); break;
        case 'spiky':
          cap(0.53, 0.46);
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            add(new T.ConeGeometry(0.11, 0.32, 4), Math.sin(a) * 0.26, 0.93 + (i % 2) * 0.04, Math.cos(a) * 0.26 - 0.06, m => { m.rotation.set(Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55); });
          }
          add(new T.ConeGeometry(0.12, 0.36, 4), 0, 1.02, -0.02); break;
        case 'mohawk': {
          cap(0.508, 0.3);
          // Tall dramatic mohawk with color tips
          for (let i = 0; i < 7; i++) {
            const t = -0.9 + i * 0.3;
            const h = 0.42 - Math.abs(t) * 0.12;
            add(new T.BoxGeometry(0.09, h, 0.14), 0, 0.45 + Math.cos(t) * 0.55, Math.sin(t) * 0.52, m => { m.rotation.x = t * 0.8; });
            // Colored tip
            add(new T.BoxGeometry(0.095, 0.08, 0.145), 0, 0.45 + h / 2 + Math.cos(t) * 0.55, Math.sin(t) * 0.52, m => {
              m.rotation.x = t * 0.8;
              m.material = mat('#ff3b5c');
            });
          }
          // Shaved sides (skin-colored caps)
          for (const sx of [-1, 1])
            add(new T.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), sx * 0.32, 0.55, 0, m => {
              m.material = mat(this.look.skin || '#f6c9a0');
              m.rotation.z = sx * 0.4;
            });
          break;
        }
        case 'long':
          cap(0.545, 0.52);
          add(new T.BoxGeometry(0.92, 0.85, 0.2), 0, 0.12, -0.38, m => { m.rotation.x = 0.08; });
          for (const sx of [-1, 1]) add(new T.BoxGeometry(0.14, 0.6, 0.3), sx * 0.5, 0.2, -0.08);
          break;
        case 'afro': {
          const fro = add(new T.IcosahedronGeometry(0.7, 1), 0, 0.72, -0.14);
          fro.scale.set(1, 0.82, 0.92); break; }
        case 'bun':
          cap(0.535, 0.5);
          add(new T.IcosahedronGeometry(0.19, 1), 0, 0.98, -0.3); break;
        default: cap(0.535, 0.5);   // 'short' (classic cap, forehead visible)
      }
    }

    /** Rebuild every mesh from a new look (keeps the same root in the scene). */
    rebuild(look) {
      this.root.children.slice().forEach(c => {
        c.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material && !Object.values(matCache).includes(o.material)) o.material.dispose();
        });
        this.root.remove(c);
      });
      this.look = look; this.hitFX = null; this.fire = false;
      this.build();
      this.resetPose();
    }

    /** Facial expression: neutral | focused | shock | pain | dizzy | grin | ko.
     *  Morphs mouth shape, brow angle, eyelids — the face tells the story. */
    setExpression(expr, dur) {
      this.expr = expr;
      const d = dur || 0.18;
      const M = this.mouthShapes[expr === 'shock' ? 'open' : expr === 'pain' ? 'grimace' : expr === 'grin' ? 'grin' : 'neutral'] || this.mouthShapes.neutral;
      SAK.Tween.to(this.mouth.scale, { x: M.sx / 0.22, y: M.sy / 0.07 }, d);
      SAK.Tween.to(this.mouth.position, { y: M.y }, d);
      // Brows: focused = angled down/in, shock = raised high, pain = pinched up/inner
      const browCfg = {
        neutral: { y: 0, rot: 0 }, focused: { y: -0.04, rot: 0.3 },
        shock: { y: 0.08, rot: -0.25 }, pain: { y: 0.05, rot: 0.5 },
        dizzy: { y: 0.03, rot: 0.15 }, grin: { y: -0.02, rot: -0.1 }, ko: { y: 0, rot: 0 },
      }[expr] || { y: 0, rot: 0 };
      this.brows.forEach((b, i) => {
        const sx = i === 0 ? -1 : 1;
        SAK.Tween.to(b.position, { y: b.userData.baseY + browCfg.y }, d);
        SAK.Tween.to(b.rotation, { z: b.userData.baseRotZ + sx * browCfg.rot * 0.5 }, d);
      });
      // Eyelids: squint on pain/focused, wide (hidden) on shock
      const lidOpen = { shock: 0, pain: 0.7, focused: 0.5, dizzy: 0.3 }[expr];
      this.lids.forEach(lid => {
        lid.visible = lidOpen !== undefined && lidOpen > 0;
        if (lid.visible) SAK.Tween.to(lid.scale, { y: 1 + lidOpen * 4 }, d);
      });
      // X eyes on KO
      if (this.xEyes) this.xEyes.visible = (expr === 'ko');
      if (this.eyes) this.eyes.visible = (expr !== 'ko');
    }

    buildAccessory() {
      const L = this.look, a = L.accent || '#111', H = this.head;
      const add = (geo, color, x, y, z, opts) => { const m = mesh(geo, typeof color === 'string' ? mat(color) : color, x, y, z); if (opts) opts(m); H.add(m); return m; };
      switch (L.accessory) {
        case 'shades':
          for (const sx of [-1, 1]) add(new T.BoxGeometry(0.28, 0.16, 0.06), a, sx * 0.18, 0.5, 0.53);
          add(new T.BoxGeometry(0.14, 0.04, 0.04), a, 0, 0.53, 0.54); break;
        case 'cap':
          add(new T.SphereGeometry(0.55, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.45), L.shirt, 0, 0.55, 0);
          add(new T.BoxGeometry(0.62, 0.05, 0.4), L.shirt, 0, 0.7, 0.45, m => { m.rotation.x = 0.15; }); break;
        case 'crown': {
          const goldMat = new T.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.9, roughness: 0.25 });
          add(new T.CylinderGeometry(0.34, 0.37, 0.2, 10, 1, true), goldMat, 0, 0.98, 0);
          add(new T.TorusGeometry(0.35, 0.03, 6, 20), goldMat, 0, 0.88, 0).rotation.x = Math.PI / 2;
          for (let i = 0; i < 8; i++) {
            const ang = i / 8 * Math.PI * 2;
            const spike = add(new T.ConeGeometry(0.06, 0.22, 5), goldMat, Math.sin(ang) * 0.34, 1.18, Math.cos(ang) * 0.34);
            // Jewel on every other spike
            if (i % 2 === 0) {
              const jewel = add(new T.OctahedronGeometry(0.045),
                new T.MeshStandardMaterial({ color: i % 4 === 0 ? '#ff2d55' : '#4fa8ff', metalness: 0.3, roughness: 0.1, emissive: new T.Color(i % 4 === 0 ? '#ff2d55' : '#4fa8ff'), emissiveIntensity: 0.4 }),
                Math.sin(ang) * 0.34, 1.28, Math.cos(ang) * 0.34);
            }
          }
          // Front centerpiece gem
          add(new T.OctahedronGeometry(0.07),
            new T.MeshStandardMaterial({ color: '#ff2d55', metalness: 0.2, roughness: 0.05, emissive: new T.Color('#ff2d55'), emissiveIntensity: 0.5 }),
            0, 1.0, 0.37);
          break; }
        case 'laser': {
          // Red glowing eyes (the meme look) — beams removed, glow stays.
          const gm = new T.MeshBasicMaterial({ color: '#ff2222' });
          const gm2 = new T.MeshBasicMaterial({ color: '#ff8888', transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false });
          for (const sx of [-1, 1]) {
            add(new T.SphereGeometry(0.055, 8, 6), gm, sx * 0.18, 0.5, 0.5);
            const halo = new T.Mesh(new T.SphereGeometry(0.1, 8, 6), gm2);
            halo.position.set(sx * 0.18, 0.5, 0.5); H.add(halo);
          } break; }
        case 'headphones':
          add(new T.TorusGeometry(0.56, 0.05, 6, 14, Math.PI), a, 0, 0.42, 0);
          for (const sx of [-1, 1]) add(new T.CylinderGeometry(0.15, 0.15, 0.12, 8), a, sx * 0.54, 0.42, 0, m => { m.rotation.z = Math.PI / 2; }); break;
        case 'tophat':
          add(new T.CylinderGeometry(0.55, 0.55, 0.05, 10), '#111', 0, 0.9, 0);
          add(new T.CylinderGeometry(0.36, 0.38, 0.55, 10), '#111', 0, 1.18, 0);
          add(new T.CylinderGeometry(0.385, 0.385, 0.1, 10), a, 0, 0.98, 0); break;
        case 'beanie':
          add(new T.SphereGeometry(0.55, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), a, 0, 0.52, 0);
          add(new T.CylinderGeometry(0.56, 0.56, 0.14, 10), '#ffffff', 0, 0.55, 0);
          add(new T.IcosahedronGeometry(0.11, 0), '#ffffff', 0, 1.1, 0); break;
        case 'visor':
          add(new T.BoxGeometry(0.78, 0.18, 0.12), mat(a, { transparent: true, opacity: 0.85 }), 0, 0.5, 0.47);
          add(new T.TorusGeometry(0.52, 0.03, 4, 16), '#222', 0, 0.5, 0, m => { m.rotation.x = Math.PI / 2; }); break;
        case 'unicorn': {
          const horn = add(new T.ConeGeometry(0.11, 0.55, 6), mat(a, {}), 0, 1.02, 0.22, m => { m.rotation.x = 0.45; });
          horn.material.emissive = new T.Color('#5a2a7a');
          for (const sx of [-1, 1]) add(new T.ConeGeometry(0.09, 0.2, 4), L.hair, sx * 0.3, 0.92, -0.05, m => { m.rotation.z = -sx * 0.4; });
          break; }
        case 'headband':
          add(new T.CylinderGeometry(0.52, 0.52, 0.1, 10), '#ff3b3b', 0, 0.68, 0);
          add(new T.BoxGeometry(0.06, 0.3, 0.06), '#ff3b3b', 0.1, 0.55, -0.52, m => { m.rotation.z = 0.5; }); break;
      }
    }

    /** Apply a pose to one arm. lift = sideways raise, swing >0 back / <0 forward. */
    applyArm(arm, lift, swing, elbow) {
      const s = arm.side;
      arm.shoulder.rotation.set(0, s * swing, s * lift);
      arm.elbow.rotation.set(0, 0, s * elbow);
    }

    update(dt) {
      this.idlePhase += dt;
      // knockout: ballistic flight → slapstick landing pose
      if (this.ko) {
        const k = this.ko;
        if (k.phase === 'land') {
          // pose was stamped once on landing — just a tiny decaying settle
          // wobble (absolute, so it can't drift)
          const wob = k.landT !== undefined ? Math.max(0, 1 - (time - k.landT) * 1.2) : 0;
          if (k.baseRz !== undefined) this.root.rotation.z = k.baseRz + Math.sin(time * 14) * 0.02 * wob;
          return;
        }
        k.vel.y -= 11.5 * dt; // slightly floatier cartoon arc
        this.root.position.addScaledVector(k.vel, dt);
        this.root.rotation.x += k.spin.x * dt;
        this.root.rotation.y += (k.spin.y || 0) * dt;
        this.root.rotation.z += k.spin.z * dt;
        // Ground hit → freeze into a random awkward pose
        if (this.root.position.y <= 0.08 && k.vel.y < 0) {
          this.root.position.y = 0.08;
          k.vel.set(0, 0, 0);
          k.spin.set(0, 0, 0);
          k.landPose = k.landPose || pickLandPose();
          this.stampLandPose(k.landPose);
          const dust = this.root.position.clone(); dust.y = 0.12;
          burst(dust, ['#c4a574', '#ffd23f', '#ffffff', '#e8d5a3'], 32, 3.2);
          ring(dust, '#ffd23f');
          shake = Math.max(shake, 0.5);
        }
        return;
      }
      // springs
      for (const sp of [this.yaw, this.roll]) { sp.v += (-140 * sp.x - 10 * sp.v) * dt; sp.x += sp.v * dt; }
      const p = this.pose, idle = Math.sin(this.idlePhase * 2.2);
      this.torso.rotation.set(p.lean + idle * 0.015, p.twist, this.roll.x * 0.5);
      this.head.rotation.set(-p.lean * 0.5, this.yaw.x, this.roll.x);
      this.torso.position.y = 0.95 + idle * 0.012;
      this.root.position.z = this.homeZ + this.facing * p.lunge;
      // slapping arm uses the tweened pose; the other arm idles / guards
      this.applyArm(this.arms[this.armSide], p.lift, p.swing, p.elbow);
      const g = p.guard;
      this.applyArm(this.arms[-this.armSide], 0.12 + idle * 0.03 + g * 0.9, -g * 1.2, 0.15 + g * 1.9);
      if (this.rage.visible) { const k = 1 + Math.sin(time * 14) * 0.08; this.rage.scale.set(k, k, k); this.rage.material.opacity = 0.18 + Math.random() * 0.12; }
      // Face-squash + dizzy stars from a slap reaction
      if (this.hitFX) {
        const h = this.hitFX;
        const u = Math.max(0, Math.min(1, (h.until - time) / h.dur)); // 1→0
        const e = u * u;
        this.skull.scale.set(
          this.skullBase.x * (1 + (h.sx - 1) * e),
          this.skullBase.y * (1 + (h.sy - 1) * e),
          this.skullBase.z * (1 + (h.sz - 1) * e)
        );
        if (h.stars) {
          h.stars.rotation.y += dt * (5 + (1 - u) * 2);
          h.stars.children.forEach((c, i) => {
            c.position.y = 0.75 + Math.sin(time * 9 + i * 1.7) * 0.1;
            c.rotation.z += dt * 5;
            c.rotation.x += dt * 3;
          });
        }
        if (time >= h.until) {
          this.skull.scale.copy(this.skullBase);
          if (h.stars) {
            h.stars.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
            this.head.remove(h.stars);
          }
          this.hitFX = null;
        }
      }
    }

    get slapHand() { return this.arms[this.armSide].hand; }

    headWorld(out) { return this.skull.getWorldPosition(out || new T.Vector3()); }

    setDamage(frac) { this.blushMat.opacity = Math.min(0.75, frac * 0.9); }

    /** Progressive cartoon bruising: black eye fades in first, cheek scratch at higher damage. */
    setBruise(frac) {
      this.bruiseLevel = frac;
      this.bruiseMat.opacity = Math.min(0.85, frac * 0.9);
      this.cutMat.opacity = frac > 0.45 ? Math.min(0.9, (frac - 0.45) * 1.6) : 0;
    }

    setFire(on) {
      this.fire = on;
      const m = this.arms[this.armSide].handMat;
      if (on) { m.color.set('#ffc21a'); m.emissive.set('#ff6a00'); m.emissiveIntensity = 0.9; }
      else { m.color.set(this.look.skin); m.emissive.set('#000000'); }
      this.slapHand.scale.set(on ? 1.1 : 1, on ? 1.5 : 1, on ? 1.6 : 1);
    }

    /** Snap into a slapstick KO landing pose (root + torso/head/arms). */
    applyLandPose(P) {
      if (!P) return;
      const faceY = this.facing > 0 ? 0 : Math.PI;
      this.root.rotation.set(P.rx, faceY + (P.ry || 0), P.rz || 0);
      this.root.position.y = P.y;
      this.torso.position.y = 0.95;
      this.torso.rotation.set(P.tx || 0, P.ty || 0, P.tz || 0);
      this.head.rotation.set(P.hx || 0, P.hy || 0, P.hz || 0);
      this.applyArm(this.arms[-1], ...(P.armL || [1.2, 0.5, 0.4]));
      this.applyArm(this.arms[1], ...(P.armR || [1.2, -0.5, 0.4]));
      this.xEyes.visible = true; this.eyes.visible = false;
      this.mouth.scale.set(1, 3, 1);
    }

    /** Freeze into the KO landing pose ONCE (no per-frame snap) + start settle. */
    stampLandPose(P) {
      if (!P) return;
      this.ko = Object.assign(this.ko || {}, { phase: 'land', landPose: P, landT: time, baseRz: P.rz || 0 });
      this.applyLandPose(P);
    }

    clearHitFX() {
      if (!this.hitFX) return;
      if (this.hitFX.stars) {
        this.hitFX.stars.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.head.remove(this.hitFX.stars);
      }
      if (this.skullBase) this.skull.scale.copy(this.skullBase);
      this.hitFX = null;
    }

    resetPose() {
      Object.assign(this.pose, { lift: 0.12, swing: 0, elbow: 0.15, twist: 0, lean: 0, lunge: 0, guard: 0 });
      this.yaw.x = this.yaw.v = this.roll.x = this.roll.v = 0;
      this.ko = null; this.xEyes.visible = false; this.eyes.visible = true;
      this.mouth.scale.set(1, 1, 1);
      if (this.eyes) this.eyes.scale.set(1, 1, 1);
      this.clearHitFX();
      this.root.position.set(0, 0, this.homeZ);
      this.root.rotation.set(0, this.facing > 0 ? 0 : Math.PI, 0);
      this.torso.position.y = 0.95;
      this.torso.rotation.set(0, 0, 0);
      this.head.rotation.set(0, 0, 0);
      this.setDamage(0);
      this.setBruise(0);
    }

    dispose() {
      this.root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !Object.values(matCache).includes(o.material)) o.material.dispose();
      });
      if (this.root.parent) this.root.parent.remove(this.root);
    }
  }

  /* ============================================================== Arena */
  // Degenerate-memecoin arena: neon ring, chart billboards, WAGMI/HODL/GM
  // banners, moon + rocket, original frog & dog mascots, crowd.
  let chart = null, rocket = null, mascots = [], neonLights = [], coinRainList = [];
  let rektFlicker = null; // { light, bulbMat } — REKT Alley flickering bulb

  /** Canvas → texture helper. draw(ctx, w, h) paints the canvas. */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); draw(ctx, w, h);
    const tex = new T.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, ctx, canvas: c };
  }
  const FONT = '"Lilita One", "Arial Black", Impact, sans-serif';

  function neonText(ctx, text, x, y, size, color, glow) {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.14; ctx.strokeStyle = '#12002b';
    ctx.shadowColor = glow || color; ctx.shadowBlur = size * 0.35;
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  /** Live pump/dump candlestick screen. */
  function makeChart() {
    const candlesData = [];
    let price = 100;
    for (let i = 0; i < 26; i++) { const o = price; price *= 1 + (Math.random() - 0.45) * 0.12; candlesData.push({ o, c: price, h: Math.max(o, price) * 1.03, l: Math.min(o, price) * 0.97 }); }
    const ct = canvasTex(512, 320, () => {});
    const draw = () => {
      const ctx = ct.ctx, w = 512, h = 320;
      ctx.fillStyle = '#0a0220'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2b1a5a'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 50); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 50; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const hi = Math.max(...candlesData.map(c => c.h)), lo = Math.min(...candlesData.map(c => c.l));
      const Y = v => 300 - (v - lo) / (hi - lo || 1) * 230;
      candlesData.forEach((c, i) => {
        const x = 14 + i * 19, up = c.c >= c.o, col = up ? '#39ff88' : '#ff3b5c';
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + 6, Y(c.h)); ctx.lineTo(x + 6, Y(c.l)); ctx.stroke();
        ctx.fillRect(x, Math.min(Y(c.o), Y(c.c)), 12, Math.max(3, Math.abs(Y(c.o) - Y(c.c))));
      });
      ctx.shadowBlur = 0;
      const first = candlesData[0].o, last = candlesData[candlesData.length - 1].c, pct = (last / first - 1) * 100, up = pct >= 0;
      ctx.fillStyle = '#12002b'; ctx.fillRect(0, 0, w, 46);
      neonText(ctx, '$SLAP / PTS', 110, 25, 28, '#ffffff', '#b44dff');
      neonText(ctx, `${up ? '▲ +' : '▼ '}${pct.toFixed(1)}%`, 380, 25, 30, up ? '#39ff88' : '#ff3b5c');
      if (Math.abs(pct) > 25) neonText(ctx, up ? 'PUMP IT!' : 'DUMP!', 256, 170, 64, up ? '#39ff88' : '#ff3b5c');
      ct.tex.needsUpdate = true;
    };
    draw();
    return {
      tex: ct.tex, t: 0,
      step() {   // push a new candle: random walk with occasional mega pump / dump
        const o = candlesData[candlesData.length - 1].c;
        const shock = Math.random() < 0.08 ? (Math.random() < 0.6 ? 0.35 : -0.3) : 0;
        const c = o * (1 + (Math.random() - 0.46) * 0.14 + shock);
        candlesData.push({ o, c, h: Math.max(o, c) * (1 + Math.random() * 0.04), l: Math.min(o, c) * (1 - Math.random() * 0.04) });
        candlesData.shift(); draw();
      }
    };
  }

  function billboard(tex, w, h, ang, r, y) {
    const g = new T.Group();
    const frame = mesh(new T.BoxGeometry(w + 0.25, h + 0.25, 0.15), mat('#1a0b3a'), 0, 0, -0.1); g.add(frame);
    const glow = new T.Mesh(new T.BoxGeometry(w + 0.4, h + 0.4, 0.05), new T.MeshBasicMaterial({ color: '#b44dff' }));
    glow.position.z = -0.2; g.add(glow);
    const screen = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    g.add(screen);
    for (const sx of [-1, 1]) g.add(mesh(new T.CylinderGeometry(0.08, 0.1, y, 6), mat('#2a1458'), sx * w * 0.35, -y / 2 - h / 2 + 0.2, -0.2));
    const rad = ang * Math.PI / 180;
    g.position.set(Math.cos(rad) * r, y, Math.sin(rad) * r);
    g.lookAt(0, y, 0);
    (arenaGroup || scene).add(g);
    return g;
  }

  function textPanel(text, color, bg, w, h) {
    return canvasTex(w, h, (ctx, W2, H2) => {
      const grd = ctx.createLinearGradient(0, 0, 0, H2); grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1]);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, W2, H2);
      ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.shadowColor = color; ctx.shadowBlur = 20; ctx.strokeRect(10, 10, W2 - 20, H2 - 20); ctx.shadowBlur = 0;
      neonText(ctx, text, W2 / 2, H2 / 2 + 4, H2 * 0.55, color);
    }).tex;
  }

  /** Original low-poly frog mascot (memecoin vibe, not any existing character). */
  function makeFrog() {
    const g = new T.Group(), green = mat('#5ee05a'), belly = mat('#c9f7a0');
    const body = mesh(new T.IcosahedronGeometry(0.6, 1), green, 0, 0.55, 0); body.scale.set(1.15, 0.9, 1); g.add(body);
    g.add(mesh(new T.IcosahedronGeometry(0.42, 1), belly, 0, 0.45, 0.32));
    for (const sx of [-1, 1]) {
      g.add(mesh(new T.IcosahedronGeometry(0.22, 1), green, sx * 0.3, 1.08, 0.12));
      g.add(mesh(new T.SphereGeometry(0.15, 8, 6), mat('#ffffff'), sx * 0.3, 1.12, 0.26));
      g.add(mesh(new T.SphereGeometry(0.075, 6, 5), mat('#111111'), sx * 0.3, 1.13, 0.39));
      g.add(mesh(new T.IcosahedronGeometry(0.18, 0), green, sx * 0.55, 0.12, 0.25));
    }
    const mouth = mesh(new T.TorusGeometry(0.3, 0.04, 4, 12, Math.PI), mat('#2b6b1f'), 0, 0.72, 0.5); mouth.rotation.z = Math.PI; g.add(mouth);
    g.add(mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 5), mat('#3a2a1a'), 0.75, 0.9, 0.1));            // sign pole
    const sign = new T.Mesh(new T.PlaneGeometry(0.9, 0.5), new T.MeshBasicMaterial({ map: textPanel('GM', '#39ff88', ['#12002b', '#2a0b5e'], 256, 140), side: T.DoubleSide }));
    sign.position.set(0.75, 1.6, 0.12); g.add(sign);
    return g;
  }

  /** Original low-poly dog mascot. */
  function makeDog() {
    const g = new T.Group(), fur = mat('#ffae3b'), white = mat('#fff3e0');
    const body = mesh(new T.IcosahedronGeometry(0.5, 1), fur, 0, 0.5, 0); body.scale.set(1, 1, 1.1); g.add(body);
    const head = new T.Group(); head.position.y = 1.15; g.add(head);
    head.add(mesh(new T.IcosahedronGeometry(0.42, 1), fur, 0, 0, 0));
    head.add(mesh(new T.IcosahedronGeometry(0.22, 1), white, 0, -0.1, 0.32));
    head.add(mesh(new T.SphereGeometry(0.07, 6, 5), mat('#111111'), 0, -0.02, 0.52));
    for (const sx of [-1, 1]) {
      const ear = mesh(new T.ConeGeometry(0.14, 0.32, 4), fur, sx * 0.24, 0.42, 0); ear.rotation.z = -sx * 0.3; head.add(ear);
      head.add(mesh(new T.SphereGeometry(0.06, 6, 5), mat('#111111'), sx * 0.15, 0.1, 0.36));
    }
    const tail = mesh(new T.TorusGeometry(0.15, 0.06, 4, 8, Math.PI * 1.5), fur, 0, 0.75, -0.5); g.add(tail);
    g.add(mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 5), mat('#3a2a1a'), -0.7, 0.9, 0.1));
    const sign = new T.Mesh(new T.PlaneGeometry(0.95, 0.5), new T.MeshBasicMaterial({ map: textPanel('HODL', '#ffd23f', ['#12002b', '#2a0b5e'], 256, 140), side: T.DoubleSide }));
    sign.position.set(-0.7, 1.6, 0.12); g.add(sign);
    g.userData.head = head;
    return g;
  }

  /** Original low-poly cat mascot (memecoin vibe, not any existing character). */
  function makeCat() {
    const g = new T.Group(), fur = mat('#c9a46b'), white = mat('#fff3e0');
    const body = mesh(new T.IcosahedronGeometry(0.5, 1), fur, 0, 0.5, 0); body.scale.set(1, 1, 1.1); g.add(body);
    g.add(mesh(new T.IcosahedronGeometry(0.3, 1), white, 0, 0.42, 0.28));
    const head = new T.Group(); head.position.y = 1.15; g.add(head);
    head.add(mesh(new T.IcosahedronGeometry(0.4, 1), fur, 0, 0, 0));
    for (const sx of [-1, 1]) {
      head.add(mesh(new T.ConeGeometry(0.16, 0.34, 4), fur, sx * 0.22, 0.42, 0));
      head.add(mesh(new T.SphereGeometry(0.07, 6, 5), mat('#111111'), sx * 0.14, 0.08, 0.35));
      for (const wy of [0.0, -0.09])
        head.add(mesh(new T.BoxGeometry(0.3, 0.015, 0.015), mat('#ffffff'), sx * 0.36, wy, 0.32));
    }
    head.add(mesh(new T.SphereGeometry(0.05, 6, 5), mat('#ff8a9a'), 0, -0.08, 0.4));
    const tail = mesh(new T.TorusGeometry(0.16, 0.06, 4, 8, Math.PI * 1.5), fur, 0, 0.7, -0.5); g.add(tail);
    g.add(mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 5), mat('#3a2a1a'), 0.7, 0.9, 0.1));
    const sign = new T.Mesh(new T.PlaneGeometry(0.95, 0.5), new T.MeshBasicMaterial({ map: textPanel('MEOW', '#ff7ad9', ['#12002b', '#2a0b5e'], 256, 140), side: T.DoubleSide }));
    sign.position.set(0.7, 1.6, 0.12); g.add(sign);
    g.userData.head = head;
    return g;
  }

  function makeRocket() {
    const g = new T.Group();
    g.add(mesh(new T.CylinderGeometry(0.28, 0.32, 1.4, 8), mat('#f2f2ff'), 0, 0, 0));
    g.add(mesh(new T.ConeGeometry(0.28, 0.55, 8), mat('#ff3b5c'), 0, 0.97, 0));
    g.add(mesh(new T.CylinderGeometry(0.13, 0.13, 0.06, 10), mat('#39c5ff'), 0, 0.25, 0.28)).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const fin = mesh(new T.BoxGeometry(0.06, 0.45, 0.35), mat('#b44dff'), 0, -0.55, 0);
      const holder = new T.Group(); holder.rotation.y = i * Math.PI * 2 / 3; fin.position.z = 0.3; holder.add(fin); g.add(holder);
    }
    const flame = new T.Mesh(new T.ConeGeometry(0.22, 0.8, 8), new T.MeshBasicMaterial({ color: '#ffb000' }));
    flame.rotation.x = Math.PI; flame.position.y = -1.1; g.add(flame);
    g.userData.flame = flame;
    g.scale.setScalar(0.9);
    return g;
  }

  /* ============================================================== Arenas */
  // V2: 3 degen-memecoin arena styles. arenaGroup holds everything per-arena;
  // setArena() disposes + rebuilds it. Fighters live outside the group.
  let arenaGroup = null, arenaStyle = 'colosseum', crowdExciteUntil = 0;
  const ARENA_DEFS = {
    colosseum: { name: 'Chart Dome', fog: '#2a0b5e' },
    moonshot:  { name: 'Moonshot Launchpad',   fog: '#0a1030' },
    rekt:      { name: 'REKT Alley',            fog: '#1c0512' },
  };
  /** Excite the crowd (jump + wave) for `dur` seconds — KO celebrations. */
  function crowdExcite(dur) { crowdExciteUntil = time + (dur || 2.5); }
  /** Chart Dome: crash the chart on KO — candles dump red, then recover. */
  function chartDump() { chartDumpT = 2.2; }

  function disposeArena() {
    if (!arenaGroup) return;
    arenaGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => {
          if (Object.values(matCache).includes(m)) return; // shared cached mats survive
          if (m.map && m.map.isCanvasTexture) m.map.dispose();
          m.dispose();
        });
      }
    });
    scene.remove(arenaGroup);
    arenaGroup = null;
  }

  /** Switch arena style (also used at boot). Safe to call any time. */
  function setArena(style) {
    if (!ARENA_DEFS[style]) style = 'colosseum';
    disposeArena();
    candles = []; coins = []; chartDomeCandles = []; chartDumpT = 0; mascots = []; neonLights = []; coinRainList = [];
    chart = null; rocket = null; rektFlicker = null;
    arenaStyle = style;
    arenaGroup = new T.Group();
    scene.add(arenaGroup);
    buildArenaCore(arenaGroup);
    if (style === 'moonshot') buildMoonshot(arenaGroup);
    else if (style === 'rekt') buildRekt(arenaGroup);
    else buildColosseum(arenaGroup);
    if (scene.fog) scene.fog.color.set(ARENA_DEFS[style].fog);
  }

  /** Full-360° night backdrop: gradient sky + stars + lit city skyline, so the
   *  background is never a blank void no matter where the camera swings. */
  function buildBackdrop(AG) {
    const palettes = {
      colosseum: { top: '#0d0221', mid: '#2a0b5e', bot: '#150430', win: '#ffd23f' },
      moonshot:  { top: '#020610', mid: '#0a1030', bot: '#060a20', win: '#39c5ff' },
      rekt:      { top: '#0d0208', mid: '#1c0512', bot: '#0d0209', win: '#ff3b5c' },
    };
    const P = palettes[arenaStyle] || palettes.colosseum;
    const { tex } = canvasTex(1024, 512, (ctx, w, h) => {
      const grd = ctx.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, P.top); grd.addColorStop(0.55, P.mid); grd.addColorStop(1, P.bot);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
      // stars
      for (let i = 0; i < 240; i++) {
        const x = Math.random() * w, y = Math.random() * h * 0.62, r = Math.random() * 1.6 + 0.3;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + Math.random() * 0.65).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      // distant lit skyline silhouette
      let x = 0;
      while (x < w) {
        const bw = 30 + Math.random() * 70, bh = 60 + Math.random() * 130, by = h - bh;
        ctx.fillStyle = '#05010d'; ctx.globalAlpha = 1;
        ctx.fillRect(x, by, bw, bh);
        for (let wy = by + 10; wy < h - 8; wy += 14)
          for (let wx = x + 6; wx < x + bw - 6; wx += 12)
            if (Math.random() < 0.38) {
              ctx.fillStyle = P.win; ctx.globalAlpha = 0.35 + Math.random() * 0.55;
              ctx.fillRect(wx, wy, 5, 7);
            }
        ctx.globalAlpha = 1; ctx.fillStyle = '#05010d';
        if (Math.random() < 0.5) ctx.fillRect(x + bw / 2 - 1, by - 22, 2, 22); // antenna
        // red aircraft-warning blinkers on tall towers
        if (bh > 140) { ctx.fillStyle = '#ff2222'; ctx.beginPath(); ctx.arc(x + bw / 2, by - 24, 3, 0, 7); ctx.fill(); }
        x += bw + 8 + Math.random() * 22;
      }
    });
    tex.wrapS = T.RepeatWrapping; tex.repeat.x = 3;
    const m = new T.Mesh(
      new T.CylinderGeometry(24, 24, 20, 48, 1, true),
      new T.MeshBasicMaterial({ map: tex, side: T.BackSide, fog: false })
    );
    m.position.y = 7;
    AG.add(m);
  }

  /** Shared core: floor, neon ring, slap table, coin stacks, crowd. */
  function buildArenaCore(AG) {

    // floor + neon ring
    const floor = mesh(new T.CylinderGeometry(14, 14, 0.2, 28), mat('#1a0640'), 0, -0.1, 0);
    floor.castShadow = false; AG.add(floor);
    const ringTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#4b16b0'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#6d2fe0'; ctx.lineWidth = 3;
      for (let i = 0; i <= w; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
      ctx.save(); ctx.translate(w / 2, h / 2);
      // Solana logo: three slanted bars (SOL gradient green->blue->purple)
      ctx.save(); ctx.globalAlpha = 0.9;
      const barW = 120, barH = 26, gap = 14, slant = 18;
      const grad = ctx.createLinearGradient(-60, -60, 60, 60);
      grad.addColorStop(0, '#14f195'); grad.addColorStop(0.5, '#39c5ff'); grad.addColorStop(1, '#b44dff');
      ctx.fillStyle = grad;
      for (let b = -1; b <= 1; b++) {
        const y = b * (barH + gap);
        ctx.beginPath();
        ctx.moveTo(-barW / 2 + slant, y - barH / 2);
        ctx.lineTo(barW / 2 + slant, y - barH / 2);
        ctx.lineTo(barW / 2 - slant, y + barH / 2);
        ctx.lineTo(-barW / 2 - slant, y + barH / 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.restore();
    }).tex;
    const ringMat = new T.MeshLambertMaterial({ map: ringTex });
    const mat2 = mesh(new T.CylinderGeometry(3.2, 3.4, 0.12, 24), [mat('#2a0b5e'), ringMat, mat('#2a0b5e')], 0, 0.02, 0);
    mat2.castShadow = false; AG.add(mat2);
    const neonG = new T.MeshBasicMaterial({ color: '#39ff88' }), neonP = new T.MeshBasicMaterial({ color: '#ff4fd8' });
    const ringEdge = new T.Mesh(new T.TorusGeometry(3.3, 0.07, 6, 48), neonG); ringEdge.rotation.x = Math.PI / 2; ringEdge.position.y = 0.1; AG.add(ringEdge);
    const ringEdge2 = new T.Mesh(new T.TorusGeometry(3.55, 0.05, 6, 48), neonP); ringEdge2.rotation.x = Math.PI / 2; ringEdge2.position.y = 0.06; AG.add(ringEdge2);

    // table (wood) + PTS coin stacks
    const wood = mat('#c9844a'), woodDark = mat('#8f5427');
    AG.add(mesh(new T.BoxGeometry(1.9, 0.12, 1.0), wood, 0, 1.0, 0));
    AG.add(mesh(new T.BoxGeometry(1.95, 0.06, 1.05), woodDark, 0, 0.92, 0));
    for (const x of [-0.8, 0.8]) for (const z of [-0.38, 0.38]) AG.add(mesh(new T.CylinderGeometry(0.06, 0.05, 0.9, 6), woodDark, x, 0.45, z));
    const coinMat = mat('#ffcc22', {}); coinMat.emissive = new T.Color('#5a3a00');
    SAK.Scene3D._coinMat = coinMat;
    for (let i = 0; i < 5; i++) AG.add(mesh(new T.CylinderGeometry(0.12, 0.12, 0.035, 10), coinMat, -0.65, 1.075 + i * 0.037, 0.05 * (i % 2)));
    for (let i = 0; i < 3; i++) AG.add(mesh(new T.CylinderGeometry(0.12, 0.12, 0.035, 10), coinMat, -0.4, 1.075 + i * 0.037, -0.15));

    // crowd: a full 360° ring of little fight fans with faces, hair and clothes
    // waving glow sticks — no blank side no matter where the camera swings
    const skinTones = ['#f2c49b', '#e8b088', '#d9a066', '#b07a4a', '#8a5a35', '#6e4426'];
    const shirtCols = ['#ff4fd8', '#39c5ff', '#ffe23d', '#39ff88', '#ff7a1a', '#b44dff', '#ff3b5c', '#f5f5f5', '#2e9dff', '#7dff6a'];
    const hairCols = ['#141414', '#3a2410', '#6e4a1f', '#c9a24a', '#a33327', '#2b4f9e', '#6e6e6e', '#1f7a4d', '#d97fb0'];
    const capCols = ['#ff3b5c', '#2e9dff', '#39ff88', '#ffd23f', '#f5f5f5', '#ff4fd8'];
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2;
      const r = 5.6 + (i % 2) * 0.8;
      const g = new T.Group();
      const skin = skinTones[i % skinTones.length];
      const shirt = shirtCols[(i * 3 + 1) % shirtCols.length];
      const s = 0.9 + ((i * 37) % 10) / 10 * 0.25; // height variety, deterministic
      // torso (clothing)
      const torso = new T.Mesh(new T.CylinderGeometry(0.28, 0.34, 0.85, 8), mat(shirt));
      g.add(torso);
      // arms + hands
      for (const sx of [-1, 1]) {
        const arm = new T.Mesh(new T.CylinderGeometry(0.07, 0.06, 0.5, 6), mat(shirt));
        arm.position.set(sx * 0.37, 0.1, 0); arm.rotation.z = sx * -0.3; g.add(arm);
        const hand = new T.Mesh(new T.SphereGeometry(0.075, 6, 5), mat(skin));
        hand.position.set(sx * 0.45, -0.16, 0); g.add(hand);
      }
      // head: big and high-contrast so faces read on phone screens.
      // A neck separates it from the torso; hair/cap sit strictly ON TOP
      // (hemisphere) so they can never swallow the face.
      const neck = new T.Mesh(new T.CylinderGeometry(0.09, 0.1, 0.18, 6), mat(skin));
      neck.position.y = 0.5; g.add(neck);
      const head = new T.Mesh(new T.SphereGeometry(0.3, 12, 10), mat(skin));
      head.position.y = 0.7; g.add(head);
      // hair or beanie cap (+z faces the ring after lookAt). No brim — brims
      // shade the eyes out from the fight camera, reading as a missing face.
      if (i % 3 === 2) {
        const capC = capCols[i % capCols.length];
        const dome = new T.Mesh(new T.SphereGeometry(0.315, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(capC));
        dome.position.set(0, 0.78, -0.03); g.add(dome);
      } else {
        const hair = new T.Mesh(new T.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(hairCols[(i * 5 + 2) % hairCols.length]));
        hair.position.set(0, 0.78, -0.03); g.add(hair);
      }
      // face: big unlit eyes + smile or cheering "O" mouth
      const eyeMat = new T.MeshBasicMaterial({ color: '#0a0a0a' });
      for (const sx of [-1, 1]) {
        const eye = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), eyeMat);
        eye.position.set(sx * 0.11, 0.73, 0.285); g.add(eye);
      }
      if (i % 2) {
        const smile = new T.Mesh(new T.TorusGeometry(0.07, 0.018, 4, 10, Math.PI), new T.MeshBasicMaterial({ color: '#5a1a1a' }));
        smile.position.set(0, 0.64, 0.29); smile.rotation.z = Math.PI; g.add(smile);
      } else {
        const ooh = new T.Mesh(new T.CircleGeometry(0.04, 10), new T.MeshBasicMaterial({ color: '#4a1414' }));
        ooh.position.set(0, 0.62, 0.292); g.add(ooh);
      }
      // glow stick waved in the right hand
      const stick = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.5, 4), new T.MeshBasicMaterial({ color: i % 2 ? '#39ff88' : '#ff4fd8' }));
      stick.position.set(0.47, 0.3, 0.05); stick.rotation.z = -0.4; g.add(stick);
      g.scale.setScalar(s);
      g.position.set(Math.cos(ang) * r, 0.45, Math.sin(ang) * r);
      g.lookAt(0, 0.45, 0);
      g.userData.baseQ = g.quaternion.clone(); // base orientation — the wobble below must compose onto this, never assign rotation.z (that flips lookAt'd groups upside-down)
      g.userData.phase = Math.random() * 6; g.userData.crowd = true;
      AG.add(g); candles.push(g);
    }

    // 360° night backdrop + filler billboards covering the old bare angles,
    // so the background stays dressed wherever the camera swings
    buildBackdrop(AG);
    // dark apron sealing the ground between floor edge and backdrop
    const apron = new T.Mesh(new T.CircleGeometry(24, 40), mat('#0a0318'));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.16;
    AG.add(apron);
    billboard(textPanel('HODL', '#ffd23f', ['#12002b', '#3a2a0b'], 512, 220), 3.4, 1.5, 55, 8.6, 3.4);
    billboard(textPanel('WAGMI', '#39ff88', ['#12002b', '#2a0b5e'], 512, 220), 3.4, 1.5, 95, 8.6, 3.8);
    billboard(textPanel('SMACK-A-KOL', '#ff4fd8', ['#2a0b2e', '#5e0b3a'], 640, 200), 3.8, 1.15, 130, 8.6, 3.2);
  }

  /** Candlestick Colosseum — the original trading-floor arena, V2 dressed. */
  function buildColosseum(AG) {
    // billboards: live chart + slogans (arc behind the ring, visible from both cameras)
    chart = makeChart();
    billboard(chart.tex, 4.2, 2.6, 215, 8.5, 3.6);
    billboard(textPanel('WAGMI', '#39ff88', ['#12002b', '#2a0b5e'], 512, 220), 3.6, 1.55, 248, 8.5, 4.4);
    billboard(textPanel('TO THE MOON 🚀', '#ffd23f', ['#2a0b5e', '#5a1aa8'], 768, 200), 4.6, 1.2, 278, 8.8, 3.0);
    billboard(textPanel('NGMI', '#ff3b5c', ['#12002b', '#3a0b2e'], 512, 220), 3.0, 1.3, 183, 8.5, 2.6);
    billboard(chart.tex, 3.2, 2.0, 302, 8.6, 4.2);
    // Solana memecoin degen dressing
    billboard(textPanel('DIAMOND HANDS 💎🙌', '#39ff88', ['#12002b', '#1a3a2e'], 768, 200), 4.6, 1.2, 218, 8.8, 3.4);
    billboard(textPanel('PUMP.FUN', '#39ff88', ['#0b2e1a', '#1a5e3a'], 640, 200), 3.8, 1.15, 262, 8.6, 4.0);
    billboard(textPanel('FOMO', '#ffd23f', ['#2e1a0b', '#5e3a1a'], 512, 200), 3.0, 1.15, 285, 8.6, 3.6);
    billboard(textPanel('SOL ▲ +420%', '#14f195', ['#1a0b3a', '#2a1a5e'], 640, 200), 3.8, 1.15, 158, 8.6, 4.0);

    // low ring-side banners
    const words = [['HODL', '#ffd23f'], ['GM', '#39ff88'], ['NGMI', '#ff3b5c'], ['WAGMI', '#39ff88'], ['PUMP IT', '#ff4fd8'], ['GM', '#39ff88'], ['HODL', '#ffd23f']];
    words.forEach(([w, c], i) => {
      const ang = (150 + i * 25) * Math.PI / 180, r = 4.3;
      const b = new T.Mesh(new T.PlaneGeometry(1.7, 0.55), new T.MeshBasicMaterial({ map: textPanel(w, c, ['#12002b', '#2a0b5e'], 384, 124), side: T.DoubleSide }));
      b.position.set(Math.cos(ang) * r, 0.45, Math.sin(ang) * r); b.lookAt(0, 0.45, 0); AG.add(b);
    });

    // Stage lighting truss behind the ring (Slap Kings arena feel) —
    // dark metal frame with colored spotlights washing the fighters.
    const trussMat = mat('#1a1a22');
    const truss = new T.Group();
    // Two vertical posts
    for (const sx of [-3.2, 3.2]) {
      truss.add(mesh(new T.BoxGeometry(0.25, 5.5, 0.25), trussMat, sx, 2.75, -4.5));
      // Cross-brace X
      const brace1 = mesh(new T.BoxGeometry(0.08, 5.8, 0.08), trussMat, sx, 2.75, -4.5);
      brace1.rotation.z = 0.35; truss.add(brace1);
      const brace2 = mesh(new T.BoxGeometry(0.08, 5.8, 0.08), trussMat, sx, 2.75, -4.5);
      brace2.rotation.z = -0.35; truss.add(brace2);
    }
    // Horizontal bar
    truss.add(mesh(new T.BoxGeometry(6.9, 0.25, 0.25), trussMat, 0, 5.5, -4.5));
    // Spotlights with colored glow
    const spotCols = ['#ff4f6d', '#ffd23f', '#4fa8ff', '#39ff88'];
    spotCols.forEach((c, i) => {
      const x = -2.4 + i * 1.6;
      const housing = mesh(new T.CylinderGeometry(0.18, 0.24, 0.35, 8), trussMat, x, 5.25, -4.5);
      housing.rotation.x = 0.5; truss.add(housing);
      const glow = new T.Mesh(
        new T.SphereGeometry(0.14, 8, 6),
        new T.MeshBasicMaterial({ color: c })
      );
      glow.position.set(x, 5.1, -4.35); truss.add(glow);
      // Light cone (additive, subtle)
      const cone = new T.Mesh(
        new T.ConeGeometry(0.9, 4.5, 12, 1, true),
        new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.07, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })
      );
      cone.position.set(x, 3.0, -4.0); cone.rotation.x = 0.15; truss.add(cone);
    });
    AG.add(truss);

    // moon + stars
    const moon = new T.Mesh(new T.IcosahedronGeometry(2.6, 1), new T.MeshBasicMaterial({ color: '#fff4c2' }));
    moon.position.set(-10, 12, -18); AG.add(moon);    for (let i = 0; i < 6; i++) {
      const cr = new T.Mesh(new T.IcosahedronGeometry(0.35 + Math.random() * 0.4, 0), new T.MeshBasicMaterial({ color: '#e6d48a' }));
      const v = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, 1).normalize().multiplyScalar(2.45);
      cr.position.copy(moon.position).add(v); cr.scale.z = 0.4; cr.lookAt(moon.position); AG.add(cr);
    }
    const starGeo = new T.BufferGeometry(), pts = [];
    for (let i = 0; i < 260; i++) { const a = Math.PI * (0.8 + Math.random() * 1.0), r = 22 + Math.random() * 6; pts.push(Math.cos(a) * r, 6 + Math.random() * 16, Math.sin(a) * r); }
    starGeo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    AG.add(new T.Points(starGeo, new T.PointsMaterial({ color: '#ffffff', size: 0.18, fog: false })));

    // rocket that keeps launching to the moon
    rocket = makeRocket(); rocket.userData.t = 0; AG.add(rocket);

    // neon candle skyline far back
    const green = new T.MeshBasicMaterial({ color: '#39ff88' }), red = new T.MeshBasicMaterial({ color: '#ff3b5c' });
    let price = 3;
    for (let i = 0; i < 26; i++) {
      const up = Math.random() > 0.4, h = 0.6 + Math.random() * 1.8;
      price += up ? h * 0.35 : -h * 0.3; price = Math.max(2, Math.min(8, price));
      const g = new T.Group();
      g.add(new T.Mesh(new T.BoxGeometry(0.5, h, 0.5), up ? green : red), new T.Mesh(new T.BoxGeometry(0.08, h + 1, 0.08), up ? green : red));
      const ang = (170 + i * 5.2) * Math.PI / 180;
      g.position.set(Math.cos(ang) * 14, price + 1, Math.sin(ang) * 14);
      g.userData.baseY = price + 1; g.userData.phase = Math.random() * 6;
      AG.add(g); candles.push(g);
    }
    // CHART DOME centerpiece: giant pumping candlestick chart arcing behind the ring.
    // Big green candles climbing up — the degen battleground.
    chartDomeCandles = [];
    let domePrice = 2.5;
    const domeGreen = new T.MeshBasicMaterial({ color: '#14f195' });
    const domeRed = new T.MeshBasicMaterial({ color: '#ff3b5c' });
    for (let i = 0; i < 14; i++) {
      const up = i < 10 ? Math.random() > 0.25 : Math.random() > 0.6; // mostly pumping
      const h = 1.2 + Math.random() * 2.4;
      domePrice += up ? h * 0.45 : -h * 0.35;
      domePrice = Math.max(2, Math.min(9, domePrice));
      const g = new T.Group();
      const bodyMat = up ? domeGreen : domeRed;
      const body = new T.Mesh(new T.BoxGeometry(0.9, h, 0.9), bodyMat);
      const wick = new T.Mesh(new T.BoxGeometry(0.14, h + 1.6, 0.14), bodyMat);
      g.add(body, wick);
      // Arc across the back, centered behind the fighters
      const ang = (200 + i * 11) * Math.PI / 180;
      g.position.set(Math.cos(ang) * 10.5, domePrice + 1.5, Math.sin(ang) * 10.5);
      g.userData = { baseY: domePrice + 1.5, phase: Math.random() * 6, up, bodyMat, green: domeGreen, red: domeRed };
      AG.add(g); chartDomeCandles.push(g); candles.push(g);
    }
    // floating coins
    for (let i = 0; i < 9; i++) {
      const c = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 0.07, 14), SAK.Scene3D._coinMat);
      c.rotation.x = Math.PI / 2;
      const ang = (180 + Math.random() * 100) * Math.PI / 180, r = 6 + Math.random() * 3;
      c.position.set(Math.cos(ang) * r, 3 + Math.random() * 4, Math.sin(ang) * r);
      c.userData.phase = Math.random() * 6; AG.add(c); coins.push(c);
    }
    // mascots at the ring corners
    const frog = makeFrog(); frog.position.set(-3.9, 0, -2.2); frog.lookAt(2, 0, 3); AG.add(frog);
    const dog = makeDog(); dog.position.set(1.4, 0, -4.2); dog.lookAt(1, 0, 2); AG.add(dog);
    const cat = makeCat(); cat.position.set(4.1, 0, -2.4); cat.lookAt(1, 0, 2); AG.add(cat);
    mascots = [frog, dog, cat];

    // coloured neon fill lights
    const l1 = new T.PointLight('#39ff88', 18, 12); l1.position.set(-3, 3, -3); AG.add(l1);
    const l2 = new T.PointLight('#ff4fd8', 18, 12); l2.position.set(3, 3, -2); AG.add(l2);
    neonLights = [l1, l2];
  }

  /** Moonshot Launchpad — rocket base under a giant moon. */
  function buildMoonshot(AG) {
    // launch pad markings under the ring
    const padTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#10163a'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#39c5ff'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(256, 256, 210, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#b44dff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(256, 256, 150, 0, 7); ctx.stroke();
      neonText(ctx, 'MOONSHOT', 256, 256, 52, '#ffd23f');
    }).tex;
    const pad = new T.Mesh(new T.CylinderGeometry(5.2, 5.4, 0.1, 28),
      new T.MeshToonMaterial({ map: padTex, gradientMap: toonGrad }));
    pad.position.y = -0.06; pad.receiveShadow = true; AG.add(pad);

    // GIANT moon looming behind
    const moon = new T.Mesh(new T.IcosahedronGeometry(5.5, 2), new T.MeshBasicMaterial({ color: '#fff3c4' }));
    moon.position.set(-4, 13, -22); AG.add(moon);
    for (let i = 0; i < 8; i++) {
      const cr = new T.Mesh(new T.IcosahedronGeometry(0.6 + Math.random() * 0.7, 0), new T.MeshBasicMaterial({ color: '#e8d58e' }));
      const v = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, 1).normalize().multiplyScalar(5.2);
      cr.position.copy(moon.position).add(v); cr.scale.z = 0.35; cr.lookAt(moon.position); AG.add(cr);
    }
    // dense star field
    const sg = new T.BufferGeometry(), pts = [];
    for (let i = 0; i < 420; i++) { const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 10; pts.push(Math.cos(a) * r, 5 + Math.random() * 20, Math.sin(a) * r); }
    sg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    AG.add(new T.Points(sg, new T.PointsMaterial({ color: '#cfe8ff', size: 0.22, fog: false })));

    // launch tower (truss)
    const towerMat = mat('#8a93a8'), stripeMat = mat('#ff3b5c');
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5])
      AG.add(mesh(new T.BoxGeometry(0.18, 7.5, 0.18), towerMat, 6.5 + sx, 3.75, -6 + sz));
    for (let y = 0.8; y < 7.2; y += 1.1)
      AG.add(mesh(new T.BoxGeometry(1.2, 0.12, 1.2), y % 2.2 < 1.1 ? stripeMat : towerMat, 6.5, y, -6));
    // rocket parked on the pad
    const parked = makeRocket(); parked.position.set(6.5, 1.6, -3.4); parked.rotation.z = 0.12; AG.add(parked);
    // the looped moon-bound rocket
    rocket = makeRocket(); rocket.userData.t = 0; AG.add(rocket);

    // billboards
    billboard(textPanel('TO THE MOON 🚀', '#ffd23f', ['#0a1030', '#2a1a6e'], 768, 200), 4.8, 1.25, 250, 9, 3.2);
    billboard(textPanel('$SLAP ▲ +999%', '#39ff88', ['#0a1030', '#123a2a'], 640, 200), 3.8, 1.15, 205, 9, 4.4);
    billboard(textPanel('WAGMI', '#39c5ff', ['#0a1030', '#1a2a5e'], 512, 220), 3.4, 1.5, 295, 9, 2.8);
    // degen launchpad dressing
    billboard(textPanel('APE IN 🚀', '#ff7a1a', ['#0a1030', '#3a1a0e'], 640, 200), 3.8, 1.15, 228, 9, 4.2);
    billboard(textPanel('LFGOOO', '#b44dff', ['#0a1030', '#2a1a5e'], 512, 220), 3.2, 1.4, 318, 9, 3.0);
    // floating coins
    const coinMat = mat('#ffcc22', {}); coinMat.emissive = new T.Color('#5a3a00');
    for (let i = 0; i < 8; i++) {
      const c = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 0.07, 14), coinMat);
      c.rotation.x = Math.PI / 2;
      const ang = (180 + Math.random() * 100) * Math.PI / 180, r = 6 + Math.random() * 3;
      c.position.set(Math.cos(ang) * r, 3 + Math.random() * 4, Math.sin(ang) * r);
      c.userData.phase = Math.random() * 6; AG.add(c); coins.push(c);
    }
    // cool blue/purple wash
    const l1 = new T.PointLight('#39c5ff', 20, 14); l1.position.set(-3, 4, -4); AG.add(l1);
    const l2 = new T.PointLight('#b44dff', 20, 14); l2.position.set(4, 3, -3); AG.add(l2);
    neonLights = [l1, l2];
  }

  /** REKT Alley — gritty neon back-alley for the fallen. */
  function buildRekt(AG) {
    // brick walls both sides (canvas texture)
    const brickTex = canvasTex(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#241016'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3a1c26'; ctx.lineWidth = 3;
      for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        for (let x = (y / 32 % 2) * 32; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 32); ctx.stroke(); } }
    }).tex;
    brickTex.wrapS = brickTex.wrapT = T.RepeatWrapping; brickTex.repeat.set(4, 2);
    for (const sx of [-1, 1]) {
      const wall = new T.Mesh(new T.BoxGeometry(0.6, 7, 26), new T.MeshToonMaterial({ map: brickTex, gradientMap: toonGrad }));
      wall.position.set(sx * 8.2, 3.5, -2); wall.receiveShadow = true; AG.add(wall);
    }
    // wet asphalt strip
    const wet = new T.Mesh(new T.CircleGeometry(7.5, 24), new T.MeshBasicMaterial({ color: '#0d060d', transparent: true, opacity: 0.85 }));
    wet.rotation.x = -Math.PI / 2; wet.position.y = 0.005; AG.add(wet);

    // dumpsters
    for (const [x, z, ry] of [[-5.5, -3.5, 0.3], [5.8, -4.5, -0.4]]) {
      const dg = new T.Group();
      dg.add(mesh(new T.BoxGeometry(1.8, 1.1, 1.0), mat('#1f4d2e'), 0, 0.55, 0));
      dg.add(mesh(new T.BoxGeometry(1.9, 0.12, 1.1), mat('#163a22'), 0, 1.15, 0));
      dg.position.set(x, 0, z); dg.rotation.y = ry; AG.add(dg);
    }
    // trash bags
    for (let i = 0; i < 6; i++) {
      const b = mesh(new T.IcosahedronGeometry(0.32 + Math.random() * 0.15, 0), mat('#15151f'), (Math.random() - 0.5) * 11, 0.28, -3 - Math.random() * 4);
      b.scale.y = 0.85; AG.add(b);
    }
    // neon wall signs
    const sign = (txt, color, x, y, z, ry) => {
      const m2 = new T.Mesh(new T.PlaneGeometry(3.2, 1.1),
        new T.MeshBasicMaterial({ map: textPanel(txt, color, ['#120309', '#3a0b1e'], 512, 176), transparent: true, side: T.DoubleSide }));
      m2.position.set(x, y, z); m2.rotation.y = ry; AG.add(m2);
    };
    sign('REKT', '#ff3b5c', -7.8, 4.2, -3, Math.PI / 2);
    sign('NGMI', '#ff9a1f', 7.8, 3.6, -5, -Math.PI / 2);
    sign('DUMP IT', '#ff4fd8', -7.8, 2.6, -8, Math.PI / 2);
    sign('COPE', '#39ff88', -7.8, 5.6, -6, Math.PI / 2);
    sign('LIQUIDATED', '#b44dff', 7.8, 5.0, -8, -Math.PI / 2);
    // hanging wire + flickering bulb
    const curve = new T.QuadraticBezierCurve3(new T.Vector3(-8, 6.4, -4), new T.Vector3(0, 5.2, -4), new T.Vector3(8, 6.4, -4));
    AG.add(new T.Mesh(new T.TubeGeometry(curve, 16, 0.03, 5), new T.MeshBasicMaterial({ color: '#000000' })));
    const bulbMat = new T.MeshBasicMaterial({ color: '#ffd9a0' });
    const bulb = new T.Mesh(new T.SphereGeometry(0.14, 8, 6), bulbMat);
    bulb.position.set(0.6, 5.35, -4); AG.add(bulb);
    const blight = new T.PointLight('#ffb000', 14, 10); blight.position.copy(bulb.position); AG.add(blight);
    rektFlicker = { light: blight, bulbMat };
    // red/pink wash
    const l1 = new T.PointLight('#ff3b5c', 16, 12); l1.position.set(-3, 3, -2); AG.add(l1);
    const l2 = new T.PointLight('#ff4fd8', 14, 12); l2.position.set(3, 2.5, -4); AG.add(l2);
    neonLights = [l1, l2];
    // distant red chart glow billboard
    billboard(textPanel('$SLAP ▼ -99.9%', '#ff3b5c', ['#120309', '#3a0b1e'], 640, 200), 3.8, 1.15, 250, 9.5, 4.2);
  }

  function updateArena(dt) {
    if (chart) { chart.t += dt; if (chart.t > 0.7) { chart.t = 0; chart.step(); } }
    if (rektFlicker) { // buzzing faulty bulb
      const f = Math.random() < 0.1 ? 0.15 : 1;
      rektFlicker.light.intensity = 14 * f;
      rektFlicker.bulbMat.color.set(f < 1 ? '#5a3a20' : '#ffd9a0');
    }
    // rocket: launch from behind the billboards towards the moon, loop
    if (rocket) { const r = rocket.userData; r.t += dt;
    const cyc = r.t % 9;
    rocket.visible = cyc < 6.5;
    const p0 = new T.Vector3(-4, -1, -11), p1 = new T.Vector3(-10, 12, -18);
    const kk = Math.min(1, cyc / 6.5), e = kk * kk;
    rocket.position.lerpVectors(p0, p1, e);
    rocket.position.x += Math.sin(kk * 9) * 0.3;
    rocket.rotation.z = 0.45; rocket.rotation.x = -0.35;
    rocket.userData.flame.scale.set(1, 0.7 + Math.random() * 0.7, 1);
    }
    if (rocket.visible && Math.random() < 0.5) {
      const m = new T.Mesh(partGeo(), new T.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#ffb000' : '#ff4fd8', transparent: true }));
      m.position.copy(rocket.position).add(new T.Vector3(0.4, -0.9, 0.3));
      particles.push({ m, v: new T.Vector3((Math.random() - 0.5), -1.5, (Math.random() - 0.5)), life: 0.7, age: 0, spin: 4, noGrav: true });
      scene.add(m);
    }
    // mascots bounce
    mascots.forEach((m, i) => { m.position.y = Math.abs(Math.sin(time * 3 + i * 1.7)) * 0.18; });
    if (mascots[1] && mascots[1].userData.head) mascots[1].userData.head.rotation.z = Math.sin(time * 2.5) * 0.25;
    // neon lights pulse
    neonLights.forEach((l, i) => { l.intensity = 14 + Math.sin(time * 3 + i * 2) * 6; });
    // coin rain physics
    coinRainList = coinRainList.filter(c => {
      c.age += dt;
      c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.z += c.spin.z * dt;
      if (c.m.position.y < 0.12 && c.v.y < 0) { c.m.position.y = 0.12; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; c.spin.multiplyScalar(0.6); }
      if (c.age > 3.2) { scene.remove(c.m); c.m.geometry.dispose(); return false; }
      return true;
    });
  }

  /** 🪙 Coin rain over the ring (knockout celebration). */
  function coinRain(n) {
    const cm = SAK.Scene3D._coinMat;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const m = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.04, 10), cm);
        m.position.set((Math.random() - 0.5) * 4.5, 5 + Math.random() * 3, (Math.random() - 0.5) * 3.5);
        m.castShadow = true;
        coinRainList.push({ m, v: new T.Vector3((Math.random() - 0.5) * 1.5, -Math.random() * 2, (Math.random() - 0.5) * 1.5), spin: new T.Vector3(Math.random() * 12, 0, Math.random() * 12), age: 0 });
        scene.add(m);
      }, i * 18);
    }
  }

  /* ============================================================ particles */
  const partGeo = () => new T.OctahedronGeometry(0.07, 0);
  /** V2: dramatic slow-motion punch-in. scale<1 slows, restores after dur. */
  function slowMo(scale, dur) { timeScale = scale; slowMoT = dur; }

  /** V2: floating 3D damage number that rises + fades. */
  function damageNumber(worldPos, text, color) {
    const { tex } = canvasTex(256, 128, (ctx, w, h) => {
      ctx.font = `900 62px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = '#12002b';
      ctx.shadowColor = color; ctx.shadowBlur = 20;
      ctx.strokeText(text, w / 2, h / 2); ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2);
      ctx.shadowBlur = 0;
    });
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.position.copy(worldPos); sp.position.y += 0.4;
    sp.scale.set(1.7, 0.85, 1);
    sp.renderOrder = 50;
    scene.add(sp);
    floaters.push({ sp, t0: time, base: 1.7 });
  }

  function burst(pos, colors, count, speed) {
    for (let i = 0; i < count; i++) {
      const m = new T.Mesh(partGeo(), new T.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
      m.position.copy(pos);
      const v = new T.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      particles.push({ m, v, life: 0.6 + Math.random() * 0.5, age: 0, spin: Math.random() * 10 });
      scene.add(m);
    }
  }
  function ring(pos, color) {
    const m = new T.Mesh(new T.RingGeometry(0.15, 0.25, 20), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide, depthWrite: false }));
    m.position.copy(pos); m.lookAt(camera.position);
    rings.push({ m, age: 0 }); scene.add(m);
  }
  // Shared radial-glow texture for impact flashes
  let glowTex = null;
  function getGlowTex() {
    if (glowTex) return glowTex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,244,210,0.85)');
    grad.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    glowTex = new T.CanvasTexture(c);
    return glowTex;
  }
  let flashes = []; // impact glow-flashes {sp, light, age, life, big}
  let flashLightPool = [], flashLightIdx = 0; // persistent pooled flash lights (see init)
  function updateParticles(dt) {
    particles = particles.filter(p => {
      p.age += dt;
      if (p.age >= p.life) { scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); return false; }
      if (!p.noGrav) p.v.y -= 6 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt;
      p.m.material.opacity = 1 - p.age / p.life;
      return true;
    });
    floaters = floaters.filter(f => {
      const k = (time - f.t0) / 0.9;
      if (k >= 1) { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); return false; }
      f.sp.position.y += dt * 1.7;
      f.sp.material.opacity = 1 - k * k;
      const sc = f.base * (1 + k * 0.25); f.sp.scale.set(sc, sc / 2, 1);
      return true;
    });
    rings = rings.filter(r => {
      r.age += dt;
      if (r.age > 0.35) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; }
      const s = 1 + r.age * 14; r.m.scale.set(s, s, s); r.m.material.opacity = 1 - r.age / 0.35;
      return true;
    });
    // impact glow-flashes: pop big, fade fast, light decays
    flashes = flashes.filter(f => {
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) { scene.remove(f.sp); f.sp.material.dispose(); f.light.intensity = 0; return false; } // pooled light: park at 0, never removed
      const s = (0.5 + k * 2.2) * f.big; f.sp.scale.set(s, s, 1);
      f.sp.material.opacity = 1 - k * k;
      f.light.intensity = 4 * f.big * (1 - k);
      return true;
    });
    // golden fire fist trail
    for (const f of [player, kol]) {
      if (f && f.fire && Math.random() < 0.7) {
        const p = f.slapHand.getWorldPosition(new T.Vector3());
        p.x += (Math.random() - 0.5) * 0.2; p.z += (Math.random() - 0.5) * 0.2;
        const m = new T.Mesh(partGeo(), new T.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#ffb000' : '#ff4a00', transparent: true }));
        m.position.copy(p);
        particles.push({ m, v: new T.Vector3((Math.random() - 0.5) * 0.4, 1.5 + Math.random(), (Math.random() - 0.5) * 0.4), life: 0.45, age: 0, spin: 6 });
        scene.add(m);
      }
    }
  }

  /* =============================================================== camera */
  function frameCamera() {
    const w = container.clientWidth, h = container.clientHeight;
    const aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    // narrower screens => pull back so both fighters fit
    const k = Math.min(1.75, Math.max(1, 0.82 / aspect));
    camK = k;
    const preview = mode === 'pick';
    if (player) player.root.visible = !preview;   // picker focuses on the KOL only
    if (mode === 'menu') {
      // wide establishing shot; fighters sit in the upper half above the logo
      camBase.look.set(-0.6, 0.2 - 0.5 * (k - 1), -0.6);
      const dir = new T.Vector3(1, 0.55, 0.75).normalize();
      camBase.pos.set(0, 1.9, 0).addScaledVector(dir, 6.2 * k);
    } else if (preview) {
      // KOL close-up from the front, kept in the upper half (bottom sheet below)
      camBase.look.set(0, 2.0 - 0.75 * (k - 1), -0.8);
      const dir = new T.Vector3(0.35, 0.12, 1).normalize();
      camBase.pos.set(0, 2.3, -0.8).addScaledVector(dir, 4.1 * k);
    } else if (!koCam) {
      // side three-quarter view: both faces + the slapping arms read clearly
      camBase.look.set(0, 1.75, 0);
      const dir = new T.Vector3(1, 0.42, 0.42).normalize();
      camBase.pos.copy(camBase.look).addScaledVector(dir, 5.9 * k);
      camBase.look.y -= 0.35 * (k - 1); // leave room for the meter at the bottom
      camFight.pos.copy(camBase.pos); camFight.look.copy(camBase.look);
    }
    // during KO fly-out, loop() owns camBase (tracks the loser) — don't overwrite
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  /* ------------------------------------------------------- slap face-cam */
  // Face close-up framing for fighter F: three-quarter front on the slap side
  // (+x, where every slapping hand enters), slightly above eye level.
  const _faceOff = new T.Vector3(), _sA = new T.Spherical(), _sB = new T.Spherical();
  const _vA = new T.Vector3(), _vB = new T.Vector3(), _face = { pos: new T.Vector3(), look: new T.Vector3() };
  function faceFraming(F, out, scale, headAt, ang) {
    const head = headAt || F.homeHead || F.headWorld();
    // Fit ~2.1 units of width (head + slapping hand + FX) for this aspect:
    // portrait phones (the usual case) need more distance than landscape.
    const halfV = Math.tan(T.MathUtils.degToRad(45) / 2);
    const dist = Math.min(5.8, Math.max(2.5, 1.0 / (halfV * Math.min(1, camera.aspect || 1)))) * (scale || 1);
    // ~57° off the face normal on the -x side: every slap travels +x → -x, so
    // the struck head snaps TOWARD this camera (full scream/wince face), and the
    // attacker's head/shoulder sits at frame edge instead of masking the face.
    // For the LOCAL player (opponent's turn) we use PLAYER_FACE_ANG instead:
    // a much smaller orbit from the default view that still sits on the slapped
    // side, so the face, the incoming hand and the contact all read clearly.
    const a = (ang == null ? -1.0 : ang);
    // HUD covers the top, meter the bottom — centre the head in what's left
    out.look.set(head.x, head.y - 0.1, head.z);
    _faceOff.set(Math.sin(a), 0, Math.cos(a) * F.facing).multiplyScalar(dist);
    out.pos.set(head.x + _faceOff.x, head.y + 1.2, head.z + _faceOff.z);
    return out;
  }
  // Face-cam angle for the local player: slight rotate (~45° orbit) instead of
  // the full ~160° swing, keeping face + slapping hand + contact in frame.
  const PLAYER_FACE_ANG = 1.05;
  // Face-cam angle for the KOL (player's turn): the default fight view already
  // frames the KOL's face well, so this barely rotates (~0° orbit) — it just
  // pushes in. No more swinging around to the player's back.
  const KOL_FACE_ANG = 1.05;

  /** Blend fight framing → face framing by w, orbiting (spherical) not cutting. */
  function orbitBlend(a, b, w, out) {
    out.look.lerpVectors(a.look, b.look, w);
    _sA.setFromVector3(_vA.subVectors(a.pos, a.look));
    _sB.setFromVector3(_vB.subVectors(b.pos, b.look));
    let dTheta = _sB.theta - _sA.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    _sA.set(
      _sA.radius + (_sB.radius - _sA.radius) * w,
      _sA.phi + (_sB.phi - _sA.phi) * w,
      _sA.theta + dTheta * w
    );
    out.pos.setFromSpherical(_sA).add(out.look);
  }

  /** Resting fight framing for the current local role (attack ↔ brace). */
  const _rest = { pos: new T.Vector3(), look: new T.Vector3() }, _brace = { pos: new T.Vector3(), look: new T.Vector3() };
  const _windup = { pos: new T.Vector3(), look: new T.Vector3() }; // wind-up stage framing temp
  const _qWob = new T.Quaternion(), _ZAXIS = new T.Vector3(0, 0, 1); // crowd wobble temps
  function restFraming(out) {
    if (roleCam.w <= 0.0001 || !player) { out.pos.copy(camFight.pos); out.look.copy(camFight.look); return out; }
    if (!player.restHead) player.restHead = new T.Vector3(player.root.position.x, 2.35, player.homeZ);
    // Wide enough that the opponent's incoming slap stays in frame — the
    // brace view frames the player loosely instead of a tight face close-up.
    // Uses the gentle player angle: slight rotate, not the full face-cam swing.
    faceFraming(player, _brace, 1.8, player.restHead, PLAYER_FACE_ANG);
    orbitBlend(camFight, _brace, roleCam.w, out);
    return out;
  }

  /* ================================================================= loop */
  function loop() {
    const rawDt = Math.min(0.05, clock.getDelta());
    if (slowMoT > 0) { slowMoT -= rawDt; if (slowMoT <= 0) timeScale = 1; } // V2 slow-mo recovery
    const dt = rawDt * timeScale;
    time += dt;
    SAK.Tween.update(dt);
    if (player) player.update(dt);
    if (kol) kol.update(dt);
    updateParticles(dt);
    updateArena(dt);
    if (chartDumpT > 0) chartDumpT = Math.max(0, chartDumpT - dt); // chart recovers after dump
    for (const c of candles) {
      if (c.userData.crowd) {
        const exc = time < crowdExciteUntil; // V2: crowd goes wild on KOs
        c.position.y = 0.45 + Math.abs(Math.sin(time * (exc ? 10 : 4) + c.userData.phase)) * (exc ? 0.4 : 0.12);
        // Celebration wobble composes onto the stored lookAt orientation.
        // NEVER assign c.rotation.z here: rewriting the euler of a lookAt'd
        // group flips half the crowd upside-down (heads under the floor).
        if (c.userData.baseQ) {
          _qWob.setFromAxisAngle(_ZAXIS, exc ? Math.sin(time * 8 + c.userData.phase) * 0.15 : 0);
          c.quaternion.copy(c.userData.baseQ).multiply(_qWob);
        }
      }
      else {
        // Chart Dome dump: on KO the chart crashes — candles drop and flash red.
        if (chartDumpT > 0 && c.userData.bodyMat) {
          const d = Math.min(1, chartDumpT * 2);
          c.position.y = c.userData.baseY - d * 2.2 + Math.sin(time * 0.8 + c.userData.phase) * 0.15 * (1 - d);
          c.children.forEach(m => { if (m.material) m.material = c.userData.red; });
        } else {
          c.position.y = c.userData.baseY + Math.sin(time * 0.8 + c.userData.phase) * 0.15;
        }
      }
    }
    for (const c of coins) { c.rotation.z += dt * 1.5; c.position.y += Math.sin(time * 1.3 + c.userData.phase) * 0.003; }

    // KO camera: hard-track the loser through fly-out AND landing pose
    if (koCam) {
      const F = koCam.track;
      if (F && F.root) {
        const head = F.headWorld();
        const landed = F.ko && F.ko.phase === 'land';
        // Aim at the skull; drop look floor once they pancake so the pose reads
        const lookY = Math.max(landed ? 0.12 : 0.35, head.y - (landed ? 0.05 : 0.2));
        camBase.look.set(head.x, lookY, head.z);
        // Ride a three-quarter offset — pulled BACK so the whole wrecked face
        // reads in frame (funny, not claustrophobic). Stays wide on landing.
        const off = koCam.offset || new T.Vector3(6.8, 3.4, 4.4);
        const pull = landed ? 1.05 : 1;
        camBase.pos.set(
          head.x + off.x * pull,
          Math.max(landed ? 1.35 : 1.8, head.y + off.y * (landed ? 0.7 : 1)),
          head.z + off.z * pull
        );
      }
      if (time > koCam.until) koCam = null;
    } else if ((hitCam && hitCam.target || roleCam.w > 0) && mode !== 'menu' && mode !== 'pick') {
      // Role cam (brace → local player's face) is the resting framing…
      restFraming(_rest);
      if (!(hitCam && hitCam.target)) { camBase.pos.copy(_rest.pos); camBase.look.copy(_rest.look); }
    }
    if (!koCam && hitCam && hitCam.target && mode !== 'menu' && mode !== 'pick') {
      // …and the slap face-cam orbits from there onto the defender's face.
      // Both fighters get the gentle angle now: slight rotate on the
      // opponent's turn, barely any rotate on the player's turn (the default
      // view already frames the KOL's face well) — just a push-in.
      const F = hitCam.target;
      faceFraming(F, _face, 1, null, F === player ? PLAYER_FACE_ANG : KOL_FACE_ANG);
      // follow the head's recoil a little so the reaction stays centred
      const live = F.headWorld(_vA);
      const home = F.homeHead || live;
      _face.look.x += (live.x - home.x) * 0.9;
      _face.look.y += (live.y - home.y) * 0.9;
      _face.look.z += (live.z - home.z) * 0.9;
      // Wind-up stage: ease back toward the wide fight framing (hitCam.aw)
      // so the ATTACKER's wind-up plays in frame on both turns — on the
      // opponent's turn the resting brace view would otherwise hide it —
      // then swing onto the defender's face for the contact (hitCam.w).
      if (hitCam.aw > 0.0001) orbitBlend(_rest, camFight, hitCam.aw, _windup);
      else { _windup.pos.copy(_rest.pos); _windup.look.copy(_rest.look); }
      orbitBlend(_windup, _face, hitCam.w, camBase);
    }
    // smooth camera + shake (snappier during KO pullback)
    const camLerp = koCam ? (1 - Math.pow(0.00005, dt)) : (1 - Math.pow(0.001, dt));
    camCur.pos.lerp(camBase.pos, camLerp);
    camCur.look.lerp(camBase.look, camLerp);
    camera.position.copy(camCur.pos);
    if (shake > 0) {
      // close-ups magnify shake — tame it while the face-cam is in tight
      const tight = koCam ? 0 : Math.max(hitCam ? hitCam.w : 0, roleCam.w * 0.8);
      const sh = shake * (1 - 0.45 * tight);
      camera.position.x += (Math.random() - 0.5) * sh;
      camera.position.y += (Math.random() - 0.5) * sh;
      shake = Math.max(0, shake - dt * (koCam ? 1.1 : 1.6));
    }
    camera.lookAt(camCur.look);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  /* ================================================================ API */
  function init(el) {
    container = el;
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = T.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    scene = new T.Scene();
    scene.fog = new T.Fog('#2a0b5e', 16, 34);
    camera = new T.PerspectiveCamera(50, 1, 0.1, 100); // 10% wider view

    scene.add(new T.HemisphereLight('#ffffff', '#9b6bff', 2.0));
    const sun = new T.DirectionalLight('#fff4e0', 2.6);
    sun.position.set(6, 9, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 25 });
    scene.add(sun);
    const rim = new T.DirectionalLight('#7ad7ff', 1.2); rim.position.set(-5, 4, -6); scene.add(rim);
    // Pooled impact-flash lights: adding/removing a PointLight mid-fight forces
    // three.js to recompile every shader (light-count change) — a multi-second
    // freeze on iPhone GPUs. These two live forever at intensity 0, so the
    // light count never changes during gameplay; smacks just borrow one.
    for (let i = 0; i < 2; i++) {
      const fl = new T.PointLight(0xffd23f, 0, 7);
      scene.add(fl); flashLightPool.push(fl);
    }

    setArena('colosseum');
    clock = new T.Clock();
    frameCamera();
    camCur.pos.copy(camBase.pos); camCur.look.copy(camBase.look);
    new ResizeObserver(frameCamera).observe(container);
    window.addEventListener('resize', frameCamera);
    loop();
  }

  /**
   * The ONE place avatar params turn into a 3D model: rebuilds `model`
   * (a Fighter) from profile avatar params ({ body, hairStyle, hairColor,
   * skin, eyes, eyeColor, accessory, shirt }) or an already-built look.
   */
  function applyAvatar(model, params) {
    const look = params && params.hairColor !== undefined ? SAK.Account.toLook(params) : params;
    model.rebuild(look);
    return model;
  }

  /** @param params player avatar params (or a look) */
  function setPlayer(params) {
    if (!player) { player = new Fighter(SAK.PLAYER.look, -1, -1); scene.add(player.root); }   // player slaps with right hand (local -x)
    applyAvatar(player, params);
  }

  /**
   * Mini turntable renderer for the character creator (own canvas/scene,
   * shares Fighter + applyAvatar). Drag to spin. Returns { apply, dispose }.
   */
  function createPreview(canvas) {
    const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if ('outputColorSpace' in r) r.outputColorSpace = T.SRGBColorSpace;
    const sc = new T.Scene();
    sc.add(new T.HemisphereLight('#ffffff', '#9b6bff', 2.1));
    const key = new T.DirectionalLight('#fff4e0', 2.4); key.position.set(3, 5, 4); sc.add(key);
    const rim = new T.DirectionalLight('#7ad7ff', 1.3); rim.position.set(-4, 3, -4); sc.add(rim);
    const pad = new T.Mesh(new T.CylinderGeometry(0.95, 1.05, 0.08, 20), new T.MeshLambertMaterial({ color: '#39ff88', flatShading: true }));
    pad.position.y = -0.04; sc.add(pad);
    const cam = new T.PerspectiveCamera(32, 1, 0.1, 50);
    const F = new Fighter(SAK.PLAYER.look, +1, +1);
    F.homeZ = 0; F.root.position.z = 0; sc.add(F.root);
    let yaw = 0, vel = 0, drag = null, alive = true, last = performance.now(), idleSpin = true, idleT = 0;
    const down = e => { drag = { x: e.clientX, yaw }; idleSpin = false; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); };
    const move = e => { if (!drag) return; const nyaw = drag.yaw + (e.clientX - drag.x) * 0.012; vel = nyaw - yaw; yaw = nyaw; };
    const up = () => { drag = null; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    function size() {
      const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
      r.setSize(w, h, false); cam.aspect = w / h;
      // fit the whole fighter (~3.3 units tall incl. hair/hats) vertically; pull back on narrow canvases
      const vfit = 3.25 / (2 * Math.tan(T.MathUtils.degToRad(cam.fov / 2)));
      const dist = vfit * Math.max(1, 0.9 / cam.aspect);
      cam.position.set(0, 1.9, dist); cam.lookAt(0, 1.55, 0); cam.updateProjectionMatrix();
    }
    function tick(now) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag) { if (idleSpin) { idleT += dt; yaw = 0.45 * Math.sin(idleT * 0.9); } else { vel *= 0.92; yaw += vel; } }   // idle: face the camera with a gentle sway
      F.root.rotation.y = yaw;
      F.update(dt);
      if (canvas.clientWidth && (canvas.width !== Math.round(canvas.clientWidth * r.getPixelRatio()))) size();
      r.render(sc, cam);
      requestAnimationFrame(tick);
    }
    size(); requestAnimationFrame(tick);
    return {
      apply(params) { applyAvatar(F, params); F.root.rotation.y = yaw; },
      get yaw() { return yaw; },
      dispose() {
        alive = false; F.dispose(); pad.geometry.dispose(); pad.material.dispose(); r.dispose();
        canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      }
    };
  }

  function setOpponent(look) {
    if (kol) kol.dispose();
    kol = new Fighter(look, +1, +1);      // KOL slaps with left hand (camera side)
    scene.add(kol.root);
  }

  function setMode(m) { mode = m; frameCamera(); }

  function resetFight() {
    SAK.Tween.clear();
    koCam = null;
    roleCam = { role: 'attack', w: 0 };
    endHitCam(true);
    if (player) { player.resetPose(); player.setFire(false); }
    if (kol) { kol.resetPose(); kol.setFire(false); }
    if (mode === 'fight' || mode === 'arena') frameCamera();
  }

  /** Spawn dizzy ★ stars that orbit the defender's head for a beat. */
  function spawnHitStars(F, count) {
    if (count <= 0) return null;
    const g = new T.Group();
    const starMat = new T.MeshBasicMaterial({ color: '#ffd23f' });
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const s = new T.Mesh(new T.OctahedronGeometry(0.09, 0), starMat.clone());
      s.position.set(Math.cos(ang) * 0.55, 0.75, Math.sin(ang) * 0.55);
      s.scale.set(1, 1.35, 0.55);
      g.add(s);
    }
    F.head.add(g);
    return g;
  }

  /** Apply tiered cartoon damage reaction to the defender (no gore). */
  /** Dizzy stars circling the head — cartoon disorientation after heavy hits. */
  function dizzyStars(D, count) {
    if (!D || !D.head) return;
    const hp = D.headWorld();
    const stars = [];
    for (let i = 0; i < count; i++) {
      const s = new T.Mesh(
        new T.OctahedronGeometry(0.09),
        new T.MeshBasicMaterial({ color: '#ffe94f', transparent: true, opacity: 0.95 })
      );
      s.userData.phase = (i / count) * Math.PI * 2;
      scene.add(s);
      stars.push(s);
    }
    const start = time;
    const dur = 1.6;
    const tick = () => {
      const t = time - start;
      if (t > dur || D.ko) {
        stars.forEach(s => scene.remove(s));
        return;
      }
      const fade = t > dur - 0.4 ? (dur - t) / 0.4 : 1;
      stars.forEach(s => {
        const a = s.userData.phase + t * 5;
        s.position.set(
          hp.x + Math.cos(a) * 0.55,
          hp.y + 0.35 + Math.sin(t * 3 + s.userData.phase) * 0.1,
          hp.z + Math.sin(a) * 0.55
        );
        s.rotation.y = a * 2;
        s.material.opacity = 0.95 * fade;
      });
      requestAnimationFrame(tick);
    };
    tick();
  }

  function applyHitReact(D, tier, fire) {
    const R = HIT_REACT[tier] || HIT_REACT.light;
    const fireMul = fire ? 1.35 : 1;
    const hp = D.headWorld(); hp.x += 0.35; hp.y -= 0.05;
    // Head WHIP + springy overshoot: hard snap to the side, then a wobble back
    // the other way so it reads springy instead of stiff (Slap Kings feel).
    const k = R.yaw * fireMul * 1.25;
    D.yaw.v += -D.facing * k;
    D.roll.v += -(R.roll * fireMul);
    setTimeout(() => { if (!D.ko) { D.yaw.v += D.facing * R.yaw * 0.55; D.roll.v += R.roll * 0.35; } }, 150);
    // Lean-back flinch, then settle; medium+ get a delayed wobble kick
    SAK.Tween.to(D.pose, { lean: R.lean }, 0.08, SAK.Ease.outCubic);
    setTimeout(() => SAK.Tween.to(D.pose, { lean: 0 }, 0.35, SAK.Ease.inOutQuad), 140 + R.mouthMs * 0.25);
    if (tier === 'medium' || tier === 'heavy' || tier === 'perfect') {
      setTimeout(() => { if (!D.ko) D.roll.v += (Math.random() > 0.5 ? 1 : -1) * R.roll * 0.5; }, 110);
      setTimeout(() => { if (!D.ko) D.yaw.v += -D.facing * R.yaw * 0.28; }, 200);
      setTimeout(() => { if (!D.ko) D.yaw.v += D.facing * R.yaw * 0.3; }, 320); // secondary wobble
    }
    // Body stagger on heavy hits: whole torso follows the head a beat later
    if (tier === 'heavy' || tier === 'perfect') {
      const sx0 = D.root.position.x, shove = -D.facing * (tier === 'perfect' ? 0.35 : 0.22);
      SAK.Tween.to(D.root.position, { x: sx0 + shove }, 0.12, SAK.Ease.outCubic)
        .then(() => { if (!D.ko) return SAK.Tween.to(D.root.position, { x: sx0 }, 0.4, SAK.Ease.inOutQuad); });
    }
    // Wince (light/medium) or scream face (heavy/perfect) — with a random
    // "ouch" style picked fresh every hit, plus jitter, so the pain face
    // never repeats. Tier still sets the overall intensity.
    const ouch = OUCH_FACES[(Math.random() * OUCH_FACES.length) | 0];
    const jit = (v, amt) => v * (1 + (Math.random() * 2 - 1) * amt);
    D.mouth.scale.set(jit(R.mouthX * ouch.mx, 0.12), jit(R.mouthY * ouch.my, 0.12), 1);
    if (D.eyes) D.eyes.scale.set(jit(R.eyeSx * ouch.ex, 0.12), jit(R.eyeSy * ouch.ey, 0.12), 1);
    // Brows sell the pain: random worried-raise (inner up) or furrow (inner down)
    if (D.brows && D.brows.length) {
      const raise = Math.random() < 0.55;
      D.brows.forEach((b, i) => {
        const sx = i === 0 ? -1 : 1;
        SAK.Tween.to(b.position, { y: b.userData.baseY + (raise ? 0.055 : -0.02) }, 0.09, SAK.Ease.outCubic);
        SAK.Tween.to(b.rotation, { z: sx * (raise ? -0.38 : 0.52) }, 0.09, SAK.Ease.outCubic);
      });
      setTimeout(() => {
        if (D.ko || !D.brows) return;
        D.brows.forEach(b => {
          SAK.Tween.to(b.position, { y: b.userData.baseY }, 0.35, SAK.Ease.inOutQuad);
          SAK.Tween.to(b.rotation, { z: b.userData.baseRotZ }, 0.35, SAK.Ease.inOutQuad);
        });
      }, R.mouthMs);
    }
    setTimeout(() => {
      if (D.ko) return;
      D.mouth.scale.set(1, 1, 1);
      if (D.eyes) D.eyes.scale.set(1, 1, 1);
    }, R.mouthMs * (0.9 + Math.random() * 0.25));
    // Tiny cartoon hop on heavier hits
    if (R.hop) {
      const y0 = D.root.position.y;
      SAK.Tween.to(D.root.position, { y: y0 + R.hop }, 0.07, SAK.Ease.outCubic)
        .then(() => { if (!D.ko) return SAK.Tween.to(D.root.position, { y: y0 }, 0.18, SAK.Ease.inCubic); });
    }
    // Dizzy stars circling the head on heavy/perfect hits (Slap Kings feel)
    if (tier === 'heavy' || tier === 'perfect') {
      dizzyStars(D, tier === 'perfect' ? 5 : 3);
    }
    // Face squash
    D.clearHitFX();
    D.hitFX = {
      until: time + R.squashDur, dur: R.squashDur,
      sx: R.sx, sy: R.sy, sz: R.sz,
      stars: spawnHitStars(D, R.stars)
    };
    // Impact FX
    const cols = fire ? ['#ffd000', '#ff7a00', '#ff3b00', '#fff3a0', ...R.colors] : R.colors;
    burst(hp, cols, fire ? R.burstN + 12 : R.burstN, fire ? R.burstSpd + 1.2 : R.burstSpd);
    ring(hp, fire ? '#ffb000' : R.ring);
    if (tier === 'heavy' || tier === 'perfect') {
      ring(hp.clone().add(new T.Vector3(0, 0.1, 0)), tier === 'perfect' ? '#ff4fd8' : '#ff9a1f');
    }
    shake = Math.max(shake, R.shake + (fire ? 0.18 : 0));
    D.setDamage(Math.min(0.85, (D.blushMat.opacity / 0.9) + R.blushAdd));
    // Progressive bruising across rounds: harder hits deepen the black eye;
    // the cheek scratch shows once damage passes ~half.
    const bruiseAdd = tier === 'light' ? 0.22 : tier === 'medium' ? 0.38 : 0.6;
    D.setBruise(Math.min(1, (D.bruiseLevel || 0) + bruiseAdd));
    // Yelp slightly after contact so the slap "lands" first
    const yelpTier = tier;
    setTimeout(() => { if (SAK.Audio && SAK.Audio.yelp) SAK.Audio.yelp(yelpTier); }, (R.yelpDelay || 0) * 1000);
    return R;
  }

  /** Role-based framing for the LOCAL player each round:
   *  'brace'  → smooth orbit onto the local player's face (they're about to get slapped)
   *  'attack' → smooth return to the default fight view. */
  function setRoleCam(role, opts) {
    const target = role === 'brace' ? 1 : 0;
    if (player && !player.ko) player.restHead = null; // re-derive from home spot
    const rc = { role: role === 'brace' ? 'brace' : 'attack', w: roleCam.w };
    roleCam = rc;
    if (opts && opts.snap) { rc.w = target; return Promise.resolve(); }
    return SAK.Tween.to(rc, { w: target }, (opts && opts.dur) || 0.9, SAK.Ease.inOutQuad);
  }

  /** Begin the face-cam on defender D. Returns the cam token. */
  function startHitCam(D, peak) {
    D.homeHead = D.headWorld(new T.Vector3());
    hitCam = { target: D, w: hitCam && hitCam.target === D ? hitCam.w : 0, peak: peak, aw: 0 };
    return hitCam;
  }
  /** Ease the face-cam back to the fight framing (or snap off). */
  async function endHitCam(snap, cam) {
    const hc = cam || hitCam;
    if (!hc) return;
    if (!snap) {
      await SAK.Tween.to(hc, { w: 0 }, 0.8, SAK.Ease.inOutQuad);
      if (hitCam !== hc) return;   // superseded by a newer slap / KO
    }
    if (hitCam === hc) {
      hitCam = null;
      if (!koCam && mode !== 'menu' && mode !== 'pick') { restFraming(_rest); camBase.pos.copy(_rest.pos); camBase.look.copy(_rest.look); }
    }
  }

  /**
   * Full slap animation.
   * @param who      'player' | 'kol' (the attacker)
   * @param opts     { grade:'perfect'|'good'|'weak'|'miss', fire:bool, dist:number, windup:sec, onImpact:fn }
   */
  async function slap(who, opts) {
    const A = who === 'player' ? player : kol, D = who === 'player' ? kol : player;
    const p = A.pose, E = SAK.Ease, sd = A.armSide;
    const tier = reactTier(opts.grade, opts.fire, opts.dist);
    if (opts.fire) A.setFire(true);

    // Slap style from meter strength (red → green center). Stuffed slaps
    // (defender won the exchange) drop a notch. The defender's reaction tier
    // stays on reactTier(); the style drives the ATTACKER's motion + FX.
    let styleId;
    if (!opts.grade || opts.grade === 'miss') styleId = 'whiff';
    else if (opts.grade === 'weak') styleId = 'limp';
    else if (opts.grade === 'perfect') styleId = 'devastating';
    else styleId = (opts.dist != null && opts.dist < 20) ? 'heavy' : 'standard';
    if (opts.landed === false && (styleId === 'heavy' || styleId === 'devastating')) styleId = 'standard';
    const ST = SLAP_STYLES[styleId];
    lastSlapTier = tier; // remembered for knockout() variant selection

    // Face-cam: gentle push toward the fighter about to be slapped so the hit
    // reaction reads on their FACE — kept shallow so the attacker's arm and
    // the moment of contact stay in frame.
    const landsHit = opts.grade !== 'miss' && !!tier;
    let peak = ST.peak;
    if (opts.landed === false) peak = Math.min(peak, 0.45);
    if (!landsHit) peak = 0.3;
    const cam = startHitCam(D, peak);
    const windup = (opts.windup || 0.42) * ST.windupMul;
    SAK.Tween.to(cam, { w: peak * 0.35 }, windup + 0.06, E.inOutQuad);
    // Wind-up stage: pull back to the wide fight framing so the attacker's
    // wind-up reads in frame on BOTH turns (the brace view on the opponent's
    // turn would otherwise hide it). Swings onto the defender at the strike.
    SAK.Tween.to(cam, { aw: 1 }, Math.min(0.3, windup), E.outCubic);

    // 1) Wind-up: arm rises HIGH above/behind the head, body coiled back,
    // held for a readable beat — bigger coil for stronger styles.
    // Faces: attacker focuses, defender tenses.
    try { A.setExpression('focused'); D.setExpression('neutral'); } catch (e) {}
    SAK.Tween.to(A.root.scale, { x: ST.squash, y: 2 - ST.squash, z: ST.squash }, windup * 0.55, E.outCubic);
    await SAK.Tween.to(p, { lift: ST.wind.lift, swing: ST.wind.swing, elbow: ST.wind.elbow, twist: sd * ST.wind.twist, lean: ST.wind.lean }, windup, E.outCubic);
    if (opts.onWindupDone) opts.onWindupDone();
    // Anticipation hold at the coil peak — the beat before the snap (longer for heavy)
    await wait(ST.fx >= 1.5 ? 0.09 : 0.06);

    // 2) strike: arm whips down/forward FAST with follow-through across the body.
    // Open palm, never a punch; limp style keeps a floppy loose wrist.
    SAK.Audio.whoosh();
    SAK.Tween.to(A.root.scale, { x: 1, y: 1, z: 1 }, 0.14, E.outCubic); // unsquash into the hit
    const handBase = A.slapHand.scale.clone();
    A.slapHand.scale.set(ST.hand[0], ST.hand[1], ST.hand[2]); // flattened open hand
    if (hitCam === cam) SAK.Tween.to(cam, { w: peak }, 0.42, E.outCubic); // swing in to the face through contact
    if (hitCam === cam) SAK.Tween.to(cam, { aw: 0 }, 0.35, E.inOutQuad); // leave the wide wind-up framing as the swing starts
    if (opts.grade === 'miss') SAK.Tween.to(D.pose, { lean: -0.32 }, 0.12, E.outCubic); // dodge
    // heavy+ styles hop/lunge their weight into the hit
    if (ST.hop > 0) {
      const ay0 = A.root.position.y;
      SAK.Tween.to(A.root.position, { y: ay0 + ST.hop }, ST.strikeDur * 0.7, E.outCubic)
        .then(() => { if (!A.ko) return SAK.Tween.to(A.root.position, { y: ay0 }, 0.22, E.inCubic); });
    }
    const strike = SAK.Tween.to(p, { lift: ST.strike.lift, swing: ST.strike.swing, elbow: ST.strike.elbow, twist: -sd * ST.strike.twist, lean: ST.strike.lean, lunge: ST.strike.lunge }, ST.strikeDur, E.inCubic);
    await wait(0.1);
    if (opts.grade !== 'miss' && tier) {
      const R = applyHitReact(D, tier, !!opts.fire);
      // Faces: defender shock on impact, then pain. Heavy hits leave them dizzy.
      try {
        D.setExpression('shock', 0.1);
        setTimeout(() => { try { D.setExpression(tier === 'heavy' || tier === 'perfect' ? 'dizzy' : 'pain', 0.25); } catch (e) {} }, 180);
        setTimeout(() => { try { D.setExpression('neutral', 0.4); } catch (e) {} }, 1200);
      } catch (e) {}
      const hp = D.headWorld();
      if (opts.dmg > 0) damageNumber(hp, '-' + opts.dmg, tier === 'perfect' ? '#39ff88' : tier === 'heavy' ? '#ffd23f' : '#ffffff'); // V2
      impactFlash(hp, tier); // glow-flash pop on every landed smack, bigger for heavy/perfect
      if (tier === 'heavy' || tier === 'perfect') slowMo(0.3, 0.32); // V2: dramatic beat
      // Style FX: heavy/devastating add shockwave rings + extra shake; devastating gets a big flash
      if (ST.fx >= 1.5) {
        ring(hp, styleId === 'devastating' ? '#ff4fd8' : '#ffd23f');
        shake = Math.max(shake, styleId === 'devastating' ? 0.85 : 0.6);
      }
      if (styleId === 'devastating') {
        burst(hp, ['#ffffff', '#ffd23f', '#ff4fd8'], 26, 7);
        slowMo(0.25, 0.4);
      }
      if (opts.onImpact) opts.onImpact(hp);
      // Cartoon hit-stop — longer for heavier tiers, longest for devastating
      if (R.hitStop) await wait(R.hitStop * (styleId === 'devastating' ? 1.6 : 1));
    } else if (opts.onImpact) opts.onImpact(null);
    await strike;
    // Follow-through: arm keeps travelling across the body after contact (heavy+ styles)
    if (ST.fx >= 1.5 && landsHit) {
      SAK.Tween.to(p, { swing: ST.strike.swing - 0.55, twist: -sd * (ST.strike.twist + 0.25), lean: ST.strike.lean + 0.08 }, 0.16, E.outCubic);
    }
    A.slapHand.scale.copy(handBase);
    await wait(0.12);

    // 3) recover — hold on the reaction face a beat, then ease back for next round
    if (opts.grade === 'miss') SAK.Tween.to(D.pose, { lean: 0 }, 0.3);
    A.setFire(false);
    // Attacker relaxes back to neutral (or grins on a big hit)
    try {
      if (tier === 'perfect' || tier === 'heavy') A.setExpression('grin', 0.3);
      else A.setExpression('neutral', 0.3);
    } catch (e) {}
    const holdS = tier === 'perfect' || tier === 'heavy' ? 0.42 : 0.28;
    wait(holdS).then(() => { if (hitCam === cam && !koCam) endHitCam(false, cam); });
    await SAK.Tween.to(p, { lift: 0.12, swing: 0, elbow: 0.15, twist: 0, lean: 0, lunge: 0 }, 0.38, E.inOutQuad);
  }

  /** V2: winner's raised-arm victory pose — hop + crowd goes wild. */
  function victory(who) {
    const F = who === 'player' ? player : kol;
    if (!F || F.ko) return;
    const p = F.pose, sd = F.armSide;
    SAK.Tween.to(p, { lift: 2.9, swing: -0.35, elbow: 0.12, twist: -sd * 0.35, lean: -0.2, lunge: 0 }, 0.55, SAK.Ease.outBack);
    SAK.Tween.to(F.root.position, { y: 0.28 }, 0.3, SAK.Ease.outCubic)
      .then(() => { if (!F.ko) return SAK.Tween.to(F.root.position, { y: 0 }, 0.45, SAK.Ease.inCubic); });
    crowdExcite(4);
  }

  /** KO variations — resolves when done.
   *  Most KOs drop the loser in place (usually a dead-weight crumple, sometimes
   *  a dizzy spin-out, occasionally a faceplant flip); only sometimes does the
   *  loser get launched out of the ring (backflip launch or ragdoll rocket),
   *  slightly more often on heavy/perfect finishing blows.
   *  EVERY KO ends with the money shot: the loser's head turns to camera so the
   *  battered face (bruises, black eye, scratches + X eyes) and dizzy stars
   *  always read — never face-down — before the winner celebrates. */
  async function knockout(who, tier) {
    const F = who === 'player' ? player : kol;
    const finTier = tier || lastSlapTier || 'perfect'; // game.js passes only `loser`
    endHitCam(true); // KO follow-cam takes over from the face-cam
    chartDump(); // Chart Dome: the chart crashes on KO
    crowdExcite(3); // crowd goes wild
    F.xEyes.visible = true; F.eyes.visible = false;
    F.mouth.scale.set(1, 3, 1);

    // KO variety: fly-outs are rare treats now, even on big hits. Most KOs end
    // with the loser dropping in place — usually a dead-weight crumple, sometimes
    // a dizzy spin-out, occasionally a faceplant. Only sometimes do they get
    // launched out of the ring (backflip launch or ragdoll rocket).
    const hardKO = finTier === 'heavy' || finTier === 'perfect';
    const flyChance = hardKO ? 0.25 : 0.08;
    let variant;
    if (Math.random() < flyChance) {
      variant = Math.random() < 0.5 ? 'launch' : 'rocket';
    } else {
      // No faceplant — the loser's face must stay visible at the end (funny > hidden).
      // 'flatback': launched onto their back, dazed face looking up at the sky.
      const r = Math.random();
      variant = r < 0.45 ? 'crumple' : r < 0.75 ? 'spinout' : 'flatback';
    }

    // Impact beat scaled to the variant (no gore)
    const hp = F.headWorld();
    shake = variant === 'crumple' ? 0.5 : variant === 'launch' || variant === 'rocket' ? 1.2 : 0.8;
    burst(hp, ['#39ff88', '#ff4fd8', '#ffd23f', '#ffffff', '#ff7a9a'],
      variant === 'crumple' ? 18 : variant === 'launch' ? 44 : variant === 'rocket' ? 58 : 30, 8.5);
    ring(hp, '#ffd23f');
    if (variant === 'launch' || variant === 'rocket') ring(hp.clone().add(new T.Vector3(0, 0.12, 0)), '#ff4fd8');
    await wait(0.1); // tiny cartoon hit-stop

    // Shared: the fighter's yaw baseline so fall tweens land exactly on the pose
    // (applyLandPose adds faceY itself).
    const faceY = F.facing > 0 ? 0 : Math.PI;
    // Shortest-path yaw: collapse tweens must not whiplash through full turns
    // left over from the spinout's 4π spin.
    const nearestY = (cur, want) => cur + ((((want - cur) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (variant === 'crumple') {
      // Knees buckle — folds and drops straight down into a heap at their spot. No launch.
      const pose = LAND_POSES.find(p => p.id === 'heap') || pickLandPose();
      const yT = nearestY(F.root.rotation.y, faceY + (pose.ry || 0));
      SAK.Tween.to(F.root.rotation, { x: pose.rx, y: yT, z: pose.rz || 0 }, 0.35, SAK.Ease.inCubic);
      await SAK.Tween.to(F.root.position, { y: pose.y }, 0.35, SAK.Ease.inCubic);
      const dust = F.root.position.clone(); dust.y = 0.12;
      burst(dust, ['#c4a574', '#e8d5a3', '#ffffff'], 14, 2.4);
      F.stampLandPose(pose);
    } else if (variant === 'spinout') {
      // Spins like a top from the slap, wobbles dizzy, then the legs give out
      // and they flop down in place — never leaves the ring. The full spin is
      // awaited so it always plays out instead of stalling mid-turn.
      const pose = LAND_POSES.find(p => p.id === 'heap') || pickLandPose();
      const dir = Math.random() > 0.5 ? 1 : -1;
      const y0rot = F.root.rotation.y;
      SAK.Tween.to(F.root.rotation, { z: dir * 0.25 }, 0.4, SAK.Ease.outCubic)
        .then(() => SAK.Tween.to(F.root.rotation, { z: -dir * 0.25 }, 0.4, SAK.Ease.inOutQuad)); // dizzy wobble
      await SAK.Tween.to(F.root.rotation, { y: y0rot + dir * Math.PI * 4 }, 0.8, SAK.Ease.outCubic);
      const yT = nearestY(F.root.rotation.y, faceY + (pose.ry || 0));
      SAK.Tween.to(F.root.rotation, { x: pose.rx, y: yT, z: pose.rz || 0 }, 0.35, SAK.Ease.inCubic);
      await SAK.Tween.to(F.root.position, { y: pose.y }, 0.35, SAK.Ease.inCubic);
      const dust = F.root.position.clone(); dust.y = 0.12;
      burst(dust, ['#c4a574', '#e8d5a3', '#ffffff'], 16, 2.6);
      ring(dust, '#ffd23f');
      F.stampLandPose(pose);
    } else if (variant === 'flatback') {
      // Smacked onto their back — dazed wrecked face looking up at the sky.
      // Funny and the face stays fully visible. Stays in the ring.
      const y0 = F.root.position.y;
      SAK.Tween.to(F.root.position, { y: y0 + 0.7 }, 0.28, SAK.Ease.outCubic);
      await SAK.Tween.to(F.root.rotation, { x: -Math.PI * 0.55 }, 0.5, SAK.Ease.inCubic);
      await SAK.Tween.to(F.root.position, { y: 0.35 }, 0.18, SAK.Ease.inCubic);
      const dust = F.root.position.clone(); dust.y = 0.2;
      burst(dust, ['#c4a574', '#e8d5a3', '#ffffff'], 18, 2.8);
      ring(dust, '#ffd23f');
      // little bounce-settle — the gag, awaited so it fully plays
      await SAK.Tween.to(F.root.position, { y: 0.45 }, 0.14, SAK.Ease.outCubic);
      await SAK.Tween.to(F.root.position, { y: 0.35 }, 0.22, SAK.Ease.inCubic);
      // rest pose matches the gag's final transform exactly (no pop)
      const yEnd = F.root.rotation.y;
      F.stampLandPose({ id: 'faceplant-rest', rx: Math.PI * 1.5, ry: yEnd - faceY, rz: 0, y: 0.12,
        tx: 0.85, ty: 0.05, tz: 0.1, hx: 1.15, hy: 0.1, hz: 0.25,
        armL: [1.25, -0.55, 0.35], armR: [1.3, 0.55, 0.3] });
    } else {
      // launch: backflip-style backward launch, lands flat on back.
      // rocket: the classic — body goes rigid then ragdoll-spins, random landing.
      const isRocket = variant === 'rocket';
      F.ko = {
        phase: 'fly',
        landPose: isRocket ? pickLandPose() : (LAND_POSES.find(p => p.id === 'starfished') || pickLandPose()),
        vel: isRocket
          ? new T.Vector3(-5.2 + Math.random() * 2.2, 13.5 + Math.random() * 3, -F.facing * (13.5 + Math.random() * 2))
          : new T.Vector3(-2 + Math.random() * 1.5, 8.5 + Math.random() * 2, -F.facing * (8 + Math.random() * 2)),
        spin: isRocket
          ? new T.Vector3(-F.facing * (18 + Math.random() * 8), 5 + Math.random() * 8, 14 + Math.random() * 6)
          : new T.Vector3(-F.facing * (13 + Math.random() * 4), 2 + Math.random() * 3, 3 + Math.random() * 3)
      };
      shake = Math.max(shake, 0.7);
      burst(F.headWorld(), ['#ffd23f', '#ffffff', '#39ff88'], 24, 5);
    }

    // Follow-cam: lock onto the loser through fly-out AND landing
    const head0 = F.headWorld();
    const followOff = new T.Vector3(5.2, 2.6, 3.4); // pulled-back three-quarter
    camBase.look.set(head0.x, Math.max(0.35, head0.y - 0.2), head0.z);
    camBase.pos.set(head0.x + followOff.x, Math.max(1.8, head0.y + followOff.y), head0.z + followOff.z);
    const fov0 = camera.fov;
    camera.fov = Math.min(58, fov0 + 10);
    camera.updateProjectionMatrix();
    koCam = { track: F, offset: followOff, until: time + 8 }; // cleared after landing beat

    // Wait until they actually hit the dirt (safety cap ~4s)
    const t0 = time;
    while (!(F.ko && F.ko.phase === 'land') && time - t0 < 4) await wait(0.05);
    // ---- Face-reveal finale (EVERY KO): the money shot. ----
    // Turn the loser's head toward the camera so the battered face always reads,
    // no matter the landing pose — never face-down. Yaw/pitch-only aim (no roll
    // weirdness), wide cartoon clamps. The per-frame pose driver is parked
    // during KO, so this tween holds.
    {
      const headPos = F.headWorld();
      const toCam = camera.position.clone().sub(headPos);
      if (toCam.lengthSq() > 1e-6) {
        toCam.normalize();
        const qParent = new T.Quaternion();
        F.head.parent.getWorldQuaternion(qParent);
        const local = toCam.applyQuaternion(qParent.invert());
        // Face is +z: yaw = atan2(x,z), pitch up = negative X rotation
        const yaw = Math.atan2(local.x, local.z);
        const pitch = -Math.asin(Math.max(-1, Math.min(1, local.y)));
        F.head.rotation.order = 'YXZ';
        SAK.Tween.to(F.head.rotation, {
          x: Math.max(-2.2, Math.min(2.2, pitch)),
          y: Math.max(-2.6, Math.min(2.6, yaw)),
          z: 0
        }, 0.45, SAK.Ease.outCubic);
      }
    }
    // Push in close on the battered face (bruises, black eye, scratches + X
    // eyes) with dizzy stars orbiting, hold so the damage reads.
    const stars = spawnHitStars(F, 6);
    SAK.Tween.to(koCam.offset, { x: 1.7, y: 1.0, z: 1.2 }, 0.6, SAK.Ease.inOutQuad);
    const spinUntil = time + 1.7;
    while (time < spinUntil) {
      await wait(0.03);
      if (stars.parent) {
        stars.rotation.y += 0.28;
        stars.children.forEach((c, i) => {
          c.position.y = 0.75 + Math.sin(time * 9 + i * 1.7) * 0.1;
          c.rotation.z += 0.18; c.rotation.x += 0.12;
        });
      }
    }
    if (stars.parent) F.head.remove(stars);
    stars.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    victory(who === 'player' ? 'kol' : 'player'); // V2: winner celebrates

    koCam = null;
    roleCam = { role: 'attack', w: 0 }; // result screen uses the default view
    camera.fov = fov0;
    camera.updateProjectionMatrix();
    frameCamera(); // restore fight framing for result transition
  }

  function setFireArmed(on) { if (player) player.setFire(on); }

  function setHelmet(on) { if (player) player.helmet.visible = !!on; }
  function setRage(on) { if (player) player.rage.visible = !!on; }

  function setBrace(on) { if (player) SAK.Tween.to(player.pose, { guard: on ? 1 : 0, lean: on ? -0.1 : 0 }, 0.12); }

  /** Project a fighter's head into container pixel coords (for floating text). */
  function screenPos(who) {
    const F = who === 'player' ? player : kol;
    if (!F) return { x: 0, y: 0 };
    const v = F.headWorld().project(camera);
    return { x: (v.x + 1) / 2 * container.clientWidth, y: (1 - v.y) / 2 * container.clientHeight };
  }

  /** Idle "taunt" bounce used on the picker screen. */
  function taunt() {
    if (!kol || kol.ko) return;
    const p = kol.pose;
    SAK.Tween.to(p, { lift: 2.6, swing: -0.3, elbow: 1.2 }, 0.25, SAK.Ease.outBack)
      .then(() => wait(0.35)).then(() => SAK.Tween.to(p, { lift: 0.12, swing: 0, elbow: 0.15 }, 0.3));
    kol.yaw.v += 3;
  }

  /** Impact glow-flash at a smack contact point — replaces the old laser eyes. */
  function impactFlash(pos, tier) {
    if (!pos) return;
    const big = tier === 'perfect' ? 1.6 : tier === 'heavy' ? 1.25 : 0.85;
    const sp = new T.Sprite(new T.SpriteMaterial({
      map: getGlowTex(), transparent: true,
      blending: T.AdditiveBlending, depthWrite: false,
      color: tier === 'perfect' ? '#a8ffc8' : '#ffe9a8'
    }));
    sp.position.copy(pos);
    sp.scale.setScalar(0.5 * big);
    scene.add(sp);
    // Borrow a pooled light (never create/dispose mid-fight — see init).
    const light = flashLightPool[flashLightIdx++ % flashLightPool.length];
    light.color.set(tier === 'perfect' ? 0x66ff99 : 0xffd23f);
    light.intensity = 4 * big;
    light.position.copy(pos);
    flashes.push({ sp, light, age: 0, life: tier === 'perfect' || tier === 'heavy' ? 0.5 : 0.32, big });
  }

  return { init, setPlayer, applyAvatar, createPreview, setOpponent, setMode, resetFight, setRoleCam, slap, knockout, setFireArmed, setBrace, screenPos, taunt, coinRain, impactFlash, setHelmet, setRage, setArena, crowdExcite, chartDump,
    get player() { return player; }, get kol() { return kol; },
    get arena() { return arenaStyle; }, get arenaName() { return ARENA_DEFS[arenaStyle].name; },
    get camDebug() { return { hit: hitCam ? +hitCam.w.toFixed(3) : null, role: roleCam.role, roleW: +roleCam.w.toFixed(3), ko: !!koCam, t: +time.toFixed(2) }; } };
})();
