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
        const draw = () => {
          try {
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            c.getContext('2d').drawImage(img, 0, 0, W, H);
            URL.revokeObjectURL(url);
            c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
          } catch (e) { reject(e); }
        };
        // An embedded @font-face inside an SVG image needs a beat to load
        // before rasterizing, or the text falls back to the system font.
        if (svg.includes('@font-face')) setTimeout(draw, 350);
        else draw();
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

  // Inner content of a full-body avatarSVG so we can nest it at an arbitrary position/size.
  function bodyInner(look) {
    const svg = SAK.avatarBodySVG(look);
    return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  }

  // Greedy word wrap for card text (SVG text does not wrap itself).
  function wrapLines(text, maxChars, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (t.length > maxChars && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] += '…';
      return kept;
    }
    return lines;
  }

  // Centered rows of rounded trait pills inside a column of maxW.
  function traitPills(traits, cx, y0, maxW) {
    const fs = 24, padX = 18, gap = 12, ph = 44, rowGap = 12;
    const wOf = t => Math.ceil(t.length * fs * 0.62) + padX * 2;
    const rows = [];
    let row = [], rowW = 0;
    for (const t of traits) {
      const w = wOf(t);
      const need = row.length ? gap + w : w;
      if (row.length && rowW + need > maxW) { rows.push([row, rowW]); row = []; rowW = 0; }
      row.push([t, w]); rowW += row.length > 1 ? need : w;
    }
    if (row.length) rows.push([row, rowW]);
    let out = '';
    rows.slice(0, 2).forEach(([r, rw], ri) => {
      let x = cx - rw / 2;
      const y = y0 + ri * (ph + rowGap);
      for (const [t, w] of r) {
        out += `<rect x="${x}" y="${y}" width="${w}" height="${ph}" rx="22" fill="#00000055" stroke="#39ff88" stroke-width="1.5"/>`;
        out += `<text x="${x + w / 2}" y="${y + 30}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#39ff88">${esc(t)}</text>`;
        x += w + gap;
      }
    });
    return { svg: out, height: Math.min(rows.length, 2) * ph + (Math.min(rows.length, 2) - 1) * rowGap };
  }

  // ---- Fighter card (1080×1080): NFT-style collectible ----
  // Whole fighter body on the left, info on the right, chunky cartoon
  // type (Lilita One, embedded so the rasterized PNG keeps it) and the
  // Smack-a-KOL wordmark + white-hand collection badge.
  function buildFighterCard(o) {
    const look = o.look || {};
    const body = bodyInner(look);
    const name = (o.name || 'DEGEN').toUpperCase();
    const tagline = o.tagline || o.phrase || 'READY TO SLAP';
    const traits = [];
    if (look.species && look.species !== 'human') traits.push(look.species.toUpperCase());
    if (look.outfit && look.outfit !== 'none') traits.push(look.outfit.toUpperCase());
    if (look.facialHair && look.facialHair !== 'none') traits.push(look.facialHair.toUpperCase());
    if (look.necklace && look.necklace !== 'none') traits.push(look.necklace.toUpperCase());
    if (look.glasses && look.glasses !== 'none') traits.push(look.glasses.toUpperCase());
    if (look.tattoo && look.tattoo !== 'none') traits.push(look.tattoo.toUpperCase() + ' INK');
    if (look.hairStyle && look.hairStyle !== 'bald' && look.hairStyle !== 'short') traits.push(look.hairStyle.toUpperCase() + ' HAIR');
    const record = `${o.wins || 0}W — ${o.losses || 0}L`;
    const locked = o.lockedTx ? '🔒 LOCKED · 0.05 SOL' : '🆓 STARTER FIGHTER';
    const assets = (typeof SAK !== 'undefined' && SAK.CARD_ASSETS) || {};
    const fontFace = assets.font
      ? `<style>@font-face { font-family: 'Lilita One'; src: url(${assets.font}) format('woff2'); } text { font-family: 'Lilita One', 'Arial Black', system-ui, sans-serif; }</style>`
      : '';
    const handBadge = assets.hand
      ? `<defs><clipPath id="handClip"><circle cx="108" cy="218" r="40"/></clipPath></defs>
  <circle cx="108" cy="218" r="42" fill="#1a0b2e" stroke="#ffd23f" stroke-width="4"/>
  <image href="${assets.hand}" x="74" y="194" width="68" height="48" clip-path="url(#handClip)" preserveAspectRatio="xMidYMid meet"/>`
      : '';
    const CX = 790, COL_W = 430;
    // Only compress long names to the column; never stretch short ones
    // (Lilita One is already wide — forcing a short name to full width
    // pulls its letters apart).
    const estNameW = name.length * 64 * 0.58;
    const nameFit = estNameW > COL_W ? ` textLength="${COL_W}" lengthAdjust="spacingAndGlyphs"` : '';
    let y = 400;
    let right = `<text x="${CX}" y="${y}" text-anchor="middle" font-size="64" font-weight="400" fill="#ffffff" paint-order="stroke" stroke="#1a0b2e" stroke-width="10" stroke-linejoin="round"${nameFit}>${esc(name)}</text>`;
    y += 52;
    if (o.xHandle) {
      right += `<text x="${CX}" y="${y}" text-anchor="middle" font-size="28" font-weight="700" fill="#1d9bf0">@${esc(o.xHandle.replace(/^@/, ''))}</text>`;
      y += 44;
    }
    const tagLines = wrapLines(tagline, 26, 2);
    y += 46;
    tagLines.forEach((ln, i) => {
      right += `<text x="${CX}" y="${y + i * 38}" text-anchor="middle" font-size="30" font-weight="400" fill="#ffffff" opacity="0.9">${esc(ln)}</text>`;
    });
    y += tagLines.length * 38 + 34;
    const pills = traitPills(traits.slice(0, 4), CX, y, COL_W);
    right += pills.svg;
    y += pills.height + 70;
    right += `<text x="${CX}" y="${y}" text-anchor="middle" font-size="36" font-weight="400" fill="#ffffff">RECORD  ${esc(record)}</text>`;
    y += 58;
    right += `<text x="${CX}" y="${y}" text-anchor="middle" font-size="30" font-weight="400" fill="#ffd23f">${esc(locked)}</text>`;

    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, -apple-system, sans-serif">
  ${fontFace}
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
  <rect x="14" y="14" width="1052" height="1052" rx="44" fill="none" stroke="#ffd23f" stroke-width="8"/>
  <rect x="30" y="30" width="1020" height="1020" rx="32" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
  <text x="540" y="104" text-anchor="middle" font-size="72" font-weight="400" fill="#ffd23f" letter-spacing="6" paint-order="stroke" stroke="#12031f" stroke-width="8" stroke-linejoin="round">SMACK-A-KOL</text>
  <rect x="905" y="52" width="125" height="44" rx="22" fill="#ffd23f"/>
  <text x="967" y="82" text-anchor="middle" font-size="24" font-weight="700" fill="#1a0b2e">1 OF 1</text>
  <text x="540" y="152" text-anchor="middle" font-size="30" font-weight="700" fill="#ffffff" opacity="0.65" letter-spacing="6">MY FIGHTER</text>
  <rect x="60" y="190" width="460" height="720" rx="36" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
  <svg x="90" y="210" width="400" height="680" viewBox="0 0 100 170">${body}</svg>
  ${handBadge}
  ${right}
  <text x="540" y="1000" text-anchor="middle" font-size="26" font-weight="700" fill="#ffffff" opacity="0.5" letter-spacing="3">🥊 PLAY AT SMACKAKOL.COM</text>
</svg>`;
  }

  return { build, buildFighterCard, share, shareToX };
})();
