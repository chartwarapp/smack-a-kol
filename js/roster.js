/* =========================================================================
 * Smack-a-KOL — KOL ROSTER (edit me!)
 * -------------------------------------------------------------------------
 * Plain data array: add / remove / rename entries freely, no other code
 * changes needed. Order = progression order in the picker.
 * Required fields: id (unique), name, handle, level, tagline, difficulty
 * (1-5), hp, power, accuracy (0-1), winPts, minBet, payout, look{}, taunts[].
 * ========================================================================= */
window.SAK = window.SAK || {};

/* ---- KOL roster ---------------------------------------------------------
 * PARODY characters loosely inspired by well-known crypto-Twitter personas,
 * with altered names, cartoon looks and invented handles. Jokes riff on public
 * meme personas only — nothing here is a factual claim about anyone.
 *
 * winPts = PTS for a (free) win. payout = optional-bet multiplier.
 * minBet = smallest PTS bet allowed vs this KOL.
 * difficulty 1..5 → meter speed + AI accuracy. `accuracy` (0..1) drives the AI
 * timing roll. `look` drives both the 3D model and the SVG portrait.
 * accessory: shades | cap | crown | laser | headphones | tophat | beanie | visor | unicorn | headband */
SAK.PARODY_DISCLAIMER = 'All KOLs are fictional parody cartoons. Not affiliated with, endorsed by, or depicting any real person.';

SAK.KOLS = [
  {
    id: 'solflakey', name: 'SolFlakey', handle: '@SolFlakey', level: 1,
    tagline: 'Pink hair. Backwards cap. Flaky plans, heavy hands.',
    difficulty: 1, hp: 70, power: 9, accuracy: 0.40, winPts: 120, minBet: 50, payout: 1.6,
    look: { skin: '#f2c49b', shirt: '#1f8a4c', hair: '#ff5a8a', pants: '#1a1a2a', accessory: 'shades', accent: '#111111', body: 'classic', hairStyle: 'long', eyes: 'round', outfit: 'tracksuit', parody: 'solflakey' },
    taunts: ['I said I\'d show up. I showed up to slap.', 'Flaky by name, heavy by hand.', 'My plans change. My slaps don\'t.']
  },
  {
    id: 'cupsalty', name: 'CupSalty', handle: '@CupSalty', level: 3,
    tagline: 'Salutes first. Rugs second. Smiles always.',
    difficulty: 3, hp: 105, power: 13, accuracy: 0.53, winPts: 240, minBet: 150, payout: 2.0,
    look: { skin: '#ffe14d', shirt: '#ffffff', hair: '#1a1a1a', pants: '#6b4423', accessory: 'none', accent: '#111111', body: 'classic', hairStyle: 'bald', eyes: 'big', eyeColor: '#3a6fd8', outfit: 'tie', tie: '#ff3b5c', tieKnot: '#c1121f', parody: 'cupsalty' },
    taunts: ['The only thing I hold is your bags.', 'Salute first, rug second.', 'I pulled the rug. You pulled a muscle.']
  },
  {
    id: 'fabiony', name: 'Fabiony', handle: '@FabionySolana', level: 4,
    tagline: 'Little blue cat. Big Solana conviction.',
    difficulty: 3, hp: 130, power: 15, accuracy: 0.62, winPts: 320, minBet: 250, payout: 2.2,
    look: { species: 'cat', body: 'chonk', skin: '#a8d0f0', shirt: '#ffffff', hair: '#1a1a1a', pants: '#1a1a2a', accessory: 'visor', accent: '#111111', hairStyle: 'bald', eyes: 'round', outfit: 'tie' },
    taunts: ['Visor down. Paws up. Let\'s slap.', 'Meow means moon where I come from.', 'I bought the dip. I stayed for the slap.']
  },
  {
    id: 'arthurhaze', name: 'Arthur Haze', handle: '@EssaysAndSlaps', level: 5,
    tagline: 'Drops a 10,000-word macro essay between slaps.',
    difficulty: 3, hp: 155, power: 18, accuracy: 0.7, winPts: 420, minBet: 250, payout: 2.4,
    look: { skin: '#f0c8a8', shirt: '#9b5cff', hair: '#1a1a1a', pants: '#2b1b4f', accessory: 'tophat', accent: '#ffd23f', body: 'classic', hairStyle: 'short', eyes: 'round' },
    taunts: ['Long volatility. Short your HP.', 'Chapter 37: The Slap Printer.', 'Money printer goes slap.']
  },
  {
    id: 'tolly', name: 'Tolly', handle: '@400msSlaps', level: 6,
    tagline: 'Runs on 400ms blocks. Chews glass. Slaps faster.',
    difficulty: 4, hp: 180, power: 20, accuracy: 0.76, winPts: 540, minBet: 500, payout: 2.6,
    look: { skin: '#f4c7a1', shirt: '#1a1a2a', hair: '#1a1a1a', pants: '#3a1f6b', accessory: 'cap', accent: '#9945ff', body: 'gymbro', hairStyle: 'buzz', eyes: 'angry', facialHair: 'beard', glasses: 'shades', print: 'sol', parody: 'tolly' },
    taunts: ['Sub-second finality on your cheek.', 'Chewing glass, serving slaps.', 'Throughput: one slap per block.']
  },
  {
    id: 'mikesailor', name: 'Slingy', handle: '@NoSecondBestSlap', level: 7,
    tagline: 'Laser eyes. Infinite conviction. Zero chill.',
    difficulty: 4, hp: 200, power: 22, accuracy: 0.82, winPts: 680, minBet: 500, payout: 2.8,
    look: { skin: '#5f3a20', shirt: '#1a1a1a', hair: '#1a1a1a', pants: '#1a1a2a', accessory: 'shades', accent: '#111111', body: 'gymbro', hairStyle: 'buzz', eyes: 'angry', facialHair: 'goatee', outfit: 'tactical', parody: 'slingy', cardBg: '#ffd23f', cardShirt: '#ffd23f' },
    taunts: ['There is no second-best slap.', 'I just bought more slaps.', 'Laser-focused on your cheek. 👁👁']
  },
  {
    id: 'chairboy', name: 'Chairboy', handle: '@ChairboySlaps', level: 8,
    tagline: 'Take a seat. This slap is reserved.',
    difficulty: 4, hp: 220, power: 24, accuracy: 0.84, winPts: 780, minBet: 750, payout: 2.9,
    look: { skin: '#f2e6d8', shirt: '#f2e6d8', hair: '#f2e6d8', pants: '#1a1a2a', accessory: 'none', accent: '#22d3ee', body: 'classic', hairStyle: 'bald', eyes: 'round', eyeColor: '#ff9a1f', outfit: 'tee', parody: 'chairboy', cardBg: '#12121e' },
    taunts: ['Take a seat. This slap is reserved.', 'The chair recognizes you — as exit liquidity.', 'You just got chaired. 🪑']
  },
  /* ---- V3 Parody Fighters -------------------------------------------------
   * Cartoon parody presets inspired by reference images. The `parody` field
   * triggers special 3D geometry in the Fighter builder (horns, visor, etc.).
   * These are original parody characters, not depictions of real people. */
  {
    id: 'unibonker', name: 'UniBonker', handle: '@UniBonker', level: 7,
    tagline: 'Beep. Boop. Bonk.',
    difficulty: 4, hp: 200, power: 22, accuracy: 0.82, winPts: 680, minBet: 500, payout: 2.8,
    look: { skin: '#ffd23f', shirt: '#ffd23f', hair: '#1a1a1a', pants: '#ffd23f', accessory: 'none', accent: '#111111', body: 'classic', hairStyle: 'bald', eyes: 'round', parody: 'unibonker' },
    taunts: ['Beep boop. Your HP is now zero.', 'I run on 100% bonk energy.', 'Does not compute… how you lost that fast.']
  },
  {
    id: 'pattyspice', name: 'Patty Spice', handle: '@PattySpiceSlaps', level: 9,
    tagline: 'Blue crystal bull. Horns up. Visor down.',
    difficulty: 5, hp: 260, power: 27, accuracy: 0.85, winPts: 1000, minBet: 1000, payout: 3.2,
    look: { skin: '#4fb8ff', shirt: '#1a3a5c', hair: '#1a1a1a', pants: '#0f1f2e', accessory: 'visor', accent: '#22d3ee', body: 'gymbro', hairStyle: 'spiky', eyes: 'angry', eyeColor: '#0ea5e9', parody: 'patty', gloves: 'diamond', outfit: 'gold', outfitColor: '#2f7fe0', species: 'bull' },
    taunts: ['Feel the crystal sting.', 'Horns up, hands faster.', 'You just got iced. 🧊']
  },
  {
    id: 'frankienogood', name: 'Frankie NoGood', handle: '@FrankieNoGood', level: 9,
    tagline: 'Blonde buzz. Beaded chains. Zero mercy.',
    difficulty: 4, hp: 220, power: 24, accuracy: 0.8, winPts: 900, minBet: 500, payout: 3.0,
    look: { skin: '#f6c9a0', shirt: '#2f6fd8', hair: '#e9e9f5', pants: '#1f1f2e', accessory: 'none', accent: '#ff8fab', body: 'classic', hairStyle: 'buzz', eyes: 'round', eyeColor: '#3a6fd8', parody: 'frankie', gloves: 'mma', outfit: 'tee' },
    taunts: ['Nice chains. Shame about your face.', 'I\'m Frankie. You\'re nogood.', 'That slap had drip. 💧']
  },
  {
    id: 'ansombull', name: 'Ansom Bull', handle: '@AnsomBullSlaps', level: 10,
    tagline: 'Glowing horns. Dark energy. Final final boss.',
    difficulty: 5, hp: 300, power: 30, accuracy: 0.9, winPts: 1200, minBet: 1000, payout: 3.5,
    look: { skin: '#7a4a2e', shirt: '#1a1a1a', hair: '#0f0f0f', pants: '#0f0f0f', accessory: 'none', accent: '#39ff88', body: 'gymbro', hairStyle: 'afro', eyes: 'angry', eyeColor: '#22ff66', parody: 'ansom', gloves: 'spike', outfit: 'hoodie' },
    taunts: ['The horns see your fear.', 'Darkness slaps back.', 'You were never bullish on this.']
  },
  {
    id: 'alone', name: 'Alone', handle: '@Alone9', level: 10,
    tagline: 'Don\'t tread on me. Stop being poor.',
    difficulty: 5, hp: 280, power: 28, accuracy: 0.88, winPts: 1100, minBet: 1000, payout: 3.4,
    look: { skin: '#f5d3b8', shirt: '#ffffff', hair: '#c8c8d0', pants: '#1a1a2a', accessory: 'none', accent: '#111111', body: 'noodle', hairStyle: 'long', eyes: 'round', eyeColor: '#3a3a3a', outfit: 'tank', parody: 'alone', cardBg: '#5ecb88' },
    taunts: ['Don\'t tread on this slap. 🐍', 'This slap just launched — already up 100x.', 'You just got rugged by a slap.']
  }
];

