/* =========================================================================
 * SAK.Traits — NFT-style fighter trait system (Phase 1: no blockchain)
 * -------------------------------------------------------------------------
 * Trait layers with weighted rarity. Each randomize rolls every layer
 * except gloves (PTS shop track since 2026-10-25 — see SAK.GLOVE_TIERS).
 * Players get 5 rerolls, then lock in their fighter.
 * Rarity tiers: common → uncommon → rare → epic → legendary
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Traits = (() => {
  const RARITY = {
    common:    { weight: 60, color: '#9aa0b0', label: 'Common' },
    uncommon:  { weight: 25, color: '#39ff88', label: 'Uncommon' },
    rare:      { weight: 10, color: '#4fa8ff', label: 'Rare' },
    epic:      { weight: 4,  color: '#c86bff', label: 'Epic' },
    legendary: { weight: 1,  color: '#ffd23f', label: 'Legendary' },
  };
  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  // Each layer: array of { id, label, rarity, value }
  // value maps to the existing avatar look fields where possible.
  const LAYERS = {
    // Species (LT 2026-10-23; frog retired 2026-10-25 — its eyes-on-top
    // look didn't read well): all 8 remaining species already have 3D
    // geometry + portrait art; Human carries a weight override so ~2/3
    // of rolls stay human and animals read as a treat (Panda = the
    // legendary chase).
    species: [
      { id: 'human', label: 'Human', rarity: 'common', weight: 180 },
      { id: 'bear', label: 'Bear 🐻', rarity: 'uncommon' },
      { id: 'bull', label: 'Bull 🐂', rarity: 'uncommon' },
      { id: 'ape', label: 'Ape 🦍', rarity: 'rare' },
      { id: 'dog', label: 'Dog 🐶', rarity: 'rare' },
      { id: 'cat', label: 'Cat 🐱', rarity: 'rare' },
      { id: 'rabbit', label: 'Rabbit 🐰', rarity: 'epic' },
      { id: 'panda', label: 'Panda 🐼', rarity: 'legendary' },
    ],
    body: [
      { id: 'classic', label: 'Classic', rarity: 'common' },
      { id: 'chonk', label: 'Chonk', rarity: 'common' },
      { id: 'noodle', label: 'Noodle', rarity: 'uncommon' },
      { id: 'smol', label: 'Smol', rarity: 'uncommon' },
      { id: 'gymbro', label: 'Gym Bro', rarity: 'rare' },
    ],
    skin: [
      { id: 's1', label: 'Porcelain', rarity: 'common', value: '#ffe0c4' },
      { id: 's2', label: 'Sand', rarity: 'common', value: '#f6c9a0' },
      { id: 's3', label: 'Honey', rarity: 'common', value: '#e0a77a' },
      { id: 's4', label: 'Bronze', rarity: 'uncommon', value: '#c98b5f' },
      { id: 's5', label: 'Espresso', rarity: 'uncommon', value: '#7a4a2e' },
      { id: 's6', label: 'Frost', rarity: 'rare', value: '#9fd3ff' },
      { id: 's7', label: 'Toxic', rarity: 'epic', value: '#b6ff9f' },
      { id: 's8', label: 'Magma', rarity: 'legendary', value: '#ff6b35' },
    ],
    eyes: [
      { id: 'round', label: 'Round', rarity: 'common' },
      { id: 'dot', label: 'Dot', rarity: 'common' },
      { id: 'sleepy', label: 'Sleepy', rarity: 'uncommon' },
      { id: 'big', label: 'Big', rarity: 'rare' },
      { id: 'angry', label: 'Angry', rarity: 'epic' },
      { id: 'laser', label: 'Laser', rarity: 'legendary' },
    ],
    eyeColor: [
      { id: 'e1', label: 'Onyx', rarity: 'common', value: '#1a1a1a' },
      { id: 'e2', label: 'Ocean', rarity: 'common', value: '#3a6fd8' },
      { id: 'e3', label: 'Forest', rarity: 'uncommon', value: '#2e9e4f' },
      { id: 'e4', label: 'Amber', rarity: 'uncommon', value: '#7a4a24' },
      { id: 'e5', label: 'Violet', rarity: 'rare', value: '#9b5cff' },
      { id: 'e6', label: 'Crimson', rarity: 'epic', value: '#ff3b5c' },
      { id: 'e7', label: 'Gold', rarity: 'legendary', value: '#ffd23f' },
    ],
    hairStyle: [
      { id: 'short', label: 'Short', rarity: 'common' },
      { id: 'buzz', label: 'Buzz', rarity: 'common' },
      { id: 'bald', label: 'Bald', rarity: 'common' },
      { id: 'long', label: 'Long', rarity: 'uncommon' },
      { id: 'bun', label: 'Bun', rarity: 'uncommon' },
      { id: 'spiky', label: 'Spiky', rarity: 'rare' },
      { id: 'afro', label: 'Afro', rarity: 'epic' },
      { id: 'mohawk', label: 'Mohawk', rarity: 'legendary' },
    ],
    hairColor: [
      { id: 'h1', label: 'Midnight', rarity: 'common', value: '#1a1a1a' },
      { id: 'h2', label: 'Chestnut', rarity: 'common', value: '#3b2416' },
      { id: 'h3', label: 'Copper', rarity: 'uncommon', value: '#7a4a24' },
      { id: 'h4', label: 'Platinum', rarity: 'uncommon', value: '#e9e9f5' },
      { id: 'h5', label: 'Ember', rarity: 'rare', value: '#ff5a36' },
      { id: 'h6', label: 'Frost', rarity: 'rare', value: '#22c3ff' },
      { id: 'h7', label: 'Bubblegum', rarity: 'epic', value: '#ff7ad9' },
      { id: 'h8', label: 'Slime', rarity: 'legendary', value: '#39ff88' },
    ],
    gloves: [
      { id: 'wrap', label: 'Hand Wraps', rarity: 'common' },
      { id: 'mma', label: 'MMA Gloves', rarity: 'common' },
      { id: 'boxing', label: 'Boxing Gloves', rarity: 'uncommon' },
      { id: 'gold', label: 'Golden Fists', rarity: 'rare' },
      { id: 'spike', label: 'Spiked', rarity: 'epic' },
      { id: 'diamond', label: 'Diamond 💎', rarity: 'legendary' },
    ],
    outfit: [
      { id: 'tee', label: 'Gym Tee', rarity: 'common' },
      { id: 'tank', label: 'Tank Top', rarity: 'common' },
      { id: 'hoodie', label: 'Hoodie', rarity: 'uncommon' },
      { id: 'gi', label: 'Fight Gi', rarity: 'uncommon' },
      { id: 'suit', label: 'Suit', rarity: 'rare' },
      { id: 'chart', label: 'Chart Print 📈', rarity: 'rare' },
      { id: 'gold', label: 'Gold Lamé', rarity: 'epic' },
      { id: 'flames', label: 'Flames 🔥', rarity: 'epic' },
      { id: 'money', label: 'Money Print 💵', rarity: 'epic' },
      { id: 'royal', label: 'Royal Robe', rarity: 'legendary' },
    ],
    // Pants (LT 2026-10-25): pants used to be one fixed dark navy for
    // every fighter — now they roll like any other layer. Navy is the
    // old in-game color (SAK.PLAYER.look.pants), so old saves default
    // to it and nothing changes for existing fighters.
    pants: [
      { id: 'p1', label: 'Navy', rarity: 'common', value: '#1d2a4d' },
      { id: 'p2', label: 'Denim', rarity: 'common', value: '#2b3a5c' },
      { id: 'p3', label: 'Charcoal', rarity: 'common', value: '#3a3a4a' },
      { id: 'p4', label: 'Burgundy', rarity: 'uncommon', value: '#5c2b3a' },
      { id: 'p5', label: 'Forest', rarity: 'uncommon', value: '#1a4a3a' },
      { id: 'p6', label: 'Khaki', rarity: 'rare', value: '#8a7a5c' },
      { id: 'p7', label: 'Crimson', rarity: 'epic', value: '#d42a2a' },
      { id: 'p8', label: 'Gold', rarity: 'legendary', value: '#ffd23f' },
    ],
    // Shirt prints (LT 2026-10-25): logo badges that roll like any
    // other layer and sit on the chest. 'none' carries a weight
    // override (like Human) so about half of fighters keep a plain
    // shirt and prints stay a treat. Logos live in assets/print-*.png
    // (circular-masked from LT's uploads) + embedded in card-assets.js
    // for the fighter card.
    print: [
      { id: 'none', label: 'None', rarity: 'common', weight: 180 },
      { id: 'btc', label: 'Bitcoin', rarity: 'common' },
      { id: 'sol', label: 'Solana', rarity: 'common' },
      { id: 'fomo', label: 'FOMO', rarity: 'uncommon' },
      { id: 'zec', label: 'Zcash', rarity: 'uncommon' },
      { id: 'stonks', label: 'STONKS', rarity: 'rare' },
      { id: 'pumpfun', label: 'PUMPFUN', rarity: 'epic' },
    ],
    accessory: [
      { id: 'none', label: 'None', rarity: 'common' },
      { id: 'headband', label: 'Headband', rarity: 'common' },
      { id: 'cap', label: 'Cap', rarity: 'uncommon' },
      { id: 'beanie', label: 'Beanie', rarity: 'uncommon' },
      { id: 'shades', label: 'Shades', rarity: 'rare' },
      { id: 'headphones', label: 'Cans', rarity: 'rare' },
      { id: 'visor', label: 'Visor', rarity: 'epic' },
      { id: 'tophat', label: 'Top Hat', rarity: 'epic' },
      { id: 'crown', label: 'Crown 👑', rarity: 'legendary' },
      { id: 'unicorn', label: 'Unicorn', rarity: 'legendary' },
    ],
  };

  const LAYER_ORDER = ['species', 'body', 'skin', 'eyes', 'eyeColor', 'hairStyle', 'hairColor', 'outfit', 'print', 'pants', 'accessory'];
  const LAYER_LABELS = {
    species: 'Species', body: 'Body', skin: 'Skin', eyes: 'Eyes', eyeColor: 'Eye Color',
    hairStyle: 'Hair', hairColor: 'Hair Color', gloves: 'Gloves',
    outfit: 'Outfit', print: 'Shirt Print', pants: 'Pants', accessory: 'Accessory',
  };

  const MAX_REROLLS = 5;

  /** Weighted pick from a layer's traits. */
  function rollLayer(layerId) {
    const traits = LAYERS[layerId];
    let total = 0;
    const weighted = traits.map(t => {
      const w = t.weight != null ? t.weight : RARITY[t.rarity].weight;
      total += w;
      return { t, w, cum: total };
    });
    let r = Math.random() * total;
    for (const { t, cum } of weighted) {
      if (r < cum) return t;
    }
    return traits[0];
  }

  /** Roll a full fighter: { layerId: trait } */
  function rollFighter() {
    const out = {};
    for (const layerId of LAYER_ORDER) {
      out[layerId] = rollLayer(layerId);
    }
    return out;
  }

  /** Overall rarity = highest trait rarity (a single legendary makes it legendary). */
  function getRarity(roll) {
    let best = 0;
    for (const layerId of LAYER_ORDER) {
      const t = roll[layerId];
      if (!t) continue;
      const idx = RARITY_ORDER.indexOf(t.rarity);
      if (idx > best) best = idx;
    }
    return RARITY_ORDER[best];
  }

  /** Count traits per rarity for the reveal UI. */
  function rarityBreakdown(roll) {
    const counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    for (const layerId of LAYER_ORDER) {
      const t = roll[layerId];
      if (t && counts[t.rarity] !== undefined) counts[t.rarity]++;
    }
    return counts;
  }

  /** Convert a trait roll to the game's avatar look object. */
  function toAvatar(roll) {
    const get = (layer, fallback) => {
      const t = roll[layer];
      if (!t) return fallback;
      return t.value !== undefined ? t.value : t.id;
    };
    return {
      species: get('species', 'human'),
      body: get('body', 'classic'),
      skin: get('skin', '#f6c9a0'),
      eyes: get('eyes', 'round'),
      eyeColor: get('eyeColor', '#1a1a1a'),
      hairStyle: get('hairStyle', 'short'),
      hairColor: get('hairColor', '#1a1a1a'),
      // gloves/outfit map to visual variants the 3D builder can read later
      gloves: get('gloves', 'wrap'),
      outfit: get('outfit', 'tee'),
      print: get('print', 'none'),
      pants: get('pants', '#1d2a4d'),
      accessory: get('accessory', 'none'),
      shirt: '#2f80ff', // derived from outfit in Phase 2
    };
  }

  return {
    RARITY, RARITY_ORDER, LAYERS, LAYER_ORDER, LAYER_LABELS, MAX_REROLLS,
    rollLayer, rollFighter, getRarity, rarityBreakdown, toAvatar,
  };
})();
