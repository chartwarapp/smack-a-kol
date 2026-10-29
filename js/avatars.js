/* =========================================================================
 * Procedural SVG portraits (used in HUD + KOL cards). Same `look` object as
 * the 3D model so colours always match.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.avatarSVG = function (look, opts) {
  opts = opts || {};
  const bg = opts.bg || look.cardBg || look.shirt;
  // LT 2026-10-25: the fighter card passes the account-dialect avatar
  // (hairColor), while the 3D preview converts to the scene dialect
  // (hair) first — so accept both, or the hair falls back to black.
  // Same gap for accessories: the scene dialect carries an accent
  // (laser red, crown gold, unicorn white) that the account dialect
  // lacks, so derive it from the accessory instead of defaulting black
  // (which turned the card's unicorn horn black while the 3D horn is
  // white). Other accessories keep the dark default, as in 3D.
  const s = look.skin, h = look.hair || look.hairColor || '#111';
  const a = look.accent || (look.accessory === 'laser' ? '#ff1a1a' : look.accessory === 'crown' ? '#ffd23f' : look.accessory === 'unicorn' ? '#ffffff' : '#111');
  const dead = !!opts.ko;

  const ec = look.eyeColor || '#222', es = look.eyes || 'round';
  let eyes;
  if (dead) eyes = `<g stroke="#222" stroke-width="3" stroke-linecap="round">
         <path d="M33 45l8 8M41 45l-8 8"/><path d="M59 45l8 8M67 45l-8 8"/></g>`;
  else if (es === 'dot') eyes = `<circle cx="37" cy="49" r="4" fill="${ec}"/><circle cx="63" cy="49" r="4" fill="${ec}"/>`;
  else if (es === 'big') eyes = `<circle cx="37" cy="49" r="8.5" fill="#fff"/><circle cx="63" cy="49" r="8.5" fill="#fff"/>
       <circle cx="38" cy="50" r="4.5" fill="${ec}"/><circle cx="62" cy="50" r="4.5" fill="${ec}"/>`;
  else eyes = `<circle cx="37" cy="49" r="6" fill="#fff"/><circle cx="63" cy="49" r="6" fill="#fff"/>
       <circle cx="38" cy="50" r="${es === 'angry' ? 2.4 : 3}" fill="${ec}"/><circle cx="62" cy="50" r="${es === 'angry' ? 2.4 : 3}" fill="${ec}"/>`
       + (es === 'sleepy' ? `<path d="M30 49a7 7 0 0 1 14 0Z" fill="${s}"/><path d="M56 49a7 7 0 0 1 14 0Z" fill="${s}"/>` : '');
  const brows = es === 'angry' ? `<path d="M30 39l12 5M70 39l-12 5" stroke="${h}" stroke-width="3.5" stroke-linecap="round"/>`
    : `<path d="M30 40l12 2M70 40l-12 2" stroke="${h}" stroke-width="3.5" stroke-linecap="round"/>`;

  // hair (KOLs without hairStyle keep the classic cap)
  let hs = look.hairStyle || 'short';
  if (['cap', 'beanie', 'tophat'].includes(look.accessory) && ['spiky', 'mohawk', 'afro', 'bun'].includes(hs)) hs = 'short';
  const capPath = `<path d="M20 46 Q22 16 50 16 Q78 16 80 46 Q66 30 50 32 Q34 30 20 46Z" fill="${h}"/>`;
  let hairBack = '', hairFront = '';
  switch (hs) {
    case 'bald': break;
    case 'buzz': hairFront = `<path d="M22 42 Q24 20 50 20 Q76 20 78 42 Q66 31 50 32 Q34 31 22 42Z" fill="${h}" opacity="0.9"/>`; break;
    case 'spiky': hairFront = capPath + `<path d="M24 32 L28 10 L37 24 L44 4 L50 20 L57 4 L63 24 L72 10 L76 32Z" fill="${h}"/>`; break;
    case 'mohawk': hairFront = `<path d="M43 34 L44 4 L50 0 L56 4 L57 34Z" fill="${h}"/>`; break;
    case 'long': hairBack = `<path d="M18 46 Q16 86 26 92 L74 92 Q84 86 82 46Z" fill="${h}"/>`; hairFront = capPath; break;
    case 'afro': hairBack = `<circle cx="50" cy="36" r="34" fill="${h}"/>`; hairFront = `<path d="M22 44 Q24 22 50 24 Q76 22 78 44 Q66 32 50 34 Q34 32 22 44Z" fill="${h}"/>`; break;
    case 'bun': hairFront = capPath + `<circle cx="50" cy="12" r="9" fill="${h}"/>`; break;
    default: hairFront = capPath;
  }
  const sw = { chonk: [10, 90], gymbro: [8, 92], noodle: [26, 74], smol: [20, 80] }[look.body] || [18, 82];

  let acc = '';
  switch (look.accessory) {
    case 'shades':
      acc = `<rect x="25" y="42" width="22" height="12" rx="4" fill="${a}"/><rect x="53" y="42" width="22" height="12" rx="4" fill="${a}"/><rect x="45" y="45" width="10" height="3" fill="${a}"/>`; break;
    case 'cap':
      acc = `<path d="M22 36 Q50 4 78 36 Z" fill="${look.shirt}" stroke="#0003" stroke-width="2"/><rect x="50" y="31" width="38" height="7" rx="3" fill="${look.shirt}" stroke="#0003" stroke-width="2"/>`; break;
    case 'crown':
      acc = `<path d="M28 30 L32 12 L41 24 L50 8 L59 24 L68 12 L72 30 Z" fill="${a}" stroke="#a87b00" stroke-width="2"/>`; break;
    case 'laser':
      acc = `<path d="M37 50 L2 70" stroke="#ff1a1a" stroke-width="4"/><path d="M63 50 L98 70" stroke="#ff1a1a" stroke-width="4"/><circle cx="37" cy="50" r="5" fill="#ff1a1a"/><circle cx="63" cy="50" r="5" fill="#ff1a1a"/>`; break;
    case 'headphones':
      acc = `<path d="M20 52 Q20 14 50 14 Q80 14 80 52" fill="none" stroke="${a}" stroke-width="6"/><rect x="13" y="44" width="12" height="20" rx="5" fill="${a}"/><rect x="75" y="44" width="12" height="20" rx="5" fill="${a}"/>`; break;
    case 'tophat':
      acc = `<rect x="22" y="26" width="56" height="6" rx="2" fill="#111"/><rect x="32" y="2" width="36" height="26" rx="2" fill="#111"/><rect x="32" y="20" width="36" height="5" fill="${a}"/>`; break;
    case 'beanie':
      acc = `<path d="M23 38 Q50 0 77 38 Z" fill="${a}"/><rect x="21" y="32" width="58" height="9" rx="4" fill="#fff"/><circle cx="50" cy="12" r="6" fill="#fff"/>`; break;
    case 'visor':
      acc = `<rect x="22" y="40" width="56" height="14" rx="7" fill="${a}" opacity="0.9"/><rect x="26" y="43" width="20" height="4" rx="2" fill="#fff8"/>`; break;
    case 'unicorn':
      acc = `<path d="M44 22 L56 22 L52 -2 Z" fill="${a}" stroke="#0004" stroke-width="2"/><path d="M45 15h10M46 8h7" stroke="#fff8" stroke-width="2"/>`; break;
    case 'headband':
      acc = `<rect x="22" y="30" width="56" height="8" rx="3" fill="#ff3b3b"/>`; break;
  }

  const mouth = dead
    ? `<ellipse cx="50" cy="70" rx="7" ry="5" fill="#5a1a1a"/>`
    : `<path d="M40 67 Q50 75 60 67" stroke="#5a1a1a" stroke-width="3" fill="none" stroke-linecap="round"/>`;

  // V3: facial hair (mustache for Frankie NoGood parody)
  let facialHair = '';
  if (look.facialHair === 'mustache' || look.parody === 'frankie') {
    facialHair = `<g>
      <ellipse cx="41" cy="63" rx="9" ry="4" fill="#6b4423" transform="rotate(-12 41 63)"/>
      <ellipse cx="59" cy="63" rx="9" ry="4" fill="#6b4423" transform="rotate(12 59 63)"/>
    </g>`;
  }

  // UniBonker robot (LT 2026-10-26): antenna, forehead band, black oval
  // eyes, silver ear discs — drawn over the standard face.
  const unibonkerFx = look.parody === 'unibonker'
    ? `<g><line x1="50" y1="20" x2="50" y2="4" stroke="#1a1a1a" stroke-width="2.5"/><circle cx="50" cy="4" r="3.5" fill="#ff5a36"/><rect x="22" y="32" width="56" height="10" rx="3" fill="#9fb8d8"/><ellipse cx="37" cy="49" rx="8.5" ry="11" fill="#111"/><ellipse cx="63" cy="49" rx="8.5" ry="11" fill="#111"/><circle cx="20" cy="50" r="9" fill="#c0c8d0"/><circle cx="80" cy="50" r="9" fill="#c0c8d0"/></g>`
    : '';

  // V3: horns accessory (for Ansom Bull parody)
  let horns = '';
  if (look.accessory === 'horns' || look.parody === 'ansom') {
    horns = `<g>
      <path d="M28 28 Q18 10 26 2 Q30 12 36 22 Z" fill="#39ff88" opacity="0.9"/>
      <path d="M72 28 Q82 10 74 2 Q70 12 64 22 Z" fill="#39ff88" opacity="0.9"/>
    </g>`;
  }

  // Tie (Fabiony, LT 2026-10-26): knot + body over the shirt, drawn late
  // so the knot sits on the collar under the chin. Colours from the
  // look (tie / tieKnot); default is Fabiony's green + purple.
  const tieFx = look.outfit === 'tie'
    ? `<g><rect x="45" y="73" width="10" height="7" rx="2" fill="${look.tieKnot || '#9945ff'}"/><path d="M47 80 L53 80 L52 98 L48 98 Z" fill="${look.tie || '#14f195'}"/></g>`
    : '';

  // SolFlakey (LT 2026-10-26): black cap dome over the pink hair
  // (no front brim — the cap is backwards) + dark beard framing the
  // jaw, mouth left clear via the even-odd cutout.
  const solflakeyFx = look.parody === 'solflakey'
    ? `<g><rect x="27" y="35" width="19" height="10" fill="${s}"/><rect x="54" y="35" width="19" height="10" fill="${s}"/><path d="M22 36 Q50 4 78 36 Z" fill="#1a1a1a"/><path d="M30 58 Q30 82 50 84 Q70 82 70 58 L64 58 Q64 74 50 76 Q36 74 36 58 Z" fill="#2a1a12" fill-rule="evenodd"/></g>`
    : '';
  // CupSalty sponge (LT 2026-10-26): brow covers (a sponge has no
  // brows), olive cheek spots, buck teeth over the smile, camo cap.
  const cupsaltyFx = look.parody === 'cupsalty'
    ? `<g><rect x="27" y="35" width="19" height="10" fill="${s}"/><rect x="54" y="35" width="19" height="10" fill="${s}"/><circle cx="22" cy="62" r="4" fill="#9ab54d"/><circle cx="80" cy="58" r="5" fill="#9ab54d"/><rect x="44" y="70" width="6" height="10" rx="2" fill="#fff" stroke="#0003" stroke-width="1"/><rect x="50" y="70" width="6" height="10" rx="2" fill="#fff" stroke="#0003" stroke-width="1"/><path d="M22 36 Q50 4 78 36 Z" fill="#6b7c3f"/><ellipse cx="38" cy="26" rx="10" ry="6" fill="#4a5c2a"/><ellipse cx="62" cy="22" rx="8" ry="5" fill="#8a9a4b"/><rect x="48" y="38" width="30" height="7" rx="3" fill="#6b7c3f"/></g>`
    : '';
  // Slingy Blade-style parody (LT 2026-10-26): gray hairline patch,
  // mustache + goatee with gray chin patch, over the base shades.
  const slingyFx = look.parody === 'slingy'
    ? `<g><path d="M40 22 Q45 17 51 19 L49 26 Q44 24 41 27 Z" fill="#d8d8d8"/><ellipse cx="41" cy="62" rx="8" ry="3.5" fill="#1a1a1a" transform="rotate(-10 41 62)"/><ellipse cx="59" cy="62" rx="8" ry="3.5" fill="#1a1a1a" transform="rotate(10 59 62)"/><path d="M43 67 Q50 65 57 67 Q57 78 50 79 Q43 78 43 67 Z" fill="#1a1a1a"/><ellipse cx="50" cy="77" rx="4" ry="2.5" fill="#d8d8d8"/></g>`
    : '';
  // Alone (LT 2026-10-26): black cap + yellow front panel + yellow
  // brim band with DON'T TREAD ON ME, white oval sunglasses, flat
  // little mouth like the reference.
  const aloneFx = look.parody === 'alone'
    ? `<g><path d="M22 36 Q50 4 78 36 Z" fill="#1a1a1a"/><ellipse cx="50" cy="26" rx="15" ry="8" fill="#ffd23f"/><path d="M42 28 q4 -4 8 0 t8 0" stroke="#2a5c2a" stroke-width="1.5" fill="none" stroke-linecap="round"/><rect x="22" y="31" width="56" height="8" fill="#ffd23f"/><text x="50" y="37.5" text-anchor="middle" font-size="5" font-weight="bold" fill="#111" font-family="Arial, sans-serif">DON'T TREAD ON ME</text><ellipse cx="37" cy="51" rx="11" ry="10" fill="#fff" stroke="#0003" stroke-width="1"/><ellipse cx="63" cy="51" rx="11" ry="10" fill="#fff" stroke="#0003" stroke-width="1"/><ellipse cx="37" cy="51" rx="8" ry="8" fill="#1a1a1a"/><ellipse cx="63" cy="51" rx="8" ry="8" fill="#1a1a1a"/><rect x="39" y="64" width="22" height="12" fill="${s}"/><rect x="46" y="67" width="8" height="2.5" rx="1" fill="#1a1a1a"/></g>`
    : '';
  // Chairboy (LT 2026-10-27): skin cover over the brows, blue
  // gradient data-bar on the forehead, wide black visor with glowing
  // orange square eyes — the reference's pixel head in cartoon form.
  const chairboyFx = look.parody === 'chairboy'
    ? `<g><defs><linearGradient id="chairboyGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e0f2fe"/><stop offset="0.35" stop-color="#38bdf8"/><stop offset="0.7" stop-color="#22d3ee"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient></defs><path d="M28 24 L22 6 L36 18 L44 2 L52 16 L62 4 L72 22 Z" fill="${s}" stroke="#0003" stroke-width="1"/><path d="M21 34 L9 30 L21 42 Z M21 46 L11 46 L21 54 Z" fill="${s}" stroke="#0003" stroke-width="1"/><rect x="28" y="35" width="44" height="9" fill="${s}"/><rect x="30" y="27" width="40" height="8" rx="2" fill="url(#chairboyGrad)"/><rect x="24" y="44" width="52" height="14" rx="3" fill="#111118"/><rect x="36" y="48" width="7" height="7" fill="#ff9a1f"/><rect x="57" y="48" width="7" height="7" fill="#ff9a1f"/></g>`
    : '';
  // Tolly rework (LT 2026-10-27): brow cover (cap shadow), black
  // shades, full beard — cap comes from accessory 'cap', Solana logo
  // from look.print 'sol' on the body card + 3D chest badge.
  const tollyFx = look.parody === 'tolly'
    ? `<g><rect x="26" y="36" width="48" height="9" fill="${s}"/><rect x="25" y="42" width="22" height="12" rx="4" fill="#111"/><rect x="53" y="42" width="22" height="12" rx="4" fill="#111"/><rect x="45" y="45" width="10" height="3" fill="#111"/><path d="M30 58 Q30 82 50 84 Q70 82 70 58 L64 58 Q64 74 50 76 Q36 74 36 58 Z" fill="#1a1a1a" fill-rule="evenodd"/></g>`
    : '';
  // Poor Goat (LT 2026-10-28): black goat — plain red baseball cap
  // (no text) over the species bull horns, floppy goat ears, big black
  // handlebar mustache with curled tips. The cap dome covers the horn
  // bases; the horn tips poke out above it, like the reference.
  const poorgoatFx = look.parody === 'poorgoat'
    ? `<g><ellipse cx="14" cy="44" rx="9" ry="15" fill="${s}" stroke="#0003" stroke-width="2" transform="rotate(24 14 44)"/><ellipse cx="86" cy="44" rx="9" ry="15" fill="${s}" stroke="#0003" stroke-width="2" transform="rotate(-24 86 44)"/><path d="M22 36 Q50 2 78 36 Z" fill="#e03131" stroke="#0003" stroke-width="2"/><ellipse cx="50" cy="35" rx="30" ry="6" fill="#b81e28"/><ellipse cx="50" cy="33" rx="30" ry="2.5" fill="#ff6b6b" opacity="0.6"/><ellipse cx="40" cy="64" rx="12" ry="5" fill="#0a0a0a" stroke="#44444a" stroke-width="1" transform="rotate(-14 40 64)"/><ellipse cx="60" cy="64" rx="12" ry="5" fill="#0a0a0a" stroke="#44444a" stroke-width="1" transform="rotate(14 60 64)"/><path d="M28 62 Q26 56 30 55 M72 62 Q74 56 70 55" stroke="#0a0a0a" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>`
    : '';

  // Mertz (LT 2026-10-28): bald Zcash maxi — full dark beard + connected
  // mustache. The 2D base draws no beard (only mustache), so the beard
  // lives here; the 3D base beard covers the stage fighter, and the
  // Zcash chest badge comes from look.print 'zec' on the body card.
  const mertzFx = look.parody === 'mertz'
    ? `<g><path d="M30 58 Q30 82 50 84 Q70 82 70 58 L64 58 Q64 74 50 76 Q36 74 36 58 Z" fill="#1a1a1a" fill-rule="evenodd"/><ellipse cx="40" cy="62" rx="10" ry="3.5" fill="#1a1a1a"/><ellipse cx="60" cy="62" rx="10" ry="3.5" fill="#1a1a1a"/></g>`
    : '';

  // Minh Fantasy (LT 2026-10-28): blind swordsman — silver spiky hair
  // (base), black bandanna over the eyes with a side knot + flowing
  // tails. Skin cover hides the brows first (Chairboy pattern): a
  // blindfold with brows above it would read as a headband.
  const minhFx = look.parody === 'minhfantasy'
    ? `<g><rect x="24" y="36" width="52" height="10" fill="${s}"/><rect x="18" y="44" width="64" height="13" rx="4" fill="#111111"/><circle cx="82" cy="50" r="5" fill="#111111"/><path d="M84 47 Q92 42 96 44 M84 53 Q92 58 96 56" stroke="#111111" stroke-width="4" fill="none" stroke-linecap="round"/></g>`
    : '';

  // ChoosePoor Nick (LT 2026-10-28): white dog — big black visor
  // glasses with grey frame + shine stripes over the eyes, fluffy
  // fur tufts on the head top, big black nose + toothpick. Species
  // dog base draws the floppy ears + muzzle underneath.
  const choosepoorFx = look.parody === 'choosepoornick'
    ? `<g><circle cx="32" cy="16" r="9" fill="${s}" stroke="#0003" stroke-width="1.5"/><circle cx="50" cy="12" r="10" fill="${s}" stroke="#0003" stroke-width="1.5"/><circle cx="68" cy="16" r="9" fill="${s}" stroke="#0003" stroke-width="1.5"/><rect x="18" y="38" width="64" height="22" rx="7" fill="#8a919c"/><rect x="22" y="42" width="56" height="14" rx="4" fill="#14142a"/><path d="M34 56 L44 42 M52 56 L62 42" stroke="#ffffff" stroke-width="3" opacity="0.85" stroke-linecap="round"/><rect x="14" y="45" width="5" height="8" rx="2" fill="#14142a"/><rect x="81" y="45" width="5" height="8" rx="2" fill="#14142a"/><ellipse cx="50" cy="62" rx="7" ry="5" fill="#111111"/><line x1="40" y1="70" x2="31" y2="77" stroke="#d8c9a0" stroke-width="2" stroke-linecap="round"/></g>`
    : '';

  // Growling Kitty (LT 2026-10-28): blonde slick-back hair swept over
  // the top, wide black sunglasses over eyes + brows, flat little
  // mouth like the reference. Base hair is bald so the fx hair is
  // the whole style; shades draw after brows so nothing peeks out.
  const growlingFx = look.parody === 'growlingkitty'
    ? `<g><path d="M20 46 Q18 14 50 10 Q82 14 80 46 Q74 32 58 28 Q50 26 40 30 Q26 32 20 46 Z" fill="${h}" stroke="#0003" stroke-width="1.5"/><path d="M30 24 Q50 16 70 22 M34 30 Q52 22 68 28" stroke="#e0a92e" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="16" y="38" width="68" height="22" rx="6" fill="#111111"/><rect x="14" y="45" width="5" height="8" rx="2" fill="#111111"/><rect x="81" y="45" width="5" height="8" rx="2" fill="#111111"/><path d="M30 56 L40 42 M56 56 L66 42" stroke="#ffffff" stroke-width="2.5" opacity="0.7" stroke-linecap="round"/><rect x="38" y="64" width="24" height="12" fill="${s}"/><line x1="45" y1="69" x2="55" y2="69" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round"/></g>`
    : '';

  // Kooked (LT 2026-10-28): red balaclava — veil over the whole head
  // down past the chin, skin eye window, big black shiny angry eyes.
  // The veil draws after the base face so it covers ears, brows, nose
  // and mouth; only the window + eyes show through.
  const kookedFx = look.parody === 'kooked'
    ? `<g><path d="M18 100 L18 45 Q18 8 50 8 Q82 8 82 45 L82 100 Z" fill="#e03131" stroke="#0003" stroke-width="1.5"/><path d="M26 40 Q26 20 50 16 M74 40 Q74 20 50 16" stroke="#b81e28" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/><path d="M28 44 Q50 36 72 44 Q70 58 50 60 Q30 58 28 44 Z" fill="${s}"/><ellipse cx="41" cy="51" rx="8" ry="7" fill="#0a0a0a"/><ellipse cx="59" cy="51" rx="8" ry="7" fill="#0a0a0a"/><circle cx="39" cy="48" r="3" fill="#ffffff"/><circle cx="61" cy="48" r="3" fill="#ffffff"/><line x1="32" y1="42" x2="48" y2="46" stroke="#0a0a0a" stroke-width="3.5" stroke-linecap="round"/><line x1="68" y1="42" x2="52" y2="46" stroke="#0a0a0a" stroke-width="3.5" stroke-linecap="round"/></g>`
    : '';

  // Sensei SOL (LT 2026-10-28): gold conical straw hat, panda eye
  // patches kept (redrawn bigger, covering the base brows + base
  // eyes) with glowing white slits, black nose on the BEAR muzzle
  // (species is bear now — tan muzzle ellipse from speciesFx),
  // gold pipe. No mouth cover: the base smile reads as the bear
  // mouth on the muzzle.
  // The shallow wide cone covers the base ears' tops; the ear bottoms
  // peek below the brim, like the reference photo.
  const senseiFx = look.parody === 'senseisol'
    ? `<g><path d="M50 2 L98 30 Q50 22 2 30 Z" fill="#e8c547" stroke="#0003" stroke-width="1.5"/><line x1="50" y1="2" x2="20" y2="28" stroke="#c99327" stroke-width="1.5" opacity="0.6"/><line x1="50" y1="2" x2="80" y2="28" stroke="#c99327" stroke-width="1.5" opacity="0.6"/><line x1="32" y1="8" x2="24" y2="24" stroke="#ffffff" stroke-width="2" opacity="0.55" stroke-linecap="round"/><circle cx="50" cy="4" r="3" fill="#f5d76e"/><ellipse cx="38" cy="48" rx="9" ry="12" fill="#1a1a1a"/><ellipse cx="62" cy="48" rx="9" ry="12" fill="#1a1a1a"/><ellipse cx="38" cy="48" rx="4.5" ry="2.5" fill="#ffffff"/><ellipse cx="62" cy="48" rx="4.5" ry="2.5" fill="#ffffff"/><ellipse cx="50" cy="59" rx="5" ry="4" fill="#1a1a1a"/><line x1="56" y1="70" x2="70" y2="67" stroke="#d4af37" stroke-width="3" stroke-linecap="round"/><rect x="67" y="58" width="7" height="10" rx="2" fill="#d4af37" stroke="#0003" stroke-width="1"/></g>`
    : '';

  // Super Trump (LT 2026-10-28): MAX KOL 1 — red aura rings around
  // the head, boxy side-comb hair, stern flat mouth (base smile covered).
  const supertrumpFx = look.parody === 'supertrump'
    ? `<g><circle cx="50" cy="50" r="33" fill="none" stroke="#ff2a1a" stroke-width="3" opacity="0.45"/><circle cx="50" cy="50" r="37" fill="none" stroke="#ff2a1a" stroke-width="3" opacity="0.22"/><path d="M18 42 L18 16 L82 16 L82 42 Q74 30 50 32 Q26 30 18 42 Z" fill="#f2d06b" stroke="#0003" stroke-width="1.5"/><path d="M28 22 L74 27" fill="none" stroke="#d9b45c" stroke-width="2" stroke-linecap="round"/><path d="M30 29 L70 33" fill="none" stroke="#d9b45c" stroke-width="2" stroke-linecap="round"/><rect x="38" y="64" width="24" height="12" fill="${s}"/><line x1="43" y1="70" x2="57" y2="70" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round"/></g>`
    : '';

  // Elon Mars (LT 2026-10-28): MAX KOL 2 — neat brown hair under a
  // clear bubble helmet (light tint wash + shine arc over the face).
  const elonmarsFx = look.parody === 'elonmars'
    ? `<g><path d="M20 44 Q18 14 50 12 Q82 14 80 44 Q74 30 50 32 Q26 30 20 44 Z" fill="#6b4a2f" stroke="#0003" stroke-width="1.5"/><circle cx="50" cy="50" r="36" fill="#cfe8ff" fill-opacity="0.18" stroke="#e8f4ff" stroke-opacity="0.8" stroke-width="2.5"/><path d="M30 28 Q50 12 70 28" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.6" stroke-linecap="round"/></g>`
    : '';

  // Animal species overlays (drawn right after the head circle, under hair/eyes).
  let speciesFx = '';
  const sp = look.species || 'human';
  if (sp === 'bear') {
    speciesFx = `<g><circle cx="28" cy="24" r="9" fill="${s}" stroke="#0003" stroke-width="2"/><circle cx="72" cy="24" r="9" fill="${s}" stroke="#0003" stroke-width="2"/><circle cx="28" cy="24" r="4" fill="#e8b98a"/><circle cx="72" cy="24" r="4" fill="#e8b98a"/><ellipse cx="50" cy="63" rx="10" ry="7" fill="#f0d0a8"/></g>`;
  } else if (sp === 'bull' && look.parody !== 'ansom') {
    speciesFx = `<g><path d="M30 26 Q20 8 28 0 Q32 10 38 20 Z" fill="#e8dcc8" stroke="#0003" stroke-width="1.5"/><path d="M70 26 Q80 8 72 0 Q68 10 62 20 Z" fill="#e8dcc8" stroke="#0003" stroke-width="1.5"/><rect x="38" y="55" width="24" height="9" rx="4" fill="${s}" stroke="#0003" stroke-width="1.5"/></g>`;
  } else if (sp === 'ape') {
    speciesFx = `<g><rect x="28" y="36" width="44" height="8" rx="4" fill="${s}" stroke="#0003" stroke-width="1.5"/><rect x="35" y="66" width="30" height="10" rx="5" fill="${s}" stroke="#0003" stroke-width="1.5"/></g>`;
  } else if (sp === 'dog') {
    speciesFx = `<g><ellipse cx="22" cy="34" rx="8" ry="16" fill="${s}" stroke="#0003" stroke-width="2" transform="rotate(18 22 34)"/><ellipse cx="78" cy="34" rx="8" ry="16" fill="${s}" stroke="#0003" stroke-width="2" transform="rotate(-18 78 34)"/><ellipse cx="50" cy="62" rx="11" ry="8" fill="${s}" stroke="#0003" stroke-width="1.5"/></g>`;
  } else if (sp === 'cat') {
    speciesFx = `<g><path d="M28 30 L22 8 L42 20 Z" fill="${s}" stroke="#0003" stroke-width="2"/><path d="M72 30 L78 8 L58 20 Z" fill="${s}" stroke="#0003" stroke-width="2"/><path d="M29 24 L26 13 L36 19 Z" fill="#f0a0a0"/><path d="M71 24 L74 13 L64 19 Z" fill="#f0a0a0"/></g>`;
  } else if (sp === 'frog') {
    speciesFx = `<g><circle cx="35" cy="18" r="9" fill="${s}" stroke="#0003" stroke-width="2"/><circle cx="65" cy="18" r="9" fill="${s}" stroke="#0003" stroke-width="2"/><circle cx="35" cy="17" r="3.5" fill="#2a1e16"/><circle cx="65" cy="17" r="3.5" fill="#2a1e16"/></g>`;
  } else if (sp === 'rabbit') {
    speciesFx = `<g><ellipse cx="36" cy="10" rx="7" ry="16" fill="${s}" stroke="#0003" stroke-width="2"/><ellipse cx="64" cy="10" rx="7" ry="16" fill="${s}" stroke="#0003" stroke-width="2"/><ellipse cx="36" cy="11" rx="3" ry="10" fill="#f0a0a0"/><ellipse cx="64" cy="11" rx="3" ry="10" fill="#f0a0a0"/></g>`;
  } else if (sp === 'panda') {
    speciesFx = `<g><circle cx="28" cy="24" r="8" fill="#1a1a1a"/><circle cx="72" cy="24" r="8" fill="#1a1a1a"/><ellipse cx="38" cy="48" rx="8" ry="10" fill="#1a1a1a"/><ellipse cx="62" cy="48" rx="8" ry="10" fill="#1a1a1a"/></g>`;
  }

  // Evolving battle damage (0 clean → 3 wrecked), drawn over the face.
  // Wrecked = maximum cartoon damage for the loser: bloodied + bandaged.
  const wrecked = !!opts.wrecked;
  const dmg = wrecked ? 3 : Math.max(0, Math.min(3, opts.dmg | 0));
  let dmgFx = '';
  if ((!dead || wrecked) && dmg >= 1) {
    dmgFx += `<ellipse cx="68" cy="62" rx="9" ry="6" fill="#ff2d2d" opacity="0.45"/>`;
    dmgFx += `<ellipse cx="63" cy="49" rx="8" ry="6.5" fill="#5a2a6a" opacity="0.35"/>`;
  }
  if ((!dead || wrecked) && dmg >= 2) {
    dmgFx += `<ellipse cx="63" cy="49" rx="10" ry="8" fill="#3d1d55" opacity="0.7"/>`;
    dmgFx += `<ellipse cx="33" cy="64" rx="8" ry="6" fill="#6a2a8a" opacity="0.5"/>`;
    dmgFx += `<path d="M28 56 l11 9 M33 54 l11 9" stroke="#c22" stroke-width="1.6" opacity="0.8" stroke-linecap="round"/>`;
  }
  if ((!dead || wrecked) && dmg >= 3) {
    dmgFx += `<ellipse cx="37" cy="49" rx="10" ry="8" fill="#3d1d55" opacity="0.65"/>`;
    dmgFx += `<ellipse cx="50" cy="74" rx="12" ry="6" fill="#5a2a6a" opacity="0.5"/>`;
    dmgFx += `<circle cx="73" cy="38" r="6" fill="${s}" stroke="#c22" stroke-width="2"/>`;
  }
  if (wrecked) {
    // Bandage strips: forehead + X on the cheek
    dmgFx += `<g transform="rotate(-8 50 32)"><rect x="33" y="27.5" width="34" height="9" rx="4" fill="#e8d5b0" stroke="#c9a86a" stroke-width="1.5"/><line x1="42" y1="28" x2="42" y2="36" stroke="#c9a86a" stroke-width="1"/><line x1="58" y1="28" x2="58" y2="36" stroke="#c9a86a" stroke-width="1"/></g>`;
    dmgFx += `<g><rect x="20" y="61" width="20" height="6" rx="3" fill="#e8d5b0" stroke="#c9a86a" stroke-width="1.5" transform="rotate(28 30 64)"/><rect x="20" y="61" width="20" height="6" rx="3" fill="#e8d5b0" stroke="#c9a86a" stroke-width="1.5" transform="rotate(-28 30 64)"/></g>`;
    // Bloodied nose: cartoon drip
    dmgFx += `<ellipse cx="50" cy="63" rx="3" ry="4" fill="#d42a2a"/><path d="M50 66 q-1.5 5 -2.5 8" stroke="#d42a2a" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
    dmgFx += `<path d="M60 68 l5 3" stroke="#d42a2a" stroke-width="2" stroke-linecap="round"/>`;
  }

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="avatar-svg">
    <rect width="100" height="100" rx="18" fill="${bg}"/>
    <rect y="80" width="100" height="20" fill="#0002"/>
    ${hairBack}
    <path d="M${sw[0]} 100 Q50 72 ${sw[1]} 100 Z" fill="${look.cardShirt || look.shirt}" stroke="#0003" stroke-width="2"/>
    <circle cx="50" cy="50" r="30" fill="${s}" stroke="#0003" stroke-width="2"/>
    ${speciesFx}
    ${hairFront}
    <circle cx="24" cy="54" r="5" fill="${s}" stroke="#0002" stroke-width="2"/>
    <circle cx="76" cy="54" r="5" fill="${s}" stroke="#0002" stroke-width="2"/>
    ${eyes}
    ${brows}
    <ellipse cx="50" cy="59" rx="4" ry="3" fill="#0002"/>
    ${mouth}
    ${facialHair}
    ${horns}
    ${unibonkerFx}
    ${cupsaltyFx}
    ${solflakeyFx}
    ${slingyFx}
    ${aloneFx}
    ${chairboyFx}
    ${tollyFx}
    ${poorgoatFx}
    ${mertzFx}
    ${minhFx}
    ${choosepoorFx}
    ${growlingFx}
    ${kookedFx}
    ${senseiFx}
    ${supertrumpFx}
    ${elonmarsFx}
    ${opts.blush ? '<ellipse cx="68" cy="62" rx="9" ry="6" fill="#ff2d2d" opacity="0.55"/>' : ''}
    ${dmgFx}
    ${tieFx}
    ${acc}
  </svg>`;
};

/* Full-body figure for the fighter card (LT 2026-10-25: whole body on the
 * left, info on the right). Reuses the avatarSVG head with its portrait
 * background + shirt wedge stripped, over a simple cartoon body, so hair,
 * skin, species and shirt always match the 3D preview. viewBox 0 0 100 170. */
SAK.avatarBodySVG = function (look) {
  const head = SAK.avatarSVG(look, {})
    .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .replace(/<rect width="100" height="100" rx="18" fill="[^"]*"\/>/, '')
    .replace(/<rect y="80" width="100" height="20" fill="#0002"\/>/, '')
    .replace(/<path d="M[^"]* 100 Q50 72 [^"]* 100 Z" fill="[^"]*" stroke="#0003" stroke-width="2"\/>/, '');
  const s = look.skin || '#c98d5f';
  const shirt = look.shirt || '#2f80ff';
  const pants = look.pants || '#1d2a4d', shoe = '#1a1a22';
  // Shirt print (LT 2026-10-25): the rolled logo badge on the chest,
  // from the embedded data URIs in card-assets.js (external refs are
  // blocked inside SVG-as-img rasterization, same as the font + hand).
  const prints = (typeof SAK !== 'undefined' && SAK.CARD_ASSETS && SAK.CARD_ASSETS.prints) || {};
  const printImg = (look.print && look.print !== 'none' && prints[look.print])
    ? `<image href="${prints[look.print]}" x="36.8" y="97.8" width="26.4" height="26.4" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  const bw = { chonk: 8, gymbro: 4, noodle: -6, smol: -2 }[look.body] || 0;
  const tx0 = 27 - bw / 2, tx1 = 73 + bw / 2, tw = tx1 - tx0;
  // Alone (LT 2026-10-26): STOP BEING POOR print on the tank.
  const aloneShirt = look.parody === 'alone'
    ? `<text x="50" y="102" text-anchor="middle" font-size="10" font-weight="bold" fill="#111" font-family="Arial, sans-serif">STOP</text><text x="50" y="113" text-anchor="middle" font-size="10" font-weight="bold" fill="#111" font-family="Arial, sans-serif">BEING</text><text x="50" y="124" text-anchor="middle" font-size="10" font-weight="bold" fill="#111" font-family="Arial, sans-serif">POOR</text>`
    : '';
  // Poor Goat (LT 2026-10-28): hoodie drawstrings + kangaroo pocket +
  // glowing yellow C chest logo on the charcoal hoodie.
  const poorgoatShirt = look.parody === 'poorgoat'
    ? `<g><path d="M62 96 A13 13 0 1 0 62 118" fill="none" stroke="#ffd23f" stroke-width="6" stroke-linecap="round" opacity="0.35"/><path d="M62 96 A13 13 0 1 0 62 118" fill="none" stroke="#ffd23f" stroke-width="4" stroke-linecap="round"/><line x1="44" y1="88" x2="44" y2="99" stroke="#111111" stroke-width="2.5" stroke-linecap="round"/><line x1="56" y1="88" x2="56" y2="99" stroke="#111111" stroke-width="2.5" stroke-linecap="round"/><circle cx="44" cy="100" r="2" fill="#111111"/><circle cx="56" cy="100" r="2" fill="#111111"/><rect x="38" y="118" width="24" height="9" rx="3" fill="#1a1a1e" stroke="#0003" stroke-width="1.5"/></g>`
    : '';
  // Minh Fantasy (LT 2026-10-28): brown blazer lapels + dark open
  // front + gold chain, and the katana diagonal across the back —
  // drawn BEFORE the torso so the torso and head cover its middle
  // and only the hip tip + shoulder hilt peek out, like the reference.
  const minhShirt = look.parody === 'minhfantasy'
    ? `<g><polygon points="44,88 56,88 50,110" fill="#1a1a22"/><polygon points="42,88 50,96 46,122 38,102" fill="#2e1d12"/><polygon points="58,88 50,96 54,122 62,102" fill="#2e1d12"/><path d="M44 90 Q50 98 56 90" stroke="#ffd23f" stroke-width="1.5" fill="none"/></g>`
    : '';
  const minhSword = look.parody === 'minhfantasy'
    ? `<g><line x1="16" y1="138" x2="86" y2="60" stroke="#7a1f1f" stroke-width="6" stroke-linecap="round"/><line x1="16" y1="138" x2="86" y2="60" stroke="#a83232" stroke-width="2" stroke-linecap="round" opacity="0.5"/><g transform="rotate(-48 86 60)"><rect x="84" y="57" width="9" height="6" fill="#ffd23f"/><rect x="91" y="57" width="8" height="6" rx="2" fill="#1a1a22"/></g><rect x="21" y="126" width="6" height="6" fill="#ffd23f" transform="rotate(-48 24 129)"/></g>`
    : '';
  // ChoosePoor Nick (LT 2026-10-28): black blazer lapels over a white
  // collar shirt V, black tie down the center.
  const choosepoorShirt = look.parody === 'choosepoornick'
    ? `<g><polygon points="42,88 58,88 50,110" fill="#f2f2f2"/><polygon points="42,88 50,96 46,122 38,102" fill="#2a2a35"/><polygon points="58,88 50,96 54,122 62,102" fill="#2a2a35"/><polygon points="47,93 53,93 52,100 48,100" fill="#111111"/><polygon points="48,100 52,100 51,122 49,122" fill="#111111"/></g>`
    : '';
  // Growling Kitty (LT 2026-10-28): black suit lapels over a white
  // collar shirt V, red tie down the center.
  const growlingShirt = look.parody === 'growlingkitty'
    ? `<g><polygon points="42,88 58,88 50,110" fill="#f2f2f2"/><polygon points="42,88 50,96 46,122 38,102" fill="#2a2a35"/><polygon points="58,88 50,96 54,122 62,102" fill="#2a2a35"/><polygon points="47,93 53,93 52,100 48,100" fill="#e11d2e"/><polygon points="48,100 52,100 51,122 49,122" fill="#e11d2e"/></g>`
    : '';
  // Kooked (LT 2026-10-28): red hoodie — white flame silhouette on
  // the chest + drawstrings + kangaroo pocket.
  const kookedShirt = look.parody === 'kooked'
    ? `<g><path d="M50 96 Q56 106 54 114 Q60 110 58 120 Q54 128 50 126 Q46 128 42 120 Q40 110 46 114 Q44 106 50 96 Z" fill="#ffffff"/><line x1="42" y1="88" x2="41" y2="104" stroke="#f2f2f2" stroke-width="2" stroke-linecap="round"/><line x1="58" y1="88" x2="59" y2="104" stroke="#f2f2f2" stroke-width="2" stroke-linecap="round"/><rect x="38" y="118" width="24" height="10" rx="3" fill="none" stroke="#b81e28" stroke-width="2"/></g>`
    : '';
  // Sensei SOL (LT 2026-10-28): silvery grey robe — dark lapels,
  // dark inner V, belt, knee-high skirt with center placket, dense
  // small gold Solana marks (3 slanted bars) all over chest + skirt.
  const senseiShirt = look.parody === 'senseisol'
    ? `<g><polygon points="36,88 50,98 44,130 32,130" fill="#2a2a30"/><polygon points="64,88 50,98 56,130 68,130" fill="#2a2a30"/><polygon points="44,88 56,88 50,108" fill="#2a2a30"/><rect x="30" y="118" width="40" height="5" fill="#7d838c"/><polygon points="34,124 66,124 68,148 32,148" fill="#9aa0a8" stroke="#0003" stroke-width="1.5"/><polygon points="46,124 54,124 58,148 42,148" fill="#2a2a30"/><g fill="#d4af37"><path d="M0 0 L6 0 L4 2 L-2 2 Z M0 3 L6 3 L4 5 L-2 5 Z M0 6 L6 6 L4 8 L-2 8 Z" transform="translate(36,102) skewX(-20)"/><path d="M0 0 L6 0 L4 2 L-2 2 Z M0 3 L6 3 L4 5 L-2 5 Z M0 6 L6 6 L4 8 L-2 8 Z" transform="translate(60,96) skewX(-20)"/><path d="M0 0 L6 0 L4 2 L-2 2 Z M0 3 L6 3 L4 5 L-2 5 Z M0 6 L6 6 L4 8 L-2 8 Z" transform="translate(44,112) skewX(-20)"/><path d="M0 0 L6 0 L4 2 L-2 2 Z M0 3 L6 3 L4 5 L-2 5 Z M0 6 L6 6 L4 8 L-2 8 Z" transform="translate(38,132) skewX(-20)"/><path d="M0 0 L6 0 L4 2 L-2 2 Z M0 3 L6 3 L4 5 L-2 5 Z M0 6 L6 6 L4 8 L-2 8 Z" transform="translate(60,136) skewX(-20)"/><path d="M0 0 L6 0 L4 2 L-2 2 Z M0 3 L6 3 L4 5 L-2 5 Z M0 6 L6 6 L4 8 L-2 8 Z" transform="translate(38,141) skewX(-20)"/><path d="M0 0 L6 0 L4 2 L-2 2 Z M0 3 L6 3 L4 5 L-2 5 Z M0 6 L6 6 L4 8 L-2 8 Z" transform="translate(60,143) skewX(-20)"/></g></g>`
    : '';

  // Super Trump (LT 2026-10-28): blue suit — red cape panels at the
  // sides, red shield + gold S swoosh on the chest, gold belt, red
  // trunks over blue legs, red aura rings, flame glow on the
  // slapping hand (viewer's right, same rotated group as the arm).
  const supertrumpShirt = look.parody === 'supertrump'
    ? `<g><ellipse cx="50" cy="95" rx="46" ry="78" fill="none" stroke="#ff2a1a" stroke-width="2.5" opacity="0.12"/><ellipse cx="50" cy="95" rx="41" ry="72" fill="none" stroke="#ff2a1a" stroke-width="2.5" opacity="0.22"/><polygon points="25,88 31,88 29,152 15,150" fill="#e03131" stroke="#0003" stroke-width="1.5"/><polygon points="69,88 75,88 85,150 71,152" fill="#e03131" stroke="#0003" stroke-width="1.5"/><path d="M36 90 L64 90 L64 106 Q64 120 50 128 Q36 120 36 106 Z" fill="#e11d2e" stroke="#0003" stroke-width="1.5"/><path d="M58 97 C48 97 44 101 46 106 C48 111 58 109 57 115 C56 120 46 119 43 116" fill="none" stroke="#ffd23f" stroke-width="3.5" stroke-linecap="round"/><rect x="36" y="122" width="28" height="5" fill="#e8c547" stroke="#0003" stroke-width="1"/><rect x="47" y="121" width="6" height="7" rx="1.5" fill="#ffe27a" stroke="#0003" stroke-width="1"/><rect x="36" y="132" width="28" height="10" fill="#e03131" stroke="#0003" stroke-width="1"/><g transform="rotate(-8 70 92)"><circle cx="70.5" cy="134" r="11" fill="#ff2a1a" opacity="0.35"/><circle cx="70.5" cy="134" r="6.5" fill="#ff3b1f"/><path d="M66 128 Q68 120 70.5 126 Q72 119 74 127 Q76 122 75 130" fill="none" stroke="#ff6a1a" stroke-width="2" stroke-linecap="round"/></g></g>`
    : '';

  // Elon Mars (LT 2026-10-28): white space suit — backpack edges
  // peeking at the sides, jetpack tank tops + nozzle tips, white suit
  // collar, chest panel with the rocket emblem, dark shoulder straps,
  // white-black glove with blue glow on the slapping hand.
  const elonmarsShirt = look.parody === 'elonmars'
    ? `<g><rect x="20" y="92" width="6" height="30" rx="2" fill="#d8d8e0" stroke="#0003" stroke-width="1.5"/><rect x="74" y="92" width="6" height="30" rx="2" fill="#d8d8e0" stroke="#0003" stroke-width="1.5"/><rect x="36" y="78" width="28" height="8" rx="3" fill="#e8e8f0" stroke="#0003" stroke-width="1.5"/><line x1="36" y1="88" x2="38" y2="128" stroke="#3a3a44" stroke-width="3" stroke-linecap="round"/><line x1="64" y1="88" x2="62" y2="128" stroke="#3a3a44" stroke-width="3" stroke-linecap="round"/><rect x="38" y="94" width="24" height="18" rx="3" fill="#d8d8e0" stroke="#0003" stroke-width="1.5"/><g><rect x="47" y="97" width="6" height="12" rx="3" fill="#ffffff" stroke="#0003" stroke-width="1"/><path d="M47 97 L53 97 L50 91 Z" fill="#e03131"/><circle cx="50" cy="102" r="1.8" fill="#22d3ee"/><path d="M44 107 L47 105 L47 110 Z" fill="#e03131"/><path d="M56 107 L53 105 L53 110 Z" fill="#e03131"/><path d="M47 109 L53 109 L50 114 Z" fill="#ff6a1a"/></g><rect x="24" y="80" width="10" height="12" rx="3" fill="#d8d8e0" stroke="#0003" stroke-width="1.5"/><rect x="66" y="80" width="10" height="12" rx="3" fill="#d8d8e0" stroke="#0003" stroke-width="1.5"/><rect x="22" y="122" width="4" height="8" fill="#3a3a44"/><rect x="76" y="122" width="4" height="8" fill="#3a3a44"/><g transform="rotate(-8 70 92)"><circle cx="70.5" cy="134" r="11" fill="#2a7bff" opacity="0.35"/><circle cx="70.5" cy="134" r="6.5" fill="#f2f2f2"/><path d="M65 131 Q70.5 127 76 131" fill="none" stroke="#1a1a22" stroke-width="2.5" stroke-linecap="round"/><rect x="65.5" y="125" width="10" height="6" fill="#1a1a22"/></g></g>`
    : '';
  return `<svg viewBox="0 0 100 170" xmlns="http://www.w3.org/2000/svg" class="avatar-body-svg">
    <g transform="rotate(8 30 92)"><rect x="24" y="90" width="11" height="26" rx="5" fill="${shirt}"/><rect x="24.5" y="112" width="10" height="18" rx="5" fill="${s}"/><circle cx="29.5" cy="134" r="6" fill="${s}"/></g>
    <g transform="rotate(-8 70 92)"><rect x="65" y="90" width="11" height="26" rx="5" fill="${shirt}"/><rect x="65.5" y="112" width="10" height="18" rx="5" fill="${s}"/><circle cx="70.5" cy="134" r="6" fill="${s}"/></g>
    <rect x="36" y="132" width="12" height="28" rx="4" fill="${pants}"/>
    <rect x="52" y="132" width="12" height="28" rx="4" fill="${pants}"/>
    <ellipse cx="42" cy="162" rx="9" ry="5" fill="${shoe}"/>
    <ellipse cx="58" cy="162" rx="9" ry="5" fill="${shoe}"/>
    <rect x="44" y="76" width="12" height="12" fill="${s}"/>
    ${minhSword}
    <rect x="${tx0}" y="86" width="${tw}" height="44" rx="10" fill="${shirt}" stroke="#0003" stroke-width="2"/>
    <rect x="${tx0}" y="128" width="${tw}" height="7" fill="#1a1a22"/>
    ${printImg}
    ${aloneShirt}
    ${poorgoatShirt}
    ${minhShirt}
    ${choosepoorShirt}
    ${growlingShirt}
    ${kookedShirt}
    ${senseiShirt}
    ${supertrumpShirt}
    ${elonmarsShirt}
    <g>${head}</g>
  </svg>`;
};
