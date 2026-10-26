/* =========================================================================
 * Smack-a-KOL — game controller (screens, fight state machine, economy UI).
 * -------------------------------------------------------------------------
 * Economy (points only for now): matches are FREE and pay PTS; optionally
 * bet PTS for a bigger payout; stake PTS in the Vault for yield + boost.
 * Upgrades / Golden Fist cost PTS. Wallet connect is a mock Solana
 * placeholder. Roster = built-in parody KOLs + user-submitted KOLs.
 *
 * Fight loop (private per-device meter):
 *   Each ROUND: local player sees ONLY their meter (ATTACK or BRACE), jerky
 *   on both roles. Opponent locks privately (AI / other phone — never shown).
 *   Closer to the green centre wins. Tie → attacker edge.
 *   Classic = best of 5. Then KO fly-off → result.
 * ========================================================================= */
(function () {
  'use strict';
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const wait = s => new Promise(r => setTimeout(r, s * 1000));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const ptsHTML = cls => `<span class="pts ${cls || 'sm'}">★</span>`;
  const esc = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };  // local day
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const S = SAK.Storage.load();      // persistent save
  const W = SAK.Wallet, A = SAK.Audio, P = SAK.Points, V = SAK.Vault;
  let Scene = null;                  // SAK.Scene3D once WebGL is up
  let MeterLocal = null;                 // private per-device meter (local player only)
  let RevealDial = null;                 // inline post-lock dual-needle dial
  let aiLockTimer = 0, roundTimer = 0;
  let revealDismiss = null;              // finish() for tap-to-continue on inline reveal
  let fightToken = 0;                    // guards intro timers across rematches

  /* ----------------------------------------------------------- derived stats */
  const playerMaxHp = () => SAK.PLAYER.baseHp + S.upgrades.health * SAK.PLAYER.hpPerLevel;
  const playerPower = () => SAK.PLAYER.basePower + S.upgrades.power * SAK.PLAYER.powerPerLevel;
  const upgradeCost = type => {
    const u = SAK.UPGRADES[type];
    return Math.round(u.baseCost * Math.pow(u.growth, S.upgrades[type]) / 10) * 10;
  };
  /* --- gloves shop (PTS upgrade ladder) -------------------------------- */
  const gloveTier = id => SAK.GLOVE_TIERS.find(t => t.id === id) || SAK.GLOVE_TIERS[0];
  const gloveLabel = id => { const t = (SAK.Traits.LAYERS.gloves || []).find(g => g.id === id); return t ? t.label : id; };
  const gloveState = () => { if (!S.gloves) S.gloves = { owned: ['wrap'], equipped: 'wrap' }; return S.gloves; };
  const snapshotGlove = () => { const g = gloveState(); const t = gloveTier(g.equipped); return { id: t.id, bonus: t.bonus, label: gloveLabel(t.id) }; };
  const meterSpeed = kol => SAK.METER.baseSpeed + (kol.difficulty - 1) * SAK.METER.speedPerDifficulty;
  const boosted = n => Math.round(n * (1 + V.boost));

  /* ------------------------------------------------------- player fighter */
  const DEFAULT_PHRASE = 'gm. prepare to get slapped.';
  const DEFAULT_PROFILE = { v: SAK.Account.VERSION, id: 'guest', name: 'YOU', createdAt: 0, phrase: DEFAULT_PHRASE, avatar: SAK.Account.defaultAvatar() };
  // migrate a pre-account save ({ name, colour, phrase }) into the v2 profile
  if (SAK.Account.migrate(S, (n, c) => lookFromName(n, c))) SAK.Storage.save();
  const profile = () => S.profile || DEFAULT_PROFILE;
  const playerPhrase = () => profile().phrase || DEFAULT_PHRASE;
  const playerAvatar = () => profile().avatar;
  /** Player's SVG/3D look, derived from the saved account avatar params. */
  const playerLook = () => { const L = SAK.Account.toLook(playerAvatar()); L.gloves = (S.gloves && S.gloves.equipped) || 'wrap'; return L; };

  /* ------------------------------------------------------------ roster (UGC) */
  /** Turn a saved user submission into a full KOL object. */
  function hydrateCustom(c) {
    return Object.assign({
      id: c.id, name: c.name, handle: '@' + c.name.replace(/[^a-z0-9]/gi, '') + '_fanmade', level: 'FAN',
      tagline: c.phrase, custom: true,
      look: { skin: c.skin, shirt: c.shirt, hair: c.hair, pants: '#2a2a40', accessory: c.accessory, accent: c.accessory === 'laser' ? '#ff1a1a' : '#ffd23f' },
      taunts: [c.phrase, 'Fan-made and fully unhinged.', 'Community-submitted slap incoming!']
    }, SAK.customKolStats(Math.max(1, Math.min(5, c.difficulty || 2))));
  }
  const roster = () => SAK.KOLS.concat(S.customKols.map(hydrateCustom));
  const ugcSlotsUnlocked = () => SAK.UGC.slotMilestones.filter(m => S.stats.lifetimePts >= m).length;
  const ugcNextMilestone = () => SAK.UGC.slotMilestones.find(m => S.stats.lifetimePts < m);

  /* ------------------------------------------- rewards program: daily login */
  function checkDailyLogin() {
    const today = new Date().toISOString().slice(0, 10);
    if (S.lastLoginDate === today) return; // already claimed today
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    S.loginStreak = (S.lastLoginDate === yesterday) ? (S.loginStreak || 0) + 1 : 1;
    S.lastLoginDate = today;
    const day = Math.min(S.loginStreak, 7);
    const bonus = day >= 7 ? 500 : 50 * day;
    P.add(bonus, true);
    SAK.Storage.save();
    setTimeout(() => toast(`🎁 Day ${S.loginStreak} login bonus: +${fmt(bonus)} PTS`, 2800), 1400);
  }

  /* ---------------------------------------------- rewards program: referrals */
  function ensureReferralCode() {
    if (!S.referralCode) {
      S.referralCode = 'SAK-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      SAK.Storage.save();
    }
  }
  function checkIncomingReferral() {
    ensureReferralCode();
    try {
      const ref = new URLSearchParams(location.search).get('ref');
      if (ref && ref !== S.referralCode && !S.referredBy) {
        S.referredBy = ref;
        SAK.Storage.save();
        console.log('[SAK] referred by', ref);
        setTimeout(() => toast('🎁 You joined via a referral link! Win your first match for +250 PTS', 3000), 2200);
      }
    } catch (e) {}
  }
  function myReferralLink() {
    ensureReferralCode();
    const code = (W.isConnected && W.address) ? W.address : S.referralCode;
    return 'https://smackakol.com/?ref=' + encodeURIComponent(code);
  }
  // Referee reward on first win; referrer credit is best-effort via backend.
  function checkReferralReward(win) {
    if (!win || S.referralRewardClaimed || !S.referredBy) return;
    if (S.stats.wins !== 1) return; // first match win only
    S.referralRewardClaimed = true;
    P.add(250, true);
    SAK.Storage.save();
    setTimeout(() => toast('🎁 Referral bonus: +250 PTS! Your referrer earns 250 PTS too', 3000), 3600);
    // Best-effort: record the referral event for the referrer via Supabase.
    try {
      if (SAK.Api && SAK.Api.recordReferral && W.address) {
        SAK.Api.recordReferral({ referee_wallet: W.address, referrer_code: S.referredBy }).catch(() => {});
      }
    } catch (e) {}
  }

  /* -------------------------------------------- rewards program: achievements */
  const ACHIEVEMENTS = {
    first_win: { name: 'First Blood',  pts: 100 },
    first_ko:  { name: 'KO Artist',   pts: 150 },
    win_10:    { name: 'Rising Star',  pts: 200 },
    win_50:    { name: 'Contender',    pts: 500 },
    win_100:   { name: 'Champion',     pts: 1000 },
    streak_5:  { name: 'On Fire',      pts: 150 },
    streak_10: { name: 'Unstoppable',  pts: 300 },
    pts_10000: { name: 'High Roller',  pts: 500 },
  };
  function checkAchievements(win, wasKo) {
    const newly = [];
    const unlock = (id) => {
      if (S.achievements[id]) return;
      const a = ACHIEVEMENTS[id];
      if (!a) return;
      S.achievements[id] = Date.now();
      P.add(a.pts, true);
      newly.push(a);
    };
    if (win) {
      if (S.stats.wins >= 1) unlock('first_win');
      if (wasKo) unlock('first_ko');
      if (S.stats.wins >= 10) unlock('win_10');
      if (S.stats.wins >= 50) unlock('win_50');
      if (S.stats.wins >= 100) unlock('win_100');
      if (S.stats.streak >= 5) unlock('streak_5');
      if (S.stats.streak >= 10) unlock('streak_10');
    }
    if ((S.stats.lifetimePts || 0) >= 10000) unlock('pts_10000');
    SAK.Storage.save();
    newly.forEach((a, i) => setTimeout(() => toast(`🏆 Achievement: ${a.name} +${fmt(a.pts)} PTS`, 2600), 900 + i * 1400));
  }

  /* -------------------------------------------------------------- UI helpers */
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 1800);
  }
  function floatText(x, y, html, cls) {
    const el = document.createElement('div');
    el.className = 'float-text ' + (cls || '');
    el.innerHTML = html; el.style.left = x + 'px'; el.style.top = y + 'px';
    $('#fx-layer').appendChild(el);
    setTimeout(() => el.remove(), 1050);
  }
  function flash(color) {
    const el = document.createElement('div');
    el.className = 'flash'; el.style.background = color;
    $('#fx-layer').appendChild(el); setTimeout(() => el.remove(), 300);
  }
  async function banner(text, color, ms) {
    const b = $('#banner'); b.textContent = text; b.style.color = color || '';
    b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    await wait((ms || 1000) / 1000); b.classList.add('hidden');
  }
  /* 🥊 Ring cards: VS names card, then ROUND N card (same look all rounds) */
  async function vsCardIntro(pName, kName) {
    if (typeof A !== 'undefined' && A.realCheer) A.realCheer(); // real crowd recording only
    const card = $('#round-card');
    const rcLabel = card.querySelector('.rc-label');
    const rcNumber = $('#rc-number');
    rcLabel.textContent = '';
    rcLabel.style.cssText = '';
    rcNumber.innerHTML = `<div style="font-size:28px;line-height:1.3;font-weight:900;color:#fff;text-shadow:0 0 20px var(--yellow)">${pName}</div><div style="font-size:16px;color:var(--yellow);margin:4px 0">vs</div><div style="font-size:28px;line-height:1.3;font-weight:900;color:#fff;text-shadow:0 0 20px var(--yellow)">${kName}</div>`;
    card.classList.remove('hidden');
    const inner = card.querySelector('.rc-inner');
    inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = '';
    await wait(2.6); // LT 2026-10-14: linger a touch longer so the names read
    card.classList.add('hidden');
  }
  async function roundCardIntro(roundNum) {
    const card = $('#round-card');
    const rcLabel = card.querySelector('.rc-label');
    const rcNumber = $('#rc-number');
    rcLabel.textContent = 'ROUND';
    rcLabel.style.cssText = '';
    rcNumber.textContent = roundNum;
    rcNumber.innerHTML = roundNum;
    card.classList.remove('hidden');
    const inner = card.querySelector('.rc-inner');
    inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = '';
    await wait(1.6);
    card.classList.add('hidden');
  }
  /* Slap haptics mirror scene3d reactTier (light/medium/heavy/perfect).
   * Golden Fist (fire) bumps weak→medium and good→heavy; perfect stays max.
   * Vibration API: Android Chrome yes; iPhone Safari no. */
  const HAPTIC_SLAP = {
    light: 15,
    medium: 35,
    heavy: [50, 30, 40],
    perfect: [80, 40, 80, 40, 120]
  };
  function haptic(ms) {
    if (!S.settings.haptics || !navigator.vibrate) return;
    try { navigator.vibrate(ms); } catch (e) { /* unsupported / blocked */ }
  }
  /** Map grade (+ fire / distance) → slap vibration pattern. */
  function hapticSlap(grade, fire, dist) {
    let tier = null;
    if (!grade || grade === 'miss') return;
    if (grade === 'perfect') tier = 'perfect';
    else if (grade === 'weak') tier = fire ? 'medium' : 'light';
    else if (grade === 'good') {
      if (fire) tier = 'heavy';
      else if (dist != null && dist < 20) tier = 'heavy';
      else tier = 'medium';
    } else tier = 'medium';
    const pat = HAPTIC_SLAP[tier];
    if (pat != null) haptic(pat);
  }
  const appRect = () => $('#app').getBoundingClientRect();

  // Animated PTS counter
  let shownPts = S.points, ptsRaf = 0;
  function renderPoints() {
    const target = S.points, start = shownPts, t0 = performance.now();
    cancelAnimationFrame(ptsRaf);
    if (target !== start) { const p = $('#pts-pill'); p.classList.add('bump'); setTimeout(() => p.classList.remove('bump'), 160); }
    const step = now => {
      const k = Math.min(1, (now - t0) / 600);
      shownPts = start + (target - start) * (1 - Math.pow(1 - k, 3));
      $('#points').textContent = fmt(shownPts);
      if (k < 1) ptsRaf = requestAnimationFrame(step);
    };
    ptsRaf = requestAnimationFrame(step);
  }

  let solBalance = null;
  let solBalanceTimer = null;

  async function refreshSolBalance() {
    if (!W.isConnected || !W.address || !SAK.SolanaEscrow || !SAK.SolanaEscrow.getSolBalance) {
      solBalance = null;
      return;
    }
    try {
      solBalance = await SAK.SolanaEscrow.getSolBalance(W.address);
      // Update the button sub-line if we're on the menu
      const btn = $('#btn-connect');
      if (btn && W.isConnected) {
        const bal = solBalance !== null ? `◎ ${solBalance.toFixed(2)} SOL` : '◎ —';
        btn.innerHTML = `✅ ${W.shortAddress()}<small class="btn-sub">${bal} · ${W.providerName || 'Solana'}</small>`;
      }
    } catch (e) { solBalance = null; }
  }

  function startSolBalancePolling() {
    stopSolBalancePolling();
    refreshSolBalance();
    solBalanceTimer = setInterval(refreshSolBalance, 30000);
  }

  function stopSolBalancePolling() {
    if (solBalanceTimer) { clearInterval(solBalanceTimer); solBalanceTimer = null; }
    solBalance = null;
  }

  function renderMenu() {
    const on = W.isConnected;
    $('#fighter-chip-av').innerHTML = SAK.avatarSVG(playerLook());
    $('#fighter-chip-name').textContent = profile().name;
    $('#wallet-chip').classList.toggle('hidden', !on);
    $('#wallet-addr').textContent = W.shortAddress();
    const balText = solBalance !== null ? `◎ ${solBalance.toFixed(2)} SOL` : '◎ …';
    // Kick off a fetch if we don't have the balance yet
    if (on && solBalance === null && !window._balFetching) {
      window._balFetching = true;
      refreshSolBalance().finally(() => { window._balFetching = false; });
    }
    $('#btn-connect').innerHTML = on
      ? `✅ ${W.shortAddress()}<small class="btn-sub">${balText} · ${W.providerName || 'Solana'}</small>`
      : '👛 CONNECT WALLET<small class="btn-sub">Phantom · Solflare</small>';
    $('#btn-connect').classList.toggle('btn-purple', !on);
    $('#btn-connect').classList.toggle('btn-grey', on);
    $('#vault-sub').textContent = V.staked > 0 ? `${fmt(V.staked)} staked · ${V.tier.name}` : 'earn yield + boost';
    $('#btn-rescue').classList.toggle('hidden', !(S.points < SAK.POINTS.rescueThreshold && V.staked === 0));
    const st = S.stats;
    const tier = SAK.playerTier ? SAK.playerTier() : SAK.TIERS[0];
    $('#menu-stats').innerHTML = `<span>🏆 ${st.wins}W / ${st.losses}L</span><span>🔥 Streak ${st.streak}</span><span style="color:${tier.color};font-weight:700">◆ ${tier.name}</span><span>❤ Lv${S.upgrades.health} ✊ Lv${S.upgrades.power}</span>`
      + (V.boost ? `<span class="boost-tag">⚡ +${Math.round(V.boost * 100)}% boost</span>` : '')
      + (tier.yieldBoost ? `<span class="boost-tag" style="border-color:${tier.color}">🏦 +${Math.round(tier.yieldBoost * 100)}% yield</span>` : '');
    $('#set-wallet').textContent = on ? `Wallet: ${W.address}` : 'Wallet not connected';
    $('#btn-disconnect').classList.toggle('hidden', !on);
    renderShopStats();
    updateMenuPendingBar();
    // B1 stats
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('m1-pts', fmt(S.points)); setText('m1-pts2', fmt(S.points));
    setText('m1-streak', S.stats.streak); setText('m1-streak2', S.stats.streak);
    setText('m1-wallet-addr', on ? W.shortAddress() : '—');
    const tier2 = SAK.playerTier ? SAK.playerTier() : SAK.TIERS[0];
    setText('m1-tier', tier2.name.toUpperCase());
    const wr = (S.stats.wins + S.stats.losses) > 0 ? Math.round(S.stats.wins / (S.stats.wins + S.stats.losses) * 100) + '%' : '—';
    setText('m1-winrate', wr);
    setText('m1-shop-lv', `Lv${S.upgrades.health} · Lv${S.upgrades.power}`);
    // Ensure fighter is synced to Supabase (for PvP opponent visibility)
    // Expose manual sync for debugging
    window.syncFighterNow = async () => {
      if (!W.address || !S.profile || !S.profile.avatar) {
        console.warn('[SAK] syncFighterNow: missing wallet or local fighter');
        return false;
      }
      try {
        await SAK.Api.saveProfile(W.address, {
          name: S.profile.name,
          fighter_look: S.profile.avatar, x_handle: S.profile.x_handle || '',
        });
        console.log('[SAK] Fighter synced to Supabase!');
        toast('Fighter synced ✓', 2000);
        return true;
      } catch (e) {
        console.error('[SAK] syncFighterNow failed', e);
        return false;
      }
    };
    if (on && W.address && S.profile && S.profile.avatar && SAK.Api) {
      SAK.Api.getProfile(W.address).then(p => {
        if (p && !p.fighter_look) {
          SAK.Api.saveProfile(W.address, {
            name: S.profile.name,
            fighter_look: S.profile.avatar, x_handle: S.profile.x_handle || '',
          }).catch(e => console.warn('[SAK] menu fighter sync failed', e));
        }
      }).catch(() => {});
    }
    // Keep badge fresh while on menu (poll every 10s)
    if (window._pvpBadgeTimer) clearInterval(window._pvpBadgeTimer);
    window._pvpBadgeTimer = setInterval(() => {
      if (screen === 'menu') updateMenuPendingBar();
    }, 10000);
  }

  async function updateMenuPendingBar() {
    const badge = $('#pvp-btn-badge');
    if (!badge) return;
    // Hide badge if wallet not connected
    if (!W.address || !W.isConnected) {
      badge.className = 'pvp-btn-badge hidden';
      return;
    }
    // Check in-memory first, then Supabase
    let hasPending = !!(activeChainChallenge && activeChainChallenge.address);
    let hasAccepted = false;
    if (!hasPending && SAK.PvpSync && W.address) {
      try {
        const { awaiting, accepted } = await SAK.PvpSync.getMyChallenges(W.address);
        hasPending = awaiting.length > 0;
        hasAccepted = accepted.length > 0;
      } catch (e) {}
    }
    if (hasAccepted) {
      badge.textContent = '⚔ ACCEPTED';
      badge.className = 'pvp-btn-badge accepted';
    } else if (hasPending) {
      badge.textContent = '⏳ PENDING';
      badge.className = 'pvp-btn-badge';
    } else {
      badge.className = 'pvp-btn-badge hidden';
    }
  }

  /* ----------------------------------------------------------------- screens */
  let screen = 'menu';
  function show(name) {
    screen = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    document.body.classList.toggle('on-menu', name === 'menu');
    if (Scene) Scene.setMode(name === 'result' ? 'fight' : name === 'solo' ? 'pick' : name);
    if (name === 'menu') renderMenu();
  }

  /* --------------------------------------------------------- daily / bonuses */
  function grantDailyFist() {
    if (S.lastFreeFistDate !== todayStr()) {
      S.lastFreeFistDate = todayStr();
      const PU = SAK.POWERUPS.fist;
      S.powerups.fist = Math.min(PU.max, (S.powerups.fist || 0) + PU.freePerDay);
      SAK.Storage.save();
    }
  }

  /* ================================================================== MENU */
  function openWalletModal() { A.unlock(); A.click(); $('#modal-wallet').classList.remove('hidden'); }

  $('#btn-connect').addEventListener('click', () => {
    if (W.isConnected) {
      // Custom confirm modal (native confirm() is unreliable on iOS)
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:20px;max-width:280px;text-align:center;font-family:var(--font);">
        <div style="font-size:16px;font-weight:bold;color:#1a0a2e;margin-bottom:12px;">Disconnect wallet?</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button id="dc-yes" style="background:#ef4444;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-weight:bold;cursor:pointer;">YES</button>
          <button id="dc-no" style="background:#e5e7eb;color:#1a0a2e;border:none;border-radius:10px;padding:10px 20px;font-weight:bold;cursor:pointer;">CANCEL</button>
        </div></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#dc-yes').onclick = () => {
        overlay.remove();
        W.disconnect();
        toast('Wallet disconnected');
        renderMenu();
      };
      overlay.querySelector('#dc-no').onclick = () => overlay.remove();
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      return;
    }
    openWalletModal();
  });
  $('#wallet-cancel').addEventListener('click', () => $('#modal-wallet').classList.add('hidden'));
  // Wallet login: connect -> look up profile by wallet -> create fighter if new.
  async function syncProfileFromWallet() {
    const addr = W.address;
    if (!addr) return;
    try {
      const p = await SAK.Api.getProfile(addr);
      if (p && p.fighter_look) {
        S.profile = Object.assign({}, S.profile, { name: p.name, avatar: p.fighter_look, phrase: p.phrase || '' });
        SAK.Storage.save();
        if (Scene) { try { Scene.setPlayer(playerLook()); } catch (e) {} }
        renderMenu();
        toast(`Welcome back, ${p.name} 🫡`, 2200);
      } else if (p && S.profile && S.profile.avatar) {
        // Supabase missing fighter look, but we have it locally — sync it up
        SAK.Api.saveProfile(addr, {
          name: S.profile.name || p.name, phrase: S.profile.phrase || p.phrase || '',
          fighter_look: S.profile.avatar, x_handle: S.profile.x_handle || '',
        }).catch(e => console.warn('[SAK] fighter sync failed', e));
        renderMenu();
        toast(`Welcome back, ${p.name || S.profile.name}`, 2200);
      } else {
        toast('New wallet — build your fighter 👤', 2200);
        setTimeout(() => openFighter(false), 400);
      }
    } catch (e) { console.warn('[SAK] profile sync failed', e); }
  }
  $('#wallet-approve').addEventListener('click', async () => {
    const btn = $('#wallet-approve'); btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      const { address, walletName } = await W.connect();
      $('#modal-wallet').classList.add('hidden');
      A.coin();
      toast(`Wallet ${W.shortAddress()} linked · ${walletName}`, 2600);
      renderMenu();
      syncProfileFromWallet();
    } catch (err) {
      if (err && err.code === 'NO_WALLET') {
        $('#wallet-help').textContent = (err.help && err.help.body) || SAK.Wallet.NO_WALLET_HELP.body;
        // Show diagnostic so we can see what the browser actually exposes
        try {
          const d = SAK.Wallet.debug();
          const seen = [];
          if (d.jupiter && d.jupiter.exists) seen.push('jupiter');
          if (d.jupiter_solana && d.jupiter_solana.exists) seen.push('jupiter.solana');
          if (d.solana && d.solana.exists) seen.push('solana');
          if (d.phantom_solana && d.phantom_solana.exists) seen.push('phantom');
          if (d.walletStandard && d.walletStandard !== 'absent') seen.push('wallet-std:' + d.walletStandard);
          $('#wallet-help').textContent += seen.length
            ? ` [Detected: ${seen.join(', ')} — tap Try Again]`
            : ' [No wallet detected in this browser]';
        } catch (e) {}
        btn.textContent = 'Try Again';
      } else {
        toast('Wallet connection cancelled', 1800);
        $('#modal-wallet').classList.add('hidden');
      }
    }
    btn.disabled = false; if (btn.textContent !== 'Try Again') btn.textContent = 'Connect';
  });

  // Jupiter Mobile via WalletConnect (Reown AppKit). Hidden if not configured.
  const jupBtn = $('#wallet-jupiter'), jupRow = $('#wallet-jup-row'), jupHint = $('#wallet-jup-hint');
  if (!SAK.REOWN_PROJECT_ID || !SAK.WalletConnect) {
    if (jupRow) jupRow.classList.add('hidden');
  } else if (jupBtn) {
    jupBtn.addEventListener('click', async () => {
      jupBtn.disabled = true;
      const old = jupBtn.innerHTML;
      jupBtn.textContent = 'Loading…';
      try {
        await SAK.WalletConnect.init();
        jupBtn.textContent = 'Opening…';
        if (jupHint) jupHint.classList.remove('hidden');
        const { address, walletName } = await SAK.WalletConnect.connect();
        // Persist to the shared wallet state so W.address / W.isConnected work.
        const st = SAK.Storage.state;
        st.wallet.connected = true;
        st.wallet.address = address;
        st.wallet.provider = walletName;
        SAK.Storage.save();
        $('#modal-wallet').classList.add('hidden');
        A.coin();
        toast(`Wallet ${address.slice(0, 4)}…${address.slice(-4)} linked · ${walletName}`, 2600);
        renderMenu();
        syncProfileFromWallet();
      } catch (err) {
        console.warn('[SAK] Jupiter connect failed', err);
        const msg = (err && err.message) ? String(err.message).slice(0, 120) : 'unknown error';
        toast(err && err.code === 'CONNECT_TIMEOUT'
          ? 'Timed out — approve in Jupiter, then switch back here'
          : `Jupiter failed: ${msg} — try again`, 3200);
      }
      jupBtn.disabled = false; jupBtn.innerHTML = old;
    });
  }

  $('#btn-fighter').addEventListener('click', () => { A.unlock(); A.click(); openFighter(false); });

  /* --- account + character creator ------------------------------------
   * First launch: CREATE ACCOUNT (name) → BUILD YOUR FIGHTER (live 3D
   * preview, drag to spin). Editable later from the menu fighter chip. */
  let crDraft = null, crPreview = null, playAfterFighter = false, crIsNew = false, welcomePending = false;
  const AO = SAK.Account.OPTIONS;
  function openFighter(thenPlay) {
    playAfterFighter = !!thenPlay;
    crIsNew = !S.profile;
    const p = profile();
    // Always start from the current fighter when editing (not blank)
    crDraft = Object.assign({}, p.avatar || {});
    // If local avatar is missing, try to recover from Supabase
    if (!crIsNew && !p.avatar && W.address && SAK.Api && SAK.Api.getProfile) {
      SAK.Api.getProfile(W.address).then(sp => {
        if (sp && sp.fighter_look) {
          crDraft = Object.assign({}, sp.fighter_look);
          S.profile.avatar = Object.assign({}, sp.fighter_look);
          try { SAK.Storage.save(); } catch (_) {}
          renderCreatorPreview();
          // Update trait display
          if (typeof updateTraitDisplay === 'function') updateTraitDisplay();
        } else {
          // No cloud backup either, use random
          crDraft = Object.assign({}, SAK.Account.randomAvatar());
          renderCreatorPreview();
        }
      }).catch(() => {
        crDraft = Object.assign({}, SAK.Account.randomAvatar());
        renderCreatorPreview();
      });
    } else if (!p.avatar) {
      crDraft = Object.assign({}, SAK.Account.randomAvatar());
    }
    $('#fit-name').value = S.profile ? p.name : '';
    $('#fit-x').value = S.profile ? (p.x_handle || '') : '';
    $('#cr-name').value = S.profile ? p.name : '';
    $('#fit-phrase').value = S.profile ? (p.phrase || '') : '';
    $('#cr-name-err').textContent = ''; $('#cr-look-err').textContent = '';
    // Hide any stale fighter-card button
    const fcb = $('#pk-fighter-card'); if (fcb) fcb.remove();
    $('#modal-fighter').classList.remove('hidden');
    if (crIsNew) showCreatorStep('name'); else showCreatorStep('look');
    refreshFightHistory();
  }

  // ---- Fight history tracker (profile section) ----
  function fhMoney(n, cur) {
    if (cur === 'SMACK' || cur === 'PTS') return Math.round(n).toLocaleString('en-US');
    return String(Math.round(n * 1000) / 1000);
  }
  async function refreshFightHistory() {
    const list = document.getElementById('fh-list');
    if (!list) return;
    const tiles = document.getElementById('fh-tiles');
    const money = document.getElementById('fh-money');
    if (!W.address || !SAK.Api || !SAK.Api.getFightHistory) {
      if (tiles) tiles.innerHTML = '';
      if (money) money.innerHTML = '';
      list.innerHTML = '<p class="fine dark" style="margin:4px 0">Connect your wallet to track your fights.</p>';
      return;
    }
    let rows = [];
    try { rows = await SAK.Api.getFightHistory(W.address, 200); } catch (e) { rows = []; }
    // Rows recorded before the currency fix: a solo wager stored as FREE
    // with a wager on it was a SOL bet (solo mode only exists for house
    // wagers; SMACK rows were always labeled). Display it as SOL.
    (rows || []).forEach(r => { if (r.mode === 'solo' && r.currency === 'FREE' && Number(r.wager) > 0) r.currency = 'SOL'; });
    if (!rows || !rows.length) {
      if (tiles) tiles.innerHTML = '';
      if (money) money.innerHTML = '';
      list.innerHTML = '<p class="fine dark" style="margin:4px 0">No fights recorded yet — history starts with your next fight.</p>';
      return;
    }
    const wins = rows.filter(r => r.won).length, losses = rows.length - wins;
    if (tiles) tiles.innerHTML =
      `<div class="fh-tile"><b>${rows.length}</b><span>FIGHTS</span></div>` +
      `<div class="fh-tile"><b>${wins}–${losses}</b><span>W – L</span></div>` +
      `<div class="fh-tile"><b>${Math.round(wins / rows.length * 100)}%</b><span>WIN RATE</span></div>`;
    const agg = {};
    rows.forEach(r => {
      if (!r.currency || r.currency === 'FREE') return;
      const a = agg[r.currency] = agg[r.currency] || { w: 0, net: 0 };
      a.w += Number(r.wager) || 0; a.net += (Number(r.payout) || 0) - (Number(r.wager) || 0);
    });
    if (money) money.innerHTML = Object.keys(agg).map(cur => {
      const a = agg[cur];
      const netTxt = (a.net >= 0 ? '+' : '−') + fhMoney(Math.abs(a.net), cur);
      return `<div class="fh-money-row"><span>${cur === 'SMACK' ? '<img class="smack-hand" src="assets/hand-icon-sm.png" alt=""> SMACK' : cur === 'SOL' ? '◎ SOL' : '⭐ PTS'} WAGERED</span><b>${fhMoney(a.w, cur)}</b><span class="${a.net >= 0 ? 'fh-pos' : 'fh-neg'}">${netTxt} net</span></div>`;
    }).join('');
    const modeTag = r => r.mode === 'solo' ? '🏠 SOLO' : r.mode === 'pvp' ? '⚔️ PVP' : (r.currency === 'PTS' ? '⭐ PTS BET' : '🆓 FREE');
    list.innerHTML = rows.slice(0, 30).map(r => {
      const net = (Number(r.payout) || 0) - (Number(r.wager) || 0);
      const unit = r.currency === 'SOL' ? ' SOL' : r.currency === 'SMACK' ? ' SMACK' : r.currency === 'PTS' ? ' PTS' : '';
      const netHtml = r.currency === 'FREE'
        ? `<span class="fh-pos">+${r.pts || 0} PTS</span>`
        : `<span class="${net >= 0 ? 'fh-pos' : 'fh-neg'}">${net >= 0 ? '+' : '−'}${fhMoney(Math.abs(net), r.currency)}${unit}</span>`;
      return `<div class="fh-row">
        <span class="fh-badge ${r.won ? 'w' : 'l'}">${r.won ? 'W' : 'L'}</span>
        <div class="fh-main"><div class="fh-opp">${esc(r.opponent_name || 'Fighter')}</div>
        <div class="fh-meta">${modeTag(r)}${r.score ? ' · ' + esc(r.score) : ''} · ${timeAgo(r.created_at)}</div></div>
        <div class="fh-net">${netHtml}${r.currency === 'FREE' ? '' : `<div class="fh-wager">wager ${fhMoney(Number(r.wager) || 0, r.currency)}${unit}</div>`}</div>
      </div>`;
    }).join('');
  }
  function showCreatorStep(step) {
    $('#cr-step-name').classList.toggle('hidden', step !== 'name');
    $('#cr-step-look').classList.toggle('hidden', step !== 'look');
    $('#cr-title').textContent = crIsNew ? '👤 PICK YOUR FIGHTER' : '👤 CHANGE FIGHTER';
    if (step === 'name') { setTimeout(() => $('#fit-name').focus(), 50); return; }
    initPicker();
    if (!crPreview && Scene && Scene.createPreview) {
      try { crPreview = Scene.createPreview($('#cr-canvas')); } catch (err) { console.warn('[SAK] preview unavailable', err); crPreview = null; }
      // Retry once after layout settles (canvas may have 0 size on first pass)
      if (!crPreview) setTimeout(() => {
        if (!crPreview && Scene && Scene.createPreview && !$('#cr-step-look').classList.contains('hidden')) {
          try {
            crPreview = Scene.createPreview($('#cr-canvas'));
            $('#cr-canvas').classList.toggle('hidden', !crPreview);
            $('#cr-fallback').classList.toggle('hidden', !!crPreview);
            renderCreatorPreview();
          } catch (e) { console.warn('[SAK] preview retry failed', e); }
        }
      }, 300);
    }
    $('#cr-canvas').classList.toggle('hidden', !crPreview);
    $('#cr-fallback').classList.toggle('hidden', !!crPreview);
    renderCreatorPreview();
  }
  function closeCreator() {
    $('#modal-fighter').classList.add('hidden');
    if (crPreview) { crPreview.dispose(); crPreview = null; }
    if (welcomePending) { welcomePending = false; setTimeout(() => toast(`🎁 Welcome bonus: +${fmt(SAK.POINTS.welcomeBonus)} PTS to get slapping`, 2600), 2000); }
  }
  /* ---- Fighter picker: random only (premade starters removed 2026-10-25).
   * Returning players open on their SAVED fighter in the 3D preview;
   * new players open on a fresh random draft. RANDOMIZE is the Change
   * option; LOCK saves the draft (free during testing; mainnet: first
   * lock free, later changes 0.05 SOL). Drafts never touch the saved
   * fighter until LOCK, so Cancel keeps the current fighter. ---- */
  let pkCustomLook = null, pkLocked = false;
  function updateLockButton() {
    const lockBtn = $('#pk-lock');
    if (!lockBtn || pkLocked) return;
    lockBtn.disabled = false;
    lockBtn.textContent = '🔒 LOCK'; // TEMPORARY: free lock for testing
  }
  function initPicker() {
    pkLocked = false;
    // Profile-first: a returning player's preview opens on THEIR fighter;
    // a new player gets a fresh random draft to roll from.
    if (S.profile && S.profile.avatar) pkCustomLook = Object.assign({}, S.profile.avatar);
    else pkCustomLook = SAK.Account.randomAvatar();
    updateLockButton();
    // Refresh lock button when wallet connects/disconnects while picker is open
    if (SAK.Wallet && SAK.Wallet.onChange) {
      SAK.Wallet.onChange(() => { if (!$('#cr-step-look').classList.contains('hidden')) updateLockButton(); });
    }
    renderCustomTraits();
    renderCreatorPreview();
  }
  function renderCustomTraits() {
    const box = $('#pk-traits');
    if (!pkCustomLook) { box.innerHTML = ''; return; }
    const L = SAK.Account.toLook(pkCustomLook);
    // Labels: id layers use the OPTIONS labels; color layers
    // reverse-lookup the LAYERS tables by hex. Account rolls include
    // hexes outside those tables (e.g. skin #f2c49b), which fall back
    // to the hex itself — always truthful, never blank. (LT 2026-10-25:
    // the old 4-row readout + dead facialHair/necklace/glasses/tattoo
    // rows never kept up with the new layers.)
    const optLabel = (key, id) => {
      const list = (SAK.Account.OPTIONS && SAK.Account.OPTIONS[key]) || [];
      const hit = list.find(o => (typeof o === 'string' ? o : o.id) === id);
      return hit ? (typeof hit === 'string' ? hit : hit.label) : null;
    };
    const layerLabel = (layer, hex) => {
      const list = (SAK.Traits && SAK.Traits.LAYERS && SAK.Traits.LAYERS[layer]) || [];
      const hit = list.find(t => t.value === hex);
      return hit ? hit.label : null;
    };
    const swatch = hex => `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${hex};border:1px solid #0005;vertical-align:-1px;margin-right:4px"></span>`;
    const colorRow = (label, layer, hex) => {
      hex = hex || '#888888';
      const name = layerLabel(layer, hex);
      return [label, swatch(hex) + (name || hex.toUpperCase())];
    };
    const idRow = (label, key, id, fallback) => [label, (optLabel(key, id) || id || fallback).toUpperCase()];
    const rows = [
      idRow('Species', 'species', L.species, 'human'),
      idRow('Body', 'body', L.body, 'classic'),
      colorRow('Skin', 'skin', L.skin),
      idRow('Eyes', 'eyes', L.eyes, 'round'),
      colorRow('Eye Color', 'eyeColor', L.eyeColor),
      idRow('Hair', 'hairStyle', L.hairStyle, 'short'),
      colorRow('Hair Color', 'hairColor', L.hair),
      ['Outfit', (L.outfit || 'tee').toUpperCase()],
      ['Shirt', swatch(L.shirt || '#888888') + (L.shirt || '').toUpperCase()],
      idRow('Shirt Print', 'print', L.print, 'none'),
      colorRow('Pants', 'pants', L.pants),
      idRow('Accessory', 'accessory', L.accessory, 'none'),
    ];
    box.innerHTML = rows.map(([k, v]) => `<div><span style="opacity:.6">${k}:</span> <b>${v}</b></div>`).join('');
  }
  function renderCreatorPreview() {
    // Preview shows the random draft (seeded from the saved fighter for
    // returning players, fresh roll for new players)
    const look = pkCustomLook || crDraft;
    if (crPreview) crPreview.apply(look || crDraft);
    else $('#cr-fallback').innerHTML = SAK.avatarSVG(SAK.Account.toLook(look || crDraft));
  }
  $('#cr-next').addEventListener('click', () => {
    const n = SAK.Account.validateName($('#fit-name').value), v = n.ok ? validateText(n.ok, SAK.UGC.maxName) : n;
    if (v.err) { $('#cr-name-err').textContent = 'Name: ' + v.err; return; }
    // Unique fighter names: no duplicates with KOL roster or other custom KOLs
    const nameLower = v.ok.toLowerCase();
    if (roster().some(k => k.name.toLowerCase() === nameLower)) {
      $('#cr-name-err').textContent = 'That name is taken'; return;
    }
    A.click();
    $('#cr-name').value = v.ok;
    if (crIsNew) crDraft = SAK.Account.randomAvatar();   // fresh degen, tweak from here
    showCreatorStep('look');
  });
  $('#fit-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#cr-next').click(); } });

  // ---- Randomize + lock (the only picker: starters removed 2026-10-25) ----
  $('#pk-random').addEventListener('click', () => {
    A.click();
    pkCustomLook = SAK.Account.randomAvatar();
    pkLocked = false;
    updateLockButton();
    renderCustomTraits();
    renderCreatorPreview();
    A.coin();
  });
  $('#pk-lock').addEventListener('click', async () => {
    const btn = $('#pk-lock');
    // TEMPORARY: free lock for everyone during testing — remove before mainnet
    if (!pkCustomLook) { toast('🎲 Randomize a fighter first', 2000); return; }
    btn.disabled = true;
    btn.textContent = '⏳ Locking…';
    try {
      // TEMPORARY: free lock — no payment, no wallet needed. Remove before mainnet.
      await SAK.FighterLock.lockFighterFree(pkCustomLook);
      pkLocked = true;
      crDraft = Object.assign({}, pkCustomLook);
      // Stamp the name/quote the user typed (validated on save path too)
      const nm = $('#cr-name').value.trim(), q = $('#fit-phrase').value.trim();
      await saveFighterProfile(nm || undefined, q || undefined, { starter_id: null, custom: true });
      btn.textContent = '✅ LOCKED!';
      A.perfect();
      // Auto-sync to Supabase when wallet is connected (for PvP visibility)
      if (W.isConnected && W.address && SAK.Api) {
        btn.textContent = '🔄 Syncing…';
        try {
          // Timeout after 10s so the button doesn't hang forever
          const syncPromise = SAK.Api.saveProfile(W.address, {
            name: S.profile.name,
            fighter_look: S.profile.avatar, x_handle: S.profile.x_handle || '',
          });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Sync timed out')), 10000));
          await Promise.race([syncPromise, timeoutPromise]);
          btn.textContent = '✅ LOCKED!';
          toast('🔒 Fighter locked & synced ✓', 2600);
        } catch (e) {
          console.warn('[SAK] auto-sync after lock failed', e);
          btn.textContent = '✅ LOCKED!';
          toast('🔒 Locked! (sync failed — tap SYNC to retry)', 2600);
        }
      } else {
        btn.textContent = '✅ LOCKED!';
        toast('🔒 Fighter locked!', 2400);
      }
      showFighterCardButton();
    } catch (e) {
      console.warn('[SAK] lock failed', e);
      toast('⚠️ Lock failed, try again', 2000);
      updateLockButton();
    }
  });
  $('#cr-later').addEventListener('click', () => { closeCreator(); if (playAfterFighter) setTimeout(openSolo, 50); });   // play as guest
  $('#cr-cancel').addEventListener('click', () => { if (crIsNew) showCreatorStep('name'); else closeCreator(); });
  // Manual fighter sync to Supabase for PvP visibility
  const syncBtn = $('#cr-sync');
  if (syncBtn) syncBtn.addEventListener('click', async () => {
    if (!W.address || !W.isConnected) { toast('Connect wallet first', 2000); return; }
    if (!S.profile || !S.profile.avatar) { toast('No fighter to sync', 2000); return; }
    syncBtn.disabled = true; syncBtn.textContent = '⏳ Syncing…';
    try {
      await SAK.Api.saveProfile(W.address, {
        name: S.profile.name,
        fighter_look: S.profile.avatar, x_handle: S.profile.x_handle || '',
      });
      toast('Fighter synced ✓ — visible in PvP', 2600);
      syncBtn.textContent = '✅ SYNCED';
    } catch (e) {
      toast('Sync failed: ' + (e.message || e), 2600);
      syncBtn.textContent = '🔄 SYNC';
    }
    syncBtn.disabled = false;
    setTimeout(() => { syncBtn.textContent = '🔄 SYNC'; }, 3000);
  });
  /**
   * Shared save: writes name/phrase/avatar to the profile (local + backend),
   * updates the 3D player, and shows the fighter-card share button.
   * `extra` may carry { starter_id } or { custom: true }.
   */
  async function saveFighterProfile(name, phrase, extra) {
    extra = extra || {};
    const v = name !== undefined ? { ok: name } : (() => {
      const n = SAK.Account.validateName($('#cr-name').value);
      return n.ok ? validateText(n.ok, SAK.UGC.maxName) : n;
    })();
    if (v.err) { $('#cr-look-err').textContent = 'Name: ' + v.err; return false; }
    const nameLower = v.ok.toLowerCase();
    const isOwnName = S.profile && S.profile.name.toLowerCase() === nameLower;
    if (!isOwnName && roster().some(k => k.name.toLowerCase() === nameLower)) {
      $('#cr-look-err').textContent = 'That name is taken'; return false;
    }
    const rawPh = phrase !== undefined ? phrase : $('#fit-phrase').value.trim();
    const ph = rawPh ? validateText(rawPh, SAK.UGC.maxCatchphrase) : { ok: '' };
    if (ph.err) { $('#cr-look-err').textContent = 'Quote: ' + ph.err; return false; }
    const xh = $('#fit-x').value.trim().replace(/^@/, '').slice(0, 15);
    // Resolve the avatar: the random draft (starters removed 2026-10-25)
    const avatar = crDraft, starterId = extra.starter_id || null;
    const cleanAvatar = SAK.Account.sanitize(avatar);
    if (S.profile) Object.assign(S.profile, {
      name: v.ok, phrase: ph.ok, x_handle: xh, avatar: cleanAvatar,
      starter_id: starterId || null,
    });
    else S.profile = Object.assign(SAK.Account.create(v.ok, cleanAvatar, ph.ok), { x_handle: xh, starter_id: starterId || null });
    SAK.Storage.save();
    // Verify the save worked
    const verify = SAK.Storage.load();
    if (!verify || !verify.profile || !verify.profile.avatar) {
      console.error('[SAK] profile save verification failed');
      toast('Save failed — try again', 2600);
      return false;
    }
    if (W.isConnected && W.address) {
      SAK.Api.saveProfile(W.address, {
        name: S.profile.name, fighter_look: S.profile.avatar, x_handle: xh,
      }).catch(e => console.warn('[SAK] profile save failed', e));
    }
    if (Scene) Scene.setPlayer(playerLook());
    return true;
  }

  /** After save/lock: show a "Save Fighter Card" share button in the modal. */
  function showFighterCardButton() {
    if ($('#pk-fighter-card')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pk-fighter-card';
    btn.className = 'btn btn-purple';
    btn.style.cssText = 'width:100%;margin-top:10px';
    btn.textContent = '🖼️ SAVE FIGHTER CARD';
    btn.onclick = async () => {
      A.click();
      btn.disabled = true;
      btn.textContent = '⏳ Building card…';
      try {
        const svg = SAK.FightCard.buildFighterCard({
          name: S.profile.name,
          xHandle: S.profile.x_handle,
          phrase: S.profile.phrase,
          look: S.profile.avatar,
          starterId: S.profile.starter_id,
          wins: S.profile.wins || 0,
          losses: S.profile.losses || 0,
        });
        await SAK.FightCard.share(svg, `🥊 My Smack-a-KOL fighter: ${S.profile.name}!`);
        toast('🖼️ Fighter card shared!', 2000);
      } catch (e) {
        console.warn('[SAK] fighter card failed', e);
        toast('Card failed — try again', 2000);
      }
      btn.disabled = false;
      btn.textContent = '🖼️ SAVE FIGHTER CARD';
    };
    const actions = document.querySelector('#cr-step-look .cr-actions');
    if (actions) actions.parentNode.insertBefore(btn, actions);
    else $('#cr-step-look').appendChild(btn);
    // DONE button after lock — takes user back home
    if (!document.getElementById('pk-done')) {
      const done = document.createElement('button');
      done.type = 'button'; done.id = 'pk-done';
      done.className = 'btn btn-green'; done.style.cssText = 'width:100%;margin-top:8px';
      done.textContent = 'DONE · LFG 🚀';
      done.onclick = () => {
        A.click();
        closeCreator();
        renderMenu();
        if (typeof playAfterFighter !== 'undefined' && playAfterFighter) openSolo();
      };
      btn.parentNode.insertBefore(done, btn.nextSibling);
    }
  }

  $('#fighter-form').addEventListener('submit', async e => {
    e.preventDefault();
    // LOCK is the save action (SAVE button removed with starters 2026-10-25).
    // Enter key in a name/quote field lands here: route it to LOCK.
    if (!pkLocked) { $('#pk-lock').click(); return; }
    const ok = await saveFighterProfile();
    if (!ok) return;
    A.perfect();
    toast(crIsNew ? `🪪 ${S.profile.name} has entered the arena. LFG 🚀` : `${S.profile.name}: fresh drip saved 💅`, 2600);
    // Swap form actions for a success state: fighter-card button + Done
    const actions = document.querySelector('#cr-step-look .cr-actions');
    if (actions) actions.style.display = 'none';
    showFighterCardButton();
    if (!$('#pk-done')) {
      const done = document.createElement('button');
      done.type = 'button'; done.id = 'pk-done';
      done.className = 'btn btn-green'; done.style.cssText = 'width:100%;margin-top:8px';
      done.textContent = 'DONE · LFG 🚀';
      done.onclick = () => {
        A.click();
        if (actions) actions.style.display = '';
        const d = $('#pk-done'); if (d) d.remove();
        const fcb = $('#pk-fighter-card'); if (fcb) fcb.remove();
        closeCreator();
        renderMenu();
        if (playAfterFighter) openSolo();
      };
      const fcb = $('#pk-fighter-card');
      if (fcb && fcb.parentNode) fcb.parentNode.insertBefore(done, fcb.nextSibling);
    }
    renderMenu();
  });
  $('#btn-vault').addEventListener('click', () => { A.unlock(); A.click(); openVault(); });
  $('#btn-rescue').addEventListener('click', () => {
    if (S.points >= SAK.POINTS.rescueThreshold) return;
    P.add(SAK.POINTS.rescueAmount, false);
    A.coin(); toast(`🛟 +${fmt(SAK.POINTS.rescueAmount)} PTS — get back in there!`);
    renderMenu();
  });
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => { A.click(); show(b.dataset.nav); }));

  /* ================================================================ PICKER */
  let selected = 0;
  let selectedBet = 0;   // PTS bet for the next fight (0 = free match)
  let selectedMode = 'classic';   // 'classic' (KO) - only mode

  /** Render the mode toggle into `el`. Hidden when only one mode exists. */
  function renderModes(el, mode, onPick) {
    const modes = Object.values(SAK.MODES);
    if (modes.length <= 1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = modes.map(m => `
      <button type="button" class="mode-btn ${m.id} ${m.id === mode ? 'selected' : ''}" data-mode="${m.id}">
        <b>${m.icon} ${m.label}</b><small>${m.desc}</small></button>`).join('');
    el.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => { A.click(); onPick(b.dataset.mode); });
  }
  const modePts = (k, mode) => boosted(k.winPts * SAK.MODES[mode].ptsMult);

  function openPicker(forceIdx) {
    const list = roster();
    const idx = list.findIndex(k => !S.beaten[k.id]);   // default: first unbeaten
    selected = forceIdx !== undefined ? forceIdx : idx >= 0 ? idx : 0;
    selected = Math.min(selected, list.length - 1);
    renderPicker();
    show('pick');
    selectKol(selected, true);
  }

  function renderPicker() {
    const list = roster();
    const used = S.customKols.length, slots = ugcSlotsUnlocked(), next = ugcNextMilestone();
    const canSubmit = used < slots;
    $('#kol-list').innerHTML = list.map((k, i) => `
      <button class="kol-card ${i === selected ? 'selected' : ''}" data-i="${i}">
        ${S.beaten[k.id] ? '<span class="beaten">✓</span>' : ''}
        ${k.custom ? '<span class="fan">FAN</span>' : ''}
        ${SAK.avatarSVG(k.look)}
        <div class="kc-name">${esc(k.name)}</div>
        <div class="kc-stake">${ptsHTML()}+${fmt(modePts(k, selectedMode))}</div>
      </button>`).join('') + `
      <button class="kol-card submit-card-btn ${canSubmit ? '' : 'locked'}" id="btn-submit-kol">
        <span class="plus">${canSubmit ? '+' : '🔒'}</span>
        <div class="kc-name">SUBMIT KOL</div>
        <small>${canSubmit ? `${slots - used} slot${slots - used > 1 ? 's' : ''} free` : next !== undefined ? `next slot at ${fmt(next)} lifetime PTS` : 'all slots used'}</small>
      </button>`;
    $$('.kol-card[data-i]').forEach(c => c.addEventListener('click', () => { A.click(); selectKol(+c.dataset.i); }));
    $('#btn-submit-kol').addEventListener('click', () => { A.click(); openSubmit(); });
  }

  function selectKol(i, noTaunt) {
    const list = roster();
    selected = i;
    const k = list[i];
    $$('.kol-card[data-i]').forEach(c => c.classList.toggle('selected', +c.dataset.i === i));
    const maxHp = 260, maxPow = 28;
    $('#kol-detail').innerHTML = `
      <div><div class="kd-name">${esc(k.name)}</div><div class="kd-handle">${esc(k.handle)} · ${k.custom ? 'FAN-MADE' : 'LEVEL ' + k.level}</div></div>
      <div class="kd-stars">${'★'.repeat(Math.max(0, Math.min(5, k.difficulty)))}<span style="opacity:.3">${'★'.repeat(Math.max(0, 5 - k.difficulty))}</span></div>
      <div class="kd-tag">“${esc(k.tagline)}”</div>
      <div class="kd-stats">
        <span>❤ HP</span><div class="stat-bar"><i style="width:${k.hp / maxHp * 100}%;background:#2ee66b"></i></div><span>${k.hp}</span>
        <span>✊ POWER</span><div class="stat-bar"><i style="width:${k.power / maxPow * 100}%;background:#ff3b5c"></i></div><span>${k.power}</span>
      </div>
      <div class="kd-money">
        <div>WIN ${ptsHTML()}<b>+${fmt(modePts(k, selectedMode))}</b></div>
        <div>BET PAYS <b style="color:#2ee66b">x${k.payout.toFixed(1)}</b>${V.boost ? ` <span class="boost-tag">+${Math.round(V.boost * 100)}%</span>` : ''}</div>
      </div>
      ${k.custom ? `<button class="kd-remove" id="btn-remove-kol">🗑 Remove fan KOL</button>` : ''}`;
    if ($('#btn-remove-kol')) $('#btn-remove-kol').addEventListener('click', () => removeCustom(k.id));
    if (selectedBet && selectedBet < k.minBet) selectedBet = 0;
    renderModes($('#mode-row'), selectedMode, m => { selectedMode = m; renderPicker(); selectKol(selected, true); });
    renderBets();
    if (Scene) { Scene.setOpponent(k.look); if (!noTaunt) Scene.taunt(); }
    const card = $(`.kol-card[data-i="${i}"]`); if (card) card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function renderBets() {
    const k = roster()[selected];
    if (selectedBet && !P.canAfford(selectedBet)) selectedBet = 0;
    $('#bet-chips').innerHTML = SAK.BETS.map(b => {
      const free = b === 0, locked = !free && (b < k.minBet || !P.canAfford(b));
      return `<button class="bet-chip ${free ? 'free' : ''} ${b === selectedBet ? 'selected' : ''} ${locked ? 'locked' : ''}" data-bet="${b}">
        ${free ? 'FREE' : `${ptsHTML()}${b >= 1000 ? b / 1000 + 'K' : b}`}</button>`;
    }).join('');
    $('#bet-hint').textContent = selectedBet
      ? `win → ${fmt(boosted(selectedBet * k.payout))} PTS`
      : `min bet ${fmt(k.minBet)} PTS`;
    $$('.bet-chip').forEach(c => c.addEventListener('click', () => {
      const b = +c.dataset.bet; A.click();
      if (b && b < k.minBet) return toast(`${k.name} min bet: ${fmt(k.minBet)} PTS`);
      if (b && !P.canAfford(b)) return toast('Not enough PTS for that bet');
      selectedBet = b; renderBets();
    }));
    const btn = $('#btn-challenge');
    btn.className = 'btn btn-xl ' + (selectedBet ? 'btn-red' : 'btn-yellow');
    btn.innerHTML = selectedBet ? `🖐 SEND IT · BET ${fmt(selectedBet)} PTS` : `🖐 SEND IT · FREE · +${fmt(modePts(k, selectedMode))} PTS`;
  }

  $('#btn-challenge').addEventListener('click', () => startFight(roster()[selected], selectedBet, { mode: selectedMode }));

  /* ======================================================= SUBMIT A KOL (UGC) */
  let draft = null;
  let subRoll = null, subRerollsLeft = SAK.Traits.MAX_REROLLS;
  /** Deterministic look/stats from the name, so the form stays tiny (name, colour, catchphrase). */
  function lookFromName(name, colour) {
    let h = 0; for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const P = SAK.UGC.palettes, A = SAK.UGC.accessories;
    return {
      skin: P.skin[h % P.skin.length], hair: P.hair[(h >>> 3) % P.hair.length], shirt: colour,
      accessory: A[(h >>> 6) % A.length], difficulty: 1 + ((h >>> 9) % 4)
    };
  }
  function openSubmit() {
    const used = S.customKols.length, slots = ugcSlotsUnlocked(), next = ugcNextMilestone();
    if (used >= slots) {
      return toast(next !== undefined ? `Slots full. Earn ${fmt(next - S.stats.lifetimePts)} more PTS to unlock another` : 'All submission slots used');
    }
    const pal = SAK.UGC.palettes;
    draft = { shirt: pick(pal.shirt) };
    subRoll = null; subRerollsLeft = SAK.Traits.MAX_REROLLS; // reset trait rerolls
    $('#sub-traits').classList.add('hidden');
    $('#sub-name').value = ''; $('#sub-phrase').value = '';
    const box = $('.swatches[data-key="shirt"]');
    box.innerHTML = pal.shirt.map(c => `<button type="button" data-c="${c}" style="background:${c}"></button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => { draft.shirt = b.dataset.c; renderDraft(); });
    $('#sub-name').oninput = renderDraft;
    $('#sub-slots').textContent = `Slots used ${used}/${slots}` + (next !== undefined ? ` · next slot at ${fmt(next)} lifetime PTS (you: ${fmt(S.stats.lifetimePts)})` : '');
    renderDraft();
    $('#modal-submit').classList.remove('hidden');
  }
  // Submit KOL trait reroll (same system as fighter creator)
  $('#sub-reroll').addEventListener('click', () => {
    A.click();
    if (subRerollsLeft <= 0) { toast('No rerolls left — lock it in!', 1800); return; }
    subRerollsLeft--;
    subRoll = SAK.Traits.rollFighter();
    const rarity = SAK.Traits.getRarity(subRoll);
    if (rarity === 'legendary') A.fanfare && A.fanfare();
    else A.coin();
    renderSubTraits();
    renderDraft(); // update the preview with the new traits
    if (rarity === 'epic' || rarity === 'legendary') {
      toast(`🎰 ${SAK.Traits.RARITY[rarity].label.toUpperCase()} KOL!`, 2200);
    }
  });
  function renderSubTraits() {
    const box = $('#sub-traits'), list = $('#sub-trait-list');
    if (!subRoll) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const rarity = SAK.Traits.getRarity(subRoll);
    const rc = SAK.Traits.RARITY[rarity];
    $('#sub-rarity-badge').innerHTML = `<span style="color:${rc.color}">◆ ${rc.label.toUpperCase()}</span>`;
    $('#sub-reroll-left').textContent = `${subRerollsLeft} reroll${subRerollsLeft === 1 ? '' : 's'} left`;
    $('#sub-reroll-count').textContent = subRerollsLeft > 0 ? `(${subRerollsLeft})` : '';
    list.innerHTML = SAK.Traits.LAYER_ORDER.map(lid => {
      const t = subRoll[lid], tc = SAK.Traits.RARITY[t.rarity];
      return `<div><span style="opacity:.6">${SAK.Traits.LAYER_LABELS[lid]}:</span> <b style="color:${tc.color}">${t.label}</b></div>`;
    }).join('');
  }
  function renderDraft() {
    const name = $('#sub-name').value.trim() || 'Anon';
    const L = lookFromName(name, draft.shirt), st = SAK.customKolStats(L.difficulty);
    // If they rerolled traits, the roll wins over the name-hash look
    let look;
    if (subRoll) {
      const av = SAK.Traits.toAvatar(subRoll);
      look = { skin: av.skin, shirt: draft.shirt, hair: av.hairColor, hairStyle: av.hairStyle, eyes: av.eyes, accessory: av.accessory, accent: av.accessory === 'laser' ? '#ff1a1a' : '#ffd23f', gloves: av.gloves, outfit: av.outfit };
    } else {
      look = { skin: L.skin, shirt: L.shirt, hair: L.hair, accessory: L.accessory, accent: L.accessory === 'laser' ? '#ff1a1a' : '#ffd23f' };
    }
    $('#sub-preview').innerHTML = SAK.avatarSVG(look) + `<div class="sub-stats">${'★'.repeat(L.difficulty)} ❤${st.hp} ✊${st.power}</div>`;
    $$('.swatches[data-key="shirt"] button').forEach(b => b.classList.toggle('on', b.dataset.c === draft.shirt));
  }
  function validateText(str, max) {
    const t = str.replace(/\s+/g, ' ').trim();
    if (!t) return { err: 'required' };
    if (t.length > max) return { err: `max ${max} characters` };
    const low = t.toLowerCase();
    if (SAK.UGC.blocklist.some(w => low.includes(w))) return { err: 'keep it playful 🙏' };
    if (/https?:|www\.|@\w{2,}/i.test(t)) return { err: 'no links or @handles' };
    return { ok: t };
  }
  $('#submit-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = validateText($('#sub-name').value, SAK.UGC.maxName);
    const ph = validateText($('#sub-phrase').value, SAK.UGC.maxCatchphrase);
    if (n.err) return toast('Name: ' + n.err);
    if (ph.err) return toast('Catchphrase: ' + ph.err);
    if (roster().some(k => k.name.toLowerCase() === n.ok.toLowerCase())) return toast('That name is taken');
    if (S.customKols.length >= ugcSlotsUnlocked()) return toast('No free slots');
    const base = lookFromName(n.ok, draft.shirt);
    // Merge trait roll if they rerolled (gloves/outfit/accessory carry over)
    if (subRoll) {
      const av = SAK.Traits.toAvatar(subRoll);
      base.gloves = av.gloves; base.outfit = av.outfit; base.print = av.print;
      base.accessory = av.accessory; base.hairStyle = av.hairStyle;
      base.traits = subRoll; // save the full roll for NFT metadata later
    }
    const entry = Object.assign(base, { id: 'ugc_' + Date.now().toString(36), name: n.ok, phrase: ph.ok, createdAt: Date.now() });
    S.customKols.push(entry);
    SAK.Storage.save();
    $('#modal-submit').classList.add('hidden');
    A.perfect(); toast(`🎉 ${entry.name} just got listed. Time to slap!`);
    const idx = roster().findIndex(k => k.id === entry.id);
    renderPicker(); selectKol(idx);
  });
  function removeCustom(id) {
    const k = S.customKols.find(c => c.id === id);
    if (!k || !confirm(`Remove ${k.name} from the roster? (frees the slot)`)) return;
    S.customKols = S.customKols.filter(c => c.id !== id);
    delete S.beaten[id];
    SAK.Storage.save();
    selected = 0; renderPicker(); selectKol(0, true);
  }

  /* ================================================================= FIGHT */
  let F = null;   // current fight state
  let lastSlots = 1;  // UGC slots unlocked (to announce new unlocks)

  function say(text) {
    const t = $('#taunt'); t.textContent = text; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(say.t); say.t = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  function sayPlayer(text) {
    const t = $('#p-taunt'); t.textContent = text; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(sayPlayer.t); sayPlayer.t = setTimeout(() => t.classList.add('hidden'), 2000);
  }

  function renderHp(instant) {
    const set = (who, hp, max) => {
      const pct = Math.max(0, hp / max * 100);
      const fill = $(`#${who}-hp`), lag = $(`#${who}-hp-lag`);
      if (instant) { fill.style.transition = lag.style.transition = 'none'; }
      fill.style.width = pct + '%'; lag.style.width = pct + '%';
      fill.classList.toggle('low', pct < 30);
      $(`#${who}-hp-txt`).textContent = `${Math.max(0, Math.ceil(hp))} / ${max}`;
      if (instant) { void fill.offsetWidth; fill.style.transition = lag.style.transition = ''; }
    };
    set('p', F.pHp, F.pMax); set('k', F.kHp, F.kMax);
    if (Scene && Scene.player) Scene.player.setDamage(1 - F.pHp / F.pMax);
    if (Scene && Scene.kol) Scene.kol.setDamage(1 - F.kHp / F.kMax);
  }

  /* Meter faces: fighter portraits flanking the slap meter, damage evolving
     with each smack (driven by the 3D fighters' bruiseLevel, 0→3).
     The loser gets maximum damage: bloodied + bandaged. */
  function dmgLevel(who) {
    const b = (Scene && Scene[who] && Scene[who].bruiseLevel) || 0;
    return b <= 0 ? 0 : b < 0.35 ? 1 : b < 0.7 ? 2 : 3;
  }
  function renderMeterFaces(hitSide, koLoser) {
    if (!F) return;
    const pAv = $('#face-p-av'), kAv = $('#face-k-av');
    if (pAv) pAv.innerHTML = SAK.avatarSVG(playerLook(), koLoser === 'player' ? { ko: true, wrecked: true } : { dmg: dmgLevel('player') });
    if (kAv) {
      kAv.innerHTML = SAK.avatarSVG(F.kol.look, koLoser === 'kol' ? { ko: true, wrecked: true } : { dmg: dmgLevel('kol') });
      const kn = $('#face-k-name'); if (kn) kn.textContent = F.kol.name;
    }
    if (hitSide) {
      const el = hitSide === 'player' ? pAv : kAv;
      if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    }
  }

  function renderUpgrades() {
    $$('.upg-btn').forEach(b => {
      const type = b.dataset.upgrade, lvl = S.upgrades[type], max = lvl >= SAK.PLAYER.maxUpgradeLevel;
      b.querySelector('[data-lvl]').textContent = max ? 'MAX' : 'LV ' + (lvl + 1);
      b.querySelector('[data-cost]').textContent = max ? '—' : fmt(upgradeCost(type));
      b.disabled = max || !P.canAfford(upgradeCost(type));
    });
  }

  /* --- gloves shop (PTS upgrade ladder, ordered) ---------------------- */
  function renderGloves() {
    const wrap = $('#shop-gloves'); if (!wrap) return;
    const g = gloveState();
    const eq = gloveTier(g.equipped);
    const head = `<div class="glove-head">🥊 GLOVES · win PTS <b>+${Math.round(eq.bonus * 100)}%</b> with ${gloveLabel(eq.id)}</div>`;
    const rows = SAK.GLOVE_TIERS.map((t, i) => {
      const owned = g.owned.includes(t.id), isEq = g.equipped === t.id;
      const unlocked = i === 0 || g.owned.includes(SAK.GLOVE_TIERS[i - 1].id);
      let state, dis = '';
      if (isEq) { state = 'EQUIPPED'; dis = 'disabled'; }
      else if (owned) { state = 'EQUIP'; }
      else if (!unlocked) { state = '🔒'; dis = 'disabled'; }
      else { state = `BUY · ${fmt(t.price)} PTS`; if (!P.canAfford(t.price)) dis = 'disabled'; }
      return `<button class="glove-btn ${isEq ? 'on' : ''}" data-glove="${t.id}" ${dis}><span class="g-ico">🥊</span><span class="g-name">${gloveLabel(t.id)}</span><span class="g-bonus">+${Math.round(t.bonus * 100)}% PTS</span><span class="g-state">${state}</span></button>`;
    }).join('');
    wrap.innerHTML = head + rows;
    wrap.querySelectorAll('.glove-btn').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.glove, g2 = gloveState(), t = gloveTier(id);
      if (g2.equipped === id) return;
      if (g2.owned.includes(id)) { g2.equipped = id; }
      else {
        const idx = SAK.GLOVE_TIERS.findIndex(x => x.id === id);
        if (idx > 0 && !g2.owned.includes(SAK.GLOVE_TIERS[idx - 1].id)) return toast('Unlock the previous glove first');
        if (!P.spend(t.price)) return toast(`Need ${fmt(t.price)} PTS — win fights to earn more`);
        g2.owned.push(id); g2.equipped = id; A.coin();
      }
      SAK.Storage.save(); haptic(20);
      toast(`🥊 ${gloveLabel(id)} equipped · win PTS +${Math.round(t.bonus * 100)}%`);
      renderGloves();
      if (Scene && !(F && !['over', 'done', 'busy'].includes(F.turn))) { try { Scene.setPlayer(playerLook()); } catch (e) {} }
    }));
  }

  /* --- power-ups (limited-use consumables) ---------------------------- */
  function renderPowerups() {
    return; // Power-ups removed — pure timing skill game
    const rail = $('#powerups');
    rail.innerHTML = Object.values(SAK.POWERUPS).map(pu => {
      const own = S.powerups[pu.id] || 0, used = F && F.pu.used[pu.id];
      const active = F && ((pu.id === 'fist' && F.fireArmed) || (pu.id === 'helmet' && F.pu.helmet > 0) || (pu.id === 'rage' && F.pu.rage > 0));
      const badge = own > 0 ? '×' + own : `${ptsHTML()}${pu.cost}`;
      return `<button class="pu-btn ${pu.id} ${active ? 'active' : ''} ${used && !active ? 'used' : ''} ${!own && !P.canAfford(pu.cost) ? 'cant' : ''}" data-pu="${pu.id}" title="${pu.desc}">
        <span class="pu-ico">${pu.icon}</span><span class="pu-lbl">${pu.name}</span><span class="pu-badge">${badge}</span></button>`;
    }).join('');
    rail.querySelectorAll('.pu-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); usePowerup(b.dataset.pu); }));
    const st = [];
    if (F && F.fireArmed) st.push('🔥 GOLDEN FIST ARMED');
    if (F && F.pu.helmet) st.push(`⛑ HELMET ×${F.pu.helmet}`);
    if (F && F.pu.rage) st.push(`😤 RAGE ×${F.pu.rage}`);
    $('#pu-status').innerHTML = st.map(t => `<span>${t}</span>`).join('');
  }

  function usePowerup(id) {
    return; // Power-ups removed
    A.unlock();
    const pu = SAK.POWERUPS[id];
    if (!F || ['over', 'done'].includes(F.turn)) return;
    if (id === 'fist' && F.fireArmed) {           // un-arm (refund the charge)
      F.fireArmed = false; F.pu.used.fist = false; S.powerups.fist++; SAK.Storage.save();
      if (Scene) Scene.setFireArmed(false);
      return renderPowerups();
    }
    if (F.pu.used[id]) return toast(`${pu.icon} One ${pu.name} per fight, greedy.`);
    if (!(S.powerups[id] > 0)) {                    // buy one with PTS
      if (!P.spend(pu.cost)) return toast(`${pu.icon} ${pu.name} costs ${pu.cost} PTS. You're down bad.`);
      S.powerups[id] = 1; A.coin();
    }
    S.powerups[id]--; F.pu.used[id] = true; SAK.Storage.save();
    haptic(30);
    if (id === 'fist') { F.fireArmed = true; A.fire(); if (Scene && F.turn === 'challenge' && F.challenge && F.challenge.attacker === 'player') Scene.setFireArmed(true); }
    if (id === 'helmet') { F.pu.helmet = pu.hits; A.brace(); if (Scene) Scene.setHelmet(true); }
    if (id === 'rage') { F.pu.rage = pu.slaps; A.fire(); if (Scene) Scene.setRage(true); if (F.turn === 'challenge' && F.challenge && F.challenge.attacker === 'player' && MeterLocal) MeterLocal.setSpeedMult(pu.meterMult); }
    toast(`${pu.icon} ${pu.name}: ${pu.desc}`);
    renderPowerups(); renderUpgrades();
  }

  /* --- upgrades (PTS) ------------------------------------------------- */
  $$('.upg-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); buyUpgrade(b.dataset.upgrade, b); }));

  function buyUpgrade(type, btn) {
    A.unlock();
    if (S.upgrades[type] >= SAK.PLAYER.maxUpgradeLevel) return toast('Already maxed!');
    const cost = upgradeCost(type);
    if (!P.spend(cost)) return toast(`Need ${fmt(cost)} PTS — win fights to earn more`);
    S.upgrades[type]++;
    SAK.Storage.save();
    A.coin(); haptic(20);
    if (F) {
      if (type === 'health') {
        const newMax = playerMaxHp(), delta = newMax - F.pMax;
        F.pMax = newMax;
        if (delta > 0) F.pHp = Math.min(F.pMax, F.pHp + delta);
        renderHp();
      }
      // Power applies on the next landed slap via playerPower()
    }
    if (btn) {
      const r = btn.getBoundingClientRect(), app = appRect();
      floatText(r.left - app.left + r.width / 2, r.top - app.top, type === 'health' ? `+${SAK.PLAYER.hpPerLevel} HP` : `+${SAK.PLAYER.powerPerLevel} POWER`, 'good');
    }
    renderUpgrades(); renderGloves();
    renderShopStats();
  }


  function startFight(kol, bet, opts) {
    A.unlock();
    if (S.settings.battleMusic) A.startMusic();
    opts = opts || {};
    bet = bet || 0;
    const mode = opts.mode || 'classic';
    if (bet > 0) {   // optional bet is escrowed up-front
      if (bet < kol.minBet && !opts.pvp) bet = 0;   // PvP wagers aren't bound by KOL min bets
      else if (!P.spend(bet)) { toast('Not enough PTS for that bet'); return; }
      else A.coin();
    }
    grantDailyFist();
    clearTimeout(aiLockTimer);
    const bestOf = (SAK.MODES[mode] && SAK.MODES[mode].bestOf) || 5;
    const winsNeeded = Math.ceil(bestOf / 2);
    F = {
      kol, bet, hits: 0,
      pMax: playerMaxHp(), pHp: playerMaxHp(),
      kMax: kol.hp, kHp: kol.hp,
      turn: 'intro', started: false,
      perfects: 0, maxHit: 0, slaps: 0,
      fireArmed: false,
      pu: { used: {}, helmet: 0, rage: 0 },
      brace: null,
      mode, duel: { p: null, k: null }, opts,
      glove: snapshotGlove(), // equipped glove at fight start (win-PTS bonus; immune to mid-fight equips)
      localPvp: false,   // hotseat dual-UI removed — private meter only
      challenge: {
        bestOf, winsNeeded,
        pWins: 0, kWins: 0,
        round: 0,
        attacker: 'player',   // who attacks this round
        localSide: 'atk',     // this device's role this round: 'atk' | 'def'
        locks: { atk: null, def: null },
        resolving: false
      }
    };
    $('#duel-score') && $('#duel-score').remove();
    if (Scene) { Scene.setOpponent(kol.look); Scene.resetFight(); }
    $('#p-portrait').innerHTML = SAK.avatarSVG(playerLook());
    $('#p-name').textContent = profile().name;
    $('#k-portrait').innerHTML = SAK.avatarSVG(kol.look);
    $('#k-name').textContent = kol.name;
    renderMeterFaces(); // clean faces at fight start
    const tag = kol.pvp ? 'PVP · PRIVATE' : (kol.custom ? 'FAN KOL' : 'LEVEL ' + kol.level);
    $('#fight-level').textContent = tag;
    const chainWager = opts.chainWagerSol;
    // Solo vs House wagers arrive as opts.soloHouse (the placed house bet);
    // they were never read here, so wagered solo fights fell through to
    // the FREE label even though real SOL was locked.
    const soloWager = !chainWager && opts.soloHouse && opts.soloHouse.wagerSol;
    const soloTok = !chainWager && opts.soloHouse && opts.soloHouse.currency === 'SMACK' ? opts.soloHouse.wagerTokens : 0;
    const fmtSolAmt = n => (Math.round(n * 10000) / 10000).toString();
    $('#stake-tag').innerHTML = '' + (chainWager
      ? `⛓ ${chainWager} SOL <span class="escrow-badge">ON-CHAIN · DEVNET</span>`
      : soloWager
      ? `🏠 BET ◎ ${fmtSolAmt(soloWager)} → WIN ◎ ${fmtSolAmt(soloWager * 1.9)}`
      : soloTok
      ? `🏠 BET ${soloTok.toLocaleString('en-US')} SMACK → WIN ${Math.floor(soloTok * 0.99 * 1.9).toLocaleString('en-US')} SMACK`
      : bet
      ? `BET ${ptsHTML()} ${fmt(bet)} → ${fmt(boosted(bet * kol.payout))}`
      : `FREE · WIN ${ptsHTML()} +${fmt(modePts(kol, mode))}`);
    renderFightInfoBar();
    $('#upgrade-bar').classList.remove('gone');
    $('#taunt').classList.add('hidden'); $('#p-taunt').classList.add('hidden');
    $('#brace').classList.add('hidden');
    setWaitUI(false);
    renderHp(true); renderUpgrades(); renderGloves(); renderPowerups(); renderRoundScore();
    if (Scene) { Scene.setHelmet(false); Scene.setRage(false); }
    const token = ++fightToken;
    F.token = token;
    show('fight');
    sayPlayer(playerPhrase());
    setTimeout(() => F && F.token === token && say(pick(kol.taunts)), 900);
    // Fight start: VS names → ROUND 1 (+ bell) → READY → SLAP
    (async () => {
      const pName = profile().name || 'YOU';
      await vsCardIntro(pName, kol.name);
      if (typeof A !== 'undefined' && A.bell) A.bell();
      await roundCardIntro(1);
      await banner('READY...', '#fff', 700);
      await banner('SLAP! 👋', 'var(--yellow)', 600);
      if (F && F.token === token) startChallengeRound(true);
    })();
  }

  function renderFightInfoBar() {
    const bar = $('#fight-info-bar');
    if (!bar) return;
    if (!F || !F.challenge) { bar.classList.add('hidden'); return; }
    const C = F.challenge;
    const arenaEl = $('#arena-label');
    const stakeEl = $('#stake-tag');
    const arena = arenaEl ? arenaEl.textContent.trim() : '';
    const stake = stakeEl ? stakeEl.innerHTML.trim() : '';
    bar.classList.remove('hidden');
    bar.innerHTML =
      (arena ? `<span class="fib-arena">${esc(arena)}</span><span class="fib-div"></span>` : '') +
      `<span class="fib-score"><span class="rs-p">${C.pWins}</span> — <span class="rs-k">${C.kWins}</span></span>` +
      (stake ? `<span class="fib-div"></span><span class="fib-bet">${stake}</span>` : '');
  }

  function renderRoundScore() {
    if (!F || !F.challenge) {
      const bar = $('#fight-info-bar');
      if (bar) bar.classList.add('hidden');
      return;
    }
    renderFightInfoBar();
    // Real HP lives in renderHp() — round wins decide the match; HP is flavour that drops on landed hits
  }

  function stopMeters() {
    clearTimeout(aiLockTimer);
    clearTimeout(roundTimer);
    if (MeterLocal) MeterLocal.stop();
    // inline reveal is closed by its own finish(); hideLockReveal on next round / KO
  }

  function makeLockResult(angle) {
    const a = Math.max(-90, Math.min(90, angle));
    const abs = Math.abs(a);
    const zone = SAK.METER.zones.find(z => abs <= z.maxAngle) || SAK.METER.zones[SAK.METER.zones.length - 1];
    return { zone, angle: a, dist: abs, already: false };
  }

  function localSide() {
    return F && F.challenge ? F.challenge.localSide : 'atk';
  }

  function setWaitUI(on, msg) {
    const w = $('#meter-wait');
    if (!w) return;
    w.classList.toggle('hidden', !on);
    if (msg) w.textContent = msg;
  }

  async function startChallengeRound(skipBell) {
    if (!F || ['over', 'done'].includes(F.turn)) return;
    const C = F.challenge;
    const upcomingRound = (C.round || 0) + 1;
    // Rounds 2+: bell + ROUND N card (round 1 bell already played with its card)
    if (upcomingRound > 1) {
      A.bell();
      await roundCardIntro(upcomingRound);
      if (!F || ['over', 'done'].includes(F.turn)) return;
    } else if (!skipBell) {
      A.bell(); // 🛎 boxing ring bell — round is starting
    }
    hideLockReveal();
    C.round++;
    C.locks = { atk: null, def: null };
    C.resolving = false;
    // Alternate attacker: for chain PvP, challenger attacks odd rounds, acceptor attacks even rounds.
    // For local/AI fights, player attacks odd rounds.
    const isChainPvp = F.opts && F.opts.chainChallenge;
    const iAmChallenger = F.opts && F.opts.chainRole === 'challenger';
    const oddRound = (C.round % 2 === 1);
    if (isChainPvp) {
      // Challenger attacks odd rounds; acceptor attacks even rounds
      const iAttack = (oddRound && iAmChallenger) || (!oddRound && !iAmChallenger);
      C.attacker = iAttack ? 'player' : 'kol';
    } else {
      C.attacker = oddRound ? 'player' : 'kol';
    }
    C.localSide = C.attacker === 'player' ? 'atk' : 'def';
    F.turn = 'challenge';
    F.started = true;
    F.slaps++;
    // Upgrade bar stays visible during the whole match (LT 2026-10-13)
    $('#brace').classList.add('hidden');

    const isAtk = C.localSide === 'atk';
    // Role camera: bracing → show YOUR face (incoming slap); attacking → default fight view
    if (Scene && Scene.setRoleCam) Scene.setRoleCam(isAtk ? 'attack' : 'brace');
    if (Scene && Scene.setAnticipate) {
      Scene.setAnticipate('player', isAtk);
      Scene.setAnticipate('kol', !isAtk);
    }
    const ml = $('#meter-local');
    if (ml) ml.classList.toggle('attack-ready', isAtk && F.turn === 'challenge');
    // Degen play-by-play: random commentary so rounds never feel the same
    if (Math.random() < 0.4) setTimeout(() => { if (F && F.started) say(pick(SAK.COPY.fightCommentary)); }, 1400);
    const roleEl = $('#role-label');
    roleEl.textContent = isAtk ? '🖐 SMACK' : '🛡 BRACE';
    roleEl.className = 'meter-role ' + (isAtk ? 'atk-role smack-label' : 'def-role brace-label');
    const panel = $('#panel-local');
    panel.classList.remove('locked');
    panel.classList.add('you-control');
    panel.classList.toggle('role-atk', isAtk);
    panel.classList.toggle('role-def', !isAtk);
    $('#hint-local').textContent = isAtk ? 'TAP / SPACE TO SLAP-LOCK' : 'TAP / SPACE TO BRACE-LOCK';
    $('#hint-local').classList.remove('dim');
    setWaitUI(false);

    const atkName = C.attacker === 'player' ? profile().name : F.kol.name;
    const p = $('#prompt');
    p.textContent = isAtk
      ? `ROUND ${C.round} · YOUR ATTACK`
      : `ROUND ${C.round} · BRACE vs ${F.kol.name.toUpperCase()}`;
    p.classList.toggle('kol-turn', !isAtk);
    p.classList.remove('hidden');

    renderRoundScore();

    const CH = SAK.CHALLENGE;
    const speed = CH.attackerBaseSpeed + (F.kol.difficulty - 1) * 12;
    MeterLocal.setSpeedMult(F.pu.rage > 0 && isAtk ? SAK.POWERUPS.rage.meterMult : 1);
    if (Scene) Scene.setFireArmed(!!(F.fireArmed && isAtk));

    // Both roles: jerky unpredictable meter on THIS device only
    MeterLocal.setJerky(true);
    MeterLocal.unfreeze();
    MeterLocal.start(speed);

    scheduleAiPrivateLock();
    armRoundTimer();
  }

  /** Soft timeout: auto-whiff any unlocked side so rounds can't hang (re-arms while Settings is open). */
  function armRoundTimer() {
    clearTimeout(roundTimer);
    roundTimer = setTimeout(() => {
      if (!F || F.turn !== 'challenge' || F.challenge.resolving) return;
      if (!$('#modal-settings').classList.contains('hidden')) return armRoundTimer();   // paused in settings
      const side = F.challenge.localSide;
      if (!F.challenge.locks[side]) {
        // local timeout → force a bad lock on the visible meter
        lockLocal(true, (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 25));
      }
      const aiSide = side === 'atk' ? 'def' : 'atk';
      if (!F.challenge.locks[aiSide]) {
        lockOpponentPrivate((Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 25));
      }
    }, (SAK.CHALLENGE.windowMs || 4500));
  }

  function gaussian() {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function aiTargetAngle(accuracy, isAttacker) {
    // Higher accuracy → tighter around centre. Attack is slightly harder (wider sigma).
    const a = Math.max(0.15, Math.min(0.95, accuracy || 0.5));
    const sigma = (isAttacker ? 48 : 38) * (1 - a) + (isAttacker ? 10 : 7);
    let ang = gaussian() * sigma;
    // Occasional whiff
    if (Math.random() < 0.04 + (1 - a) * 0.08) ang = (Math.random() < 0.5 ? -1 : 1) * (55 + Math.random() * 35);
    return Math.max(-88, Math.min(88, ang));
  }

  /** AI (or future networked opponent) locks WITHOUT a visible needle on this device. */
  function scheduleAiPrivateLock() {
    clearTimeout(aiLockTimer);
    if (!F) return;
    const CH = SAK.CHALLENGE;
    const [d0, d1] = CH.aiLockDelay || [0.3, 0.7]; // snappier: AI locks faster
    const delay = (d0 + Math.random() * (d1 - d0)) * 1000;
    const aiIsAttacker = F.challenge.attacker !== 'player';
    aiLockTimer = setTimeout(() => {
      if (!F || F.turn !== 'challenge' || F.challenge.resolving) return;
      const acc = F.kol.accuracy || 0.5;
      const ang = aiTargetAngle(aiIsAttacker ? acc : acc * 0.95, aiIsAttacker);
      lockOpponentPrivate(ang);
    }, delay);
  }

  function lockOpponentPrivate(forcedAngle) {
    if (!F || F.turn !== 'challenge' || F.challenge.resolving) return;
    const C = F.challenge;
    const aiSide = C.localSide === 'atk' ? 'def' : 'atk';
    if (C.locks[aiSide]) return;
    // Chain PvP: wait for the real opponent's lock via Supabase (no AI)
    const isChainPvp = F.opts && F.opts.chainChallenge && SAK.PvpSync;
    if (isChainPvp) {
      const challengeAddr = F.opts.chainChallenge;
      const roundNum = C.round;
      const myRole = C.localSide;
      setWaitUI(true, 'WAITING FOR OPPONENT…');
      // v2: websocket realtime — fires the instant the opponent's lock lands
      SAK.PvpSync.subscribeToRound(challengeAddr, roundNum, myRole,
        (atkLock, defLock) => {
          // Reconstruct zone objects from IDs
          const zoneById = id => SAK.METER.zones.find(z => z.id === id) || SAK.METER.zones[SAK.METER.zones.length - 1];
          C.locks.atk = { zone: zoneById(atkLock.zone), angle: atkLock.angle || 0, dist: atkLock.dist, already: false };
          C.locks.def = { zone: zoneById(defLock.zone), angle: defLock.angle || 0, dist: defLock.dist, already: false };
          if (C.locks[C.localSide]) {
            setWaitUI(true, 'OPPONENT LOCKED · REVEALING…');
            resolveChallengeRound();
          }
        },
        () => {
          // Timeout: opponent didn't lock in 30s, use a miss
          toast('Opponent timed out — round forfeited', 2600);
          const missZone = SAK.METER.zones.find(z => z.id === 'miss');
          C.locks[aiSide] = { zone: missZone, angle: 90, dist: 90, already: false };
          if (C.locks[C.localSide]) {
            setWaitUI(true, 'OPPONENT TIMED OUT · REVEALING…');
            resolveChallengeRound();
          }
        }
      );
      return;
    }
    // Non-chain (vs AI): use AI simulation
    C.locks[aiSide] = makeLockResult(forcedAngle);
    // Never reveal opponent needle — only a private status ping if local already locked
    if (C.locks[C.localSide]) {
      setWaitUI(true, 'OPPONENT LOCKED · REVEALING…');
      resolveChallengeRound();
    }
  }

  function lockLocal(fromTimeout, forcedAngle) {
    if (!F || F.turn !== 'challenge' || F.challenge.resolving) return;
    const C = F.challenge;
    const side = C.localSide;
    if (C.locks[side]) return;
    let result;
    if (fromTimeout && forcedAngle != null) {
      result = MeterLocal.forceLock(forcedAngle);
    } else {
      result = MeterLocal.lock();
    }
    if (result.already) return;
    C.locks[side] = result;
    $('#panel-local').classList.add('locked');
    $('#hint-local').classList.add('dim');
    A.click();
    haptic(18);

    // Chain PvP: submit my lock to Supabase for the opponent to see
    const isChainPvp = F.opts && F.opts.chainChallenge && SAK.PvpSync;
    if (isChainPvp) {
      const challengeAddr = F.opts.chainChallenge;
      const roundNum = C.round;
      // Determine attacker/defender wallets for this round
      const playerIsAtk = C.attacker === 'player';
      const attackerWallet = playerIsAtk ? W.address : F.opts.chainOpponentWallet;
      const defenderWallet = playerIsAtk ? F.opts.chainOpponentWallet : W.address;
      SAK.PvpSync.submitLock(challengeAddr, roundNum, W.address, side,
        { dist: result.dist, zone: result.zone.id, angle: result.angle },
        attackerWallet, defenderWallet);
    }

    const aiSide = side === 'atk' ? 'def' : 'atk';
    if (C.locks[aiSide]) {
      setWaitUI(true, 'BOTH LOCKED · REVEALING…');
      resolveChallengeRound();
    } else if (isChainPvp) {
      // Chain PvP: trigger the opponent poll (don't use AI)
      setWaitUI(true, 'LOCKED · WAITING FOR OPPONENT…');
      lockOpponentPrivate();
    } else {
      setWaitUI(true, 'LOCKED · OPPONENT LOCKING PRIVATELY…');
    }
  }


  const REVEAL_MS = 800; // 0.8s: visible but doesn't drag; tap to skip (shortened from 2000, LT 2026-10-24)

  function hideLockReveal() {
    if (revealDismiss) {
      const r = revealDismiss;
      revealDismiss = null;
      try { r(); } catch (_) {}
    }
    const el = $('#reveal-panel');
    if (el) el.classList.add('hidden');
    $('#private-meter').classList.remove('revealing');
  }

  /**
   * Inline reveal after BOTH sides locked: the meter panel swaps (same footprint)
   * into a compact YOU vs THEM dial + degrees off centre + round result.
   * Resolves on tap / Space / Enter, or automatically after REVEAL_MS.
   */
  function showLockReveal(playerWonRound) {
    return new Promise(resolve => {
      const C = F && F.challenge;
      const el = $('#reveal-panel');
      if (!C || !C.locks.atk || !C.locks.def || !el) { resolve(); return; }
      if (revealDismiss) { try { revealDismiss(); } catch (_) {} }

      const localIsAtk = C.localSide === 'atk';
      const youLock = C.locks[C.localSide];
      const themLock = C.locks[localIsAtk ? 'def' : 'atk'];
      const tie = youLock.dist === themLock.dist;
      const attackerEdge = SAK.CHALLENGE.tieBreak !== 'defender';
      const youWin = !!playerWonRound;

      const fmtDeg = lock => {
        const side = lock.angle < -0.5 ? ' L' : (lock.angle > 0.5 ? ' R' : '');
        return `${lock.dist.toFixed(0)}°${side}`;
      };
      $('#rv-result').textContent = youWin ? 'YOU WIN THE ROUND' : 'THEY WIN THE ROUND';
      $('#rv-you-deg').textContent = fmtDeg(youLock);
      $('#rv-them-deg').textContent = fmtDeg(themLock);
      $('#rv-them-name').textContent = ((F.kol && F.kol.name) || 'THEM').toUpperCase();
      $('#rv-you').classList.toggle('closer', youWin);
      $('#rv-them').classList.toggle('closer', !youWin);
      $('#rv-note').textContent = tie
        ? `tie ${youLock.dist.toFixed(0)}° · ${attackerEdge ? 'attacker' : 'defender'} wins ties · tap to continue`
        : `${Math.abs(youLock.dist - themLock.dist).toFixed(1)}° closer to ★ · tap to continue`;
      el.classList.toggle('you-win', youWin);
      el.classList.toggle('them-win', !youWin);

      if (!RevealDial) RevealDial = SAK.createRevealDial($('#rv-dial'));
      RevealDial.set(youLock.angle, themLock.angle, youWin);

      // Restart the auto-continue bar + entry animation
      const bar = $('#rv-timer-bar');
      bar.style.setProperty('--rv-ms', REVEAL_MS + 'ms');
      bar.classList.remove('run');
      el.classList.add('hidden');
      void el.offsetWidth;
      $('#private-meter').classList.add('revealing');
      el.classList.remove('hidden');
      bar.classList.add('run');
      A.click();
      haptic(12);

      const shownAt = performance.now();
      let settled = false, autoT = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(autoT);
        if (revealDismiss === finish) revealDismiss = null;
        el.removeEventListener('click', onTap);
        el.classList.add('hidden');
        bar.classList.remove('run');
        $('#private-meter').classList.remove('revealing');
        resolve();
      };
      // Ignore the tail of the lock tap that may land on the freshly swapped panel
      const onTap = e => { e.preventDefault(); if (performance.now() - shownAt > 250) finish(); };
      revealDismiss = finish;
      el.addEventListener('click', onTap);
      autoT = setTimeout(finish, REVEAL_MS);
    });
  }

  async function resolveChallengeRound() {
    if (!F || F.challenge.resolving) return;
    // Stop any active round poll
    if (SAK.PvpSync) { SAK.PvpSync.stopRoundPoll(); SAK.PvpSync.unsubscribeRound(); }
    F.challenge.resolving = true;
    F.turn = 'busy';
    clearTimeout(aiLockTimer);
    stopMeters();
    setWaitUI(false);
    $('#prompt').classList.add('hidden');

    const C = F.challenge;
    const atk = C.locks.atk, def = C.locks.def;
    const atkDist = atk.dist, defDist = def.dist;
    // Closer to centre wins. Tie → attacker edge (documented).
    let attackerWins;
    if (atkDist < defDist) attackerWins = true;
    else if (defDist < atkDist) attackerWins = false;
    else attackerWins = (SAK.CHALLENGE.tieBreak !== 'defender'); // default attacker

    const playerIsAtk = C.attacker === 'player';
    const playerWonRound = playerIsAtk ? attackerWins : !attackerWins;

    // Power-up bookkeeping on player-attack rounds
    let fire = false, rage = false, helmet = false;
    if (playerIsAtk) {
      // Golden Fist is only spent when the slap LANDS (stays armed if braced)
      fire = F.fireArmed && attackerWins;
      if (fire) F.fireArmed = false;
      rage = F.pu.rage > 0;
      if (rage) { F.pu.rage--; if (!F.pu.rage && Scene) Scene.setRage(false); }
    } else if (attackerWins && F.pu.helmet > 0) {
      // Helmet soaks the next 2 slaps that land on you (-50% dmg each)
      helmet = true;
      F.pu.helmet--;
      if (!F.pu.helmet && Scene) Scene.setHelmet(false);
    }
    renderPowerups();

    // Real damage (Power upgrade, Rage, Helmet, Golden Fist). Round wins still decide the match.
    let grade = attackerWins ? atk.zone : def.zone;
    // Golden Fist never whiffs: a landed fist slap grades at least SOLID
    if (fire && grade.mult < 1) grade = SAK.METER.zones.find(z => z.id === 'good') || grade;
    const basePow = playerIsAtk ? playerPower() : F.kol.power;
    const dmg = Math.round(basePow * Math.max(0.25, grade.mult) * (fire ? SAK.POWERUPS.fist.mult : 1) * (rage ? SAK.POWERUPS.rage.damageMult : 1) * (helmet ? SAK.POWERUPS.helmet.damageMult : 1));
    if (attackerWins) {
      if (playerIsAtk) {
        F.duel.p = dmg; F.hits++; F.maxHit = Math.max(F.maxHit, dmg); if (grade.id === 'perfect') F.perfects++;
        // Never below 1 HP until the deciding round KO sets 0
        F.kHp = Math.max(1, F.kHp - dmg);
      } else {
        F.duel.k = dmg;
        F.pHp = Math.max(1, F.pHp - dmg);
      }
      renderHp();
    } else {
      // defender won — record a small "brace" value
      if (playerIsAtk) F.duel.k = Math.round(dmg * 0.6);
      else { F.duel.p = Math.round(dmg * 0.6); F.hits++; }
    }

    // Scoreboard (+ consecutive-win streak for sweep KOs)
    if (playerWonRound) { C.pWins++; C.pStreak = (C.pStreak || 0) + 1; C.kStreak = 0; }
    else { C.kWins++; C.kStreak = (C.kStreak || 0) + 1; C.pStreak = 0; }
    renderRoundScore();

    // Reveal WHERE they locked (private until both locked) — YOU vs THEM dial
    await showLockReveal(playerWonRound);

    const winnerName = playerWonRound ? 'YOU' : F.kol.name;
    banner(
      playerWonRound ? pick(SAK.COPY.roundWinBanners) : pick(SAK.COPY.roundLoseBanners).replace('{k}', winnerName),
      playerWonRound ? '#39ff88' : '#ff3b5c',
      900
    );

    // Play slap animation: landed hit, or miss/whiff so the defender dodges/blocks (not a fake hit-react)
    // Brace rule (LT 2026-10-13): dodge ONLY when attacker hits red (miss).
    // Orange/yellow/green always land on the face, even with brace advantage —
    // orange = weak head-shake, yellow = head whip, green = full boggle.
    const slapWho = C.attacker === 'player' ? 'player' : 'kol';
    const atkZoneId = atk.zone.id;
    let slapGrade, slapLands;
    if (attackerWins) {
      slapGrade = grade.id === 'miss' ? 'weak' : grade.id;
      slapLands = true;
    } else {
      slapGrade = atkZoneId; // 'miss' → dodge; 'weak'/'good'/'perfect' → slap lands
      slapLands = atkZoneId !== 'miss';
    }
    const doImpact = () => {
      if (slapLands) {
        A.slap(grade.mult * (fire ? 1.4 : 1));
        hapticSlap(slapGrade, fire, atk.dist);
        if (fire) flash('#ffb000'); else if (grade.id === 'perfect') flash('#39ff88');
        else flash('#ffe23d');
        const target = slapWho === 'player' ? 'k' : 'p';
        const pk = $(`#${target}-portrait`);
        pk.classList.remove('hit'); void pk.offsetWidth; pk.classList.add('hit');
        if (target === 'k') pk.innerHTML = SAK.avatarSVG(F.kol.look, { blush: true, dmg: dmgLevel('kol') });
        else pk.innerHTML = SAK.avatarSVG(playerLook(), { blush: true, dmg: dmgLevel('player') });
        if (playerIsAtk && grade.id === 'perfect' && Math.random() < 0.5) sayPlayer(playerPhrase());
        else if (playerIsAtk && Math.random() < 0.45) {
          // Tier-matched trash talk: cocky for light, harsh for heavy/perfect
          const t = slapGrade;
          if ((t === 'light' || t === 'weak') && Math.random() < 0.6) sayPlayer(pick(SAK.COPY.lightSlapTaunts));
          else if ((t === 'heavy' || t === 'perfect') && Math.random() < 0.6) sayPlayer(pick(SAK.COPY.heavySlapTaunts));
          else sayPlayer(pick(SAK.COPY.attackLines));
        }
        else if (!playerIsAtk && Math.random() < 0.5) {
          const t = slapGrade;
          if ((t === 'light' || t === 'weak') && Math.random() < 0.6) say(pick(SAK.COPY.lightSlapTaunts));
          else if ((t === 'heavy' || t === 'perfect') && Math.random() < 0.6) say(pick(SAK.COPY.heavySlapTaunts));
          else say(pick(Math.random() < 0.5 ? F.kol.taunts : SAK.COPY.smackReactions));
        }
      } else {
        A.brace();
        haptic(25);
        flash('#2ee66b');
        if (playerWonRound) sayPlayer('BRACED TO THE MOON 🛡'); else say('STUFFED. NGMI swing.');
      }
    };

    // Anticipation sway ends the moment a slap starts: it must never add
    // wobble to the wind-up or contact (the scene eases it out over the wind-up).
    if (Scene && Scene.setAnticipate) { Scene.setAnticipate('player', false); Scene.setAnticipate('kol', false); }
    if (Scene) await Scene.slap(slapWho, { grade: slapGrade, fire, dist: attackerWins ? atk.dist : def.dist, windup: 0.20, landed: slapLands, dmg: slapLands ? dmg : 0, onImpact: doImpact }); // V2: dmg -> 3D number (windup trimmed 0.28 -> 0.20, LT 2026-10-24)
    else { await wait(0.35); doImpact(); }
    renderMeterFaces(attackerWins ? (slapWho === 'player' ? 'kol' : 'player') : null); // evolve meter-face damage

    await wait(0.35);

    const matchOver = C.pWins >= C.winsNeeded || C.kWins >= C.winsNeeded;
    if (matchOver) {
      // Deciding round won by bracing: deliver a quick finishing slap from the winner before fly-off
      if (!attackerWins) {
        const finisher = playerWonRound ? 'player' : 'kol';
        const doFin = () => {
          A.slap(1.1);
          hapticSlap('good', false, 12);
          flash('#ffe23d');
          const target = finisher === 'player' ? 'k' : 'p';
          const pk = $(`#${target}-portrait`);
          pk.classList.remove('hit'); void pk.offsetWidth; pk.classList.add('hit');
        };
        if (Scene) await Scene.slap(finisher, { grade: 'good', fire: false, dist: 12, windup: 0.16, landed: true, onImpact: doFin });
        else { await wait(0.25); doFin(); }
        await wait(0.12);
      }
      return knockout(C.pWins >= C.winsNeeded ? 'kol' : 'player');
    }

    await wait(0.25);
    startChallengeRound();
  }

  /* --- power-up rage mid-round meter bump handled in usePowerup ------------ */

  /* --- legacy stubs (brace ring retired) ---------------------------------- */
  function tryBrace() { /* private meter replaced brace ring */ }

  /* --- knockout & results ------------------------------------------------- */
  async function knockout(loser) {
    try {
    F.turn = 'over';
    stopMeters();
    hideLockReveal();
    const promptEl = $('#prompt'); if (promptEl) promptEl.classList.add('hidden');
    const braceEl = $('#brace'); if (braceEl) braceEl.classList.add('hidden');
    if (loser === 'kol') F.kHp = 0; else F.pHp = 0;
    renderHp();
    A.ko(); haptic([60, 40, 120]);
    if (loser === 'kol') $('#k-portrait').innerHTML = SAK.avatarSVG(F.kol.look, { ko: true, wrecked: true, blush: true });
    else $('#p-portrait').innerHTML = SAK.avatarSVG(playerLook(), { ko: true, wrecked: true, blush: true });
    renderMeterFaces(null, loser); // KO face on the meter
    const sweep = loser === 'kol' ? (F.challenge.pStreak || 0) >= 3 : (F.challenge.kStreak || 0) >= 3;
    // Safety: KO animation can never stall the game — catch errors + 8s cap
    const koTimeout = wait(8).then(() => console.warn('[KO] animation timeout, forcing endFight'));
    let ko;
    if (Scene) {
      try {
        const koPromise = Scene.knockout(loser, null, sweep);
        // Catch both sync throws and async rejections — show error in UI for debugging
        ko = Promise.race([
          Promise.resolve(koPromise).catch(e => {
            console.error('[KO] Scene.knockout failed:', e.message);
            try { toast('KO error: ' + e.message, 3000); } catch (te) {}
            return null;
          }),
          koTimeout
        ]);
      } catch (e) {
        console.error('[KO] Scene.knockout threw:', e.message);
        ko = wait(0.5);
      }
    } else {
      ko = wait(1.2);
    }
    if (Scene && loser === 'kol') Scene.coinRain(70);                       // 🪙 coin rain on a win
    banner(loser === 'kol' ? pick(SAK.COPY.koWinBanners) : pick(SAK.COPY.koLoseBanners), loser === 'kol' ? '#39ff88' : '#ff3b5c', 1400);
    await ko;
    F.wasKoWin = (loser === 'kol');
    } catch (e) {
      console.error('[KO] knockout failed:', e.message);
      try { toast('KO failed: ' + e.message, 3000); } catch (te) {}
    }
    endFight(loser === 'kol');
  }

  function endFight(win, draw) {
    // Stop PvP sync heartbeats and round polls
    if (SAK.PvpSync) { SAK.PvpSync.stopFight(); SAK.PvpSync.stopRoundPoll(); SAK.PvpSync.unsubscribeRound(); }
    // Mark chain challenge as completed so the menu badge clears
    if (F && F.opts && F.opts.chainChallenge && SAK.PvpSync) {
      SAK.PvpSync.updateChallengeStatus(F.opts.chainChallenge, 'completed').catch(() => {});
    }
    const k = F.kol, st = S.stats, R = SAK.REWARDS, PR = SAK.POINT_REWARDS;
    // Challenge match: record + resolve on the backend (v1: winner by local result).
    if (F.opts && F.opts.challengeId && W.address) {
      const cid = F.opts.challengeId;
      SAK.Api.recordMatch({
        challenge_id: cid, player_a_wallet: W.address, player_b_wallet: k.pvp ? 'shadow' : k.id,
        rounds: [], winner_wallet: win ? W.address : 'opponent', status: 'complete',
      }).catch(() => {});
      // NOTE: full async PvP resolution (both players' locks compared server-side)
      // lands with the realtime backend. v1 resolves by the local match result.
      SAK.Api.resolveChallenge(cid, win ? W.address : 'opponent').catch(() => {});
    }
    // On-chain escrow: winner settles manually via SETTLE & CLAIM button.
    // No auto-settle — the result card stays until the player acts or closes it.
    // Solo vs house: settle the bet on-chain (resolver signs on devnet).
    if (F.opts && F.opts.soloHouse && !F.opts.soloSettled) {
      F.opts.soloSettled = true;
      const soloBet = F.opts.soloHouse;
      setTimeout(async () => {
        const res = await resolveSoloBet(win, soloBet);
        if (res) F.opts.soloResult = res;
      }, 1500);
    }
    // Free fight (streak reward): no on-chain bet — a win queues a
    // payout for the settlement service; a loss costs nothing.
    if (F.opts && F.opts.freeFight && win && !draw) {
      const credit = F.opts.freeFight;
      const wallet = F.opts.freeFightWallet || W.address;
      setTimeout(async () => {
        if (!wallet) { toast('Connect your wallet so the house can pay your free-fight win', 3000); return; }
        const ok = await SAK.StreakRewards.queuePayout(credit, wallet);
        if (ok) toast('🎁 Free-fight payout queued — it lands automatically', 3000);
        else {
          // Queue failed (table missing / offline): refund the credit
          // rather than eating a reward the player earned.
          if (!Array.isArray(S.freeFights)) S.freeFights = [];
          S.freeFights.unshift(credit); SAK.Storage.save();
          toast('🎁 Payout queue failed — your free fight was refunded', 3000);
        }
      }, 500);
    }
    const modeMult = SAK.MODES[F.mode].ptsMult;
    const boost = V.boost, boostMul = 1 + boost;
    const streakBefore = st.streak;
    st.perfects += F.perfects;
    st.biggestHit = Math.max(st.biggestHit, F.maxHit);

    // ---- match PTS (always: free-to-play, play-to-earn) ----
    const rows = [];
    let pts;
    if (win) {
      const base = k.winPts * modeMult;
      const streakPts = base * PR.streakPct * Math.min(streakBefore, PR.streakCap);
      rows.push(['Bo5 classic win', base]);
      if (F.perfects > 0) rows.push([`Based slaps (${F.perfects}★)`, F.perfects * PR.perPerfect]);
      if (streakPts) rows.push([`Win streak (${streakBefore}🔥)`, streakPts]);
      pts = base + F.perfects * PR.perPerfect + streakPts;
    } else if (draw) {
      rows.push(['Crab market consolation', PR.lossBase * 2]);
      pts = PR.lossBase * 2;
    } else {
      rows.push(['Participation', PR.lossBase]);
      if (F.hits > 0) rows.push([`Rounds won (${F.hits})`, F.hits * PR.perHitLanded]);
      pts = PR.lossBase + F.hits * PR.perHitLanded;
    }
    // Solo Challenge tier bonus: Champion x2 / Pro x1.5 on match PTS (wins only)
    if (win && F.opts && F.opts.soloLobby) {
      const tier = soloTier(k);
      if (tier.mult > 1) { rows.push([`Tier bonus (${tier.name} x${tier.mult})`, pts * (tier.mult - 1)]); pts = pts * tier.mult; }
    }
    if (win && F.glove && F.glove.bonus) { rows.push([`Glove bonus (${F.glove.label} +${Math.round(F.glove.bonus * 100)}%)`, pts * F.glove.bonus]); pts = Math.round(pts * (1 + F.glove.bonus)); }
    if (boost) rows.push([`Vault boost (${V.tier.name} +${Math.round(boost * 100)}%)`, pts * boost]);
    pts = Math.round(pts * boostMul);
    // Round row values once so displayed lines sum exactly to MATCH PTS (remainder on last row)
    {
      let acc = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i === rows.length - 1) rows[i][1] = pts - acc;
        else { const r = Math.round(rows[i][1]); rows[i][1] = r; acc += r; }
      }
    }
    P.add(pts, true);

    // ---- optional PTS bet ----
    let betHtml = '', betTotal = 0;
    if (F.bet) {
      if (win) {
        const base = F.bet * k.payout;
        const perfectBonus = F.bet * R.perfectBonus * Math.min(F.perfects, R.perfectBonusCap);
        const streakBonus = F.bet * R.streakBonus * Math.min(streakBefore, R.streakBonusCap);
        const sub = base + perfectBonus + streakBonus;
        betTotal = Math.round(sub * boostMul);
        P.add(F.bet, false);                 // stake returned (not "earned")
        P.add(betTotal - F.bet, true);       // profit counts towards lifetime PTS
        betHtml = `
          <div class="bd-head">BET</div>
          <div><span>Bet ${fmt(F.bet)} × ${k.payout.toFixed(1)}</span><b>+${fmt(base)}</b></div>
          ${perfectBonus ? `<div><span>Perfect bonus</span><b>+${fmt(perfectBonus)}</b></div>` : ''}
          ${streakBonus ? `<div><span>Streak bonus</span><b>+${fmt(streakBonus)}</b></div>` : ''}
          ${boost ? `<div><span>Vault boost +${Math.round(boost * 100)}%</span><b>+${fmt(sub * boost)}</b></div>` : ''}
          <div class="total"><span>BET PAYOUT</span><span>${ptsHTML('')} ${fmt(betTotal)}</span></div>`;
      } else if (draw) {
        P.add(F.bet, false);
        betHtml = `<div class="bd-head">BET</div><div><span>Draw: bet refunded</span><b>${fmt(F.bet)}</b></div>`;
      } else {
        betHtml = `<div class="bd-head">BET</div><div><span>Bet got rugged</span><b class="neg">-${fmt(F.bet)}</b></div>`;
      }
    }

    // An armed Golden Fist that never landed isn't wasted: return the charge
    if (F.fireArmed) { F.fireArmed = false; S.powerups.fist = Math.min(SAK.POWERUPS.fist.max, (S.powerups.fist || 0) + 1); if (Scene) Scene.setFireArmed(false); }
    if (win) { st.wins++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); S.beaten[k.id] = true; A.win(); }
    else if (!draw) { st.losses++; st.streak = 0; A.lose(); }
    // ---- Solo streak rewards (LT 2026-10-25): wagered Solo only ----
    let streakGrant = null;
    if (F.opts && F.opts.soloHouse && !draw) {
      const sh = F.opts.soloHouse;
      const cur = sh.currency === 'SMACK' ? 'SMACK' : 'SOL';
      const val = cur === 'SMACK' ? (sh.wagerTokens || 0) : parseFloat(sh.wagerSol || 0);
      if (win) {
        st.soloStreak = (st.soloStreak || 0) + 1;
        const n = SAK.StreakRewards.grantFor(st.soloStreak);
        if (n > 0) {
          if (val > 0) {
            streakGrant = { count: n, currency: cur, value: val, streak: st.soloStreak };
            if (!Array.isArray(S.freeFights)) S.freeFights = [];
            for (let i = 0; i < n; i++) S.freeFights.push({ currency: cur, value: val, fromStreak: st.soloStreak, grantedAt: Date.now() });
          }
          if (st.soloStreak === 10) st.soloStreak = 0;
        }
      } else {
        st.soloStreak = 0;
      }
    }
    // Rewards program: achievements + referral bonus (after stats update)
    checkAchievements(win, !!F.wasKoWin);
    checkReferralReward(win);
    SAK.Storage.save();

    // Fight history (player tracker in the profile section, LT 2026-10-23):
    // one row per finished fight across ALL modes — solo house wagers
    // (SOL + SMACK), on-chain PvP, PTS bets and free fights. Payout is
    // the gross amount the winner receives (solo 1.9x; PvP pot minus the
    // 5% fee = 1.9x wager; PTS bet pays betTotal). Fire-and-forget.
    if (!draw && W.address && SAK.Api && SAK.Api.recordFightHistory) {
      try {
        const sh = F.opts && F.opts.soloHouse;
        let fhMode = 'free', fhCurrency = 'FREE', fhWager = 0, fhPayout = 0;
        if (sh) {
          fhMode = 'solo';
          // NOTE: the SOL bet object carries no currency field (only the
          // SMACK one sets currency:'SMACK') — default to SOL, never the
          // raw value (it recorded SOL wagers as currency FREE).
          if (sh.currency === 'SMACK') { fhCurrency = 'SMACK'; fhWager = sh.wagerTokens || 0; fhPayout = win ? Math.floor(fhWager * 0.99 * 1.9) : 0; }
          else { fhCurrency = 'SOL'; fhWager = parseFloat(sh.wagerSol || 0); fhPayout = win ? fhWager * 1.9 : 0; }
        } else if (k.pvp) {
          fhMode = 'pvp'; fhCurrency = 'SOL';
          fhWager = parseFloat((F.opts && F.opts.chainWagerSol) || 0);
          fhPayout = win ? fhWager * 1.9 : 0;
        } else if (F.bet) {
          fhCurrency = 'PTS'; fhWager = F.bet; fhPayout = win ? betTotal : 0;
        }
        const fhc = F.challenge;
        SAK.Api.recordFightHistory({
          wallet: W.address,
          opponent_name: k.name || 'Fighter',
          opponent_wallet: (F.opts && F.opts.chainOpponentWallet) || null,
          mode: fhMode, currency: fhCurrency, wager: fhWager, payout: fhPayout,
          won: !!win, pts: pts || 0,
          score: fhc ? (fhc.pWins + '-' + fhc.kWins) : null,
          ref: (F.opts && (F.opts.chainChallenge || (sh && sh.bet))) || null,
        }).catch(() => {});
      } catch (e) {}
    }

    const C = SAK.COPY, sub = t => esc(t.replace('{k}', k.name).replace('{t}', pick(k.taunts)));
    // Hoisted picks so the shareable card matches the screen exactly
    // (a second pick() would roll a different title/taunt).
    const resTitle = draw ? 'CRAB MARKET 🦀' : win ? pick(C.winTitles) : pick(C.loseTitles);
    const resSub = draw ? `${F.duel.p} vs ${F.duel.k}. Nobody pumped, nobody dumped.`
      : (win ? sub(pick(C.winSubs)) : sub(pick(C.loseSubs)))
        + (F.challenge ? ` · ${F.challenge.pWins}–${F.challenge.kWins} (Bo${F.challenge.bestOf})` : '');
    const resLoseTip = (!win && !draw) ? 'Tip: ride your jerky meter into the ★ — closer than opponent wins the round' : null;
    const resTip = (!F.bet && win && !k.pvp && !draw) ? `💡 Bet PTS next time for x${k.payout.toFixed(1)}. Scared money don't make money.` : null;
    let html = draw
      ? `<div class="result-title" style="color:#ffd23f">${resTitle}</div>
         ${SAK.avatarSVG(k.look)}
         <div class="result-sub">${resSub}</div>`
      : win
      ? `<div class="result-title">${resTitle}</div>
         <div class="result-vs">
           <div class="rv-side"><span class="rv-tag rv-winner">WINNER</span>${SAK.avatarSVG(playerLook())}</div>
           <span class="rv-vs">VS</span>
           <div class="rv-side"><span class="rv-tag rv-loser">LOSER</span>${SAK.avatarSVG(k.look, { ko: true, wrecked: true, blush: true })}</div>
         </div>
         <div class="result-sub">${resSub}</div>`
      : `<div class="result-title">${resTitle}</div>
         <div class="result-vs">
           <div class="rv-side"><span class="rv-tag rv-loser">LOSER</span>${SAK.avatarSVG(playerLook(), { ko: true, wrecked: true, blush: true })}</div>
           <span class="rv-vs">VS</span>
           <div class="rv-side"><span class="rv-tag rv-winner">WINNER</span>${SAK.avatarSVG(k.look)}</div>
         </div>
         <div class="result-sub">${resSub}<br><small>${resLoseTip}</small></div>`;
    html += `<div class="breakdown">
        <div class="bd-head">PLAY-TO-EARN</div>
        ${rows.map(([l, v]) => `<div><span>${l}</span><b>+${fmt(v)}</b></div>`).join('')}
        <div class="total pts-total"><span>MATCH PTS</span><span>${ptsHTML('')} +${fmt(pts)}</span></div>
        ${betHtml}
        ${streakGrant ? `<div class="bd-head" style="margin-top:8px;">🔥 ${streakGrant.streak}-FIGHT WIN STREAK!</div>
        <div><span>${streakGrant.count} FREE FIGHT${streakGrant.count > 1 ? 'S' : ''} EARNED</span><b style="color:#4ade80;">${SAK.StreakRewards.fmtValue(streakGrant.currency, streakGrant.value)}${streakGrant.count > 1 ? ' EACH' : ''}</b></div>` : ''}
        ${F.opts && F.opts.freeFight ? (() => {
          const c = F.opts.freeFight;
          const val = SAK.StreakRewards.fmtValue(c.currency, c.value);
          if (win) return `<div class="bd-head" style="margin-top:8px;">🎁 FREE FIGHT (DEVNET)</div>
            <div><span>Free fight value</span><b>${val}</b></div>
            <div><span>You won</span><b style="color:#4ade80;">+${SAK.StreakRewards.fmtValue(c.currency, SAK.StreakRewards.payoutFor(c))}</b></div>
            <div class="fine" style="font-size:11px;color:#888;">⏳ The house pays this automatically — no wallet step needed</div>`;
          if (!draw) return `<div class="bd-head" style="margin-top:8px;">🎁 FREE FIGHT (DEVNET)</div>
            <div><span>Free fight value</span><b>${val}</b></div>
            <div><span>You lost</span><b>Nothing lost — the fight was free</b></div>`;
          return '';
        })() : ''}
        ${F.opts && F.opts.chainChallenge ? (() => {
          const w = parseFloat(F.opts.chainWagerSol || 0);
          const fee = 0.05;
          if (win) {
            const payout = (w * 2 * (1 - fee)).toFixed(3);
            return `<div class="bd-head" style="margin-top:8px;">⛓ ON-CHAIN WAGER (DEVNET)</div>
              <div><span>Wagered</span><b>${w} SOL</b></div>
              <div><span>You won</span><b style="color:#4ade80;">+${payout} SOL</b></div>
              <div class="fine" style="font-size:11px;color:#888;">5% fee · resolver settles</div>
              <button id="chain-settle-btn" style="display:block;width:100%;padding:12px;margin-top:8px;border:none;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;background:linear-gradient(180deg,#f5c542,#d4a017);color:#000;">💰 SETTLE & CLAIM</button>`;
          } else if (!draw) {
            return `<div class="bd-head" style="margin-top:8px;">⛓ ON-CHAIN WAGER (DEVNET)</div>
              <div><span>Wagered</span><b>${w} SOL</b></div>
              <div><span>You lost</span><b class="neg">-${w} SOL</b></div>`;
          }
          return '';
        })() : ''}
        ${F.opts && F.opts.soloHouse ? (() => {
          const r = F.opts.soloResult;
          if (F.opts.soloHouse.currency === 'SMACK') {
            const wT = F.opts.soloHouse.wagerTokens || 0;
            const burnLine = `<div><span>Burn (1%)</span><b>-${fmtTokAmt(wT * 0.01)} SMACK 🔥</b></div>`;
            if (r && r.won) {
              return `<div class="bd-head" style="margin-top:8px;"><img class="smack-hand" src="assets/hand-icon-sm.png" alt=""> SOLO VS SMACK HOUSE (DEVNET)</div>
                <div><span>Wagered</span><b>${fmtTokAmt(wT)} SMACK</b></div>
                ${burnLine}
                <div><span>You won</span><b style="color:#4ade80;">+${fmtTokAmt(r.payoutTokens || 0)} SMACK</b></div>`;
            } else if (r && !r.won) {
              return `<div class="bd-head" style="margin-top:8px;"><img class="smack-hand" src="assets/hand-icon-sm.png" alt=""> SOLO VS SMACK HOUSE (DEVNET)</div>
                <div><span>Wagered</span><b>${fmtTokAmt(wT)} SMACK</b></div>
                ${burnLine}
                <div><span>You lost</span><b class="neg">-${fmtTokAmt(wT)} SMACK</b></div>`;
            }
            return `<div class="bd-head" style="margin-top:8px;"><img class="smack-hand" src="assets/hand-icon-sm.png" alt=""> SOLO VS SMACK HOUSE (DEVNET)</div>
              <div><span>Wagered</span><b>${fmtTokAmt(wT)} SMACK</b></div>
              ${burnLine}
              <div class="fine" style="font-size:11px;color:#888;">⏳ The house settles this automatically — no wallet step needed</div>`;
          }
          const w = parseFloat(F.opts.soloHouse.wagerSol || 0);
          // SOL skips the 1% burn — only SPL burns
          const burnLine = `<div><span>Burn (1%)</span><b>0 SOL <small style="color:#666;">(SOL skips burn)</small></b></div>`;
          if (r && r.won) {
            return `<div class="bd-head" style="margin-top:8px;">🏠 SOLO VS HOUSE (DEVNET)</div>
              <div><span>Wagered</span><b>${w} SOL</b></div>
              ${burnLine}
              <div><span>You won</span><b style="color:#4ade80;">+${r.payout.toFixed(3)} SOL</b></div>`;
          } else if (r && !r.won) {
            return `<div class="bd-head" style="margin-top:8px;">🏠 SOLO VS HOUSE (DEVNET)</div>
              <div><span>Wagered</span><b>${w} SOL</b></div>
              ${burnLine}
              <div><span>You lost</span><b class="neg">-${w} SOL</b></div>`;
          }
          return `<div class="bd-head" style="margin-top:8px;">🏠 SOLO VS HOUSE (DEVNET)</div>
            <div><span>Wagered</span><b>${w} SOL</b></div>
            ${burnLine}
            <div class="fine" style="font-size:11px;color:#888;">⏳ The house settles this automatically — no wallet step needed</div>`;
        })() : ''}
      </div>`;
    if (resTip) html += `<p class="fine">${resTip}</p>`;
    const total = pts + betTotal;
    setTimeout(() => {
      const sb = $('#chain-settle-btn');
      if (sb) sb.onclick = async () => {
        sb.disabled = true; sb.textContent = 'SETTLING…';
        try {
          if (!F.opts || !F.opts.chainChallenge) throw new Error('No challenge found — try rejoining from the lobby');
          const res = await SAK.SolanaEscrow.resolveChallenge(F.opts.chainChallenge, W.address);
          toast('Winnings claimed! ' + res.signature.slice(0, 12) + '…', 2600);
          sb.textContent = '✅ CLAIMED';
        } catch (e) {
          console.error('[SAK] settle failed', e);
          if (e.code === 'NOT_RESOLVER') {
            const short = (e.resolver || '').slice(0, 4) + '…' + (e.resolver || '').slice(-4);
            toast('Switch to resolver wallet ' + short + ' to settle', 3200);
          }
          else toast('Settle failed: ' + (e.message || e), 3200);
          sb.disabled = false; sb.textContent = '💰 SETTLE & CLAIM';
        }
      };
      const app = appRect(), pp = $('#pts-pill').getBoundingClientRect();
      floatText(pp.left - app.left + 30, pp.bottom - app.top + 30, `+${fmt(total)}`, 'pts-gain');
      A.coin();
    }, 500);

    const list = roster(), idx = list.findIndex(x => x.id === k.id), next = list[idx + 1];
    const reBet = F.bet && P.canAfford(F.bet) ? F.bet : 0;
    const isSoloHouse = !!(F.opts && F.opts.soloHouse);
    html += `<div class="result-btns">
        ${isSoloHouse ? `<div style="display:flex;gap:8px;align-items:stretch;">
          <div style="flex:1 1 58%;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;background:#1a0b3a;border:3px solid var(--ink);border-radius:14px;padding:6px 8px;box-sizing:border-box;">
            ${F.opts.soloHouse.currency === 'SMACK'
              ? `<input id="r-solo-amount" type="text" inputmode="numeric" value="${(F.opts.soloHouse.wagerTokens || 1000).toLocaleString('en-US')}" style="width:100%;min-width:0;background:transparent;border:none;outline:none;color:#fff;font:inherit;font-size:20px;font-weight:800;text-align:center;" />`
              : `<input id="r-solo-amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="${parseFloat(F.opts.soloHouse.wagerSol || 0.05)}" style="width:100%;min-width:0;background:transparent;border:none;outline:none;color:#fff;font:inherit;font-size:20px;font-weight:800;text-align:center;" />`}
            <span style="font-weight:800;font-size:11px;letter-spacing:2px;color:#f5c542;white-space:nowrap;">${F.opts.soloHouse.currency === 'SMACK' ? 'SMACK' : 'SOL'}</span>
          </div>
          <button class="btn btn-yellow" id="r-solo-again" style="flex:1 1 42%;min-width:0;">🖐 SMACK AGAIN</button>
        </div>` : k.pvp ? '' : `<button class="btn btn-yellow" id="r-rematch">↻ RUN IT BACK${reBet ? ` · BET ${fmt(reBet)}` : ' (FREE)'}</button>`}
        ${win && next && !k.pvp && !(F.opts && F.opts.soloLobby) ? `<button class="btn btn-red" id="r-next">APE INTO ${esc(next.name)} →</button>` : ''}
        <div class="row">
          <button class="btn btn-purple" id="r-card">📤 FIGHT CARD</button>
          <button class="btn btn-purple" id="r-xpost">𝕏 POST TO X</button>
          <button class="btn btn-purple" id="r-pick">${k.pvp ? 'PVP LOBBY' : 'PICK KOL'}</button>
          <button class="btn btn-grey" id="r-menu">TOUCH GRASS</button>
        </div>
      </div>`;
    const card = $('#result-card');
    card.className = 'result-card ' + (win ? 'win' : 'lose');
    card.innerHTML = html;
    show('result');
    if (streakGrant) setTimeout(() => SAK.StreakRewards.showCelebration(streakGrant), 1200);
    const rematchBtn = $('#r-rematch');
    if (rematchBtn) rematchBtn.onclick = () => startFight(k, reBet, { mode: F.mode, pvp: F.opts && F.opts.pvp });
    const againBtn = $('#r-solo-again');
    if (againBtn) {
      const amtEl0 = $('#r-solo-amount');
      if (amtEl0) {
        amtEl0.addEventListener('focus', () => amtEl0.select());
        // SMACK amounts are comma-formatted text (1,000 / 100,000) so the
        // full number stays readable in the box; regroup on blur.
        if (F.opts.soloHouse.currency === 'SMACK') amtEl0.addEventListener('blur', () => {
          const n = parseFloat(String(amtEl0.value).replace(/[^0-9.]/g, ''));
          if (n > 0) amtEl0.value = Math.floor(n).toLocaleString('en-US');
        });
      }
      againBtn.onclick = async () => {
        if (!W.isConnected) { toast('Connect your wallet first \u{1F45B}', 2200); openWalletModal(); return; }
        if (!SAK.SolanaHouse) { toast('House module not loaded', 2000); return; }
        const amtEl = $('#r-solo-amount');
        const amt = amtEl ? parseFloat(String(amtEl.value).replace(/,/g, '')) : NaN;
        if (!amt || !(amt > 0)) { toast('Enter a bet amount first', 2200); return; }
        againBtn.disabled = true; const oldLabel = againBtn.textContent; againBtn.textContent = 'PLACING BET\u2026';
        if (F.opts.soloHouse.currency === 'SMACK') {
          const TH = SAK.SolanaTokenHouse;
          const fail = m => { toast(m, 3000); againBtn.disabled = false; againBtn.textContent = oldLabel; };
          if (!TH) { fail('Token house module not loaded'); return; }
          await refreshTokenHouseMax();
          if (!tokenHouseReady) { fail('The SMACK house is not set up yet.'); return; }
          const base = Math.round(amt * 1e6);
          if (tokenHouseMaxBase !== null && base > tokenHouseMaxBase) { fail('That bet is bigger than the SMACK house can cover — max is ' + fmtTok(tokenHouseMaxBase) + ' SMACK.'); return; }
          try {
            const bal = await TH.getTokenBalance(W.address);
            if (bal < BigInt(base)) { fail('Not enough SMACK — you have ' + fmtTok(Number(bal)) + '.'); return; }
          } catch (e) {}
          try {
            const res = await TH.placeBet(base);
            activeSoloBet = { bet: res.bet, nonce: res.nonce, currency: 'SMACK', wagerTokens: Math.floor(amt) };
            toast('Bet locked — ' + Math.floor(amt).toLocaleString('en-US') + ' SMACK vs house \u{1F3E0}', 2400);
            startFight(k, 0, { mode: F.mode, soloHouse: activeSoloBet, soloLobby: 'wager' });
          } catch (e) {
            toast(friendlyTokenError(e, 'bet'), 2800);
            againBtn.disabled = false; againBtn.textContent = oldLabel;
          }
          return;
        }
        await refreshHouseMax();
        if (houseMaxBetLamports !== null && Math.round(amt * 1e9) > houseMaxBetLamports) {
          toast('That bet is bigger than the house can cover right now \u2014 max bet is ' + fmtSol(houseMaxBetLamports) + ' SOL.', 3000);
          againBtn.disabled = false; againBtn.textContent = oldLabel;
          return;
        }
        try {
          const res = await SAK.SolanaHouse.placeBet(Math.round(amt * 1e9));
          activeSoloBet = { bet: res.bet, nonce: res.nonce, wagerSol: amt };
          toast('Bet locked \u2014 ' + amt + ' SOL vs house \u{1F3E0}', 2400);
          startFight(k, 0, { mode: F.mode, soloHouse: activeSoloBet, soloLobby: 'wager' });
        } catch (e) {
          toast(friendlyHouseError(e, 'bet'), 2800);
          againBtn.disabled = false; againBtn.textContent = oldLabel;
        }
      };
    }
    // Shared payload for the shareable result card (both share buttons).
    // Rows/pts are raw numbers (the card formats them); bet/wager lines
    // arrive pre-formatted, mirroring the screen's breakdown exactly.
    // The wager slot holds at most one block, same as the screen.
    function cardData(oppName) {
      let wager = null;
      if (F.opts && F.opts.soloHouse) {
        const sh = F.opts.soloHouse, r = F.opts.soloResult;
        if (sh.currency === 'SMACK') {
          const wT = sh.wagerTokens || 0;
          wager = { head: 'SOLO VS SMACK HOUSE (DEVNET)', hand: true,
            lines: [['Wagered', fmtTokAmt(wT) + ' SMACK'], ['Burn (1%)', '−' + fmtTokAmt(wT * 0.01) + ' SMACK 🔥']], fine: null };
          if (r && r.won) wager.lines.push(['You won', '+' + fmtTokAmt(r.payoutTokens || 0) + ' SMACK', 'win']);
          else if (r && !r.won) wager.lines.push(['You lost', '−' + fmtTokAmt(wT) + ' SMACK', 'neg']);
          else wager.fine = '⏳ The house settles this automatically — no wallet step needed';
        } else {
          const w = parseFloat(sh.wagerSol || 0);
          wager = { head: '🏠 SOLO VS HOUSE (DEVNET)',
            lines: [['Wagered', w + ' SOL'], ['Burn (1%)', '0 SOL (SOL skips burn)']], fine: null };
          if (r && r.won) wager.lines.push(['You won', '+' + r.payout.toFixed(3) + ' SOL', 'win']);
          else if (r && !r.won) wager.lines.push(['You lost', '−' + w + ' SOL', 'neg']);
          else wager.fine = '⏳ The house settles this automatically — no wallet step needed';
        }
      } else if (F.opts && F.opts.chainChallenge) {
        const w = parseFloat(F.opts.chainWagerSol || 0);
        wager = { head: '⛓ ON-CHAIN WAGER (DEVNET)', lines: [['Wagered', w + ' SOL']], fine: '5% fee · resolver settles' };
        if (win) wager.lines.push(['You won', '+' + (w * 2 * 0.95).toFixed(3) + ' SOL', 'win']);
        else if (!draw) wager.lines.push(['You lost', '−' + w + ' SOL', 'neg']);
      } else if (F.opts && F.opts.freeFight) {
        const c = F.opts.freeFight;
        wager = { head: '🎁 FREE FIGHT (DEVNET)',
          lines: [['Free fight value', SAK.StreakRewards.fmtValue(c.currency, c.value)]], fine: null };
        if (win) wager.lines.push(['You won', '+' + SAK.StreakRewards.fmtValue(c.currency, SAK.StreakRewards.payoutFor(c)), 'win']);
        else if (!draw) wager.lines.push(['You lost', 'Nothing lost — the fight was free']);
      }
      let bet = null;
      if (F.bet) {
        if (win) {
          const base = F.bet * k.payout;
          const perfectBonus = F.bet * R.perfectBonus * Math.min(F.perfects, R.perfectBonusCap);
          const streakBonus = F.bet * R.streakBonus * Math.min(streakBefore, R.streakBonusCap);
          const sub2 = base + perfectBonus + streakBonus;
          bet = { lines: [[`Bet ${fmt(F.bet)} × ${k.payout.toFixed(1)}`, '+' + fmt(base)]], total: fmt(betTotal) };
          if (perfectBonus) bet.lines.push(['Perfect bonus', '+' + fmt(perfectBonus)]);
          if (streakBonus) bet.lines.push(['Streak bonus', '+' + fmt(streakBonus)]);
          if (boost) bet.lines.push([`Vault boost +${Math.round(boost * 100)}%`, '+' + fmt(sub2 * boost)]);
        } else if (draw) bet = { lines: [['Draw: bet refunded', fmt(F.bet)]], total: null };
        else bet = { lines: [['Bet got rugged', '−' + fmt(F.bet), 'neg']], total: null };
      }
      return { win, draw, title: resTitle, sub: resSub, loseTip: resLoseTip, tip: resTip,
        playerName: profile().name, playerLook: playerLook(), kolName: oppName, kolLook: k.look,
        rows, pts, wager, bet };
    }
    $('#r-card').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; const old = btn.textContent; btn.textContent = 'MAKING CARD…';
      try {
        // For on-chain PvP, use the opponent's real fighter name instead of wallet preview
        let oppName = k.name;
        const oppWallet = F.opts && F.opts.chainOpponentWallet;
        if (oppWallet && SAK.Api && SAK.Api.getProfile) {
          try {
            const oppProfile = await SAK.Api.getProfile(oppWallet);
            if (oppProfile && oppProfile.name) oppName = oppProfile.name;
          } catch (e) {}
        }
        const svg = SAK.FightCard.buildResultCard(cardData(oppName));
        const text = win
          ? `I just sent ${k.name} to ZERO in Smack-a-KOL 🥊`
          : `I just got REKT in Smack-a-KOL 😭 Run it back?`;
        const how = await SAK.FightCard.share(svg, text);
        btn.textContent = how === 'shared' ? 'SHARED ✓' : 'SAVED ✓';
      } catch (err) { btn.textContent = 'FAILED — TRY AGAIN'; }
      setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 1800);
    };
    $('#r-xpost').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; const old = btn.textContent; btn.textContent = 'POSTING…';
      try {
        let oppName2 = k.name;
        const oppWallet2 = F.opts && F.opts.chainOpponentWallet;
        if (oppWallet2 && SAK.Api && SAK.Api.getProfile) {
          try {
            const oppProfile2 = await SAK.Api.getProfile(oppWallet2);
            if (oppProfile2 && oppProfile2.name) oppName2 = oppProfile2.name;
          } catch (e) {}
        }
        const svg = SAK.FightCard.buildResultCard(cardData(oppName2));
        const xh = (S.profile && S.profile.x_handle) ? ` @${S.profile.x_handle.replace(/^@/, '')}` : '';
        const text = win
          ? `I${xh} just sent ${k.name} to ZERO in Smack-a-KOL 🥊`
          : `I${xh} just got REKT in Smack-a-KOL 😭 Run it back?`;
        await SAK.FightCard.shareToX(svg, text);
        btn.textContent = 'X OPENED — ATTACH CARD ✓';
        toast('Card downloaded — attach it to your X post', 3000);
      } catch (err) { btn.textContent = 'FAILED — TRY AGAIN'; }
      setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 2500);
    };
    if ($('#r-next')) $('#r-next').onclick = () => { selectedBet = 0; openPicker(idx + 1); };
    $('#r-pick').onclick = () => {
      if (F.opts && F.opts.soloLobby) { openSolo(); return; }
      if (k.pvp) { show('menu'); menuScene(); openPvp(); } else openPicker();
    };
    $('#r-menu').onclick = () => { show('menu'); menuScene(); };
    F.turn = 'done';
    A.stopMusic(); // battle music ends with the fight
    // newly unlocked UGC slot?
    const slotsNow = ugcSlotsUnlocked();
    if (slotsNow > lastSlots) setTimeout(() => toast(`✍ New KOL submission slot unlocked! (${slotsNow})`, 2600), 1200);
    lastSlots = slotsNow;
  }


  /* ================================================================ SHOP */
  function renderShopStats() {
    const el = $('#shop-stats');
    if (!el) return;
    el.innerHTML = `<div><small>MAX HP</small><b>${playerMaxHp()}</b></div>
      <div><small>POWER</small><b>${playerPower()}</b></div>
      <div><small>❤ Lv</small><b>${S.upgrades.health}</b></div>
      <div><small>✊ Lv</small><b>${S.upgrades.power}</b></div>`;
    const sub = $('#shop-sub');
    if (sub) sub.textContent = `❤ Lv${S.upgrades.health} · ✊ Lv${S.upgrades.power}`;
  }
  function openShop() {
    A.unlock(); A.click();
    renderUpgrades(); renderGloves();
    renderShopStats();
    $('#modal-shop').classList.remove('hidden');
  }
  $('#btn-shop').addEventListener('click', openShop);
  $('#btn-shop-pick').addEventListener('click', openShop);
  const shopSoloBtn = $('#btn-shop-solo'); if (shopSoloBtn) shopSoloBtn.addEventListener('click', openShop);
  $('#btn-refer').addEventListener('click', async () => {
    A.click();
    const link = myReferralLink();
    try {
      await navigator.clipboard.writeText(link);
      toast('🎁 Referral link copied! Share it on X — you both earn 250 PTS', 2800);
    } catch (e) {
      prompt('Copy your referral link:', link);
    }
  });

  /* ================================================================= VAULT */
  let vaultAmt = 500, vaultTimer = 0;
  function openVault() {
    renderVault();
    $('#modal-vault').classList.remove('hidden');
    clearInterval(vaultTimer);
    vaultTimer = setInterval(() => {
      if ($('#modal-vault').classList.contains('hidden')) return clearInterval(vaultTimer);
      $('#v-yield').textContent = V.pending.toFixed(2);
    }, 200);
  }
  function renderVault() {
    const C = SAK.STAKING, t = V.tier, nx = V.nextTier();
    $('#v-staked').textContent = fmt(V.staked);
    $('#v-apr').textContent = Math.round(C.apr * 100) + '%';
    $('#v-yield').textContent = V.pending.toFixed(2);
    $('#v-tier').innerHTML = `TIER: <span style="color:${t.color}">${t.name}</span> · +${Math.round(t.boost * 100)}% rewards`
      + (nx ? `<br><small style="font-size:12px;opacity:.8">Stake ${fmt(nx.min - V.staked)} more for ${nx.name} (+${Math.round(nx.boost * 100)}%)</small>` : '');
    $('#v-tiers').innerHTML = C.tiers.slice(1).map(x => `<div class="${V.staked >= x.min ? 'on' : ''}" style="background:${x.color}">${x.name}<br>${x.min >= 1000 ? x.min / 1000 + 'K' : x.min}<br>+${Math.round(x.boost * 100)}%</div>`).join('');
    const opts = [100, 500, 1000, 5000];
    $('#v-amounts').innerHTML = opts.map(n => `<button data-amt="${n}" class="${n === vaultAmt ? 'selected' : ''}">${fmt(n)}</button>`).join('')
      + `<button data-amt="all" class="${vaultAmt === 'all' ? 'selected' : ''}">MAX</button>`;
    $$('#v-amounts button').forEach(b => b.onclick = () => { vaultAmt = b.dataset.amt === 'all' ? 'all' : +b.dataset.amt; A.click(); renderVault(); });
    const stakeN = vaultAmt === 'all' ? S.points : vaultAmt, unN = vaultAmt === 'all' ? V.staked : Math.min(vaultAmt, V.staked);
    $('#v-stake').textContent = `STAKE ${fmt(stakeN)}`;
    $('#v-stake').disabled = stakeN <= 0 || !P.canAfford(stakeN);
    $('#v-unstake').textContent = `UNSTAKE ${fmt(unN)}`;
    $('#v-unstake').disabled = V.staked <= 0;
    $('#v-note').textContent = `Spendable: ${fmt(S.points)} PTS. Yield is demo-accelerated (1 real min ≈ ${C.demoTimeScale / 1440} day). Staked PTS can't be spent or bet.`;
  }
  $('#v-stake').addEventListener('click', () => {
    const n = vaultAmt === 'all' ? S.points : vaultAmt;
    if (V.stake(n)) { A.coin(); toast(`Staked ${fmt(n)} PTS · tier ${V.tier.name}`); }
    renderVault(); renderMenu();
  });
  $('#v-unstake').addEventListener('click', () => {
    const n = vaultAmt === 'all' ? V.staked : Math.min(vaultAmt, V.staked);
    if (V.unstake(n)) { A.coin(); toast(`Unstaked ${fmt(n)} PTS`); }
    renderVault(); renderMenu();
  });
  $('#v-claim').addEventListener('click', () => {
    const got = V.claim();
    if (got) { A.coin(); toast(`Claimed ${fmt(got)} PTS yield`); } else toast('Not enough yield yet (min 1 PTS)');
    renderVault();
  });

  /* =========================================================== LEADERBOARD */
  let lbTab = 'global';
  function openLeaderboard(tab) {
    A.unlock(); A.click();
    lbTab = tab || lbTab;
    const me = { name: profile().name + ' (you)', pts: S.stats.lifetimePts, wins: S.stats.wins };
    const list = lbTab === 'global' ? SAK.Leaderboard.global(me) : SAK.Leaderboard.friends(me);
    $$('.lb-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === lbTab));
    $('#lb-note').textContent = lbTab === 'global'
      ? 'Ranked by lifetime PTS earned. Local prototype board (simulated degens).'
      : 'Friends list is a stub for the soft launch. Invite link = this page.';
    $('#lb-invite').classList.toggle('hidden', lbTab !== 'friends');
    const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '#' + r;
    $('#lb-list').innerHTML = list.map(e => `
      <div class="lb-row ${e.me ? 'me' : ''}">
        <span class="rk">${medal(e.rank)}</span>
        <span>${lbTab === 'friends' ? `<span class="dot ${e.online ? 'on' : ''}"></span>` : ''}${e.me ? `<span class="lb-av">${SAK.avatarSVG(playerLook())}</span>` : ''}${esc(e.name)}<small>${e.wins} wins</small></span>
        <span class="pt">${ptsHTML()}${fmt(e.pts)}</span>
      </div>`).join('');
    $('#modal-lb').classList.remove('hidden');
    const meRow = $('#lb-list .lb-row.me'); if (meRow) meRow.scrollIntoView({ block: 'center' });
  }
  $('#btn-leaderboard').addEventListener('click', () => openLeaderboard());
  $$('.lb-tabs button').forEach(b => b.addEventListener('click', () => openLeaderboard(b.dataset.tab)));
  $('#lb-invite').addEventListener('click', async () => {
    const link = SAK.Leaderboard.inviteLink();
    try { await navigator.clipboard.writeText(link); toast('📨 Invite link copied. Go recruit some degens.'); }
    catch (e) { prompt('Copy this invite link:', link); }
  });

  /* ============================================================ PVP (stub) */
  // Lists fake online players; "challenging" anyone (or Quick Match) shows a
  // searching state and then falls back to an AI stand-in. See matchmaking.js.
  let pvpMode = 'classic', pvpWager = 0, pvpTimer = 0, pvpT0 = 0;
  let pendingBarTimer = null;
  function updatePendingBar() {
    const bar = $('#pvp-pending-bar');
    if (!bar) return;
    // Show if we have an active challenge (from this session or from polling)
    const ch = activeChainChallenge;
    if (ch && ch.address) {
      bar.classList.remove('hidden');
      $('#ppb-wager').textContent = `💰 ${ch.wagerSol} SOL`;
      $('#ppb-addr').textContent = ch.address.slice(0, 4) + '…' + ch.address.slice(-4);
      // Countdown timer
      if (pendingBarTimer) clearInterval(pendingBarTimer);
      const updateTimer = () => {
        // TODO: fetch actual expiry from chain; estimate from creation
        $('#ppb-timer').textContent = '⏳ Awaiting opponent…';
      };
      updateTimer();
      pendingBarTimer = setInterval(updateTimer, 30000);
      // Wire buttons (once)
      const copyBtn = $('#ppb-copy');
      if (copyBtn && !copyBtn.dataset.wired) {
        copyBtn.dataset.wired = '1';
        copyBtn.onclick = async () => {
          const url = SAK.SolanaEscrow.challengeUrl(activeChainChallenge.address);
          try { await navigator.clipboard.writeText(url); toast('Link copied 📋', 1600); }
          catch (e) { toast('Copy failed', 1600); }
        };
      }
      const cancelBtn = $('#ppb-cancel');
      if (cancelBtn && !cancelBtn.dataset.wired) {
        cancelBtn.dataset.wired = '1';
        cancelBtn.onclick = async () => {
          if (!activeChainChallenge) return;
          try {
            toast('Cancelling…', 2000);
            await SAK.SolanaEscrow.cancelChallenge(activeChainChallenge.address);
            if (SAK.PvpSync) SAK.PvpSync.updateChallengeStatus(activeChainChallenge.address, 'cancelled');
            activeChainChallenge = null;
            updatePendingBar();
            toast('Challenge cancelled & refunded ✓', 2600);
          } catch (e) { toast('Cancel failed: ' + (e.message || e), 2600); }
        };
      }
    } else {
      bar.classList.add('hidden');
      if (pendingBarTimer) { clearInterval(pendingBarTimer); pendingBarTimer = null; }
    }
  }

  // v2: Incoming direct challenge popup — someone challenged YOU.
  // Fetches the challenger's real fighter profile so it's never an AI.
  async function showIncomingChallengePopup(c) {
    // Guard against concurrent calls stacking duplicate modals (async race)
    if (window._incomingPopupOpen) return;
    window._incomingPopupOpen = true;
    const old = document.getElementById('incoming-challenge-modal');
    if (old) old.remove();
    const challengerShort = (c.challenger || '').slice(0, 4) + '…' + (c.challenger || '').slice(-4);
    // Wager text: from the tracked row if present, else filled in async via on-chain lookup
    let wagerText = c.wager_sol ? ('◎ ' + Number(c.wager_sol).toFixed(2) + ' SOL') : '…';
    // Create the modal shell + buttons FIRST (synchronously), so handlers
    // are attached immediately and can't be orphaned by a stacked duplicate
    const modal = document.createElement('div');
    modal.id = 'incoming-challenge-modal';
    const closePopup = () => { window._incomingPopupOpen = false; modal.remove(); };
    modal.innerHTML =
      '<div style="position:fixed;inset:0;z-index:10000;background:rgba(5,5,15,0.92);display:flex;align-items:center;justify-content:center;padding:20px;">' +
      '<div style="background:linear-gradient(160deg,#2a0a4a,#1a0630);border:3px solid #b44dff;border-radius:20px;padding:28px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 60px rgba(180,77,255,0.4);">' +
      '<div style="font-size:52px;margin-bottom:8px;">\u{1F94A}</div>' +
      '<div style="font-size:22px;font-weight:800;color:#b44dff;margin-bottom:8px;">YOU\u2019VE BEEN CHALLENGED!</div>' +
      '<div id="incoming-fighter-avatar" style="display:flex;justify-content:center;margin-bottom:8px;"></div>' +
      '<div id="incoming-fighter-name" style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px;">' + esc(challengerShort) + '</div>' +
      '<div style="font-size:13px;color:#888;margin-bottom:6px;">' + esc(challengerShort) + '</div>' +
      '<div style="font-size:13px;color:#ffd23f;margin-bottom:6px;">wants to slap fight you</div>' +
      '<div id="incoming-wager" style="font-size:26px;font-weight:800;color:#39ff88;margin-bottom:16px;">' + esc(wagerText) + '</div>' +
      '<button id="incoming-accept" style="display:block;width:100%;padding:16px;margin:8px 0;border:none;border-radius:14px;font-size:18px;font-weight:800;cursor:pointer;background:linear-gradient(180deg,#39ff88,#1fb855);color:#000;">ACCEPT FIGHT</button>' +
      '<button id="incoming-dismiss" style="display:block;width:100%;padding:12px;margin:8px 0;border:1px solid #666;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;background:transparent;color:#aaa;">DISMISS</button>' +
      '</div></div>';
    document.body.appendChild(modal);
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    modal.querySelector('#incoming-dismiss').onclick = () => { dismissIncomingForever(c.challenge_addr); closePopup(); };
    // Fill in the real challenger name/avatar asynchronously (non-blocking)
    (async () => {
      try {
        let fighterName = null, fighterAvatar = '';
        if (SAK.Api && SAK.Api.getProfile && c.challenger) {
          const prof = await SAK.Api.getProfile(c.challenger);
          if (prof) {
            if (prof.fighter_name || prof.name) fighterName = prof.fighter_name || prof.name;
            if (prof.fighter_look && SAK.avatarSVG) fighterAvatar = SAK.avatarSVG(prof.fighter_look);
          }
        }
        if (SAK.PvpSync && SAK.PvpSync.getFighterSnapshots && c.challenge_addr) {
          const snaps = await SAK.PvpSync.getFighterSnapshots(c.challenge_addr);
          if (snaps && snaps.challengerLook && SAK.avatarSVG) fighterAvatar = SAK.avatarSVG(snaps.challengerLook);
        }
        if (!document.body.contains(modal)) return;
        // On-chain fallback for the wager amount (older challenges lack wager_sol)
        if (!c.wager_sol && SAK.SolanaEscrow && c.challenge_addr) {
          try {
            const ch = await SAK.SolanaEscrow.getChallenge(c.challenge_addr);
            if (ch && ch.wagerSol) {
              const we = modal.querySelector('#incoming-wager');
              if (we) we.textContent = '◎ ' + Number(ch.wagerSol).toFixed(2) + ' SOL';
            }
          } catch (e) {}
        }
        if (fighterName) {
          const ne = modal.querySelector('#incoming-fighter-name');
          if (ne) ne.textContent = fighterName;
        }
        if (fighterAvatar) {
          const ae = modal.querySelector('#incoming-fighter-avatar');
          if (ae) ae.innerHTML = fighterAvatar;
        }
      } catch (e) {}
    })();
    modal.querySelector('#incoming-accept').onclick = async () => {
      closePopup();
      // Accept the on-chain challenge directly
      if (SAK.SolanaEscrow && c.challenge_addr) {
        try {
          toast('Accepting — approve in wallet…', 2400);
          await SAK.SolanaEscrow.acceptChallenge(c.challenge_addr);
          toast('Accepted! Entering fight lobby…', 2000);
          // Mark accepted in Supabase (drives the challenger's ACCEPTED badge,
          // stops this popup resurfacing) and publish our fighter look so both
          // phones render identical fighters — mirrors the ?sol_challenge= path.
          if (SAK.PvpSync) SAK.PvpSync.updateChallengeStatus(c.challenge_addr, 'accepted');
          if (SAK.PvpSync && S.profile && S.profile.avatar) SAK.PvpSync.publishFighterSnapshot(c.challenge_addr, 'acceptor', S.profile.avatar);
          // The accept flow in checkIncomingChainChallenge handles the rest,
          // but we can trigger it by setting the URL param and re-running
          window._seenIncomingChallenges.delete(c.challenge_addr);
          // Directly enter the lobby via the standard accept path
          const ch = await SAK.SolanaEscrow.getChallenge(c.challenge_addr);
          if (ch && typeof startPvpFightWithLobby === 'function') {
            let snaps = null;
            try { snaps = await SAK.PvpSync.getFighterSnapshots(c.challenge_addr); } catch (e) {}
            const shadow = await resolvePvpShadow(ch.challenger, snaps && snaps.challengerLook);
            startPvpFightWithLobby(shadow,
              { mode: 'classic', pvp: true, chainChallenge: c.challenge_addr, chainWagerSol: ch.wagerSol, chainRole: 'acceptor', chainOpponentWallet: ch.challenger },
              c.challenge_addr, W.address, ch.challenger);
          }
        } catch (e) {
          // Release the popup guard so the card can resurface on the next poll —
          // the acceptor can retry cleanly. Idempotent accept means a retry
          // after a landed-but-unconfirmed tx now succeeds instead of erroring.
          window._seenIncomingChallenges.delete(c.challenge_addr);
          toast('Accept failed: ' + (e.message || e), 2600);
        }
      }
    };
  }

  // v2: Render real online fighters from presence. Each row has a
  // wager input and a CHALLENGE button that creates an on-chain challenge
  // targeted at that wallet.
  let realOnlinePlayers = [];
  function renderRealOnlineList(players) {
    realOnlinePlayers = players || [];
    const countEl = $('#pvp-count');
    const listEl = $('#pvp-list');
    if (!countEl || !listEl) return;
    if (realOnlinePlayers.length === 0) {
      countEl.textContent = 'no live fighters online right now';
      listEl.innerHTML = '<div style="text-align:center;color:#888;padding:20px">No one else is in the PvP lobby.<br>Share your challenge link to fight!</div>';
      return;
    }
    countEl.textContent = `${realOnlinePlayers.length} live fighter${realOnlinePlayers.length > 1 ? 's' : ''} online`;
    listEl.innerHTML = realOnlinePlayers.map((p, i) => {
      const short = p.wallet.slice(0, 4) + '…' + p.wallet.slice(-4);
      const avatar = (p.look && SAK.avatarSVG) ? SAK.avatarSVG(p.look) : '';
      return `
      <div class="pvp-row">
        ${avatar}
        <div class="pvp-info"><div class="pv-name"><span class="pv-dot"></span>${esc(p.name || short)}</div>
          <div class="pv-meta">${short}</div></div>
        <div class="pvp-wager-wrap"><input type="number" class="pvp-wager-input" data-i="${i}" min="0.01" step="0.01" value="0.05" /><small>SOL</small></div>
        <button data-i="${i}" class="pvp-smack-btn">SMACK</button>
      </div>`;
    }).join('');
    $$('#pvp-list .pvp-smack-btn').forEach(b => {
      b.onclick = () => challengeRealPlayer(realOnlinePlayers[+b.dataset.i]);
    });
  }

  // v2: Challenge a real online player — creates an on-chain challenge
  // with the entered SOL wager, targeted at their wallet.
  const challengeSendsInFlight = new Set();
  async function challengeRealPlayer(player) {
    if (!player || !player.wallet) return;
    if (!W.isConnected) { openWalletModal(); toast('Connect wallet to challenge 👛', 2200); return; }
    const input = document.querySelector(`.pvp-wager-input[data-i="${realOnlinePlayers.indexOf(player)}"]`);
    let wagerSol = parseFloat(input && input.value) || 0.05;
    if (wagerSol < 0.01) { toast('Min wager is 0.01 SOL', 2000); return; }
    if (!SAK.SolanaEscrow) { toast('Escrow module not loaded', 2000); return; }
    if (challengeSendsInFlight.has(player.wallet)) return; // double-tap guard
    // One live challenge per pair (LT 2026-10-23): duplicates pile up
    // popups on the opponent's phone and conflict. Check both directions
    // — my open/accepted challenges to them, theirs open to me, and a
    // fight with them already accepted.
    if (SAK.PvpSync && SAK.PvpSync.getMyChallenges) {
      try {
        const mine = await SAK.PvpSync.getMyChallenges(W.address);
        const outOpen = (mine.awaiting || []).find(c => c.opponent === player.wallet);
        const outAccepted = (mine.accepted || []).find(c => c.opponent === player.wallet);
        const inAccepted = (mine.acceptedAsOpponent || []).find(c => c.challenger === player.wallet);
        const inOpen = (mine.incoming || []).find(c => c.challenger === player.wallet);
        if (outAccepted || inAccepted) { toast(`⚠️ Your fight with ${player.name} is already on — check the lobby!`, 3000); return; }
        if (outOpen) { toast(`⚠️ You already have a challenge out to ${player.name} — cancel it in MY CHALLENGES first`, 3200); return; }
        if (inOpen) { toast(`⚠️ ${player.name} already challenged you — accept it from the popup`, 3000); return; }
      } catch (e) {}
    }
    challengeSendsInFlight.add(player.wallet);
    try {
      toast(`Challenging ${player.name} — approve ${wagerSol} SOL in wallet…`, 2600);
      const lamports = Math.round(wagerSol * 1e9);
      const res = await SAK.SolanaEscrow.createChallenge(lamports, 24);
      // Track with the specific opponent so they get notified
      if (SAK.PvpSync) {
        SAK.PvpSync.trackChallenge(res.challenge, W.address, player.wallet, wagerSol);
        if (S.profile && S.profile.avatar) SAK.PvpSync.publishFighterSnapshot(res.challenge, 'challenger', S.profile.avatar);
      }
      toast(`Challenge sent to ${player.name}! Waiting for accept…`, 3000);
      // Start watching for the accept, same as link flow
      activeChainChallenge = { address: res.challenge, wagerSol };
      updatePendingBar();
      if (typeof startChainWatch === 'function') startChainWatch(res.challenge, wagerSol);
    } catch (e) {
      console.warn('[PvP] direct challenge failed', e);
      toast('Challenge failed: ' + (e.message || e), 2600);
    } finally {
      challengeSendsInFlight.delete(player.wallet);
    }
  }

  // Global incoming-challenge watcher — runs whenever wallet is connected,
  // so challenge popups appear even if the PvP lobby isn't open.
  // ---- My Challenges (sent, awaiting accept) ----
  let mySentChallenges = [];

  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function renderMyChallenges() {
    const list = $('#my-challenges-list');
    const count = $('#my-challenges-count');
    const toggle = $('#my-challenges-toggle');
    if (!list || !toggle) return;
    const n = mySentChallenges.length;
    if (count) {
      count.textContent = n;
      count.classList.toggle('hidden', n === 0);
    }
    if (n === 0) {
      list.innerHTML = '<div class="mc-empty">No open challenges — hit SMACK on a fighter above.</div>';
    } else {
      list.innerHTML = mySentChallenges.map(ch => {
        const opp = (ch.opponent || '').slice(0, 4) + '…' + (ch.opponent || '').slice(-4);
        const wager = ch.wager_sol ? ('◎ ' + Number(ch.wager_sol).toFixed(2) + ' SOL') : '';
        return '<div class="mc-row">' +
          '<div class="mc-info"><div class="mc-opp">' + esc(opp) + '</div>' +
          '<div class="mc-meta">' + esc(wager) + (wager ? ' · ' : '') + esc(timeAgo(ch.created_at)) + '</div></div>' +
          '<button class="mc-cancel" data-addr="' + esc(ch.challenge_addr) + '">CANCEL</button>' +
          '</div>';
      }).join('');
      list.querySelectorAll('.mc-cancel').forEach(btn => {
        btn.onclick = () => cancelSentChallenge(btn.dataset.addr, btn);
      });
    }
  }

  async function cancelSentChallenge(challengeAddr, btn) {
    if (!challengeAddr || !SAK.SolanaEscrow) return;
    if (btn) btn.disabled = true;
    try {
      toast('Cancelling — approve in wallet…', 2400);
      await SAK.SolanaEscrow.cancelChallenge(challengeAddr);
      if (SAK.PvpSync && SAK.PvpSync.updateChallengeStatus) {
        await SAK.PvpSync.updateChallengeStatus(challengeAddr, 'cancelled');
      }
      mySentChallenges = mySentChallenges.filter(ch => ch.challenge_addr !== challengeAddr);
      renderMyChallenges();
      toast('Challenge cancelled — SOL refunded', 2400);
    } catch (e) {
      toast('Cancel failed: ' + (e.message || e), 2600);
      if (btn) btn.disabled = false;
    }
  }

  // Auto-refund: sweep sent challenges past their 24h expiry
  let _refundSweepRunning = false;
  async function sweepExpiredChallenges() {
    if (_refundSweepRunning || !SAK.SolanaEscrow || !W.address) return;
    _refundSweepRunning = true;
    try {
      const now = Date.now();
      const candidates = mySentChallenges.filter(ch => {
        if (!ch.created_at) return false;
        return (now - new Date(ch.created_at).getTime()) > 24 * 60 * 60 * 1000;
      });
      for (const ch of candidates) {
        try {
          const onchain = await SAK.SolanaEscrow.getChallenge(ch.challenge_addr);
          if (onchain && onchain.stateName === 'Open' && Date.now() / 1000 > onchain.expiry) {
            toast('Refunding expired challenge…', 2200);
            await SAK.SolanaEscrow.refundExpired(ch.challenge_addr);
            if (SAK.PvpSync && SAK.PvpSync.updateChallengeStatus) {
              await SAK.PvpSync.updateChallengeStatus(ch.challenge_addr, 'refunded');
            }
            mySentChallenges = mySentChallenges.filter(x => x.challenge_addr !== ch.challenge_addr);
            toast('Expired challenge refunded ◎', 2600);
          }
        } catch (e) {
          console.warn('[PvP] auto-refund failed for', ch.challenge_addr, e.message);
        }
      }
      renderMyChallenges();
    } finally {
      _refundSweepRunning = false;
    }
  }

  // Persistent dismissals for incoming challenges — the session-only seen
  // set is why dismissed popups came back on every game open.
  function dismissedIncoming() {
    try { return JSON.parse(localStorage.getItem('sak_dismissed_incoming') || '{}'); } catch (e) { return {}; }
  }
  function dismissIncomingForever(addr) {
    try {
      const d = dismissedIncoming();
      d[addr] = Date.now();
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      Object.keys(d).forEach(k => { if (!d[k] || d[k] < cutoff) delete d[k]; });
      localStorage.setItem('sak_dismissed_incoming', JSON.stringify(d));
    } catch (e) {}
  }

  // Popup gate (marker:incoming-gate): a challenge only earns a popup if the
  // CHAIN still says Open and unexpired — the DB row alone goes stale
  // (expired TTLs, on-chain cancels, accepts from another device were all
  // re-popping on game open). Stale rows are synced in the DB so they stop
  // matching the poll entirely. Unverifiable -> stay silent, retry next poll.
  const _incomingChainCache = new Map(); // addr -> { at, ch }
  async function maybeShowIncoming(c) {
    const addr = c.challenge_addr;
    if (!addr) return;
    if (window._seenIncomingChallenges && window._seenIncomingChallenges.has(addr)) return;
    if (dismissedIncoming()[addr]) return;
    if (window._incomingVerifyBusy) return;
    let ch = null;
    const cached = _incomingChainCache.get(addr);
    if (cached && Date.now() - cached.at < 30000) ch = cached.ch;
    else if (SAK.SolanaEscrow && SAK.SolanaEscrow.getChallenge) {
      window._incomingVerifyBusy = true;
      try { ch = await SAK.SolanaEscrow.getChallenge(addr); } catch (e) { ch = null; }
      window._incomingVerifyBusy = false;
      if (ch) _incomingChainCache.set(addr, { at: Date.now(), ch });
    }
    if (!ch) return;
    if (ch.stateName !== 'Open') {
      window._seenIncomingChallenges.add(addr);
      const map = { Accepted: 'accepted', Cancelled: 'cancelled', Resolved: 'completed' };
      if (SAK.PvpSync && map[ch.stateName]) SAK.PvpSync.updateChallengeStatus(addr, map[ch.stateName]);
      return;
    }
    if (ch.expiry && Date.now() / 1000 > ch.expiry) {
      window._seenIncomingChallenges.add(addr);
      if (SAK.PvpSync) SAK.PvpSync.updateChallengeStatus(addr, 'expired');
      return;
    }
    // Real, live challenge. If another popup is up, stay unseen — a later
    // poll offers it again instead of it being swallowed.
    if (window._incomingPopupOpen) return;
    window._seenIncomingChallenges.add(addr);
    showIncomingChallengePopup(c);
  }

  function ensureGlobalChallengeWatch() {
    if (!SAK.PvpSync || !W.address || window._globalChallengeWatch) return;
    window._globalChallengeWatch = true;
    if (!window._seenIncomingChallenges) window._seenIncomingChallenges = new Set();
    SAK.PvpSync.startStatusPolling(W.address, ({ awaiting, accepted, incoming }) => {
      mySentChallenges = awaiting || [];
      try { renderMyChallenges(); } catch (e) {}
      // Update lobby badge if visible
      try {
        const badge = $('#pvp-badge');
        if (badge) {
          if (accepted.length > 0) {
            badge.textContent = `⚔ ${accepted.length} ACCEPTED`;
            badge.className = 'pvp-badge accepted';
          } else if (awaiting.length > 0) {
            badge.textContent = `⏳ ${awaiting.length} AWAITING`;
            badge.className = 'pvp-badge awaiting';
          } else {
            badge.className = 'pvp-badge hidden';
          }
        }
      } catch (e) {}
      // Incoming direct challenge popup — works from any screen.
      // Gated by maybeShowIncoming: chain-verified Open + unexpired only.
      try {
        (incoming || []).forEach(c => { maybeShowIncoming(c); });
      } catch (e) {}
    });
  }

  function stopGlobalChallengeWatch() {
    window._globalChallengeWatch = false;
    if (SAK.PvpSync) SAK.PvpSync.stopStatusPolling();
  }

  async function openPvp() {
    A.unlock();
    try {
      const tgl = $('#my-challenges-toggle');
      if (tgl && !tgl._wired) {
        tgl._wired = true;
        tgl.onclick = () => {
          const list = $('#my-challenges-list');
          const chev = tgl.querySelector('.mc-chev');
          if (list) list.classList.toggle('hidden');
          if (chev) chev.textContent = list && list.classList.contains('hidden') ? '▾' : '▴';
        };
      }
      renderMyChallenges();
      // Auto-refund any challenges past 24h unaccepted
      setTimeout(() => { try { sweepExpiredChallenges(); } catch (e) {} }, 3000);
    } catch (e) {}
    $('#pvp-lobby').classList.remove('hidden'); $('#pvp-search').classList.add('hidden');
    // v2: announce ourselves as online in the PvP lobby
    if (SAK.PvpSync && W.address) {
      const myLook = (S.profile && S.profile.avatar) || null;
      const myName = (S.profile && (S.profile.fighter_name || S.profile.name)) || null;
      SAK.PvpSync.startOnlinePresence(W.address, { name: myName, look: myLook }, renderRealOnlineList);
      initSmackTalk();
      // Stop announcing when the modal closes
      const modal = $('#modal-pvp');
      if (modal && !modal._presenceObserver) {
        const obs = new MutationObserver(() => {
          if (modal.classList.contains('hidden') && SAK.PvpSync) {
            SAK.PvpSync.stopOnlinePresence();
            stopSmackTalk();
          }
        });
        obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
        modal._presenceObserver = obs;
      }
    }
    // Global challenge watcher handles badge + incoming popups (works from any screen)
    ensureGlobalChallengeWatch();
    renderModes($('#pvp-modes'), pvpMode, m => { pvpMode = m; openPvp(); });
    renderSolBets();
    renderChainBets();
    renderChainExpiry();
    const _ps = $('#pvp-share'); if (_ps) _ps.classList.add('hidden');
    $('#pvp-chain-share').classList.add('hidden');
    updatePendingBar();
    const pcs = $('#pvp-chain-status'); if (pcs) pcs.classList.add('hidden');
    const _pb = $('#pvp-bets');
    if (_pb) {
    const wagers = [0, 100, 250, 500, 1000];
    if (!P.canAfford(pvpWager)) pvpWager = 0;
    _pb.innerHTML = wagers.map(b => `<button class="bet-chip ${b === pvpWager ? 'selected' : ''} ${b && !P.canAfford(b) ? 'locked' : ''}" data-bet="${b}">${b ? ptsHTML() + b : 'FREE'}</button>`).join('');
    $$('#pvp-bets .bet-chip').forEach(c => c.onclick = () => {
      const b = +c.dataset.bet;
      if (b && !P.canAfford(b)) return toast('Not enough PTS. Down bad.');
      pvpWager = b; A.click(); openPvp();
    });
    }
    // Payout = wager × opponent multiplier (x1.6–x2.65) × (1 + vault boost) — same as fight stake tag
    const _pwh = $('#pvp-wager-hint');
    if (_pwh && pvpWager) {
      const lo = boosted(pvpWager * 1.6), hi = boosted(pvpWager * 2.65);
      const boostLbl = V.boost ? ` incl. +${Math.round(V.boost * 100)}% vault` : '';
      _pwh.textContent = `winner takes ${fmt(lo)}–${fmt(hi)} PTS (×opp${boostLbl})`;
    } else if (_pwh) {
      _pwh.textContent = 'friendly slap, no wager';
    }
    // v2: real online players via presence (replaces simulated list)
    $('#pvp-count').textContent = 'scanning for live fighters…';
    $('#pvp-list').innerHTML = '<div style="text-align:center;color:#888;padding:20px">Looking for online fighters…</div>';
    $('#modal-pvp').classList.remove('hidden');
    // renderRealOnlineList is called by presence updates; also do an initial render
    renderRealOnlineList([]);
  }
  async function startPvpSearch(target) {
    A.click();
    $('#pvp-lobby').classList.add('hidden'); $('#pvp-search').classList.remove('hidden');
    const st = $('#pvp-status'); st.classList.remove('done');
    pvpT0 = performance.now();
    clearInterval(pvpTimer);
    pvpTimer = setInterval(() => {
      const sec = Math.floor((performance.now() - pvpT0) / 1000);
      $('#pvp-timer').textContent = `0:${String(sec).padStart(2, '0')}`;
    }, 250);
    const res = await SAK.Matchmaking.findMatch({ target, wager: pvpWager, mode: pvpMode }, (msg, done) => {
      st.textContent = msg; st.classList.toggle('done', done);
    });
    clearInterval(pvpTimer);
    if ($('#modal-pvp').classList.contains('hidden')) return;   // cancelled
    $('#modal-pvp').classList.add('hidden');
    // AI stand-in: wager behaves like a normal PTS bet (payout x opponent multiplier)
    startFight(res.opponent, pvpWager, { mode: pvpMode, pvp: true });
  }
  $('#btn-pvp').addEventListener('click', () => { A.click(); openPvp(); });
  // SMACK-A-KOL -> the Solo Challenge lobby (its own screen since the restructure)
  const enterRing = $('#btn-enter-ring');
  if (enterRing) enterRing.addEventListener('click', () => { A.unlock(); A.click(); openSolo(); });
  // B1 dock buttons → existing flows
  const dockShop = $('#m1-dock-shop'); if (dockShop) dockShop.onclick = () => { A.click(); $('#btn-shop').click(); };
  const dockStake = $('#m1-dock-stake'); if (dockStake) dockStake.onclick = () => { A.click(); $('#btn-vault').click(); };
  const dockWallet = $('#m1-dock-wallet'); if (dockWallet) dockWallet.onclick = () => { A.click(); $('#btn-connect').click(); };
  const dockSettings = $('#m1-dock-settings'); if (dockSettings) dockSettings.onclick = () => { A.click(); $('#btn-settings').click(); };
  const topSettings = $('#m1-top-settings'); if (topSettings) topSettings.onclick = () => { A.click(); $('#btn-settings').click(); };
  // B1 top bar icons
  const mAch = $('#m1-ach'); if (mAch) mAch.onclick = () => {
    A.click();
    const unlocked = Object.keys(S.achievements || {}).length;
    const total = Object.keys(ACHIEVEMENTS).length;
    toast(`🏆 ${unlocked}/${total} achievements unlocked`, 2200);
  };
  const mRefer = $('#m1-refer-icon'); if (mRefer) mRefer.onclick = () => { A.click(); $('#btn-refer').click(); };
  const mLeader = $('#m1-leader-icon'); if (mLeader) mLeader.onclick = () => { A.click(); $('#btn-leaderboard').click(); };
  $('#pvp-quick').addEventListener('click', () => startPvpSearch(null));
  $('#pvp-cancel').addEventListener('click', () => {
    SAK.Matchmaking.cancel(); clearInterval(pvpTimer);
    $('#pvp-lobby').classList.remove('hidden'); $('#pvp-search').classList.add('hidden');
  });

  /* --- challenge links (wager SOL, share on X) --------------------------- */
  let solWager = 0.1;
  const SOL_PRESETS = [0.01, 0.05, 0.1, 0.5, 1];
  function renderSolBets() {
    const _el = $('#pvp-sol-bets'); if (!_el) return; // off-chain challenge link removed
    _el.innerHTML = SOL_PRESETS.map(s =>
      `<button class="bet-chip ${s === solWager ? 'selected' : ''}" data-sol="${s}">${s} SOL</button>`).join('');
    $$('#pvp-sol-bets .bet-chip').forEach(c => c.onclick = () => { solWager = +c.dataset.sol; A.click(); renderSolBets(); });
  }
  function challengeUrl(code) {
    return `https://smackakol.com/?challenge=${code}`;
  }
  const _clBtn = $('#pvp-create-link');
  if (_clBtn) _clBtn.addEventListener('click', async () => {
    if (!W.isConnected) { toast('Connect your wallet first 👛', 2200); openWalletModal(); return; }
    const btn = $('#pvp-create-link'); btn.disabled = true; btn.textContent = 'CREATING…';
    try {
      const cfg = await SAK.Api.getConfig();
      if (solWager < cfg.wager_min_sol || solWager > cfg.wager_max_sol) {
        toast(`Wager must be ${cfg.wager_min_sol}–${cfg.wager_max_sol} SOL`, 2400);
        btn.disabled = false; btn.textContent = 'CREATE CHALLENGE LINK'; return;
      }
      const ch = await SAK.Api.createChallenge({
        challenger: W.address,
        wager_lamports: Math.round(solWager * 1e9),
        mint: null, // native SOL
        ttl_hours: cfg.challenge_ttl_hours,
      });
      const url = challengeUrl(ch.x_share_code);
      $('#pvp-link').textContent = url;
      $('#pvp-share').classList.remove('hidden');
      $('#pvp-post-x').onclick = () => {
        const text = `⚔️ I challenge YOU to a ${solWager} SOL slap match on Smack-a-KOL! Accept if you're not scared 🖐`;
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
      };
      $('#pvp-copy-link').onclick = async () => {
        try { await navigator.clipboard.writeText(url); toast('Link copied 📋', 1600); }
        catch (e) { toast('Copy failed — long-press the link', 2000); }
      };
      A.perfect(); toast('Challenge link ready 🔗', 2000);
    } catch (e) { console.warn('[SAK] challenge create failed', e); toast('Could not create challenge', 2000); }
    btn.disabled = false; btn.textContent = 'CREATE CHALLENGE LINK';
  });

  // Incoming challenge via ?challenge=CODE link.
  async function checkIncomingChallenge() {
    let code = null;
    try { code = new URLSearchParams(location.search).get('challenge'); } catch (e) {}
    if (!code) return;
    // Clean the URL so refreshes don't re-trigger.
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    let ch = null;
    try { ch = await SAK.Api.getChallenge(code); } catch (e) {}
    if (!ch || ch.status !== 'open') { setTimeout(() => toast('That challenge is no longer open', 2600), 1200); return; }
    const sol = (ch.wager_lamports / 1e9).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    const challengerShort = ch.challenger_wallet.slice(0, 4) + '…' + ch.challenger_wallet.slice(-4);
    // Reuse the wallet modal shell for the accept prompt.
    const go = async () => {
      if (!W.isConnected) { openWalletModal(); toast('Connect wallet to accept 👛', 2200); return; }
      if (W.address === ch.challenger_wallet) { toast("That's your own challenge 😅", 2000); return; }
      try {
        await SAK.Api.acceptChallenge(ch.id, W.address);
        toast(`Challenge accepted! ${sol} SOL on the line ⚔️`, 2600);
        // v1: play the challenger's shadow (AI stand-in). Async PvP resolution lands with the realtime backend.
        startFight(pvpShadowKOL(ch), 0, { mode: 'classic', pvp: true, challengeId: ch.id });
      } catch (e) { toast('Could not accept challenge', 2000); }
    };
    setTimeout(() => {
      if (confirm(`⚔️ CHALLENGE!\n\n${challengerShort} challenges you to a ${sol} SOL slap match.\n\nAccept?`)) go();
    }, 1500);
  }

  /* --- on-chain SOL escrow (devnet) ------------------------------------- */
  let chainWager = 0.1;
  const CHAIN_PRESETS = [0.01, 0.05, 0.1, 0.5, 1];
  let chainTtlHours = 6;
  const CHAIN_EXPIRY_PRESETS = [1, 6, 12, 24];
  function renderChainExpiry() {
    const el = $('#pvp-expiry-chain');
    if (!el) return;
    el.innerHTML = CHAIN_EXPIRY_PRESETS.map(h =>
      `<button class="bet-chip ${h === chainTtlHours ? 'selected' : ''}" data-hrs="${h}">${h}h</button>`).join('');
    $$('#pvp-expiry-chain .bet-chip').forEach(c => c.onclick = () => { chainTtlHours = +c.dataset.hrs; A.click(); renderChainExpiry(); });
  }
  let activeChainChallenge = null; // { address, wagerSol }
  function renderChainBets() {
    const el = $('#pvp-sol-bets-chain');
    if (!el) return;
    el.innerHTML = CHAIN_PRESETS.map(s =>
      `<button class="bet-chip ${s === chainWager ? 'selected' : ''}" data-sol="${s}">${s} SOL</button>`).join('');
    $$('#pvp-sol-bets-chain .bet-chip').forEach(c => c.onclick = () => { chainWager = +c.dataset.sol; A.click(); renderChainBets(); });
  }
  function chainStatus(msg, done) {
    const st = $('#pvp-chain-status');
    if (!st) return;
    st.textContent = msg;
    st.classList.remove('hidden');
    st.classList.toggle('done', !!done);
  }
  const chainCreateBtn = $('#pvp-create-chain');
  if (chainCreateBtn) chainCreateBtn.addEventListener('click', async () => {
    if (!W.isConnected) { toast('Connect your wallet first \u{1F45B}', 2200); openWalletModal(); return; }
    if (!SAK.SolanaEscrow) { toast('Escrow module not loaded', 2000); return; }
    const btn = chainCreateBtn; btn.disabled = true; btn.textContent = 'CREATING ON-CHAIN…';
    chainStatus('Approve the wager deposit in your wallet…');
    try {
      const lamports = Math.round(chainWager * 1e9);
      const res = await SAK.SolanaEscrow.createChallenge(lamports, chainTtlHours);
      activeChainChallenge = { address: res.challenge, wagerSol: chainWager };
      // Track for menu badge + realtime sync
      if (SAK.PvpSync) SAK.PvpSync.trackChallenge(res.challenge, W.address, null);
      // v2: publish my fighter look so both phones render identical fighters
      if (SAK.PvpSync && S.profile && S.profile.avatar) SAK.PvpSync.publishFighterSnapshot(res.challenge, 'challenger', S.profile.avatar);
      updatePendingBar();
      const url = SAK.SolanaEscrow.challengeUrl(res.challenge);
      $('#pvp-chain-link').textContent = url;
      $('#pvp-chain-share').classList.remove('hidden');
      $('#pvp-chain-post-x').onclick = () => {
        const text = `\u26D4\uFE0F I locked ${chainWager} SOL on-chain for a Smack-a-KOL slap match! ${chainTtlHours}h to accept. Accept if you're not scared \u{1F590}`;
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
      };
      $('#pvp-chain-copy').onclick = async () => {
        const me = (W.address || '').slice(0, 4) + '…' + (W.address || '').slice(-4);
        const msg = `\u{1F94A} ${me} challenged you to a Smack-a-KOL slap fight!\n\u{1F4B0} ${chainWager} SOL each on the line (winner takes ${(chainWager * 2 * 0.95).toFixed(3)} SOL)\n⏰ Expires in ${chainTtlHours}h\n\u26D3 Accept: ${url}`;
        try { await navigator.clipboard.writeText(msg); toast('Challenge message copied \u{1F4CB}', 1600); }
        catch (e) { toast('Copy failed — long-press the link', 2000); }
      };
      $('#pvp-chain-cancel').onclick = async () => {
        if (!activeChainChallenge) return;
        try {
          chainStatus('Cancelling — approve in wallet…');
          await SAK.SolanaEscrow.cancelChallenge(activeChainChallenge.address);
          chainStatus('Challenge cancelled, wager refunded.', true);
          activeChainChallenge = null;
          stopChainWatch();
          $('#pvp-chain-share').classList.add('hidden');
    updatePendingBar();
        } catch (e) { chainStatus('Cancel failed: ' + (e.message || e)); }
      };
      chainStatus('Challenge live! Share the link. ' + res.signature.slice(0, 12) + '…', true);
      A.perfect(); toast('On-chain challenge ready \u26D3', 2000);
      // Watch for the opponent accepting — poll every 5s
      startChainWatch(res.challenge, chainWager);
    } catch (e) {
      console.warn('[SAK] on-chain challenge failed', e);
      chainStatus('Failed: ' + (e.message || e));
      toast('Could not create on-chain challenge', 2200);
    }
    btn.disabled = false; btn.textContent = '⛓ CREATE ON-CHAIN CHALLENGE';
  });
  // ---- Challenge waiting room: poll for accept, notify with join countdown ----
  let chainWatchTimer = null;
  function stopChainWatch() {
    if (chainWatchTimer) { clearInterval(chainWatchTimer); chainWatchTimer = null; }
  }
  function startChainWatch(challengeAddr, wagerSol) {
    stopChainWatch();
    chainStatus('⏳ Waiting for opponent to accept… (watching on-chain)');
    chainWatchTimer = setInterval(async () => {
      if (!SAK.SolanaEscrow) return;
      let ch = null;
      try { ch = await SAK.SolanaEscrow.getChallenge(challengeAddr); } catch (e) { return; }
      if (!ch) { stopChainWatch(); return; }
      if (ch.stateName === 'Accepted') {
        stopChainWatch();
        showAcceptedModal(ch, wagerSol);
      } else if (ch.stateName !== 'Open') {
        stopChainWatch();
        chainStatus('Challenge is no longer open.', true);
      }
    }, 5000);
  }
  // Build the opponent ("shadow") fighter for a PvP bout (LT 2026-10-23):
  // the peer's published snapshot look wins; their NAME comes from their
  // profile and is fetched UNCONDITIONALLY — the older paths only fetched
  // it when the snapshot was missing, so the VS header, portraits, taunts
  // and result commentary stuck at 'Challenger' / 'Opponent xxxx'.
  async function resolvePvpShadow(opponentWallet, snapshotLook) {
    const shadow = Object.assign({}, roster()[0], {
      name: opponentWallet ? 'Fighter ' + opponentWallet.slice(0, 4) : 'Challenger', pvp: true,
    });
    if (snapshotLook) shadow.look = snapshotLook;
    if (opponentWallet && SAK.Api && SAK.Api.getProfile) {
      try {
        const op = await SAK.Api.getProfile(opponentWallet);
        if (op && op.name) shadow.name = op.name;
        if ((!shadow.look || !shadow.look.body) && op && op.fighter_look) shadow.look = op.fighter_look;
      } catch (e) {}
    }
    return shadow;
  }

  // HOISTED 2026-10-22 (marker:spfl-hoist): lobby entry must live at top level —
  // BOTH accept paths (popup + challenge link) call it; nested inside
  // showAcceptedModal it was invisible to them (acceptor ReferenceError).
    // v2: Pre-fight lobby — both fighters must be confirmed online
    // simultaneously before the fight starts. Fixes ghost fights when
    // the acceptor joins minutes after the challenger left.
    function startPvpFightWithLobby(shadow, fightOpts, challengeAddr, myWallet, opponentWallet) {
      // Build lobby overlay
      let overlay = document.getElementById('pvp-lobby-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'pvp-lobby-overlay';
        overlay.innerHTML = `
          <div class="pvp-lobby-card">
            <img class="pvp-lobby-logo" src="assets/smack-a-kol-logo-title.jpg" alt="SMACK-A-KOL" />
            <div class="pvp-lobby-title">🥊 FIGHT LOBBY</div>
            <div class="pvp-lobby-players">
              <div class="pvp-lobby-player" id="pvp-lobby-p1">
                <span class="pvp-dot online"></span><span class="pvp-name">YOU</span>
                <span class="pvp-state">online</span>
              </div>
              <div class="pvp-lobby-vs">VS</div>
              <div class="pvp-lobby-player" id="pvp-lobby-p2">
                <span class="pvp-dot"></span><span class="pvp-name">OPPONENT</span>
                <span class="pvp-state">waiting…</span>
              </div>
            </div>
            <div class="pvp-lobby-status" id="pvp-lobby-status">Waiting for opponent to join…</div>
            <div class="pvp-lobby-spinner" id="pvp-lobby-spinner"></div>
            <button class="btn btn-small" id="pvp-lobby-leave" style="margin-top:14px">LEAVE</button>
          </div>`;
        document.body.appendChild(overlay);
      }
      overlay.classList.remove('hidden');
      const statusEl = document.getElementById('pvp-lobby-status');
      const leaveBtn = document.getElementById('pvp-lobby-leave');

      const cleanup = () => {
        if (SAK.PvpSync) SAK.PvpSync.leaveLobby();
        const o = document.getElementById('pvp-lobby-overlay');
        if (o) o.classList.add('hidden');
      };
      leaveBtn.onclick = () => {
        cleanup();
        toast('Left the lobby', 2000);
      };

      if (statusEl) statusEl.textContent = 'Waiting for opponent to join…';

      SAK.PvpSync.joinLobby(challengeAddr, myWallet,
        () => {
          // Both online — START THE FIGHT
          if (statusEl) statusEl.textContent = 'Both fighters ready — FIGHT!';
          // Clear the ACCEPTED badge now that the fight is starting
          if (SAK.PvpSync && fightOpts.chainChallenge) {
            SAK.PvpSync.updateChallengeStatus(fightOpts.chainChallenge, 'fighting').catch(() => {});
          }
          setTimeout(() => {
            cleanup();
            startFight(shadow, 0, fightOpts);
            if (SAK.PvpSync) SAK.PvpSync.startFight(challengeAddr, myWallet, opponentWallet, () => {
              toast('🏆 Opponent disconnected — you win by forfeit!', 4000);
            });
          }, 800);
        },
        () => {
          // Timeout — opponent never showed
          cleanup();
          toast('Opponent did not join — no fight started', 3000);
        },
        (wallets) => {
          // Live presence: light up the opponent's dot when they're online
          const p2 = document.getElementById('pvp-lobby-p2');
          if (!p2) return;
          const dot = p2.querySelector('.pvp-dot');
          const state = p2.querySelector('.pvp-state');
          const oppOnline = wallets.some(w => w !== myWallet);
          if (dot) dot.classList.toggle('online', oppOnline);
          if (state) state.textContent = oppOnline ? 'online' : 'waiting…';
          const spinner = document.getElementById('pvp-lobby-spinner');
          if (spinner) spinner.style.display = oppOnline ? 'none' : '';
        }
      );
    }

  function showAcceptedModal(ch, wagerSol) {
    const old = document.getElementById('chain-accepted-modal');
    if (old) old.remove();
    const oppShort = (ch.opponent || '').slice(0, 4) + '…' + (ch.opponent || '').slice(-4);
    let secs = 60;
    const modal = document.createElement('div');
    modal.id = 'chain-accepted-modal';
    modal.innerHTML =
      '<div style="position:fixed;inset:0;z-index:9999;background:rgba(5,5,15,0.94);display:flex;align-items:center;justify-content:center;padding:20px;">' +
      '<div style="background:linear-gradient(160deg,#0f2f1a,#0a1f12);border:2px solid #4ade80;border-radius:20px;padding:28px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 60px rgba(74,222,128,0.3);">' +
      '<div style="font-size:52px;margin-bottom:8px;">\u{1F525}</div>' +
      '<div style="font-size:24px;font-weight:800;color:#4ade80;margin-bottom:4px;">OPPONENT ACCEPTED!</div>' +
      '<div style="font-size:13px;color:#aaa;margin-bottom:16px;">' + oppShort + ' locked ' + wagerSol + ' SOL</div>' +
      '<div style="font-size:48px;font-weight:800;color:#f5c542;margin:12px 0;" id="chain-join-timer">' + secs + '</div>' +
      '<div style="font-size:12px;color:#888;margin-bottom:16px;">seconds to join the fight</div>' +
      '<button id="chain-join-btn" style="display:block;width:100%;padding:16px;margin:8px 0;border:none;border-radius:14px;font-size:18px;font-weight:800;cursor:pointer;background:linear-gradient(180deg,#f5c542,#d4a017);color:#000;">\u{1F94A} JOIN FIGHT</button>' +
      '</div></div>';
    document.body.appendChild(modal);
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    A.perfect();
    const timerEl = document.getElementById('chain-join-timer');
    const countdown = setInterval(() => {
      secs--;
      if (timerEl) timerEl.textContent = secs;
      if (secs <= 0) {
        clearInterval(countdown);
        const m = document.getElementById('chain-accepted-modal');
        if (m) m.remove();
        toast('Opponent is waiting — rejoin from the lobby', 2600);
      }
    }, 1000);
    document.getElementById('chain-join-btn').onclick = async () => {
      clearInterval(countdown);
      const m = document.getElementById('chain-accepted-modal');
      if (m) m.remove();
      chainStatus('Fighting!', true);
      // v2: prefer the acceptor's published snapshot (identical on both phones)
      let snapsB = null;
      if (SAK.PvpSync && SAK.PvpSync.getFighterSnapshots) {
        try { snapsB = await SAK.PvpSync.getFighterSnapshots(ch.address); } catch (e) {}
      }
      const shadow = await resolvePvpShadow(ch.opponent, snapsB && snapsB.acceptorLook);
      // Challenger fights; winner settles via SETTLE & CLAIM
      // v2: lobby handshake — wait until acceptor is confirmed online
      activeChainChallenge = null; updatePendingBar();
      startPvpFightWithLobby(shadow,
        { mode: 'classic', pvp: true, chainChallenge: ch.address, chainWagerSol: wagerSol, chainRole: 'challenger', chainOpponentWallet: ch.opponent },
        ch.address, W.address, ch.opponent);
    };
  }

  // ---- SOLO VS HOUSE (devnet) ----
  let soloWager = 0.02;
  let soloCustom = false;   // true while the wager comes from the CUSTOM box
  const SOLO_PRESETS = [0.02, 0.12, 0.25, 0.5];
  let activeSoloBet = null; // { bet, nonce, wagerSol }
  // Live house max bet (lamports) from the chain; null = not loaded yet.
  // The contract rejects any bet whose 1.9x payout exceeds 5% of the vault
  // (BetTooLarge) — the UI now enforces that BEFORE the wallet opens.
  let houseMaxBetLamports = null;
  function fmtSol(lamports) { return (Math.floor(lamports / 1e6) / 1000).toString(); }
  // ---- SMACK currency (second house instance, 2026-10-23) ----
  // The solo wager currency: 'SOL' plays the original house, 'SMACK'
  // plays the token house (SAK.SolanaTokenHouse). smackWager is in whole
  // tokens; the chain only ever sees base units (x1e6, 6 decimals).
  let soloCurrency = localStorage.getItem('sak_solo_currency') === 'SMACK' ? 'SMACK' : 'SOL';
  const SMACK_PRESETS = [1000, 5000, 25000, 100000];
  let smackWager = 1000;
  let smackCustom = false;
  let tokenHouseMaxBase = null; // base units; null = not loaded yet
  let tokenHouseReady = false;  // token house initialized on-chain
  function fmtTok(base) { return Math.floor(base / 1e6).toLocaleString('en-US'); }
  function fmtTokAmt(tokens) { return (Math.floor(tokens * 100) / 100).toLocaleString('en-US'); }
  function friendlyTokenError(e, what) {
    const m = String((e && e.message) || e || '');
    if (/BetTooLarge|0x1773/.test(m)) {
      return 'That bet is bigger than the SMACK house can cover right now' +
        (tokenHouseMaxBase !== null ? ' — max bet is ' + fmtTok(tokenHouseMaxBase) + ' SMACK.' : '.');
    }
    if (/rejected|denied/i.test(m)) return 'Cancelled in your wallet.';
    if (/insufficient/i.test(m)) return 'Not enough SMACK, or not enough SOL for the network fee.';
    if (/not connected|provider not available/i.test(m)) return 'Wallet not connected.';
    return (what === 'settle' ? 'Settle' : 'Bet') + ' failed — please try again.';
  }
  async function refreshHouseMax() {
    if (soloCurrency === 'SMACK') return refreshTokenHouseMax();
    if (!SAK.SolanaHouse || !SAK.SolanaHouse.getHouseState) return;
    try {
      const st = await SAK.SolanaHouse.getHouseState();
      houseMaxBetLamports = st.maxBetLamports;
      const mx = $('#solo-max');
      if (mx) mx.textContent = '🏠 House max bet right now: ' + fmtSol(st.maxBetLamports) + ' SOL';
      renderSoloBets();
    } catch (e) { /* chain unreachable: chips stay live; pre-flight still guards */ }
  }
  async function refreshTokenHouseMax() {
    const TH = SAK.SolanaTokenHouse;
    if (!TH) return;
    try {
      const st = await TH.getState();
      tokenHouseReady = !!st.initialized;
      tokenHouseMaxBase = st.initialized ? st.maxBetBase : 0;
      const mx = $('#solo-max');
      if (mx) {
        if (!st.initialized) {
          mx.innerHTML = '<img class="smack-hand" src="assets/hand-icon-sm.png" alt=""> The SMACK house is not set up yet — it needs a one-time initialize from the admin panel.';
        } else {
          let bal = '';
          if (W.isConnected) { try { bal = ' · your balance: ' + fmtTok(Number(await TH.getTokenBalance(W.address))) + ' SMACK'; } catch (e) {} }
          mx.textContent = '🏠 House max bet right now: ' + fmtTok(st.maxBetBase) + ' SMACK' + bal;
        }
      }
      renderSoloBets();
    } catch (e) { /* chain unreachable: chips stay live; pre-flight still guards */ }
  }
  function renderSoloBets() {
    const el = $('#solo-bets');
    if (!el) return;
    if (soloCurrency === 'SMACK') {
      const prevInput = $('#solo-custom-amt');
      const prevDraft = prevInput ? prevInput.value : null;
      const hadFocus = !!(prevInput && document.activeElement === prevInput);
      el.innerHTML = SMACK_PRESETS.map(t => {
        const over = tokenHouseMaxBase !== null && Math.round(t * 1e6) > tokenHouseMaxBase;
        return `<button class="bet-chip ${!smackCustom && t === smackWager ? 'selected' : ''}" data-tok="${t}" ${over ? 'disabled style="opacity:.35"' : ''}>${t.toLocaleString('en-US')}</button>`;
      }).join('') + `<span class="solo-custom-wrap ${smackCustom ? 'selected' : ''}"><input id="solo-custom-amt" type="number" inputmode="numeric" step="100" min="100" placeholder="CUSTOM" value="${smackCustom ? smackWager : ''}" /><small>SMACK</small></span>`;
      $$('#solo-bets .bet-chip').forEach(c => c.onclick = () => { smackWager = +c.dataset.tok; smackCustom = false; A.click(); renderSoloBets(); renderSoloChallengeBtn(); });
      const inp = $('#solo-custom-amt');
      if (inp) {
        inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          if (v > 0) { smackCustom = true; smackWager = Math.floor(v); }
          else { smackCustom = false; smackWager = SMACK_PRESETS[0]; }
          $$('#solo-bets .bet-chip').forEach(c => c.classList.toggle('selected', !smackCustom && +c.dataset.tok === smackWager));
          const wrap = inp.closest('.solo-custom-wrap'); if (wrap) wrap.classList.toggle('selected', smackCustom);
          renderSoloChallengeBtn();
        });
        inp.addEventListener('focus', () => inp.select());
        if (hadFocus) {
          inp.value = prevDraft;
          inp.focus();
          try { const n = inp.value.length; inp.setSelectionRange(n, n); } catch (_) {}
        }
      }
      return;
    }
    // Preserve an in-progress custom entry across re-renders (house-max refresh)
    const prevInput = $('#solo-custom-amt');
    const prevDraft = prevInput ? prevInput.value : null;
    const hadFocus = !!(prevInput && document.activeElement === prevInput);
    el.innerHTML = SOLO_PRESETS.map(s => {
      const over = houseMaxBetLamports !== null && Math.round(s * 1e9) > houseMaxBetLamports;
      return `<button class="bet-chip ${!soloCustom && s === soloWager ? 'selected' : ''}" data-sol="${s}" ${over ? 'disabled style="opacity:.35"' : ''}>${s} SOL</button>`;
    }).join('') + `<span class="solo-custom-wrap ${soloCustom ? 'selected' : ''}"><input id="solo-custom-amt" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="CUSTOM" value="${soloCustom ? soloWager : ''}" /><small>SOL</small></span>`;
    $$('#solo-bets .bet-chip').forEach(c => c.onclick = () => { soloWager = +c.dataset.sol; soloCustom = false; A.click(); renderSoloBets(); renderSoloChallengeBtn(); });
    const inp = $('#solo-custom-amt');
    if (inp) {
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (v > 0) { soloCustom = true; soloWager = v; }
        else { soloCustom = false; soloWager = SOLO_PRESETS[0]; }
        // Reflect selection in place (no re-render: keeps focus + caret mid-typing)
        $$('#solo-bets .bet-chip').forEach(c => c.classList.toggle('selected', !soloCustom && +c.dataset.sol === soloWager));
        const wrap = inp.closest('.solo-custom-wrap'); if (wrap) wrap.classList.toggle('selected', soloCustom);
        renderSoloChallengeBtn();
      });
      inp.addEventListener('focus', () => inp.select());
      if (hadFocus) {
        inp.value = prevDraft;
        inp.focus();
        try { const n = inp.value.length; inp.setSelectionRange(n, n); } catch (_) {}
      }
    }
  }
  // Player-readable house errors — never dump raw simulation logs at the
  // player (the raw SendTransactionError text WAS the BetTooLarge screenshot).
  function friendlyHouseError(e, what) {
    const m = String((e && e.message) || e || '');
    if (/BetTooLarge|0x1773/.test(m)) {
      return 'That bet is bigger than the house can cover right now' +
        (houseMaxBetLamports !== null ? ' — max bet is ' + fmtSol(houseMaxBetLamports) + ' SOL.' : '.');
    }
    if (/rejected|denied/i.test(m)) return 'Cancelled in your wallet.';
    if (/insufficient/i.test(m)) return 'Not enough devnet SOL in your wallet.';
    if (/not connected|provider not available/i.test(m)) return 'Wallet not connected.';
    return (what === 'settle' ? 'Settle' : 'Bet') + ' failed — please try again.';
  }
  function soloStatus(msg, done) {
    const st = $('#solo-status');
    if (!st) return;
    st.textContent = msg;
    st.classList.remove('hidden');
    st.classList.toggle('done', !!done);
  }
  /* ---- SOLO CHALLENGE LOBBY (the SMACK-A-KOL screen) ----
   * Solo vs House got its own home in the 2026-10-22 restructure: the 8
   * named KOLs as premade challenges, banded into tiers (Champion x2 PTS,
   * Pro x1.5, Contender x1 — harder fighters already carry harder AI via
   * their difficulty/accuracy data). FREE mode: no SOL, PTS only.
   * WAGER mode: SOL bet vs the house at a flat 1.9x. The classic
   * picker (same 8 + fan KOLs) stays reachable from FREE mode. */
  const SOLO_KOL_IDS = ['solflakey', 'cupsalty', 'fabiony', 'arthurhaze', 'tolly', 'mikesailor', 'unibonker', 'pattyspice', 'frankienogood', 'ansombull'];
  const soloKols = () => SOLO_KOL_IDS.map(id => SAK.KOLS.find(k => k.id === id)).filter(Boolean);
  function soloTier(k) {
    const lvl = (k && k.level) || 1;
    if (lvl >= 9) return { key: 'champion', name: 'CHAMPION', mult: 2 };
    if (lvl >= 6) return { key: 'pro', name: 'PRO', mult: 1.5 };
    return { key: 'contender', name: 'CONTENDER', mult: 1 };
  }
  let soloMode = 'wager';   // 'free' | 'wager'
  let soloSelected = 0;
  let soloPtsBet = 0;

  /* ---- SOLO STREAK REWARDS (LT 2026-10-25) ----
   * Wagered Solo wins only: FREE-mode, PvP and PTS-bet fights never
   * touch the streak, and a wagered Solo loss resets it. At 5 straight
   * wins: 1 free fight worth the 5th fight's wager. At 10: 2 free fights
   * worth the 10th wager each; the streak then resets for a new cycle.
   * Credits are FIFO, spendable from the solo lobby on any KOL. A
   * free-fight win pays 1.9x the credit value; a loss costs nothing.
   * Payouts queue in Supabase (free_fight_payouts) for the settlement
   * service — devnet prototype: the service pays from the house float.
   * Mainnet needs a contract payout instruction + authoritative fights. */
  SAK.StreakRewards = {
    grantFor(streak) { return streak === 5 ? 1 : streak === 10 ? 2 : 0; },
    fmtValue(currency, value) {
      if (currency === 'SMACK') return fmtTokAmt(value) + ' SMACK';
      return (Math.round(value * 1000) / 1000) + ' SOL';
    },
    payoutFor(credit) {
      return credit.currency === 'SMACK' ? Math.floor(credit.value * 1.9) : Math.round(credit.value * 1.9 * 1000) / 1000;
    },
    showCelebration(grant) {
      const m = $('#streak-celebration'); if (!m) return;
      $('#sc-title').textContent = `🔥 ${grant.streak}-FIGHT WIN STREAK!`;
      $('#sc-reward').textContent = grant.count === 1
        ? `🎁 1 FREE FIGHT · ${this.fmtValue(grant.currency, grant.value)}`
        : `🎁 2 FREE FIGHTS · ${this.fmtValue(grant.currency, grant.value)} EACH`;
      m.classList.remove('hidden');
      const close = $('#sc-close');
      if (close) close.onclick = () => { m.classList.add('hidden'); A.click(); };
    },
    async queuePayout(credit, wallet) {
      const payout = this.payoutFor(credit);
      const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('ff-' + Date.now() + '-' + Math.floor(Math.random() * 1e9));
      try {
        await sbQueue('/free_fight_payouts', 'POST', {
          id, wallet, currency: credit.currency, amount: payout,
          credit_value: credit.value, from_streak: credit.fromStreak, status: 'pending',
        });
        return true;
      } catch (e) { return false; }
    },
  };
  function openSolo() {
    if (!S.profile) return openFighter(true);   // first run: create your fighter, then play
    renderSoloLobby();
    show('solo');
    selectSoloKol(Math.min(soloSelected, soloKols().length - 1), true);
    if (soloMode === 'wager') refreshHouseMax();
  }
  function paintSoloCurrency() {
    $$('#solo-currency .mode-btn').forEach(b => b.classList.toggle('selected', b.dataset.sc === soloCurrency));
    const lb = $('#solo-wager-label');
    if (lb) lb.textContent = soloCurrency === 'SMACK' ? 'YOUR WAGER (SMACK)' : 'YOUR WAGER (SOL)';
    const tg = $('#solo-toggle .mode-btn[data-sm="wager"] b');
    if (tg) tg.innerHTML = soloCurrency === 'SMACK' ? '<img class="smack-hand" src="assets/hand-icon-sm.png" alt=""> WAGER SMACK' : '◎ WAGER SOL';
  }
  let useFreeFight = false;   // spend a streak credit on the next SMACK (never auto-consumed)
  function renderStreakBar() {
    const bar = $('#solo-streak-bar'); if (!bar) return;
    const ss = (S.stats && S.stats.soloStreak) || 0;
    if (!Array.isArray(S.freeFights)) S.freeFights = [];
    const credits = S.freeFights;
    const next = ss >= 5 ? 10 : 5;
    const toGo = next - ss;
    let html = ss === 0
      ? `<span class="ss-hot">🔥 WIN 5 CONSECUTIVE WAGERED FIGHTS FOR A FREE FIGHT</span>`
      : `<span class="ss-hot">🔥 STREAK ${ss} IN A ROW</span> — ${toGo} more consecutive wagered win${toGo === 1 ? '' : 's'} for ${next === 10 ? '2 free fights' : 'a free fight'}`;
    if (credits.length) {
      const grouped = {};
      for (const c of credits) { const k = c.currency + ':' + c.value; grouped[k] = (grouped[k] || 0) + 1; }
      const parts = Object.entries(grouped).map(([k, n]) => {
        const [cur, v] = k.split(':');
        return (n > 1 ? n + ' × ' : '') + SAK.StreakRewards.fmtValue(cur, parseFloat(v));
      });
      html += `<br><span class="ss-gift">🎁 FREE FIGHT${credits.length > 1 ? 'S' : ''} BANKED:</span> ${parts.join(' · ')}`;
    }
    bar.innerHTML = html;
    const row = $('#solo-freefight-row');
    if (row) {
      const showRow = soloMode === 'wager' && credits.length > 0;
      row.classList.toggle('hidden', !showRow);
      if (!showRow) useFreeFight = false;
      else {
        const first = credits[0];
        $('#solo-ff-label').textContent = `Use a free fight (${SAK.StreakRewards.fmtValue(first.currency, first.value)}) — win pays ×1.9, lose nothing${credits.length > 1 ? ` · ${credits.length} available` : ''}`;
        const cb = $('#solo-use-freefight');
        if (cb) cb.checked = useFreeFight;
      }
    }
  }
  function renderSoloLobby() {
    paintSoloCurrency();
    $$('#solo-toggle .mode-btn').forEach(b => b.classList.toggle('selected', b.dataset.sm === soloMode));
    const wb = $('#solo-wager-bar'); if (wb) wb.classList.toggle('hidden', soloMode !== 'wager');
    const br = $('#solo-bet-row'); if (br) br.classList.toggle('hidden', soloMode !== 'free');
    if (soloMode === 'wager') renderSoloBets();
    renderSoloCards();
    renderStreakBar();
  }
  function renderSoloCards() {
    const list = soloKols();
    $('#solo-kol-list').innerHTML = list.map((k, i) => {
      const t = soloTier(k);
      const win = Math.round(modePts(k, 'classic') * t.mult);
      return `<button class="kol-card ${i === soloSelected ? 'selected' : ''}" data-si="${i}">
        ${S.beaten[k.id] ? '<span class="beaten">✓</span>' : ''}
        <span class="kc-tier tier-${t.key}">${t.name}${t.mult > 1 ? ' ×' + t.mult : ''}</span>
        ${SAK.avatarSVG(k.look)}
        <div class="kc-name">${esc(k.name)}</div>
        <div class="kc-stake">${ptsHTML()}+${fmt(win)}</div>
      </button>`;
    }).join('') + (soloMode === 'free' ? `
      <button class="kol-card submit-card-btn" id="btn-solo-roster">
        <span class="plus">☰</span>
        <div class="kc-name">FULL ROSTER</div>
        <small>every fighter + fan KOLs</small>
      </button>` : '');
    $$('#solo-kol-list .kol-card[data-si]').forEach(c => c.addEventListener('click', () => { A.click(); selectSoloKol(+c.dataset.si); }));
    const rb = $('#btn-solo-roster'); if (rb) rb.addEventListener('click', () => { A.click(); openPicker(); });
  }
  function selectSoloKol(i, noTaunt) {
    const list = soloKols(); const k = list[i]; if (!k) return;
    soloSelected = i;
    $$('#solo-kol-list .kol-card[data-si]').forEach(c => c.classList.toggle('selected', +c.dataset.si === i));
    const t = soloTier(k);
    const win = Math.round(modePts(k, 'classic') * t.mult);
    const maxHp = 260, maxPow = 28;
    $('#solo-kol-detail').innerHTML = `
      <div><div class="kd-name">${esc(k.name)}</div><div class="kd-handle">${esc(k.handle)} · LEVEL ${k.level} · <span class="kd-tier tier-${t.key}">${t.name}${t.mult > 1 ? ' · WIN PTS ×' + t.mult : ''}</span></div></div>
      <div class="kd-stars">${'★'.repeat(Math.max(0, Math.min(5, k.difficulty)))}<span style="opacity:.3">${'★'.repeat(Math.max(0, 5 - k.difficulty))}</span></div>
      <div class="kd-tag">“${esc(k.tagline)}”</div>
      <div class="kd-stats">
        <span>❤ HP</span><div class="stat-bar"><i style="width:${k.hp / maxHp * 100}%;background:#2ee66b"></i></div><span>${k.hp}</span>
        <span>✊ POWER</span><div class="stat-bar"><i style="width:${k.power / maxPow * 100}%;background:#ff3b5c"></i></div><span>${k.power}</span>
      </div>
      <div class="kd-money">
        <div>WIN ${ptsHTML()}<b>+${fmt(win)}</b></div>
        ${soloMode === 'wager'
          ? (soloCurrency === 'SMACK'
            ? `<div>SMACK WIN PAYS <b style="color:#2ee66b">×1.9</b> <small style="color:#888">· 1% of the wager burns 🔥</small></div>`
            : `<div>SOL WIN PAYS <b style="color:#2ee66b">×1.9</b></div>`)
          : `<div>BET PAYS <b style="color:#2ee66b">x${k.payout.toFixed(1)}</b></div>`}
      </div>`;
    if (soloMode === 'free') { if (soloPtsBet && soloPtsBet < k.minBet) soloPtsBet = 0; renderSoloPtsBets(); }
    renderSoloChallengeBtn();
    if (Scene) { Scene.setOpponent(k.look); if (!noTaunt) Scene.taunt(); }
    const card = $(`#solo-kol-list .kol-card[data-si="${i}"]`); if (card) card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
  function renderSoloPtsBets() {
    const k = soloKols()[soloSelected]; if (!k) return;
    if (soloPtsBet && !P.canAfford(soloPtsBet)) soloPtsBet = 0;
    $('#solo-bet-chips').innerHTML = SAK.BETS.map(b => {
      const free = b === 0, locked = !free && (b < k.minBet || !P.canAfford(b));
      return `<button class="bet-chip ${free ? 'free' : ''} ${b === soloPtsBet ? 'selected' : ''} ${locked ? 'locked' : ''}" data-sbet="${b}">
        ${free ? 'FREE' : `${ptsHTML()}${b >= 1000 ? b / 1000 + 'K' : b}`}</button>`;
    }).join('');
    $('#solo-bet-hint').textContent = soloPtsBet
      ? `win → ${fmt(boosted(soloPtsBet * k.payout))} PTS`
      : `min bet ${fmt(k.minBet)} PTS`;
    $$('#solo-bet-chips .bet-chip').forEach(c => c.addEventListener('click', () => {
      const b = +c.dataset.sbet; A.click();
      if (b && b < k.minBet) return toast(`${k.name} min bet: ${fmt(k.minBet)} PTS`);
      if (b && !P.canAfford(b)) return toast('Not enough PTS for that bet');
      soloPtsBet = b; renderSoloPtsBets(); renderSoloChallengeBtn();
    }));
  }
  function renderSoloChallengeBtn() {
    const k = soloKols()[soloSelected]; const btn = $('#btn-solo-challenge'); if (!k || !btn) return;
    if (soloMode === 'wager') {
      const ff = useFreeFight && S.freeFights && S.freeFights.length ? S.freeFights[0] : null;
      if (ff) {
        btn.className = 'btn btn-xl btn-green';
        btn.innerHTML = `🎁 SMACK · FREE FIGHT (${SAK.StreakRewards.fmtValue(ff.currency, ff.value)})`;
        return;
      }
      btn.className = 'btn btn-xl btn-red';
      btn.innerHTML = soloCurrency === 'SMACK'
        ? `🖐 SMACK · BET ${smackWager.toLocaleString('en-US')} SMACK`
        : `🖐 SMACK · BET ${Math.round(soloWager * 1000) / 1000} SOL`;
    } else {
      const win = Math.round(modePts(k, 'classic') * soloTier(k).mult);
      btn.className = 'btn btn-xl ' + (soloPtsBet ? 'btn-red' : 'btn-yellow');
      btn.innerHTML = soloPtsBet ? `🖐 SEND IT · BET ${fmt(soloPtsBet)} PTS` : `🖐 SEND IT · FREE · +${fmt(win)} PTS`;
    }
  }
  $$('#solo-toggle .mode-btn').forEach(b => b.addEventListener('click', () => {
    A.click(); soloMode = b.dataset.sm;
    renderSoloLobby(); selectSoloKol(soloSelected, true);
    if (soloMode === 'wager') refreshHouseMax();
  }));
  const ffCb = $('#solo-use-freefight');
  if (ffCb) ffCb.addEventListener('change', () => { useFreeFight = ffCb.checked; renderSoloChallengeBtn(); });
  $$('#solo-currency .mode-btn').forEach(b => b.addEventListener('click', () => {
    A.click();
    if (soloCurrency === b.dataset.sc) return;
    soloCurrency = b.dataset.sc;
    const stEl = $('#solo-status'); if (stEl) { stEl.textContent = ''; stEl.classList.add('hidden'); }
    try { localStorage.setItem('sak_solo_currency', soloCurrency); } catch (e) {}
    paintSoloCurrency(); renderSoloBets(); renderSoloChallengeBtn();
    selectSoloKol(soloSelected, true);
    if (soloMode === 'wager') refreshHouseMax();
  }));
  const soloChallengeBtn = $('#btn-solo-challenge');
  if (soloChallengeBtn) soloChallengeBtn.addEventListener('click', async () => {
    const k = soloKols()[soloSelected]; if (!k) return;
    A.click();
    if (soloMode === 'free') { startFight(k, soloPtsBet, { mode: 'classic', soloLobby: 'free' }); return; }
    // Streak credit: spend one (FIFO) on a stakeless fight. The house
    // needs a wallet address to pay a win to, but no signature.
    if (useFreeFight && S.freeFights && S.freeFights.length) {
      if (!W.isConnected) { toast('Connect your wallet first \u{1F45B} — the house needs an address to pay your free-fight win', 2200); openWalletModal(); return; }
      const credit = S.freeFights.shift(); SAK.Storage.save(); useFreeFight = false;
      startFight(k, 0, { mode: 'classic', soloLobby: 'freeFight', freeFight: credit, freeFightWallet: W.address });
      return;
    }
    if (!W.isConnected) { toast('Connect your wallet first \u{1F45B}', 2200); openWalletModal(); return; }
    if (!SAK.SolanaHouse) { toast('House module not loaded', 2000); return; }
    const btn = soloChallengeBtn; btn.disabled = true; const oldLabel = btn.innerHTML; btn.textContent = 'PLACING BET…';
    if (soloCurrency === 'SMACK') {
      const TH = SAK.SolanaTokenHouse;
      const done = () => { btn.disabled = false; btn.innerHTML = oldLabel; };
      if (!TH) { toast('Token house module not loaded', 2000); done(); return; }
      soloStatus('Checking the SMACK house…');
      await refreshTokenHouseMax();
      if (!tokenHouseReady) {
        const m = 'The SMACK house is not set up yet — it needs a one-time initialize from the admin panel.';
        soloStatus(m); toast(m, 3000); done(); return;
      }
      const base = Math.round(smackWager * 1e6);
      if (tokenHouseMaxBase !== null && base > tokenHouseMaxBase) {
        const m = 'That bet is bigger than the SMACK house can cover right now — max bet is ' + fmtTok(tokenHouseMaxBase) + ' SMACK.';
        soloStatus(m); toast(m, 3000); done(); return;
      }
      try {
        const bal = await TH.getTokenBalance(W.address);
        if (bal < BigInt(base)) {
          const m = 'Not enough SMACK — you have ' + fmtTok(Number(bal)) + ' SMACK.';
          soloStatus(m); toast(m, 2800); done(); return;
        }
      } catch (e) { /* balance read failed: the chain will still guard the bet */ }
      soloStatus('Approve the bet in your wallet…');
      try {
        const res = await TH.placeBet(base);
        activeSoloBet = { bet: res.bet, nonce: res.nonce, currency: 'SMACK', wagerTokens: smackWager };
        soloStatus(`Bet locked: ${smackWager.toLocaleString('en-US')} SMACK. Fight!`, true);
        toast(`Bet locked — ${smackWager.toLocaleString('en-US')} SMACK vs ${k.name} \u{1F3E0}`, 2400);
        startFight(k, 0, { mode: 'classic', soloHouse: activeSoloBet, soloLobby: 'wager' });
      } catch (e) {
        const m = friendlyTokenError(e, 'bet');
        soloStatus(m); toast(m, 2800);
      }
      done();
      return;
    }
    soloStatus('Checking the house max…');
    await refreshHouseMax();
    if (houseMaxBetLamports !== null && Math.round(soloWager * 1e9) > houseMaxBetLamports) {
      const msg = 'That bet is bigger than the house can cover right now — max bet is ' + fmtSol(houseMaxBetLamports) + ' SOL.';
      soloStatus(msg); toast(msg, 3000);
      btn.disabled = false; btn.innerHTML = oldLabel; return;
    }
    soloStatus('Approve the bet in your wallet…');
    try {
      const res = await SAK.SolanaHouse.placeBet(Math.round(soloWager * 1e9));
      activeSoloBet = { bet: res.bet, nonce: res.nonce, wagerSol: soloWager };
      soloStatus(`Bet locked: ${soloWager} SOL. Fight!`, true);
      toast(`Bet locked — ${soloWager} SOL vs ${k.name} \u{1F3E0}`, 2400);
      startFight(k, 0, { mode: 'classic', soloHouse: activeSoloBet, soloLobby: 'wager' });
    } catch (e) {
      const msg = friendlyHouseError(e, 'bet');
      soloStatus(msg); toast(msg, 2800);
    }
    btn.disabled = false; btn.innerHTML = oldLabel;
  });

  // Resolve the solo bet after the fight ends. Called from the result screen.
  /* --- Solo settlement ---------------------------------------------------
   * The house contract accepts a settle ONLY from its resolver wallet.
   * If the connected wallet is the resolver (LT), settle directly.
   * Everyone else: the result is queued in Supabase and the settlement
   * service (server-side resolver wallet) signs it — the player never
   * sees a settle popup (the old flow asked their wallet to sign a
   * transaction that could never land, and Phantom flagged it unsafe).
   * We poll the queue briefly so the result card can confirm; if it
   * takes longer, the payout still lands on its own. */
  async function sbQueue(path, method, body) {
    const B = SAK.BACKEND;
    if (!B || !B.url || !B.anonKey) throw new Error('no backend');
    const headers = { apikey: B.anonKey, Authorization: 'Bearer ' + B.anonKey, 'Content-Type': 'application/json' };
    if (method === 'POST') headers.Prefer = 'resolution=ignore-duplicates';
    const r = await fetch(B.url.replace(/\/$/, '') + '/rest/v1' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error('queue HTTP ' + r.status);
    return r.status === 204 ? null : r.json().catch(() => null);
  }

  /** Queue a finished solo bet for the settlement service. Returns true
   *  once the service confirms it settled, false if still pending. */
  async function queueSoloSettlement(house, betObj, won) {
    await sbQueue('/solo_settlements', 'POST', {
      house, bet: betObj.bet, player: W.address, nonce: String(betObj.nonce), won,
      wager: house === 'SMACK' ? (betObj.wagerTokens || null) : (betObj.wagerSol || null),
    });
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const rows = await sbQueue('/solo_settlements?bet=eq.' + encodeURIComponent(betObj.bet) + '&select=status', 'GET');
        if (rows && rows[0] && rows[0].status === 'settled') return true;
        if (rows && rows[0] && rows[0].status === 'failed') return false;
      } catch (e) { /* transient — keep polling */ }
    }
    return false;
  }

  async function resolveSoloBet(won, betObj) {
    const mine = betObj || activeSoloBet;
    if (!mine) return null;
    if (mine.currency === 'SMACK') {
      if (!SAK.SolanaTokenHouse) return null;
      const payoutTokens = won ? mine.wagerTokens * 0.99 * 1.9 : 0;
      const out = { currency: 'SMACK', wagerTokens: mine.wagerTokens, payoutTokens, won, burnTokens: mine.wagerTokens * 0.01 };
      try {
        const st = await SAK.SolanaTokenHouse.getState().catch(() => null);
        if (st && st.resolver && st.resolver !== W.address) {
          toast('⏳ House is settling your bet — no wallet step needed', 2800);
          try {
            const settled = await queueSoloSettlement('SMACK', mine, won);
            if (!settled) toast('⏳ Settlement queued — your payout lands automatically', 2800);
          } catch (e) {
            toast('Bet is safe on-chain — the house will settle it shortly', 3000);
          }
          if (activeSoloBet === mine) activeSoloBet = null;
          return out;
        }
        toast('Settle — approve in wallet…', 2400);
        await SAK.SolanaTokenHouse.resolveBet(mine.bet, W.address, mine.nonce, won);
        if (activeSoloBet === mine) activeSoloBet = null;
        return out;
      } catch (e) {
        toast(friendlyTokenError(e, 'settle'), 2600);
        return null;
      }
    }
    if (!SAK.SolanaHouse) return null;
    const { bet, nonce, wagerSol } = mine;
    const outSol = { wagerSol, payout: won ? (wagerSol * 1.9) : 0, won, burnSol: 0 }; // SOL skips the 1% burn
    try {
      const st = await SAK.SolanaHouse.getHouseState().catch(() => null);
      if (st && st.resolver && st.resolver !== W.address) {
        toast('⏳ House is settling your bet — no wallet step needed', 2800);
        try {
          const settled = await queueSoloSettlement('SOL', mine, won);
          if (!settled) toast('⏳ Settlement queued — your payout lands automatically', 2800);
        } catch (e) {
          toast('Bet is safe on-chain — the house will settle it shortly', 3000);
        }
        if (activeSoloBet === mine) activeSoloBet = null;
        return outSol;
      }
      toast('Settle — approve in wallet…', 2400);
      await SAK.SolanaHouse.resolveBet(bet, W.address, nonce, won);
      if (activeSoloBet === mine) activeSoloBet = null;
      return outSol;
    } catch (e) {
      toast(friendlyHouseError(e, 'settle'), 2600);
      return null;
    }
  }


  /* --- SMACK TALK message board ----------------------------------------- */
  const ST_TAUNTS = ['🖐 Your guard is down', '💰 0.1 SOL, coward', '😂 Soft hands', '📉 Ngmi', '⚡ Catch this slap'];
  let stMessages = [];
  let stReplyTo = null;   // message being replied to {id, wallet, name, message}

  function stTimeAgo(ts) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.floor(m / 60) + 'h ago';
  }

  function stEscapeHtml(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stHighlightMentions(text) {
    // Strip URLs - no clickable links allowed in Smack Talk
    const noUrls = String(text).replace(/(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?)/gi, '[link removed]');
    const escaped = stEscapeHtml(noUrls);
    return escaped.replace(/@([\w\s]{1,24})/g, '<span class="st-mention">@$1</span>');
  }

  function stAvatarHtml(msg) {
    try {
      if (msg.look && SAK.avatarSVG) return SAK.avatarSVG(msg.look);
    } catch (e) {}
    const emojis = ['🧑', '🧔', '👨', '👩', '🧓'];
    const idx = (msg.wallet || '').charCodeAt(0) % emojis.length;
    return emojis[idx];
  }

  function renderSmackTalk() {
    const box = $('#st-messages');
    if (!box) return;
    const myWallet = W.address;
    if (!stMessages.length) {
      box.innerHTML = '<div class="st-empty">No smack yet. Talk your trash 👇</div>';
      return;
    }
    box.innerHTML = stMessages.map(m => {
      const own = m.wallet === myWallet;
      const liked = (m.liked_by || []).includes(myWallet);
      const quote = m.reply_to ? `<div class="st-quote"><b>${stEscapeHtml(m.reply_to.name || 'Fighter')}</b><span>${stEscapeHtml(m.reply_to.message || '')}</span></div>` : '';
      const reactions = m.reactions || {};
      const rKeys = Object.keys(reactions).filter(k => (reactions[k] || []).length);
      const rPills = rKeys.length ? `<div class="st-reactions">${rKeys.map(k => {
        const mine = (reactions[k] || []).includes(myWallet);
        return `<button class="st-rpill${mine ? ' mine' : ''}" data-react="${m.id}" data-emoji="${k}">${k} ${(reactions[k] || []).length}</button>`;
      }).join('')}</div>` : '';
      return `<div class="st-msg${own ? ' own' : ''}" data-id="${m.id}">
        <div class="st-av">${stAvatarHtml(m)}</div>
        <div class="st-bubble">
          ${quote}
          <div class="st-name">${stEscapeHtml(m.name)}</div>
          <div class="st-text">${stHighlightMentions(m.message)}</div>
          <div class="st-meta-row">
            <button class="st-like${liked ? ' liked' : ''}" data-like="${m.id}">👍 ${m.likes || 0}</button>
            <span class="st-time">${stTimeAgo(m.created_at)}</span>
          </div>
          ${rPills}
        </div>
      </div>`;
    }).join('');
    // Scroll to bottom
    box.scrollTop = box.scrollHeight;
    // Wire reaction pills (tap to toggle your reaction)
    box.querySelectorAll('[data-react]').forEach(pill => {
      pill.onclick = async (e) => {
        e.stopPropagation();
        if (!W.address || !SAK.PvpSync) return;
        const updated = await SAK.PvpSync.toggleSmackTalkReaction(pill.dataset.react, W.address, pill.dataset.emoji);
        if (updated && updated.id) {
          const idx = stMessages.findIndex(m => m.id === updated.id);
          if (idx >= 0) { Object.assign(stMessages[idx], updated); renderSmackTalk(); }
        }
      };
    });
    // Wire like buttons
    box.querySelectorAll('[data-like]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!W.address || !SAK.PvpSync) return;
        const updated = await SAK.PvpSync.likeSmackTalk(btn.dataset.like, W.address);
        if (updated && updated.id) {
          const idx = stMessages.findIndex(m => m.id === updated.id);
          if (idx >= 0) { Object.assign(stMessages[idx], updated); renderSmackTalk(); }
        }
      };
    });
  }

  function stShowReplyBar() {
    const bar = $('#st-reply-bar');
    if (!bar) return;
    if (stReplyTo) {
      $('#st-reply-name').textContent = 'Replying to ' + (stReplyTo.name || 'Fighter');
      $('#st-reply-text').textContent = stReplyTo.message || '';
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  }

  const ST_REACT_EMOJIS = ['❤️', '😂', '🔥', '😮', '😢', '👎'];

  function stStartReply(msgId) {
    const m = stMessages.find(x => x.id === msgId);
    if (!m) return;
    stReplyTo = { id: m.id, wallet: m.wallet, name: m.name, message: m.message };
    stShowReplyBar();
    const input = $('#st-input');
    if (input) input.focus();
  }

  function stShowMsgPopup(msgId) {
    const m = stMessages.find(x => x.id === msgId);
    if (!m || !W.address) return;
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
    // Remove any existing popup
    const old = document.getElementById('st-msg-popup');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'st-msg-popup';
    overlay.className = 'st-popup-overlay';
    overlay.innerHTML = `<div class="st-popup">
      <div class="st-popup-preview"><b>${stEscapeHtml(m.name)}</b><span>${stEscapeHtml((m.message || '').slice(0, 80))}</span></div>
      <div class="st-popup-emojis">${ST_REACT_EMOJIS.map(e => `<button class="st-popup-emoji" data-emoji="${e}">${e}</button>`).join('')}</div>
      <button class="st-popup-reply">↩️ Reply</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.querySelectorAll('.st-popup-emoji').forEach(btn => {
      btn.onclick = async () => {
        overlay.remove();
        if (!SAK.PvpSync) return;
        const updated = await SAK.PvpSync.toggleSmackTalkReaction(msgId, W.address, btn.dataset.emoji);
        if (updated && updated.id) {
          const idx = stMessages.findIndex(x => x.id === updated.id);
          if (idx >= 0) { Object.assign(stMessages[idx], updated); renderSmackTalk(); }
        }
      };
    });
    overlay.querySelector('.st-popup-reply').onclick = () => {
      overlay.remove();
      stStartReply(msgId);
    };
  }

  function stCancelReply() {
    stReplyTo = null;
    stShowReplyBar();
  }

  function stWireLongPress() {
    const box = $('#st-messages');
    if (!box || box.dataset.lpWired) return;
    box.dataset.lpWired = '1';
    let lpTimer = null;
    const startLp = (e) => {
      if (e.target.closest('.st-like')) return;   // don't hijack like taps
      const msgEl = e.target.closest('.st-msg');
      if (!msgEl || !msgEl.dataset.id) return;
      const id = msgEl.dataset.id;
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => { stShowMsgPopup(id); lpTimer = null; }, 500);
    };
    const cancelLp = () => { clearTimeout(lpTimer); lpTimer = null; };
    box.addEventListener('touchstart', startLp, { passive: true });
    box.addEventListener('touchend', cancelLp);
    box.addEventListener('touchmove', cancelLp);
    box.addEventListener('touchcancel', cancelLp);
    box.addEventListener('mousedown', startLp);
    box.addEventListener('mouseup', cancelLp);
    box.addEventListener('mouseleave', cancelLp);
    const cancelBtn = $('#st-reply-cancel');
    if (cancelBtn) cancelBtn.onclick = stCancelReply;
  }

  // Smack Talk minimize/expand — collapses everything under the header;
  // the choice persists so the lobby reopens the way the player left it.
  const stToggleBtn = $('#st-toggle');
  if (stToggleBtn) {
    const applyStCollapsed = c => {
      const body = $('#st-body');
      if (body) body.classList.toggle('hidden', c);
      stToggleBtn.textContent = c ? '▸' : '▾';
      stToggleBtn.setAttribute('aria-label', c ? 'Expand chat' : 'Minimize chat');
    };
    let stCollapsed = false;
    try { stCollapsed = localStorage.getItem('sak_st_collapsed') === '1'; } catch (_) {}
    applyStCollapsed(stCollapsed);
    stToggleBtn.addEventListener('click', () => {
      stCollapsed = !stCollapsed;
      applyStCollapsed(stCollapsed);
      try { localStorage.setItem('sak_st_collapsed', stCollapsed ? '1' : '0'); } catch (_) {}
      A.click();
    });
  }

  async function initSmackTalk() {
    if (!SAK.PvpSync) return;
    // Load existing messages
    stMessages = await SAK.PvpSync.getSmackTalkMessages(50);
    renderSmackTalk();
    stWireLongPress();
    // Render quick taunt chips
    const tauntsEl = $('#st-taunts');
    if (tauntsEl) {
      tauntsEl.innerHTML = ST_TAUNTS.map(t => `<button class="st-taunt-chip">${stEscapeHtml(t)}</button>`).join('');
      tauntsEl.querySelectorAll('.st-taunt-chip').forEach(chip => {
        chip.onclick = () => postSmackTalkMsg(chip.textContent);
      });
    }
    // Wire send button + Enter key
    const input = $('#st-input');
    const sendBtn = $('#st-send');
    const doSend = () => postSmackTalkMsg(input.value);
    if (sendBtn) sendBtn.onclick = doSend;
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter') doSend(); };
    // Subscribe to realtime
    SAK.PvpSync.subscribeSmackTalk(
      (newMsg) => { // on INSERT
        if (!stMessages.find(m => m.id === newMsg.id)) {
          stMessages.push(newMsg);
          if (stMessages.length > 50) stMessages = stMessages.slice(-50);
          renderSmackTalk();
        }
      },
      (updatedMsg) => { // on UPDATE (likes)
        const idx = stMessages.findIndex(m => m.id === updatedMsg.id);
        if (idx >= 0) { stMessages[idx] = updatedMsg; renderSmackTalk(); }
      }
    );
  }

  async function postSmackTalkMsg(text) {
    if (!W.address || !SAK.PvpSync) { toast('Connect wallet to talk smack'); return; }
    const msg = (text || '').trim();
    if (!msg) return;
    const input = $('#st-input');
    if (input) input.value = '';
    const myName = (S.profile && (S.profile.fighter_name || S.profile.name)) || W.shortAddress();
    const myLook = (S.profile && S.profile.avatar) || null;
    const replyPayload = stReplyTo ? { id: stReplyTo.id, wallet: stReplyTo.wallet, name: stReplyTo.name, message: (stReplyTo.message || '').slice(0, 120) } : null;
    stCancelReply();
    const posted = await SAK.PvpSync.postSmackTalk(W.address, myName, myLook, msg, replyPayload);
    if (!posted) toast('Failed to post — try again');
    // Realtime subscription will add it to the list
  }

  function stopSmackTalk() {
    if (SAK.PvpSync) SAK.PvpSync.unsubscribeSmackTalk();
  }

  // Incoming on-chain challenge via ?sol_challenge=<PDA> link.
  async function checkIncomingChainChallenge() {
    let addr = null;
    try { addr = new URLSearchParams(location.search).get('sol_challenge'); } catch (e) {}
    if (!addr) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    if (!SAK.SolanaEscrow) { setTimeout(() => toast('Escrow module not loaded', 2600), 1200); return; }
    let ch = null;
    try { ch = await SAK.SolanaEscrow.getChallenge(addr); } catch (e) { console.warn('[PvP] getChallenge threw:', e.message); }
    if (!ch) { setTimeout(() => toast('Challenge not found on-chain — try again in a few seconds', 3000), 1200); return; }
    if (ch.stateName !== 'Open') { setTimeout(() => toast('Challenge is ' + ch.stateName + ' (not open)', 2600), 1200); return; }
    const sol = ch.wagerSol;
    const challengerShort = ch.challenger.slice(0, 4) + '…' + ch.challenger.slice(-4);
    const go = async () => {
      closeChainModal();
      if (!W.isConnected) { openWalletModal(); toast('Connect wallet to accept \u{1F45B}', 2200); return; }
      try {
        toast('Accepting — approve the matching deposit…', 2400);
        await SAK.SolanaEscrow.acceptChallenge(ch.address);
        toast(`Accepted! ${sol} SOL each on the line \u2694\uFE0F`, 2600);
        if (SAK.PvpSync) SAK.PvpSync.updateChallengeStatus(ch.address, 'accepted');
        // v2: publish my fighter look snapshot
        if (SAK.PvpSync && S.profile && S.profile.avatar) SAK.PvpSync.publishFighterSnapshot(ch.address, 'acceptor', S.profile.avatar);
        // v2: prefer the challenger's published snapshot (identical on both phones)
        let snapsC = null;
        if (SAK.PvpSync && SAK.PvpSync.getFighterSnapshots) {
          try { snapsC = await SAK.PvpSync.getFighterSnapshots(ch.address); } catch (e) {}
        }
        const shadow = await resolvePvpShadow(ch.challenger, snapsC && snapsC.challengerLook);
      // v2: lobby handshake — wait until challenger is confirmed online.
      // No more ghost fights when accepting minutes after the challenge.
      startPvpFightWithLobby(shadow,
        { mode: 'classic', pvp: true, chainChallenge: ch.address, chainWagerSol: sol, chainRole: 'acceptor', chainOpponentWallet: ch.challenger },
        ch.address, W.address, ch.challenger);
      } catch (e) { toast('Accept failed: ' + (e.message || e), 2600); }
    };
    const closeChainModal = () => {
      const m = document.getElementById('chain-challenge-modal');
      if (m) m.remove();
    };
    setTimeout(() => {
      closeChainModal();
      const modal = document.createElement('div');
      modal.id = 'chain-challenge-modal';
      modal.innerHTML =
        '<div style="position:fixed;inset:0;z-index:9999;background:rgba(5,5,15,0.92);display:flex;align-items:center;justify-content:center;padding:20px;">' +
        '<div style="background:linear-gradient(160deg,#1a1033,#0d0a1f);border:2px solid #f5c542;border-radius:20px;padding:28px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 60px rgba(245,197,66,0.25);">' +
        '<div style="font-size:52px;margin-bottom:8px;">\u{1F94B}</div>' +
        '<div style="font-size:22px;font-weight:800;color:#f5c542;margin-bottom:4px;">YOU\u2019VE BEEN CHALLENGED</div>' +
        '<div style="font-size:12px;color:#888;margin-bottom:16px;">⛓ ON-CHAIN ESCROW · DEVNET</div>' +
        '<div style="background:#00000055;border-radius:12px;padding:14px;margin-bottom:16px;">' +
        '<div style="font-size:13px;color:#aaa;">CHALLENGER</div>' +
        '<div style="font-size:16px;font-weight:700;font-family:monospace;margin:4px 0;">' + challengerShort + '</div>' +
        '<div style="font-size:13px;color:#aaa;margin-top:10px;">WAGER EACH</div>' +
        '<div style="font-size:32px;font-weight:800;color:#4ade80;">' + sol + ' SOL</div>' +
        '<div style="font-size:11px;color:#666;margin-top:4px;">Winner takes ' + (parseFloat(sol) * 2 * 0.95).toFixed(3) + ' SOL (5% fee)</div>' +
        (() => {
          const nowSec = Math.floor(Date.now() / 1000);
          const remainSec = Math.max(0, (ch.expiry || 0) - nowSec);
          if (remainSec <= 0) return '';
          const hrs = Math.floor(remainSec / 3600);
          const mins = Math.floor((remainSec % 3600) / 60);
          const tstr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
          return '<div style="font-size:12px;color:#f5c542;margin-top:8px;">⏰ Expires in ' + tstr + '</div>';
        })() +
        '</div>' +
        '<button id="chain-accept-btn" style="display:block;width:100%;padding:16px;margin:8px 0;border:none;border-radius:14px;font-size:18px;font-weight:800;cursor:pointer;background:linear-gradient(180deg,#22c55e,#16a34a);color:#fff;">\u{2694}\uFE0F ACCEPT & FIGHT</button>' +
        '<button id="chain-decline-btn" style="display:block;width:100%;padding:12px;margin:8px 0;border:1px solid #444;border-radius:14px;font-size:15px;font-weight:600;cursor:pointer;background:transparent;color:#999;">Decline</button>' +
        '</div></div>';
      document.body.appendChild(modal);
      document.getElementById('chain-accept-btn').onclick = go;
      document.getElementById('chain-decline-btn').onclick = closeChainModal;
    }, 1600);
  }
  // Claim winnings after an on-chain fight (resolver signs).
  async function claimChainWinnings() {
    const addr = F.opts && F.opts.chainChallenge;
    if (!addr || !SAK.SolanaEscrow) return;
    try {
      const ch = await SAK.SolanaEscrow.getChallenge(addr);
      if (!ch || ch.stateName !== 'Accepted') { toast('Challenge not ready to settle', 2000); return; }
      const winner = W.address; // local player won (this runs on win path)
      toast('Settling on-chain — approve in wallet…', 2400);
      const res = await SAK.SolanaEscrow.resolveChallenge(addr, winner);
      toast('Winnings claimed! ' + res.signature.slice(0, 12) + '…', 2600);
    } catch (e) {
      if (e.code === 'NOT_RESOLVER') toast('Only the resolver wallet can settle on devnet', 2600);
      else toast('Settle failed: ' + (e.message || e), 2600);
    }
  }

  // AI stand-in for the legacy ?challenge=CODE path: use the challenger's
  // real fighter name when the challenge row carries one.
  function pvpShadowKOL(ch) {
    const base = roster()[0];
    const nm = ch.challenger_name || ch.name || ('Challenger ' + ch.challenger_wallet.slice(0, 4));
    return Object.assign({}, base, { name: nm, pvp: true });
  }

  /* --- input: private local meter lock ----------------------------------- */
  function onMeterTap(e) {
    if (screen !== 'fight' || !F) return;
    if (!$('#modal-settings').classList.contains('hidden')) return;
    if (F.turn !== 'challenge') return;
    e.preventDefault();
    e.stopPropagation();
    A.unlock();
    lockLocal(false);
  }
  // Attacks ONLY via the meter — no more tap-anywhere
  const meterLocal = $('#meter-local');
  if (meterLocal) {
    meterLocal.addEventListener('pointerdown', onMeterTap);
    meterLocal.style.cursor = 'pointer';
    meterLocal.style.touchAction = 'manipulation';
    // Press glow: board lights up with a wider outline while pressed
    const panelLocal = $('#panel-local');
    const pressOn = () => { if (panelLocal) panelLocal.classList.add('meter-pressed'); };
    const pressOff = () => { if (panelLocal) panelLocal.classList.remove('meter-pressed'); };
    meterLocal.addEventListener('pointerdown', pressOn);
    window.addEventListener('pointerup', pressOff);
    window.addEventListener('pointercancel', pressOff);
  }
  window.addEventListener('keydown', e => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (screen !== 'fight' || !F) return;
    // Space/Enter continues past the inline lock reveal
    if (revealDismiss && !e.repeat && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      revealDismiss();
      return;
    }
    if (F.turn === 'challenge') {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyA' || e.code === 'KeyL'
          || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        lockLocal(false);
        return;
      }
    }
    if ({ KeyF: 1, KeyH: 1, KeyR: 1 }[e.code]) usePowerup({ KeyF: 'fist', KeyH: 'helmet', KeyR: 'rage' }[e.code]);
  });

  /* ============================================================== SETTINGS */
  $('#btn-settings').addEventListener('click', () => {
    A.unlock(); A.click();
    $('#set-sound').checked = S.settings.sound;
    $('#set-haptics').checked = S.settings.haptics;
    $('#btn-forfeit').classList.toggle('hidden', !(screen === 'fight' && F && !['over', 'done', 'busy'].includes(F.turn)));
    renderMenu();
    refreshAdminAccess();
    $('#modal-settings').classList.remove('hidden');
  });
  $('#btn-close-settings').addEventListener('click', () => $('#modal-settings').classList.add('hidden'));
  // V2: fight-screen arena label
  window.__setArenaLabel = () => { const el = $('#arena-label'); if (el && Scene && Scene.arenaName) { el.textContent = '\u{1F3DF}\uFE0F ' + Scene.arenaName; if (typeof renderFightInfoBar === 'function') renderFightInfoBar(); } };
  $('#set-sound').addEventListener('change', e => { S.settings.sound = e.target.checked; SAK.Storage.save(); });
  $('#set-haptics').addEventListener('change', e => { S.settings.haptics = e.target.checked; SAK.Storage.save(); });
  // V2: arena picker — REKT Alley temporarily hidden (2026-10-06): it froze
  // on smack impacts on iPhone; buildRekt() is kept intact for re-enable.
  const ARENAS_UI = [['smackbar', '🍻 SMACK BAR'], ['colosseum', '🕯️ Colosseum']];
  const apick = $('#arena-picks');
  if (apick) {
    const renderArenaPicks = () => {
      apick.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.arena === (S.settings.arena || 'smackbar')));
    };
    ARENAS_UI.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.dataset.arena = id; b.textContent = label;
      b.addEventListener('click', () => {
        S.settings.arena = id; SAK.Storage.save(); renderArenaPicks();
        if (Scene && Scene.setArena) Scene.setArena(id);
        if (window.__setArenaLabel) window.__setArenaLabel();
        A.click(); toast(`Arena: ${label}`);
      });
      apick.appendChild(b);
    });
    renderArenaPicks();
  }
  // Battle music toggle (synth hype loop during fights)
  const mset = $('#set-music');
  if (mset) {
    mset.checked = !!S.settings.battleMusic;
    mset.addEventListener('change', () => {
      A.unlock();
      S.settings.battleMusic = mset.checked; SAK.Storage.save();
      if (mset.checked) A.startMusic(); else A.stopMusic();
    });
  }
  $('#btn-forfeit').addEventListener('click', () => {
    $('#modal-settings').classList.add('hidden');
    if (F && !['over', 'done', 'busy'].includes(F.turn)) { stopMeters(); F.challenge.kWins = F.challenge.winsNeeded; renderRoundScore(); knockout('player'); }
  });
  $('#btn-disconnect').addEventListener('click', () => {
    W.disconnect();
    // Clear stale pending challenge state
    activeChainChallenge = null;
    const badge = $('#pvp-btn-badge');
    if (badge) badge.className = 'pvp-btn-badge hidden';
    $('#modal-settings').classList.add('hidden'); toast('Wallet disconnected'); renderMenu();
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Reset points, upgrades, fan KOLs and stats?')) return;
    SAK.Storage.reset(); location.reload();
  });

  /* --- admin panel (wallet-gated) ---------------------------------------- */
  let isAdmin = false;
  async function refreshAdminAccess() {
    isAdmin = false;
    if (W.isConnected && W.address) {
      try { const p = await SAK.Api.getProfile(W.address); isAdmin = !!(p && p.is_admin); } catch (e) {}
    }
    $('#btn-admin').classList.toggle('hidden', !isAdmin);
  }
  W.onChange(() => refreshAdminAccess());
  $('#btn-admin').addEventListener('click', () => { A.click(); openAdmin(); });

  const TUNABLES = [
    ['wager_min_sol', 'Min wager', 'SOL per challenge'],
    ['wager_max_sol', 'Max wager', 'SOL per challenge'],
    ['challenge_ttl_hours', 'Challenge expiry', 'hours before auto-expire'],
    ['pts_per_win', 'PTS per win', 'free-play reward'],
  ];
  const HOUSE_TUNABLES = [
    ['house_win_bps', 'Player win rate', 'basis points'],
    ['house_payout_bps', 'Win payout', 'basis points'],
  ];
  /* --- vault tracker (admin): live house vault + gameplay stats -------- */
  async function refreshAdminVault() {
    const el = $('#admin-vault');
    if (!el) return;
    const btn = $('#admin-vault-refresh');
    if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
    el.textContent = 'Reading the vault from devnet…';
    const row = (label, val) => `<div class="vt-row"><span>${label}</span><b>${val}</b></div>`;
    try {
      const H = SAK.SolanaHouse;
      const st = await H.getHouseState();
      let html =
        `<div class="vt-hero"><span class="vt-hero-label">VAULT BALANCE</span>` +
        `<span class="vt-hero-val">◎ ${fmtSol(st.vaultLamports)} <small>SOL</small></span>` +
        `<span class="vt-hero-sub">Max bet it can cover: ◎ ${fmtSol(st.maxBetLamports)} SOL</span></div>`;
      // Gameplay totals from the Bet accounts — independent read, so a
      // failure here never blanks the balance above.
      try {
        const ob = await H.getOpenBetsSummary();
        html += `<div class="vt-tiles">` +
          `<div><b>${ob.totalBets}</b><small>BETS PLACED</small></div>` +
          `<div><b>${ob.resolvedCount} · ${ob.openCount}</b><small>SETTLED · OPEN</small></div>` +
          `<div><b>◎ ${fmtSol(ob.totalWagerLamports)}</b><small>WAGERED IN</small></div></div>` +
          `<div class="vt-sub">DETAILS</div>` +
          row('Average bet', `◎ ${fmtSol(ob.avgWagerLamports)} SOL`) +
          row('Biggest bet', `◎ ${fmtSol(ob.maxWagerLamports)} SOL`) +
          row('SOL locked in open bets', `◎ ${fmtSol(ob.betVaultLamports)} SOL`);
      } catch (e) { html += `<div class="vt-sub">DETAILS</div>` + row('Bet history', 'unavailable right now'); }
      html += `<div class="vt-sub">ON-CHAIN CONFIG</div><div class="vt-tiles four">` +
        `<div><b>${st.winBps / 100}%</b><small>WIN RATE</small></div>` +
        `<div><b>${st.payoutBps / 10000}×</b><small>PAYOUT</small></div>` +
        `<div><b>${st.maxBetBps / 100}%</b><small>RISK CAP</small></div>` +
        `<div><b>${st.burnBps / 100}%</b><small>BURN</small></div></div>`;
      // Recent money in/out on the main vault (funding, lost wagers in,
      // win profits out).
      try {
        const acts = await H.getVaultActivity(8);
        if (acts.length) {
          html += `<div class="vt-sub">RECENT VAULT MOVES</div>`;
          for (const a of acts) {
            const inSol = a.deltaLamports > 0;
            const label = inSol
              ? (a.deltaLamports >= 1e9 ? 'Funding / deposit in' : 'Lost wager collected')
              : 'Win payout out';
            const when = a.blockTime ? new Date(a.blockTime * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
            html += `<div class="vt-move"><span class="vt-arrow ${inSol ? 'in' : 'out'}">${inSol ? '▲' : '▼'}</span>` +
              `<span class="vt-move-main"><span class="vt-move-label">${label}</span>${when ? `<span class="vt-move-time">${when}</span>` : ''}</span>` +
              `<b class="vt-move-amt ${inSol ? 'in' : 'out'}">${inSol ? '+' : '−'}◎ ${fmtSol(Math.abs(a.deltaLamports))}</b></div>`;
          }
        }
      } catch (e) { /* activity is a bonus; the totals above still stand */ }
      // Settlement service: who is allowed to sign resolve_bet right now.
      const svcW = SAK.SETTLEMENT_SERVICE_WALLET;
      const svcOn = !!svcW && st.resolver === svcW;
      html += `<div class="vt-sub">SETTLEMENT</div>` +
        row('Resolver', `<code>${st.resolver ? st.resolver.slice(0, 4) + '…' + st.resolver.slice(-4) : '—'}</code>`) +
        (svcOn
          ? `<div class="fine" style="margin:4px 0;">✅ The settlement service settles every player's bets automatically — nobody signs a settle popup.</div>`
          : `<button class="btn btn-gold" id="admin-handover-sol" style="width:100%;margin:4px 0;">🤖 HAND SOL SETTLEMENTS TO THE SERVICE</button>` +
            `<div class="fine" style="margin:2px 0 4px;">One tap: the service wallet becomes the resolver, so every player's bet settles automatically after their fight. You stay admin and can take it back any time. (Needs the hourly contract update — live from ~12:00 PM today.)</div>`);
      html += row('Vault address', `<code>${st.vaultAddress.slice(0, 4)}…${st.vaultAddress.slice(-4)}</code>`) +
        `<div class="vt-foot">Last checked ${new Date().toLocaleTimeString()} · devnet</div>`;
      el.innerHTML = html;
      const hoBtn = $('#admin-handover-sol');
      if (hoBtn) hoBtn.onclick = async () => {
        hoBtn.disabled = true; hoBtn.textContent = 'APPROVE IN WALLET…';
        try {
          await SAK.SolanaHouse.setResolver(SAK.SETTLEMENT_SERVICE_WALLET);
          toast('🤖 Settlement service is live for the SOL house', 3200);
        } catch (e) {
          const m = String((e && e.message) || '');
          toast(/reject|denied|cancel/i.test(m) ? 'Handover cancelled in wallet' : '⚠️ SOL handover failed: ' + (m ? m.slice(-110) : 'unknown error'), 6500);
        }
        refreshAdminVault();
      };
    } catch (e) {
      el.textContent = '⚠️ Could not reach the devnet vault from this device. Check your connection and tap REFRESH VAULT.';
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 REFRESH VAULT'; }
  }

  let openBetsCache = [];
  function betAge(ms) {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
    if (s < 172800) return (s / 3600).toFixed(1).replace(/\.0$/, '') + 'h ago';
    return (s / 86400).toFixed(1).replace(/\.0$/, '') + 'd ago';
  }

  async function refreshAdminOpenBets() {
    const el = $('#admin-openbets');
    if (!el) return;
    const btn = $('#admin-openbets-refresh');
    if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
    el.textContent = 'Reading open bets from devnet…';
    try {
      const bets = await SAK.SolanaHouse.getOpenBets();
      openBetsCache = bets;
      if (!bets.length) {
        el.innerHTML = `<div class="vt-row"><span>No open bets</span><b>All settled 🎉</b></div>`;
      } else {
        const total = bets.reduce((sum, b) => sum + b.wagerLamports, 0);
        let html = `<div class="vt-row"><span>${bets.length} open · locked in bet vaults</span><b>◎ ${fmtSol(total)} SOL</b></div>`;
        if (bets.length >= 2) {
          html += `<button class="btn btn-red" id="ob-settle-all">🧹 SETTLE ALL ${bets.length} AS LOSS · ◎ ${fmtSol(total)} → VAULT</button>`;
        }
        bets.forEach((b, i) => {
          const mine = W.address && b.player === W.address;
          const who = `${b.player.slice(0, 4)}…${b.player.slice(-4)}${mine ? ' · YOU' : ''}`;
          const when = new Date(b.nonce).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          html += `<div class="ob-row"><div class="ob-head">` +
            `<span class="vt-move-label">◎ ${fmtSol(b.wagerLamports)} SOL — ${who}</span>` +
            `<span class="vt-move-time">Placed ${when} · ${betAge(b.nonce)}</span></div>` +
            `<div class="ob-actions">` +
            `<button class="ob-btn win" data-ob="${i}" data-won="1">SETTLE WIN</button>` +
            `<button class="ob-btn loss" data-ob="${i}" data-won="0">SETTLE LOSS</button>` +
            `</div></div>`;
        });
        el.innerHTML = html;
        el.querySelectorAll('.ob-btn').forEach(btnEl => { btnEl.onclick = () => settleOpenBet(btnEl); });
        const allBtn = $('#ob-settle-all');
        if (allBtn) allBtn.onclick = () => settleAllOpenBets(allBtn);
      }
    } catch (e) {
      el.textContent = '⚠️ Could not reach devnet from this device. Check your connection and tap REFRESH OPEN BETS.';
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 REFRESH OPEN BETS'; }
  }

  // Two-tap confirm: first tap arms the button ("SURE?"), second settles.
  // The wallet signature prompt is the final gate either way.
  async function settleOpenBet(btnEl) {
    const b = openBetsCache[Number(btnEl.dataset.ob)];
    if (!b) return;
    const label = won => won ? 'SETTLE WIN' : 'SETTLE LOSS';
    if (!btnEl.classList.contains('armed')) {
      document.querySelectorAll('.ob-btn.armed').forEach(x => { x.classList.remove('armed'); x.textContent = label(x.dataset.won === '1'); });
      btnEl.classList.add('armed');
      btnEl.textContent = 'SURE?';
      setTimeout(() => { if (btnEl.isConnected && btnEl.classList.contains('armed')) { btnEl.classList.remove('armed'); btnEl.textContent = label(btnEl.dataset.won === '1'); } }, 3500);
      return;
    }
    const won = btnEl.dataset.won === '1';
    const row = btnEl.closest('.ob-row');
    if (row) row.querySelectorAll('.ob-btn').forEach(x => { x.disabled = true; });
    btnEl.textContent = 'SETTLING…';
    try {
      await SAK.SolanaHouse.resolveBet(b.bet, b.player, b.nonce, won);
      toast(won
        ? `✅ Settled as a WIN — player receives ◎ ${fmtSol(Math.round(b.wagerLamports * 1.9))} total`
        : `✅ Settled as a LOSS — ◎ ${fmtSol(b.wagerLamports)} returned to the vault`, 3400);
      refreshAdminOpenBets();
      refreshAdminVault();
    } catch (e) {
      const msg = (e && e.message) || '';
      toast(/reject|declined|cancel/i.test(msg) ? 'Settle cancelled in wallet — the bet is still open' : '⚠️ Settle failed — the bet is still open, try again', 3200);
      refreshAdminOpenBets();
    }
  }

  // Bulk cleanup: settle every open bet as LOSS. Same two-tap arm as the
  // per-bet buttons; the data layer batches 8 resolves per transaction,
  // so a long list takes a couple of wallet signatures, not one per bet.
  async function settleAllOpenBets(btnEl) {
    if (!openBetsCache.length) return;
    if (!btnEl.classList.contains('armed')) {
      btnEl.classList.add('armed');
      btnEl.dataset.label = btnEl.textContent;
      btnEl.textContent = `SURE? SETTLE ALL ${openBetsCache.length} AS LOSS`;
      setTimeout(() => { if (btnEl.isConnected && btnEl.classList.contains('armed')) { btnEl.classList.remove('armed'); btnEl.textContent = btnEl.dataset.label; } }, 3500);
      return;
    }
    const bets = openBetsCache.slice();
    const total = bets.reduce((sum, b) => sum + b.wagerLamports, 0);
    btnEl.disabled = true;
    btnEl.textContent = 'SETTLING…';
    document.querySelectorAll('.ob-btn').forEach(x => { x.disabled = true; });
    try {
      const r = await SAK.SolanaHouse.resolveAllLoss(bets);
      toast(`✅ ${r.settled} bets settled as LOSS — ◎ ${fmtSol(total)} returned to the vault`, 3600);
    } catch (e) {
      const done = (e && e.settled) || 0;
      const msg = (e && e.message) || '';
      if (done > 0) toast(`⚠️ Settled ${done} of ${bets.length} — the rest are still open, tap REFRESH OPEN BETS`, 3600);
      else toast(/reject|declined|cancel/i.test(msg) ? 'Settle-all cancelled in wallet — nothing was settled' : '⚠️ Settle-all failed — no bets were settled, try again', 3200);
    }
    refreshAdminOpenBets();
    refreshAdminVault();
  }

  // ---- PLAYER SIGNUPS (admin) ----
  // One profiles row per wallet that signed on (connected + created a
  // fighter). Tiles: total, new today / this week (Toronto time), and
  // how many have actually fought (fight_history, recording since
  // Oct 23). Recent signups listed newest first.
  async function refreshAdminPlayers() {
    const el = $('#admin-players');
    if (!el) return;
    let stats;
    try { stats = await SAK.Api.getPlayerStats(); }
    catch (e) { el.innerHTML = '<p class="fine dark">Could not load player stats right now.</p>'; return; }
    const signups = stats.signups || [];
    const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayKey = dayFmt.format(new Date());
    const weekAgo = Date.now() - 7 * 864e5;
    const newToday = signups.filter(r => dayFmt.format(new Date(r.created_at)) === todayKey).length;
    const newWeek = signups.filter(r => new Date(r.created_at).getTime() >= weekAgo).length;
    const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', year: 'numeric' });
    const short = w => w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '';
    el.innerHTML =
      `<div class="vt-tiles four">` +
      `<div><b>${signups.length}</b><small>TOTAL SIGNUPS</small></div>` +
      `<div><b>${newToday}</b><small>NEW TODAY</small></div>` +
      `<div><b>${newWeek}</b><small>THIS WEEK</small></div>` +
      `<div><b>${stats.fought || 0}</b><small>HAVE FOUGHT</small></div></div>` +
      `<div class="vt-sub">RECENT SIGNUPS</div>` +
      (signups.slice(0, 10).map(r =>
        `<div class="vt-row"><span>${esc(r.name || 'Unnamed')}</span><b>${short(r.wallet)} · ${dateFmt.format(new Date(r.created_at))}</b></div>`).join('')
        || '<div class="vt-row"><span>No signups yet</span><b>—</b></div>');
  }

  // ---- SMACK TOKEN HOUSE (admin) ----
  let tokenOpenBetsCache = [];
  async function refreshAdminTokenHouse() {
    const el = $('#admin-tokenhouse');
    if (!el) return;
    const btn = $('#admin-tokenhouse-refresh');
    if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
    const TH = SAK.SolanaTokenHouse;
    const row = (l, v) => `<div class="vt-row"><span>${l}</span><b>${v}</b></div>`;
    const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '—';
    try {
      if (!TH) { el.textContent = 'Token house module not loaded.'; return; }
      const st = await TH.getState();
      if (!st.initialized) {
        el.innerHTML =
          row('Status', 'NOT INITIALIZED') +
          row('Program', short(TH.PROGRAM_ID)) +
          row('Mint (test SMACK)', short(TH.MINT)) +
          `<button class="btn btn-red" id="th-init" style="margin-top:8px;width:100%;">🚀 INITIALIZE SMACK HOUSE</button>` +
          `<p class="fine dark" style="margin-top:6px;">One-time setup. Your connected wallet becomes admin / treasury / resolver at 45% win · 1.9× payout · 5% vault cap · 1% burn — the same shape as the SOL house. After this, KingDev funds the vault with test SMACK and SMACK wagering goes live in the solo lobby.</p>`;
        const b = $('#th-init');
        if (b) b.onclick = async () => {
          b.disabled = true; b.textContent = 'APPROVE IN WALLET…';
          try {
            await TH.initialize();
            toast('✅ SMACK house initialized — you are admin + resolver', 3000);
          } catch (e) {
            const m = String((e && e.message) || '');
            toast(/reject|denied|cancel/i.test(m) ? 'Initialize cancelled in wallet' : '⚠️ Initialize failed — try again', 3000);
          }
          refreshAdminTokenHouse();
        };
        return;
      }
      const open = await TH.getOpenBets().catch(() => []);
      tokenOpenBetsCache = open;
      let html =
        `<div class="vt-hero"><span class="vt-hero-label">SMACK VAULT BALANCE</span>` +
        `<span class="vt-hero-val">${fmtTok(st.vaultBase)} <small>SMACK</small></span>` +
        `<span class="vt-hero-sub">Max bet it can cover: ${fmtTok(st.maxBetBase)} SMACK</span></div>`;
      // Gameplay totals from the Bet accounts — the bet tracker proper,
      // mirroring the SOL vault tracker. Independent read: a failure here
      // never blanks the balance above.
      try {
        const ob = await TH.getOpenBetsSummary();
        html += `<div class="vt-tiles">` +
          `<div><b>${ob.totalBets}</b><small>BETS PLACED</small></div>` +
          `<div><b>${ob.resolvedCount} · ${ob.openCount}</b><small>SETTLED · OPEN</small></div>` +
          `<div><b>${fmtTok(ob.totalWagerBase)}</b><small>WAGERED IN (SMACK)</small></div></div>` +
          `<div class="vt-sub">DETAILS</div>` +
          row('Average bet', `${fmtTok(ob.avgWagerBase)} SMACK`) +
          row('Biggest bet', `${fmtTok(ob.maxWagerBase)} SMACK`) +
          row('SMACK locked in open bets', `${fmtTok(ob.betVaultBase)} SMACK`);
      } catch (e) { html += `<div class="vt-sub">DETAILS</div>` + row('Bet history', 'unavailable right now'); }
      html += `<div class="vt-sub">ON-CHAIN CONFIG</div><div class="vt-tiles four">` +
        `<div><b>${(st.winBps / 100).toFixed(0)}%</b><small>WIN RATE</small></div>` +
        `<div><b>×${(st.payoutBps / 10000).toFixed(2)}</b><small>PAYOUT</small></div>` +
        `<div><b>${(st.maxBetBps / 100).toFixed(0)}%</b><small>RISK CAP</small></div>` +
        `<div><b>${(st.burnBps / 100).toFixed(0)}%</b><small>BURN</small></div></div>` +
        row('Admin', short(st.admin)) + row('Resolver', short(st.resolver));
      // Settlement service: who is allowed to sign resolve_bet right now.
      const svcWT = SAK.SETTLEMENT_SERVICE_WALLET;
      const svcOnT = !!svcWT && st.resolver === svcWT;
      html += `<div class="vt-sub">SETTLEMENT</div>` +
        (svcOnT
          ? `<div class="fine" style="margin:4px 0;">✅ The settlement service settles every player's SMACK bets automatically — nobody signs a settle popup.</div>`
          : `<button class="btn btn-gold" id="th-handover" style="width:100%;margin:4px 0;">🤖 HAND SMACK SETTLEMENTS TO THE SERVICE</button>` +
            `<div class="fine" style="margin:2px 0 4px;">One tap: the service wallet becomes the resolver, so every player's bet settles automatically after their fight. You stay admin and can take it back any time.</div>`);
      // Recent token movement on the vault (funding in, lost wagers in,
      // win profits out) — mirrors the SOL tracker's moves list.
      try {
        const acts = await TH.getVaultActivity(8);
        if (acts.length) {
          html += `<div class="vt-sub">RECENT VAULT MOVES</div>`;
          for (const a of acts) {
            const inTok = a.deltaBase > 0;
            const label = inTok
              ? (a.deltaBase >= 1e12 ? 'Funding / deposit in' : 'Lost wager collected')
              : 'Win payout out';
            const when = a.blockTime ? new Date(a.blockTime * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
            html += `<div class="vt-move"><span class="vt-arrow ${inTok ? 'in' : 'out'}">${inTok ? '▲' : '▼'}</span>` +
              `<span class="vt-move-main"><span class="vt-move-label">${label}</span>${when ? `<span class="vt-move-time">${when}</span>` : ''}</span>` +
              `<b class="vt-move-amt ${inTok ? 'in' : 'out'}">${inTok ? '+' : '−'}${fmtTok(Math.abs(a.deltaBase))} SMACK</b></div>`;
          }
        }
      } catch (e) { /* activity is a bonus; the totals above still stand */ }
      if (!open.length) {
        html += row('Open bets', 'None 🎉');
      } else {
        const total = open.reduce((s, b) => s + b.wagerBase, 0);
        html += row('Open bets', `${open.length} · ${fmtTok(total)} SMACK locked`);
        if (svcOnT) {
          html += `<div class="fine" style="margin:2px 0 4px;">Settlement is automatic now — an open bet clears when its fight result comes in, so the manual settle buttons have retired.</div>`;
        } else if (open.length >= 2) {
          html += `<button class="btn btn-red" id="th-settle-all" style="width:100%;">🧹 SETTLE ALL ${open.length} AS LOSS</button>`;
        }
        open.forEach((b, i) => {
          const mine = W.address && b.player === W.address;
          const who = `${b.player.slice(0, 4)}…${b.player.slice(-4)}${mine ? ' · YOU' : ''}`;
          const when = new Date(b.nonce).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          html += `<div class="ob-row"><div class="ob-head">` +
            `<span class="vt-move-label">${fmtTok(b.wagerBase)} SMACK — ${who}</span>` +
            `<span class="vt-move-time">Placed ${when}</span></div>` +
            (svcOnT ? '' :
              `<div class="ob-actions">` +
              `<button class="ob-btn win th-btn" data-th="${i}" data-won="1">SETTLE WIN</button>` +
              `<button class="ob-btn loss th-btn" data-th="${i}" data-won="0">SETTLE LOSS</button>` +
              `</div>`) +
            `</div>`;
        });
      }
      html += row('Vault address', `<code>${short(st.vaultAddress)}</code>`) +
        `<div class="vt-foot">Last checked ${new Date().toLocaleTimeString()} · devnet</div>`;
      el.innerHTML = html;
      const hoBtnT = $('#th-handover');
      if (hoBtnT) hoBtnT.onclick = async () => {
        hoBtnT.disabled = true; hoBtnT.textContent = 'APPROVE IN WALLET…';
        try {
          await TH.setResolver(SAK.SETTLEMENT_SERVICE_WALLET);
          toast('🤖 Settlement service is live for the SMACK house', 3200);
        } catch (e) {
          const m = String((e && e.message) || '');
          toast(/reject|denied|cancel/i.test(m) ? 'Handover cancelled in wallet' : '⚠️ SMACK handover failed: ' + (m ? m.slice(-110) : 'unknown error'), 6500);
        }
        refreshAdminTokenHouse();
      };
      el.querySelectorAll('.th-btn').forEach(btnEl => { btnEl.onclick = () => settleTokenOpenBet(btnEl); });
      const allBtn = $('#th-settle-all');
      if (allBtn) allBtn.onclick = () => settleAllTokenOpenBets(allBtn);
    } catch (e) {
      el.textContent = '⚠️ Could not reach devnet from this device. Check your connection and tap REFRESH SMACK HOUSE.';
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 REFRESH SMACK HOUSE'; }
  }
  async function settleTokenOpenBet(btnEl) {
    const b = tokenOpenBetsCache[Number(btnEl.dataset.th)];
    if (!b) return;
    const label = won => won ? 'SETTLE WIN' : 'SETTLE LOSS';
    if (!btnEl.classList.contains('armed')) {
      document.querySelectorAll('.th-btn.armed').forEach(x => { x.classList.remove('armed'); x.textContent = label(x.dataset.won === '1'); });
      btnEl.classList.add('armed');
      btnEl.textContent = 'SURE?';
      setTimeout(() => { if (btnEl.isConnected && btnEl.classList.contains('armed')) { btnEl.classList.remove('armed'); btnEl.textContent = label(btnEl.dataset.won === '1'); } }, 3500);
      return;
    }
    const won = btnEl.dataset.won === '1';
    const row = btnEl.closest('.ob-row');
    if (row) row.querySelectorAll('.ob-btn').forEach(x => { x.disabled = true; });
    btnEl.textContent = 'SETTLING…';
    try {
      await SAK.SolanaTokenHouse.resolveBet(b.bet, b.player, b.nonce, won);
      toast(won
        ? `✅ Settled as a WIN — player receives ${fmtTok(Math.round(b.wagerBase * 1.9))} SMACK total`
        : `✅ Settled as a LOSS — ${fmtTok(b.wagerBase)} SMACK returned to the vault`, 3400);
    } catch (e) {
      const msg = (e && e.message) || '';
      toast(/reject|declined|cancel/i.test(msg) ? 'Settle cancelled in wallet — the bet is still open' : '⚠️ Settle failed — the bet is still open, try again', 3200);
    }
    refreshAdminTokenHouse();
  }
  async function settleAllTokenOpenBets(btnEl) {
    if (!tokenOpenBetsCache.length) return;
    if (!btnEl.classList.contains('armed')) {
      btnEl.classList.add('armed');
      btnEl.dataset.label = btnEl.textContent;
      btnEl.textContent = `SURE? SETTLE ALL ${tokenOpenBetsCache.length} AS LOSS`;
      setTimeout(() => { if (btnEl.isConnected && btnEl.classList.contains('armed')) { btnEl.classList.remove('armed'); btnEl.textContent = btnEl.dataset.label; } }, 3500);
      return;
    }
    const bets = tokenOpenBetsCache.slice();
    btnEl.disabled = true;
    btnEl.textContent = 'SETTLING…';
    try {
      const r = await SAK.SolanaTokenHouse.resolveAllLoss(bets);
      toast(`✅ ${r.settled} SMACK bets settled as LOSS — wagers returned to the vault`, 3600);
    } catch (e) {
      const done = (e && e.settled) || 0;
      toast(done > 0 ? `⚠️ Settled ${done} of ${bets.length} — the rest are still open` : '⚠️ Settle-all failed — no bets were settled, try again', 3200);
    }
    refreshAdminTokenHouse();
  }

  /* --- beta codes (admin): per-person gate passcodes ------------------ */
  const BETA_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function genBetaCode() {
    const r = new Uint8Array(8);
    crypto.getRandomValues(r);
    return [...r].map(b => BETA_CODE_ALPHABET[b % 32]).join('');
  }
  async function sha256hex(s) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const escBeta = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Signed beta-codes call (same wallet-signature pattern as admin-config).
  async function betaCall(action, extra) {
    const payload = { action, ...extra, ts: Date.now() };
    const message = JSON.stringify(payload);
    const signed = await Promise.race([
      SAK.Wallet.signMessage(message),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Wallet did not return a signature (timed out)')), 60000)),
    ]);
    const sig = signed && signed.signature;
    if (!sig) throw new Error('Wallet signature required');
    const r = await fetch(SAK.BACKEND.url.replace(/\/$/, '') + '/functions/v1/beta-codes', {
      method: 'POST',
      headers: {
        'apikey': SAK.BACKEND.anonKey,
        'Authorization': 'Bearer ' + SAK.BACKEND.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, wallet: W.address, signature: sig, message }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`beta-codes ${r.status}: ${t.slice(0, 120)}`);
    }
    return r.json();
  }
  async function refreshAdminBetaCodes() {
    const el = $('#admin-beta-list');
    if (!el) return;
    el.textContent = 'Loading beta codes…';
    try {
      const { codes } = await betaCall('list', {});
      if (!codes || !codes.length) {
        el.innerHTML = '<div class="fine dark">No beta codes yet — generate one above.</div>';
        return;
      }
      el.innerHTML = codes.map(c => {
        const revoked = !!c.revoked_at;
        const used = c.first_used_at ? 'first used ' + new Date(c.first_used_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'not used yet';
        const created = new Date(c.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `<div class="ob-row" data-beta-id="${c.id}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><span style="flex:1;min-width:0;"><b>${escBeta(c.label || 'Untitled')}</b>` +
          `<span class="fine dark"> · created ${created} · ${used}</span></span>` +
          (revoked
            ? `<span class="fine dark" style="color:#ff3b5c;flex-shrink:0;">REVOKED</span>`
            : `<button class="btn btn-small" data-beta-revoke="1" style="width:auto;flex-shrink:0;">REVOKE</button>`) +
          `</div>`;
      }).join('');
      // Two-tap arm on revoke (same pattern as the settle buttons).
      el.querySelectorAll('[data-beta-revoke]').forEach(b => {
        b.onclick = async () => {
          if (!b.classList.contains('armed')) {
            b.classList.add('armed'); b.textContent = 'SURE?';
            setTimeout(() => { if (b.isConnected && b.classList.contains('armed')) { b.classList.remove('armed'); b.textContent = 'REVOKE'; } }, 3500);
            return;
          }
          b.disabled = true; b.textContent = 'REVOKING…';
          try {
            await betaCall('revoke', { id: b.closest('[data-beta-id]').dataset.betaId });
            toast('Beta code revoked — no new devices can use it', 2400);
            refreshAdminBetaCodes();
          } catch (e) {
            toast('Revoke failed: ' + (e.message || e), 3000);
            b.disabled = false; b.textContent = 'REVOKE'; b.classList.remove('armed');
          }
        };
      });
    } catch (e) {
      const m = (e && e.message) || '';
      el.innerHTML = (/signature|timed out/i.test(m)
        ? '<div class="fine dark">Sign in your wallet to list beta codes, then refresh.</div>'
        : '<div class="fine dark">Beta codes backend not deployed yet — run the SQL + deploy the beta-codes function, then refresh.</div>');
    }
  }
  async function generateAdminBetaCode() {
    const btn = $('#admin-beta-generate'); if (!btn) return;
    const labelEl = $('#admin-beta-label');
    const label = (labelEl && labelEl.value.trim()) || 'Tester';
    const code = genBetaCode();
    btn.disabled = true; btn.textContent = 'GENERATING…';
    try {
      const codeHash = await sha256hex(code);
      await betaCall('create', { code_hash: codeHash, label });
      const box = $('#admin-beta-new');
      const shown = code.slice(0, 4) + '-' + code.slice(4);
      box.hidden = false;
      box.innerHTML = `New code for <b>${escBeta(label)}</b>: <b style="font-size:20px;letter-spacing:2px;">${shown}</b><br/>Copy this now — it can't be shown again.`;
      if (labelEl) labelEl.value = '';
      toast('Beta code created ✓', 2000);
      refreshAdminBetaCodes();
    } catch (e) {
      toast(e.message && e.message.includes('beta-codes 404')
        ? 'Beta codes backend not deployed yet — deploy the function first'
        : 'Generate failed: ' + (e.message || e), 3200);
    }
    btn.disabled = false; btn.textContent = '🎲 GENERATE';
  }

  async function openAdmin() {
    if (!W.isConnected) { toast('Connect wallet first 👛', 2000); return; }
    const cfg = await SAK.Api.getConfig();
    $('#admin-who').textContent = `Signed in as ${W.shortAddress()}${W.providerName ? ' · ' + W.providerName : ''}`;
    // Fee slider
    const feeEl = $('#admin-fee'), feeLbl = $('#admin-fee-lbl');
    feeEl.value = cfg.platform_fee_bps_default || 500;
    const paintFee = () => feeLbl.textContent = `= ${(feeEl.value / 100).toFixed(2)}%`;
    feeEl.oninput = paintFee; paintFee();
    // Tunables
    const tRow = (key, label, unit) => `
      <div class="tunable"><label>${label}<small>${unit}</small></label>
      <input data-cfg="${key}" type="number" step="any" value="${cfg[key]}" /></div>`;
    $('#admin-tunables').innerHTML = TUNABLES.map(([k, l, u]) => tRow(k, l, u)).join('');
    $('#admin-house').innerHTML = HOUSE_TUNABLES.map(([k, l, u]) => tRow(k, l, u)).join('');
    const paintEdge = () => {
      const w = +($('#admin-house [data-cfg="house_win_bps"]').value || 4500);
      const p = +($('#admin-house [data-cfg="house_payout_bps"]').value || 19000);
      const edge = (10000 - (w * p) / 10000) / 100;
      $('#admin-edge').textContent = `House edge: ${edge.toFixed(2)}%`;
      // Helper text is a live conversion of the input, not a static
      // example — a stale "(4500 = 45%)" after saving 5500 reads as if
      // the save didn't take (LT 2026-10-26).
      const paintUnit = (key, text) => {
        const inp = $('#admin-house [data-cfg="' + key + '"]');
        const sm = inp && inp.closest('.tunable') && inp.closest('.tunable').querySelector('small');
        if (sm) sm.textContent = text;
      };
      paintUnit('house_win_bps', `basis points (${w} = ${w / 100}%)`);
      paintUnit('house_payout_bps', `basis points (${p} = ${p / 10000}x)`);
    };
    $('#admin-house').oninput = paintEdge; paintEdge();
    // Sound effects controls
    const scfg = SAK.Audio.soundCfg || {};
    const bindVol = (id, key) => {
      const el = $('#snd-' + id), lbl = $('#snd-' + id + '-lbl');
      if (!el) return;
      // master: 0-100%, others: 0-150% (stored as 0-1.5 multiplier)
      const toSlider = v => key === 'master' ? Math.round(v * 100) : Math.round(v / 1.5 * 100);
      const fromSlider = s => key === 'master' ? s / 100 : (s / 100) * 1.5;
      el.value = toSlider(scfg[key] ?? (key === 'master' ? 0.5 : 1));
      const paint = () => { lbl.textContent = el.value + '%'; };
      el.oninput = () => { paint(); scfg[key] = fromSlider(+el.value); SAK.Audio.saveSoundCfg(); };
      paint();
    };
    bindVol('master', 'master'); bindVol('slap', 'slap'); bindVol('crowd', 'crowd'); bindVol('react', 'react');
    const bindToggle = (id, key) => {
      const el = $('#snd-' + id + '-toggle');
      if (!el) return;
      const paint = () => { el.textContent = scfg[key] ? 'ON' : 'OFF'; el.classList.toggle('btn-grey', !scfg[key]); };
      el.onclick = () => { scfg[key] = !scfg[key]; SAK.Audio.saveSoundCfg(); paint(); };
      paint();
    };
    bindToggle('react', 'reactOn'); bindToggle('defeat', 'defeatOn');
    // Preview + replace + reset sounds (custom uploads via IndexedDB)
    const SND_DEFS = [
      ['slap', '👋 Slap', 'every face slap', true],
      ['react_boing', '🌀 Boing', 'random layer on face slaps', true],
      ['react_whistle1', '🎵 Whistle 1', 'random layer on face slaps', true],
      ['react_whistle2', '🎵 Whistle 2', 'random layer on face slaps', true],
      ['defeat_dizzy', '😵 Dizzy', 'random on defeat', true],
      ['defeat_trombone', '🎺 Trombone', 'random on defeat', true],
      ['defeat_silly', '💥 Silly Boom', 'KO layer only', true],
      ['ko', '🥊 KO Impact', 'final knockout hit (layered)', false],
    ];
    // Collapsible folder for the preview/replace editor: collapsed by
    // default, remembers LT's choice across panel opens.
    const sndFoldHead = $('#snd-fold-head'), sndFoldBody = $('#snd-fold-body'), sndFoldArrow = $('#snd-fold-arrow');
    if (sndFoldHead && sndFoldBody) {
      const paintFold = () => {
        const open = !sndFoldBody.hidden;
        if (sndFoldArrow) sndFoldArrow.textContent = open ? '▾' : '▸';
        sndFoldHead.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      try { if (localStorage.getItem('sak_snd_fold') === 'open') sndFoldBody.hidden = false; } catch (e) {}
      paintFold();
      sndFoldHead.onclick = () => {
        sndFoldBody.hidden = !sndFoldBody.hidden;
        try { localStorage.setItem('sak_snd_fold', sndFoldBody.hidden ? 'closed' : 'open'); } catch (e) {}
        paintFold();
      };
    }
    const sndList = $('#snd-list');
    if (sndList && !sndList.dataset.built) {
      sndList.dataset.built = '1';
      SND_DEFS.forEach(([id, name, desc, replaceable]) => {
        const row = document.createElement('div');
        row.className = 'snd-item';
        row.innerHTML = `
          <div class="snd-info"><span class="snd-name">${name}</span><span class="snd-custom-tag hidden" data-custom-tag>custom</span><div class="snd-desc">${desc}</div></div>
          <div class="snd-actions">
            <button class="btn btn-small" data-act="play" title="Preview">▶</button>
            ${replaceable ? `<button class="btn btn-small" data-act="replace" title="Upload your own">📁</button>
            <button class="btn btn-small hidden" data-act="reset" title="Back to default">↩</button>` : ''}
          </div>
          ${replaceable ? `<input type="file" accept="audio/*" data-file />` : ''}`;
        const tag = row.querySelector('[data-custom-tag]');
        const resetBtn = row.querySelector('[data-act="reset"]');
        const paint = () => {
          const isCustom = SAK.Audio.hasCustomSound(id);
          if (tag) tag.classList.toggle('hidden', !isCustom);
          if (resetBtn) resetBtn.classList.toggle('hidden', !isCustom);
        };
        row.querySelector('[data-act="play"]').onclick = () => {
          SAK.Audio.unlock();
          if (id === 'slap') SAK.Audio.slap(1.0);
          else if (id === 'ko') SAK.Audio.ko();
          else SAK.Audio.previewSlap(id);
        };
        const fileInput = row.querySelector('[data-file]');
        if (fileInput) {
          row.querySelector('[data-act="replace"]').onclick = () => fileInput.click();
          fileInput.onchange = async () => {
            const file = fileInput.files[0];
            if (!file) return;
            SAK.Audio.unlock();
            const ok = await SAK.Audio.setCustomSound(id, file);
            toast(ok ? `Custom ${name} saved` : `Couldn't use that file — try an MP3 or WAV`, 2200);
            fileInput.value = '';
            paint();
          };
          resetBtn.onclick = async () => {
            await SAK.Audio.clearCustomSound(id);
            toast(`${name} back to default`, 1800);
            paint();
          };
        }
        paint();
        sndList.appendChild(row);
      });
    }
    // Overview stats
    try {
      const open = await SAK.Api.listChallenges('open');
      $('#admin-stats').innerHTML = `Open challenges: <b>${open.length}</b> · Backend: <b>${SAK.Api.name}</b>`;
    } catch (e) { $('#admin-stats').textContent = 'Stats unavailable'; }
    $('#modal-admin').classList.remove('hidden');
    // Vault tracker: bind refresh + load live state
    const vb = $('#admin-vault-refresh');
    if (vb) vb.onclick = () => { A.click(); refreshAdminVault(); };
    refreshAdminVault();
    const obBtn = $('#admin-openbets-refresh');
    if (obBtn) obBtn.onclick = () => { A.click(); refreshAdminOpenBets(); };
    refreshAdminOpenBets();
    const thBtn = $('#admin-tokenhouse-refresh');
    if (thBtn) thBtn.onclick = () => { A.click(); refreshAdminTokenHouse(); };
    refreshAdminTokenHouse();
    const plBtn = $('#admin-players-refresh');
    if (plBtn) plBtn.onclick = () => { A.click(); refreshAdminPlayers(); };
    refreshAdminPlayers();
    const bb = $('#admin-beta-refresh');
    if (bb) bb.onclick = () => { A.click(); refreshAdminBetaCodes(); };
    const bg = $('#admin-beta-generate');
    if (bg) bg.onclick = () => { A.click(); generateAdminBetaCode(); };
    refreshAdminBetaCodes();
    // Check contract initialization status
    initContractStatus();
  }

  async function initContractStatus() {
    const el = $('#contract-status');
    if (!el) return;
    try {
      const web3 = await window.SAKContracts.loadWeb3();
      const connection = new web3.Connection(window.SAKContracts.RPC_URL, 'confirmed');
      const status = await window.SAKContracts.checkInitialized(web3, connection);
      if (status.error) throw new Error(status.error);
      el.innerHTML = `Escrow: <b>${status.escrow ? '✅ Initialized' : '❌ Not initialized'}</b><br/>House: <b>${status.house ? '✅ Initialized' : '❌ Not initialized'}</b>`;
      const btn = $('#btn-init-contracts');
      if (btn) btn.style.display = (status.escrow && status.house) ? 'none' : '';
    } catch (e) {
      // Plain language only — never dump the raw JS error into the panel.
      console.warn('[SAK] contract status check failed', e);
      el.textContent = 'Status check unavailable right now — reopen the panel to retry.';
    }
  }

  // Initialize contracts button
  document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'btn-init-contracts') {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'INITIALIZING...';
      try {
        if (!W.isConnected) { toast('Connect your admin wallet first 👛', 2500); return; }
        const web3 = await window.SAKContracts.loadWeb3();
        const connection = new web3.Connection(window.SAKContracts.RPC_URL, 'confirmed');
        
        // Get the wallet's signTransaction function
        // W is the wallet module - need to find how to sign
        toast('Check your wallet to approve...', 3000);
        
        // For now, show instructions - the actual signing needs wallet integration
        // This will be completed when W.signTransaction is available
        toast('Contract initialization coming right up...', 2000);
      } catch (err) {
        toast('Init failed: ' + err.message, 3000);
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 INITIALIZE CONTRACTS';
      }
    }
  });

  $('#admin-save').addEventListener('click', async () => {
    const btn = $('#admin-save'); btn.disabled = true; btn.textContent = 'SAVING…';
    try {
      // Collect all changes, sign ONCE, save all in one request.
      const changes = { platform_fee_bps_default: +$('#admin-fee').value };
      $$('#modal-admin [data-cfg]').forEach(inp => { changes[inp.dataset.cfg] = +inp.value; });
      const message = JSON.stringify({ changes, ts: Date.now() });
      // Timeout: if the wallet doesn't return a signature in 60s, bail out.
      const signed = await Promise.race([
        SAK.Wallet.signMessage(message),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Wallet did not return a signature (timed out)')), 60000)),
      ]);
      const sig = signed && signed.signature;
      if (!sig) throw new Error('Wallet signature required');
      const r = await fetch(SAK.BACKEND.url.replace(/\/$/, '') + '/functions/v1/admin-config-', {
        method: 'POST',
        headers: {
          'apikey': SAK.BACKEND.anonKey,
          'Authorization': 'Bearer ' + SAK.BACKEND.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ changes, wallet: W.address, signature: sig, message }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`admin-config ${r.status}: ${t.slice(0, 120)}`);
      }
      A.perfect(); toast('Admin settings saved ✓', 2000);
      $('#modal-admin').classList.add('hidden');
    } catch (e) {
      console.warn('[SAK] admin save failed', e);
      toast(e.message && e.message.includes('admin-config 404')
        ? 'Edge Function not deployed yet — see setup notes'
        : 'Save failed: ' + (e.message || e), 3000);
    }
    btn.disabled = false; btn.textContent = '💾 SAVE ALL';
  });
  // Dev bootstrap: claim admin on first use (works on the mock backend;
  // on Supabase, is_admin is locked by RLS — set it in the dashboard).
  window.SAK_DEBUG = window.SAK_DEBUG || {};
  window.SAK_DEBUG.claimAdmin = async () => {
    if (!W.isConnected) return 'connect wallet first';
    const p = await SAK.Api.saveProfile(W.address, { name: (S.profile && S.profile.name) || 'Admin', is_admin: true });
    await refreshAdminAccess();
    return p.is_admin ? 'admin granted' : 'failed';
  };
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target !== m) return; if (m.id === 'modal-fighter') closeCreator(); else m.classList.add('hidden'); }));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.add('hidden')));

  /* ======================================================= pump/dump ticker */
  function buildTicker() {
    const coins = ['$SLAP', '$FROGGO', '$WOOFY', '$MOONCAT', '$HODL', '$GMGM', '$REKT', '$PALM', '$CHEEK', '$WAGMI', '$NGMI', '$LAMBO', '$COPE', '$PUMP'];
    const items = coins.map(c => {
      const up = Math.random() > 0.38, pct = up ? (Math.random() * 900 + 5) : -(Math.random() * 90 + 1);
      return `<span class="tk ${up ? 'up' : 'down'}">${c} ${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(pct > 100 || pct < -10 ? 0 : 1)}%</span>`;
    }).join('<span class="tk-sep">•</span>');
    const extra = '<span class="tk-sep">•</span><span class="tk gm">GM ☀</span><span class="tk-sep">•</span><span class="tk moon">TO THE MOON 🚀🌕</span><span class="tk-sep">•</span>';
    $('#ticker-track').innerHTML = `<div class="tk-run">${items}${extra}</div><div class="tk-run">${items}${extra}</div>`;
  }

  /* ================================================================== BOOT */
  function menuScene() {
    if (!Scene) return;
    Scene.setOpponent(pick(roster()).look); Scene.resetFight();
  }

  P.onChange(() => { renderPoints(); renderUpgrades(); renderGloves(); if (F) renderPowerups(); if (screen === 'menu') renderMenu(); if (screen === 'pick') renderBets(); if (screen === 'solo' && soloMode === 'free') { renderSoloPtsBets(); renderSoloChallengeBtn(); } });
  W.onChange(() => {
    renderMenu();
    if (W.isConnected && W.address) {
      ensureGlobalChallengeWatch();
      startSolBalancePolling();
    } else {
      stopGlobalChallengeWatch();
      stopSolBalancePolling();
    }
  });

  function boot() {
    // Backend: Supabase when configured AND reachable, local mock otherwise.
    try {
      if (SAK.BACKEND && SAK.BACKEND.url && SAK.BACKEND.anonKey && SAK.Api.SupabaseBackend) {
        const sb = new SAK.Api.SupabaseBackend(SAK.BACKEND.url, SAK.BACKEND.anonKey);
        sb.getConfig().then(
          () => { SAK.Api.use(sb); console.log('[SAK] backend: supabase'); },
          () => console.log('[SAK] backend: supabase unreachable, using mock')
        );
      }
    } catch (e) { console.warn('[SAK] backend swap failed, using mock', e); }
    if (!S.powerups) S.powerups = { fist: 0, helmet: 1, rage: 1 };
    // one-time welcome bonus so bets/upgrades/staking are explorable immediately
    if (!S.welcomeGranted) {
      S.welcomeGranted = true;
      S.points += SAK.POINTS.welcomeBonus; SAK.Storage.save();
      if (S.profile) setTimeout(() => toast(`🎁 Welcome! +${fmt(SAK.POINTS.welcomeBonus)} PTS to get slapping`, 2600), 600);
      else welcomePending = true;   // shown once the account is created (or skipped)
    }
    lastSlots = ugcSlotsUnlocked();
    // Rewards program: daily login bonus + referral link check
    checkDailyLogin();
    checkIncomingReferral();
    MeterLocal = SAK.createMeter($('#meter-local'), { jerky: true, label: '' });
    SAK.Meter.build($('#meter')); // legacy hidden mount
    buildTicker();
    try {
      if (!window.THREE) throw new Error('three.js failed to load (vendor/three.min.js)');
      SAK.Scene3D.init($('#stage'));
      Scene = SAK.Scene3D;
      Scene.setPlayer(playerLook());
      if (S.settings.arena === 'rekt') { S.settings.arena = 'colosseum'; SAK.Storage.save(); } // REKT temporarily hidden — migrate anyone parked there
      if (S.settings.arena === 'moonshot') { S.settings.arena = 'smackbar'; SAK.Storage.save(); } // Moonshot removed — migrate anyone parked there
      // Gloves shop (LT 2026-10-25): no grandfathering is possible — the
      // account sanitizer never kept avatar.gloves, so rolled gloves never
      // persisted or rendered; every player starts at Wraps, nothing lost.
      { const g = gloveState(); if (!g.owned.includes(g.equipped)) { g.equipped = 'wrap'; SAK.Storage.save(); } }
      if (Scene.setArena) Scene.setArena(S.settings.arena || 'smackbar'); // V2: saved arena
      if (window.__setArenaLabel) window.__setArenaLabel();
      menuScene();
    } catch (err) {
      console.error(err);
      $('#webgl-error').classList.remove('hidden');
    }
    shownPts = S.points; $('#points').textContent = fmt(S.points);
    renderMenu();
    show('menu');
    refreshAdminAccess();
    // Incoming X challenge link (?challenge=CODE)
    setTimeout(checkIncomingChallenge, 1800);
    setTimeout(checkIncomingChainChallenge, 2200);
    renderChainBets();
    // First launch: create a local account + fighter
    if (!S.profile) setTimeout(() => { if (!S.profile && screen === 'menu') openFighter(false); }, 500);
    // debug hook for console testing / automated smoke tests
    window.SAK_DEBUG = {
      state: S, get fight() { return F; }, roster, openVault, openShop, openSubmit, openPvp, openLeaderboard,
      startFight: (id, bet, mode) => startFight(roster().find(k => k.id === id) || roster()[0], bet, { mode }),
      lockAt: angle => lockLocal(true, angle),   // smoke tests: lock local meter at an exact angle
      lockOpp: angle => lockOpponentPrivate(angle), // smoke tests: force private opponent lock
      get scene() { return Scene; }
    };
  }
  boot();
})();
