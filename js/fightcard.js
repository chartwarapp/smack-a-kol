/* =========================================================================
 * SAK.FightCard — shareable post-fight cards (1080×1080).
 * Win card: your (battle-damaged) face. Loss card: your WRECKED face,
 * bloodied + bandaged, front and center. Built as a single SVG so it
 * stays crisp, then rasterized to PNG for the native share sheet.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.FightCard = (() => {
  const W = 1080, H = 1080;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Inner content of an avatarSVG so we can nest it at an arbitrary position/size.
  function avatarInner(look, opts) {
    const svg = SAK.avatarSVG(look, opts || {});
    return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  }

  function build(o) {
    const win = !!o.win;
    const accent = win ? '#39ff88' : '#ff3b5c';
    const result = win ? 'VICTORY' : 'DEFEAT';
    // Hero face: winner as they finished (damage kept), loser fully wrecked.
    const heroOpts = win ? { dmg: o.playerDmg || 0 } : { ko: true, wrecked: true };
    const hero = avatarInner(o.playerLook, heroOpts);
    const tagline = win
      ? `${esc(o.kolName).toUpperCase()} SENT TO ZERO`
      : 'GOT ABSOLUTELY REKT';
    const score = `${o.scoreP} — ${o.scoreK}`;

    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, -apple-system, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a0a4a"/><stop offset="1" stop-color="#0e0218"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.55" r="0.55">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.28"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="540" y="104" text-anchor="middle" font-size="68" font-weight="900" fill="#ffd23f" letter-spacing="10">SMACK-A-KOL</text>
  <text x="540" y="152" text-anchor="middle" font-size="30" font-weight="700" fill="#ffffff" opacity="0.65" letter-spacing="4">${esc(o.modeLabel || 'CLASSIC KO')} · BEST OF ${o.bestOf || 3}</text>
  <text x="540" y="300" text-anchor="middle" font-size="128" font-weight="900" fill="${accent}" letter-spacing="6">${result}</text>
  <text x="540" y="360" text-anchor="middle" font-size="46" font-weight="800" fill="#ffffff">${esc(o.playerName).toUpperCase()}  ${score}  ${esc(o.kolName).toUpperCase()}</text>
  <svg x="330" y="420" width="420" height="420" viewBox="0 0 100 100">${hero}</svg>
  <text x="540" y="908" text-anchor="middle" font-size="52" font-weight="900" fill="#ffffff">${esc(o.playerName).toUpperCase()}</text>
  ${o.xHandle ? `<text x="540" y="936" text-anchor="middle" font-size="28" font-weight="700" fill="#1d9bf0">@${esc(o.xHandle.replace(/^@/, ''))}</text>` : ''}
  <text x="540" y="956" text-anchor="middle" font-size="30" font-weight="700" fill="#ffffff" opacity="0.7" letter-spacing="3">${tagline}</text>
  <text x="540" y="1010" text-anchor="middle" font-size="30" font-weight="700" fill="#ffd23f">BIGGEST HIT ${o.biggestHit || 0}   ·   +${o.pts || 0} PTS</text>
  ${o.winSol ? `<text x="540" y="1052" text-anchor="middle" font-size="44" font-weight="900" fill="#14f195">+${(+o.winSol).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} SOL</text>` : (o.wagerSol ? `<text x="540" y="1052" text-anchor="middle" font-size="30" font-weight="700" fill="#ffffff" opacity="0.6">WAGER ${(+o.wagerSol).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} SOL</text>` : '')}
</svg>`;
  }

  function svgToPng(svg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          c.getContext('2d').drawImage(img, 0, 0, W, H);
          URL.revokeObjectURL(url);
          c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function share(svg, text) {
    const blob = await svgToPng(svg);
    const file = new File([blob], 'smack-a-kol-fight-card.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Smack-a-KOL Fight Card', text });
      return 'shared';
    }
    // Fallback: download the card image.
    downloadBlob(blob);
    return 'downloaded';
  }

  function downloadBlob(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smack-a-kol-fight-card.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Post to X: downloads the card PNG, then opens X with pre-filled text.
  // X intents can't attach images, so the user attaches the downloaded file.
  async function shareToX(svg, text) {
    const blob = await svgToPng(svg);
    downloadBlob(blob);
    const tweet = `${text}\n\n🥊 Play: https://smackakol.com`;
    const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(tweet);
    // iOS-safe: anchor click navigates reliably where window.open stalls.
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    // Fallback: if the tab didn't open (popup blocked), navigate directly.
    setTimeout(() => {
      try {
        const probe = window.open('', '_blank');
        if (probe) { probe.close(); }
        else { window.location.href = url; }
      } catch (e) { window.location.href = url; }
    }, 800);
    return 'x-opened';
  }

  // ---- Fighter card (1080×1080): portrait, name, tagline, traits, record ----
  function buildFighterCard(o) {
    const look = o.look || {};
    const hero = avatarInner(look, {});
    const name = (o.name || 'DEGEN').toUpperCase();
    const tagline = o.tagline || o.phrase || 'READY TO SLAP';
    // Key traits line
    const traits = [];
    if (look.species && look.species !== 'human') traits.push(look.species.toUpperCase());
    if (look.outfit && look.outfit !== 'none') traits.push(look.outfit.toUpperCase());
    if (look.facialHair && look.facialHair !== 'none') traits.push(look.facialHair.toUpperCase());
    if (look.necklace && look.necklace !== 'none') traits.push(look.necklace.toUpperCase());
    if (look.glasses && look.glasses !== 'none') traits.push(look.glasses.toUpperCase());
    if (look.tattoo && look.tattoo !== 'none') traits.push(look.tattoo.toUpperCase() + ' INK');
    if (look.hairStyle && look.hairStyle !== 'bald' && look.hairStyle !== 'short') traits.push(look.hairStyle.toUpperCase() + ' HAIR');
    const traitLine = traits.slice(0, 4).join(' · ') || 'CLASSIC DEGEN';
    const record = `${o.wins || 0}W — ${o.losses || 0}L`;
    const locked = o.lockedTx ? '🔒 LOCKED · 0.05 SOL' : '🆓 STARTER FIGHTER';

    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, -apple-system, sans-serif">
  <defs>
    <linearGradient id="fbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a0b2e"/><stop offset="1" stop-color="#0e0218"/>
    </linearGradient>
    <radialGradient id="fglow" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0" stop-color="#ffd23f" stop-opacity="0.25"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fbg)"/>
  <rect width="${W}" height="${H}" fill="url(#fglow)"/>
  <text x="540" y="100" text-anchor="middle" font-size="64" font-weight="900" fill="#ffd23f" letter-spacing="10">SMACK-A-KOL</text>
  <text x="540" y="148" text-anchor="middle" font-size="30" font-weight="700" fill="#ffffff" opacity="0.65" letter-spacing="6">MY FIGHTER</text>
  <svg x="340" y="190" width="400" height="400" viewBox="0 0 100 100">${hero}</svg>
  <text x="540" y="660" text-anchor="middle" font-size="84" font-weight="900" fill="#ffffff" letter-spacing="4">${esc(name)}</text>
  ${o.xHandle ? `<text x="540" y="700" text-anchor="middle" font-size="30" font-weight="700" fill="#1d9bf0">@${esc(o.xHandle.replace(/^@/, ''))}</text>` : ''}
  <text x="540" y="748" text-anchor="middle" font-size="34" font-weight="700" fill="#ffffff" opacity="0.85">${esc(tagline)}</text>
  <text x="540" y="812" text-anchor="middle" font-size="28" font-weight="700" fill="#39ff88" letter-spacing="2">${esc(traitLine)}</text>
  <text x="540" y="872" text-anchor="middle" font-size="36" font-weight="900" fill="#ffffff">RECORD  ${esc(record)}</text>
  <text x="540" y="928" text-anchor="middle" font-size="30" font-weight="800" fill="#ffd23f">${esc(locked)}</text>
  <text x="540" y="1000" text-anchor="middle" font-size="26" font-weight="700" fill="#ffffff" opacity="0.5" letter-spacing="3">🥊 PLAY AT SMACKAKOL.COM</text>
</svg>`;
  }

  return { build, buildFighterCard, share, shareToX };
})();
