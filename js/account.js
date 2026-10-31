/* =========================================================================
 * Local accounts + fighter avatar params (no backend; localStorage only).
 * -------------------------------------------------------------------------
 * Profile (stored as SAK.Storage.state.profile, versioned):
 *   { v: 2, id, name, createdAt, phrase,
 *     avatar: { species, body, hairStyle, hairColor, skin, eyes, eyeColor, accessory, shirt } }
 * `avatar` is the single source for the player's look: SAK.Account.toLook()
 * turns it into the `look` used by the 3D Fighter (Scene3D.applyAvatar) and
 * the SVG portraits (SAK.avatarSVG).
 * Future hook: an "Upload PFP → AI fighter" feature only needs to return an
 * `avatar` object with these keys (see SAK.Account.fromPfp stub).
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Account = (function () {
  const VERSION = 2;
  const OPTIONS = {
    species: [
      { id: 'human', label: 'Human' }, { id: 'bear', label: 'Bear' }, { id: 'bull', label: 'Bull' },
      { id: 'ape', label: 'Ape' }, { id: 'dog', label: 'Dog' }, { id: 'cat', label: 'Cat' },
      // Frog retired from rolls 2026-10-25 (LT: the eyes-on-top look
      // doesn't read well) but kept here so sanitize still accepts it —
      // an old frog save keeps its look instead of resetting to human.
      { id: 'frog', label: 'Frog' }, { id: 'rabbit', label: 'Rabbit' }, { id: 'panda', label: 'Panda' }
    ],
    body: [
      { id: 'classic', label: 'Classic' }, { id: 'chonk', label: 'Chonk' }, { id: 'gymbro', label: 'Gym Bro' },
      { id: 'noodle', label: 'Noodle' }, { id: 'smol', label: 'Smol' }
    ],
    hairStyle: [
      { id: 'short', label: 'Short' }, { id: 'buzz', label: 'Buzz' }, { id: 'spiky', label: 'Spiky' }, { id: 'mohawk', label: 'Mohawk' },
      { id: 'long', label: 'Long' }, { id: 'afro', label: 'Afro' }, { id: 'bun', label: 'Bun' }, { id: 'bald', label: 'Bald' }
    ],
    eyes: [
      { id: 'round', label: 'Round' }, { id: 'big', label: 'Big' }, { id: 'sleepy', label: 'Sleepy' },
      { id: 'angry', label: 'Angry' }, { id: 'dot', label: 'Dot' }
    ],
    accessory: [
      { id: 'headband', label: 'Headband' }, { id: 'none', label: 'None' }, { id: 'cap', label: 'Cap' }, { id: 'shades', label: 'Shades' },
      { id: 'crown', label: 'Crown' }, { id: 'headphones', label: 'Cans' }, { id: 'beanie', label: 'Beanie' }, { id: 'visor', label: 'Visor' },
      { id: 'laser', label: 'Laser eyes' }, { id: 'tophat', label: 'Top hat' }, { id: 'unicorn', label: 'Unicorn' }
    ],
    print: [
      { id: 'none', label: 'None' }, { id: 'btc', label: 'Bitcoin' }, { id: 'sol', label: 'Solana' },
      { id: 'fomo', label: 'FOMO' }, { id: 'zec', label: 'Zcash' }, { id: 'stonks', label: 'STONKS' }, { id: 'pumpfun', label: 'PUMPFUN' }
    ],
    skin: ['#ffe0c4', '#f6c9a0', '#f2c49b', '#e0a77a', '#c98b5f', '#a8714d', '#7a4a2e', '#9fd3ff', '#b6ff9f'],
    hairColor: ['#1a1a1a', '#3b2416', '#7a4a24', '#ffcf33', '#e9e9f5', '#ff5a36', '#22c3ff', '#ff7ad9', '#39ff88'],
    eyeColor: ['#1a1a1a', '#3a6fd8', '#2e9e4f', '#7a4a24', '#9b5cff', '#ff3b5c', '#ffd23f'],
    pants: ['#1d2a4d', '#2b3a5c', '#3a3a4a', '#5c2b3a', '#1a4a3a', '#8a7a5c', '#d42a2a', '#ffd23f'],
    shirt: ['#2f80ff', '#ff4fa3', '#2ee6a6', '#ffe23d', '#ff7a1a', '#9b5cff', '#ff3b5c', '#1f1f2e', '#39ff88', '#ffffff']
  };
  const ids = k => OPTIONS[k].map(o => (typeof o === 'string' ? o : o.id));
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function defaultAvatar() {
    const L = SAK.PLAYER.look;
    return { species: 'human', body: 'classic', hairStyle: 'short', hairColor: L.hair, skin: L.skin, eyes: 'round', eyeColor: '#1a1a1a', accessory: L.accessory, shirt: L.shirt, pants: L.pants, print: 'none', outfit: 'tee' };
  }

  /** Clamp any (possibly old / hand-edited) avatar to valid values.
   * Forge (2026-10-30): id layers also accept SAK.Traits.LAYERS values
   * (e.g. the 2026-10-29 hair/accessory variants the randomizer never
   * rolls) so a forged fighter survives saving. This does NOT change
   * randomAvatar — it still picks from OPTIONS only. */
  function sanitize(a) {
    const d = defaultAvatar(), out = {};
    a = a || {};
    const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    const PICK = ['species', 'body', 'hairStyle', 'eyes', 'accessory', 'print', 'outfit'];
    const okId = (k, v) => {
      const base = OPTIONS[k] ? ids(k) : [];
      if (base.includes(v)) return true;
      const L = (SAK.Traits && SAK.Traits.LAYERS && SAK.Traits.LAYERS[k]) || [];
      return L.some(t => t.id === v);
    };
    for (const k of ['species', 'body', 'hairStyle', 'hairColor', 'skin', 'eyes', 'eyeColor', 'accessory', 'shirt', 'pants', 'print', 'outfit']) {
      out[k] = PICK.includes(k) ? (okId(k, a[k]) ? a[k] : d[k]) : (hex(a[k]) ? a[k] : d[k]);
    }
    return out;
  }

  // Species odds mirror SAK.Traits: ~2/3 human, animals as the treat.
  // Frog retired 2026-10-25 (LT) — no weight, so it can never roll.
  const SPECIES_W = [['human', 180], ['bear', 25], ['bull', 25], ['ape', 10], ['dog', 10], ['cat', 10], ['rabbit', 4], ['panda', 1]];
  function pickSpecies() {
    let total = 0; for (const [, w] of SPECIES_W) total += w;
    let r = Math.random() * total;
    for (const [id, w] of SPECIES_W) { r -= w; if (r < 0) return id; }
    return 'human';
  }

  function randomAvatar() {
    return {
      species: pickSpecies(),
      body: pick(ids('body')), hairStyle: pick(ids('hairStyle')), hairColor: pick(OPTIONS.hairColor), skin: pick(OPTIONS.skin),
      eyes: pick(ids('eyes')), eyeColor: pick(OPTIONS.eyeColor), accessory: pick(ids('accessory')), shirt: pick(OPTIONS.shirt), pants: pick(OPTIONS.pants), print: pick(ids('print'))
    };
  }

  /** Avatar params → `look` consumed by Scene3D Fighter + SAK.avatarSVG. */
  function toLook(avatar) {
    const a = sanitize(avatar);
    return {
      skin: a.skin, shirt: a.shirt, hair: a.hairColor, pants: a.pants, accessory: a.accessory, print: a.print,
      accent: a.accessory === 'laser' ? '#ff1a1a' : a.accessory === 'crown' ? '#ffd23f' : '#ffffff',
      body: a.body, hairStyle: a.hairStyle, eyes: a.eyes, eyeColor: a.eyeColor, species: a.species, outfit: a.outfit
    };
  }

  function newId() { return 'acct_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function create(name, avatar, phrase) {
    return { v: VERSION, id: newId(), name, createdAt: Date.now(), phrase: phrase || '', avatar: sanitize(avatar) };
  }

  /**
   * Upgrade an old save's fighter ({ name, colour, phrase }) into a v2 profile.
   * `lookFromName` keeps the face/hair the old build hashed from the name.
   */
  function migrate(state, lookFromName) {
    const p = state.profile;
    if (!p) return false;
    if (p.v === VERSION && p.avatar) { p.avatar = sanitize(p.avatar); return false; }
    const L = lookFromName ? lookFromName(p.name || 'YOU', p.colour || SAK.PLAYER.look.shirt) : {};
    state.profile = {
      v: VERSION, id: p.id || newId(), name: p.name || 'YOU', createdAt: p.createdAt || Date.now(), phrase: p.phrase || '',
      avatar: sanitize(Object.assign(defaultAvatar(), { skin: L.skin, hairColor: L.hair, shirt: p.colour, accessory: 'headband' }))
    };
    return true;
  }

  /** Player name: 2–16 chars after trimming / collapsing spaces. */
  function validateName(raw) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2) return { err: 'min 2 characters' };
    if (t.length > 16) return { err: 'max 16 characters' };
    return { ok: t };
  }

  /** FUTURE: AI reads an uploaded PFP and returns avatar params. Not built yet. */
  function fromPfp(/* imageFile */) { return Promise.reject(new Error('AI fighter from PFP: coming soon')); }

  return { VERSION, OPTIONS, defaultAvatar, sanitize, randomAvatar, toLook, create, migrate, validateName, fromPfp };
})();
