/* =========================================================================
 * Procedural SVG portraits (used in HUD + KOL cards). Same `look` object as
 * the 3D model so colours always match.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.avatarSVG = function (look, opts) {
  opts = opts || {};
  const bg = opts.bg || look.shirt;
  const s = look.skin, h = look.hair, a = look.accent || '#111';
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

  // V3: horns accessory (for Ansom Bull parody)
  let horns = '';
  if (look.accessory === 'horns' || look.parody === 'ansom') {
    horns = `<g>
      <path d="M28 28 Q18 10 26 2 Q30 12 36 22 Z" fill="#39ff88" opacity="0.9"/>
      <path d="M72 28 Q82 10 74 2 Q70 12 64 22 Z" fill="#39ff88" opacity="0.9"/>
    </g>`;
  }

  // Animal species overlays (drawn right after the head circle, under hair/eyes).
  let speciesFx = '';
  const sp = look.species || 'human';
  if (sp === 'bear') {
    speciesFx = `<g><circle cx="28" cy="24" r="9" fill="${s}" stroke="#0003" stroke-width="2"/><circle cx="72" cy="24" r="9" fill="${s}" stroke="#0003" stroke-width="2"/><circle cx="28" cy="24" r="4" fill="#e8b98a"/><circle cx="72" cy="24" r="4" fill="#e8b98a"/><ellipse cx="50" cy="63" rx="10" ry="7" fill="#f0d0a8"/></g>`;
  } else if (sp === 'bull' && look.parody !== 'patty' && look.parody !== 'ansom') {
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
    <path d="M${sw[0]} 100 Q50 72 ${sw[1]} 100 Z" fill="${look.shirt}" stroke="#0003" stroke-width="2"/>
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
    ${opts.blush ? '<ellipse cx="68" cy="62" rx="9" ry="6" fill="#ff2d2d" opacity="0.55"/>' : ''}
    ${dmgFx}
    ${acc}
  </svg>`;
};
