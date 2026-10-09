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
    id: 'ansom', name: 'Ansom', handle: '@BottomCallerAnsom', level: 1,
    tagline: 'Calls the bottom. Then calls it again. And again.',
    difficulty: 1, hp: 60, power: 8, accuracy: 0.35, winPts: 100, minBet: 100, payout: 1.6,
    look: { skin: '#f6c9a0', shirt: '#1f1f2e', hair: '#2a1a10', pants: '#3a3a52', accessory: 'cap', accent: '#ffffff', body: 'noodle', hairStyle: 'buzz', eyes: 'sleepy' },
    taunts: ['This is the bottom. Probably.', 'Send it. 🚀', 'I\'m bullish on your face.']
  },
  {
    id: 'kobee', name: 'Kobee', handle: '@UpOnlySlaps', level: 2,
    tagline: 'Retired from posting. Un-retired just to slap you.',
    difficulty: 2, hp: 85, power: 11, accuracy: 0.45, winPts: 160, minBet: 100, payout: 1.8,
    look: { skin: '#f2c49b', shirt: '#ff7a1a', hair: '#7a4a24', pants: '#2b2b44', accessory: 'headphones', accent: '#222222', body: 'classic', hairStyle: 'spiky', eyes: 'round' },
    taunts: ['UpOnly? More like SlapOnly.', 'Season 2 of this slap: coming soon™.', 'Hold on, I\'m recording this.']
  },
  {
    id: 'pentoshy', name: 'Pentoshy', handle: '@PenguinCharts', level: 3,
    tagline: 'A chart-drawing penguin. Speaks only in trendlines.',
    difficulty: 2, hp: 110, power: 13, accuracy: 0.55, winPts: 230, minBet: 100, payout: 2.0,
    look: { skin: '#e9f1ff', shirt: '#111a2e', hair: '#0b0f1a', pants: '#111a2e', accessory: 'beanie', accent: '#ffb000', body: 'chonk', hairStyle: 'bald', eyes: 'dot' },
    taunts: ['Higher timeframe says: slap.', 'Bullish divergence on my palm.', 'Zoom out. Still slapping.']
  },
  {
    id: 'murrad', name: 'Murrad', handle: '@SupercycleSlap', level: 4,
    tagline: 'Preaching the memecoin supercycle, one slap at a time.',
    difficulty: 3, hp: 130, power: 15, accuracy: 0.62, winPts: 320, minBet: 250, payout: 2.2,
    look: { skin: '#d9a37a', shirt: '#2ee6a6', hair: '#1b1029', pants: '#0f3d3a', accessory: 'shades', accent: '#111111', body: 'gymbro', hairStyle: 'bun', eyes: 'angry' },
    taunts: ['It\'s a supercycle, ser.', 'Cult slaps only.', 'Your bags are not ready.']
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
    look: { skin: '#f4c7a1', shirt: '#14f195', hair: '#3b2416', pants: '#3a1f6b', accessory: 'visor', accent: '#9945ff', body: 'gymbro', hairStyle: 'mohawk', eyes: 'angry' },
    taunts: ['Sub-second finality on your cheek.', 'Chewing glass, serving slaps.', 'Throughput: one slap per block.']
  },
  {
    id: 'mikesailor', name: 'Mike Sailor', handle: '@NoSecondBestSlap', level: 7,
    tagline: 'Laser eyes. Infinite conviction. Zero chill.',
    difficulty: 4, hp: 200, power: 22, accuracy: 0.82, winPts: 680, minBet: 500, payout: 2.8,
    look: { skin: '#f0b98f', shirt: '#ff9500', hair: '#cfcfd8', pants: '#1a1a2a', accessory: 'laser', accent: '#ff1a1a', body: 'chonk', hairStyle: 'buzz', eyes: 'big' },
    taunts: ['There is no second-best slap.', 'I just bought more slaps.', 'Laser-focused on your cheek. 👁👁']
  },
  {
    id: 'vitaleek', name: 'Vitaleek', handle: '@UltrasoundSlap', level: 8,
    tagline: 'Galaxy-brained unicorn whisperer. Final boss.',
    difficulty: 5, hp: 240, power: 25, accuracy: 0.88, winPts: 850, minBet: 1000, payout: 3.0,
    look: { skin: '#f6d2b4', shirt: '#ff7ad9', hair: '#c9a46b', pants: '#2a2a40', accessory: 'unicorn', accent: '#ffffff', body: 'smol', hairStyle: 'afro', eyes: 'big', eyeColor: '#7a2bff' },
    taunts: ['Have you considered a layer-2 slap?', 'Ultrasound slap incoming.', 'Gas-efficient palm deployed.']
  },
  /* ---- V3 Parody Fighters -------------------------------------------------
   * Cartoon parody presets inspired by reference images. The `parody` field
   * triggers special 3D geometry in the Fighter builder (horns, visor, etc.).
   * These are original parody characters, not depictions of real people. */
  {
    id: 'pattyspice', name: 'Patty Spice', handle: '@PattySpiceSlaps', level: 9,
    tagline: 'Blue crystal bull. Horns up. Visor down.',
    difficulty: 5, hp: 260, power: 27, accuracy: 0.85, winPts: 1000, minBet: 1000, payout: 3.2,
    look: { skin: '#4fb8ff', shirt: '#1a3a5c', hair: '#1a1a1a', pants: '#0f1f2e', accessory: 'visor', accent: '#22d3ee', body: 'gymbro', hairStyle: 'spiky', eyes: 'angry', eyeColor: '#0ea5e9', parody: 'patty', gloves: 'diamond', outfit: 'gold' },
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
  }
];

/* ---- STARTER FIGHTERS -----------------------------------------------------
 * FREE playable fighters. Every player picks one to start — no SOL required.
 * High quality but generic: distinct personalities, not personalized.
 * The paid value is identity (custom/rolled looks), not better visuals.
 * `starter: true` marks these so the game can distinguish them from
 * paid custom fighters. Keep look{} fields to values the 3D builder supports. */
SAK.STARTERS = [
  {
    id: 'rookie', name: 'Rookie', starter: true,
    tagline: 'Fresh face. Clean slap. The default pick.',
    look: { skin: '#f6c9a0', shirt: '#2f6fd8', hair: '#7a4a24', pants: '#2b3a5c', hairStyle: 'short', eyes: 'round', eyeColor: '#3a6fd8', body: 'classic', outfit: 'tee', accessory: 'none', gloves: 'wrap' },
    taunts: ['Let\'s do this! 🖐', 'I\'m new here, go easy... NOT.', 'Clean slap incoming!']
  },
  {
    id: 'bruiser', name: 'Bruiser', starter: true,
    tagline: 'Shaved head. Full beard. Hits like a truck.',
    look: { skin: '#c98b5f', shirt: '#1a1a1a', hair: '#1a1a1a', pants: '#2b2b3a', hairStyle: 'buzz', eyes: 'angry', eyeColor: '#1a1a1a', body: 'gymbro', outfit: 'tank', accessory: 'none', facialHair: 'beard', necklace: 'chain', gloves: 'mma' },
    taunts: ['You look soft.', 'I bench your portfolio.', 'Say goodbye to your cheek. 💪']
  },
  {
    id: 'speedster', name: 'Speedster', starter: true,
    tagline: 'Blink and you\'ll miss the slap.',
    look: { skin: '#e0a77a', shirt: '#ff3b5c', hair: '#1a1a1a', pants: '#1f1f2e', hairStyle: 'spiky', eyes: 'round', eyeColor: '#1a1a1a', body: 'classic', outfit: 'tracksuit', accessory: 'headband', gloves: 'wrap' },
    taunts: ['Too slow! ⚡', 'Catch me if you can.', 'Speed kills. So do I.']
  },
  {
    id: 'degen', name: 'Degen', starter: true,
    tagline: 'Laser eyes. Diamond hands. WAGMI.',
    look: { skin: '#f6c9a0', shirt: '#1f1f2e', hair: '#39ff88', pants: '#1f1f2e', hairStyle: 'wild', eyes: 'laser', eyeColor: '#39ff88', body: 'classic', outfit: 'hoodie', accessory: 'none', gloves: 'mma' },
    taunts: ['WAGMI (after this slap) 🚀', 'Diamond hands, diamond palm. 💎', 'To the moon, via your cheek. 🌙']
  },
  {
    id: 'clown', name: 'Clown', starter: true,
    tagline: 'Certified goofball. Uncertified slap machine.',
    look: { skin: '#ffe0c4', shirt: '#ff7ad9', hair: '#ff7ad9', pants: '#2f6fd8', hairStyle: 'afro', eyes: 'big', eyeColor: '#3a6fd8', body: 'classic', outfit: 'hawaiian', accessory: 'none', gloves: 'boxing', fierce: true },
    taunts: ['Honk honk! 🤡', 'Why so serious?', 'The joke\'s on your face!']
  },
  {
    id: 'veteran', name: 'Veteran', starter: true,
    tagline: 'Scars earned. Slaps perfected. No mercy left.',
    look: { skin: '#d9a37a', shirt: '#4a5c3a', hair: '#888888', pants: '#2b2b3a', hairStyle: 'buzz', eyes: 'angry', eyeColor: '#1a1a1a', body: 'classic', outfit: 'tactical', accessory: 'none', facialHair: 'goatee', tattoo: 'sleeves', gloves: 'mma' },
    taunts: ['I\'ve seen things. Then I slapped them.', 'War never changes. Slaps do.', 'At ease... NOT. 🖐']
  },
  {
    id: 'bear', name: 'Bear', starter: true,
    tagline: 'Lumberjack by day. Cheek-wrecker by night.',
    look: { skin: '#8b5a2b', shirt: '#cc3333', hair: '#5a3a1a', pants: '#2b3a2b', hairStyle: 'bald', eyes: 'round', eyeColor: '#3a2410', body: 'chonk', species: 'bear', outfit: 'tee', accessory: 'none', facialHair: 'beard', gloves: 'wrap' },
    taunts: ['Bear market energy. 🐻', 'I hug. Then I slap.', 'Timber! 🪓']
  },
  {
    id: 'bull', name: 'Bull', starter: true,
    tagline: 'Horns up. Leather on. Boss energy only.',
    look: { skin: '#a8714d', shirt: '#1a1a1a', hair: '#1a1a1a', pants: '#1f1f2e', hairStyle: 'bald', eyes: 'angry', eyeColor: '#ff3b5c', body: 'gymbro', species: 'bull', outfit: 'leather', accessory: 'none', gloves: 'spike' },
    taunts: ['The bull charges. 🐂', 'Horns see red. So will you.', 'No brakes on this slap.']
  }
];
