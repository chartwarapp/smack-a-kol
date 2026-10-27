/* =========================================================================
 * SAK.PvpSync — Realtime PvP coordination via Supabase
 *
 * v2 (2026-10-16): True realtime via supabase-js websocket subscriptions.
 * Round locks propagate in ~50-100ms instead of 500ms+ REST polling.
 * REST polling remains as automatic fallback if the socket fails.
 *
 * 1. Challenge status indicators: poll for open challenges involving the
 *    player, show badges on the main menu (AWAITING / ACCEPTED).
 * 2. Disconnect detection: heartbeat during fights. If the opponent's
 *    heartbeat goes stale (>60s), they forfeit and the remaining player wins.
 * 3. Round sync: websocket subscription on pvp_rounds — fires the instant
 *    the opponent's lock lands. No polling.
 * 4. Fighter snapshots: both fighters' looks stored on the challenge row
 *    at accept time, so both phones render IDENTICAL fighters.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.PvpSync = (function () {
  const HEARTBEAT_INTERVAL = 5000;   // ms between heartbeats
  const DISCONNECT_TIMEOUT = 60000;  // ms of silence before forfeit
  const STATUS_POLL_INTERVAL = 10000; // ms between challenge status checks

  let heartbeatTimer = null;
  let watchTimer = null;
  let statusPollTimer = null;
  let currentChallenge = null;
  let myWallet = null;
  let onDisconnect = null;
  let disconnectWarningShown = false;

  function api() { return SAK.Api; }

  /* --- Heartbeat table helpers --------------------------------------- */
  // Table: pvp_heartbeats (challenge_addr TEXT, wallet TEXT, last_seen TIMESTAMPTZ, status TEXT)
  // Primary key: (challenge_addr, wallet)

  async function sendHeartbeat() {
    if (!currentChallenge || !myWallet) return;
    try {
      await api()._req('POST', '/pvp_heartbeats?on_conflict=challenge_addr,wallet',
        {
          challenge_addr: currentChallenge,
          wallet: myWallet,
          last_seen: new Date().toISOString(),
          status: 'fighting',
        },
        'return=minimal,resolution=merge-duplicates');
    } catch (e) {
      console.warn('[PvpSync] heartbeat failed', e.message);
    }
  }

  async function getOpponentHeartbeat(challengeAddr, opponentWallet) {
    try {
      const rows = await api()._req('GET',
        `/pvp_heartbeats?challenge_addr=eq.${encodeURIComponent(challengeAddr)}&wallet=eq.${encodeURIComponent(opponentWallet)}&select=last_seen,status`);
      return rows && rows[0];
    } catch (e) {
      console.warn('[PvpSync] heartbeat read failed', e.message);
      return null;
    }
  }

  async function markForfeited() {
    if (!currentChallenge || !myWallet) return;
    try {
      await api()._req('POST', '/pvp_heartbeats?on_conflict=challenge_addr,wallet',
        {
          challenge_addr: currentChallenge,
          wallet: myWallet,
          last_seen: new Date().toISOString(),
          status: 'opponent_forfeited',
        },
        'return=minimal,resolution=merge-duplicates');
    } catch (e) {}
  }

  /* --- Fight lifecycle ------------------------------------------------ */

  /**
   * Start syncing for a fight.
   * @param {string} challengeAddr - On-chain challenge PDA
   * @param {string} wallet - My wallet address
   * @param {string} opponentWallet - Opponent's wallet address
   * @param {function} onOpponentDisconnect - Called when opponent forfeits
   */
  function startFight(challengeAddr, wallet, opponentWallet, onOpponentDisconnect) {
    stopFight(); // clean up any previous
    currentChallenge = challengeAddr;
    myWallet = wallet;
    onDisconnect = onOpponentDisconnect;
    disconnectWarningShown = false;

    // Send heartbeats
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Watch opponent
    watchTimer = setInterval(async () => {
      const hb = await getOpponentHeartbeat(challengeAddr, opponentWallet);
      if (!hb || !hb.last_seen) return; // no data yet, opponent may not have started

      const age = Date.now() - new Date(hb.last_seen).getTime();

      // Warn at 45s
      if (age > 45000 && !disconnectWarningShown) {
        disconnectWarningShown = true;
        if (typeof toast === 'function') {
          toast('⚠️ Opponent connection unstable…', 3000);
        }
      }

      // Forfeit at 60s
      if (age > DISCONNECT_TIMEOUT) {
        console.log('[PvpSync] Opponent disconnected, declaring forfeit');
        clearInterval(watchTimer); watchTimer = null;
        await markForfeited();
        if (onDisconnect) onDisconnect();
      }
    }, HEARTBEAT_INTERVAL);
  }

  function stopFight() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    currentChallenge = null;
    myWallet = null;
    onDisconnect = null;
    disconnectWarningShown = false;
  }

  /* --- Challenge status indicators ------------------------------------ */

  /**
   * Start polling for challenge status. Updates the menu badge.
   * @param {string} wallet - Player's wallet
   * @param {function} onUpdate - Called with { awaiting, accepted }
   */
  function startStatusPolling(wallet, onUpdate) {
    stopStatusPolling();
    const poll = async () => {
      const status = await getMyChallenges(wallet);
      if (onUpdate) onUpdate(status);
    };
    poll();
    statusPollTimer = setInterval(poll, STATUS_POLL_INTERVAL);
  }

  function stopStatusPolling() {
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
  }

  /* --- Challenge tracking --------------------------------------------- */
  // Table: pvp_challenges (challenge_addr TEXT PK, challenger TEXT, opponent TEXT,
  //                        status TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)

  async function trackChallenge(challengeAddr, challenger, opponent, wagerSol) {
    try {
      await api()._req('POST', '/pvp_challenges?on_conflict=challenge_addr',
        {
          challenge_addr: challengeAddr,
          challenger, opponent,
          status: 'open',
          wager_sol: wagerSol || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'return=minimal,resolution=merge-duplicates');
    } catch (e) { console.warn('[PvpSync] track failed', e.message); }
  }

  async function updateChallengeStatus(challengeAddr, status) {
    try {
      await api()._req('PATCH', `/pvp_challenges?challenge_addr=eq.${encodeURIComponent(challengeAddr)}`,
        { status, updated_at: new Date().toISOString() },
        'return=minimal');
    } catch (e) { console.warn('[PvpSync] status update failed', e.message); }
  }

  async function getMyChallenges(wallet) {
    try {
      // Only consider challenges from the last 24h (max expiry); older ones are stale
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const rows = await api()._req('GET',
        `/pvp_challenges?or=(challenger.eq.${encodeURIComponent(wallet)},opponent.eq.${encodeURIComponent(wallet)})&status=in.(open,accepted,fighting)&created_at=gte.${encodeURIComponent(dayAgo)}&select=*&order=created_at.desc`);
      const awaiting = (rows || []).filter(c => c.status === 'open' && c.challenger === wallet);
      // ACCEPTED badge: only when YOU are the challenger and the fight hasn't
      // started yet — that's the one case with an action (join the fight).
      const accepted = (rows || []).filter(c =>
        c.status === 'accepted' && c.challenger === wallet
      );
      // INCOMING: challenges where YOU are the opponent — these trigger the popup
      const incoming = (rows || []).filter(c => c.status === 'open' && c.opponent === wallet);
      // ACCEPTED-AS-OPPONENT: fights I accepted that haven't completed —
      // used by the one-challenge-per-pair guard at send time.
      const acceptedAsOpponent = (rows || []).filter(c =>
        c.status === 'accepted' && c.opponent === wallet
      );
      // FIGHT READY (2026-10-27): accepted OR already-fighting challenges in
      // EITHER direction. These get a persistent JOIN FIGHT card in the
      // lobby — the retryable entry that replaces the one-shot popup chain.
      // 'fighting' is included on purpose: a fight that started but a side
      // dropped (reload, timeout) must be rejoinable, not stranded.
      const fightReady = (rows || []).filter(c =>
        (c.status === 'accepted' || c.status === 'fighting') &&
        (c.challenger === wallet || c.opponent === wallet)
      );
      return { awaiting, accepted, incoming, acceptedAsOpponent, fightReady };
    } catch (e) {
      console.warn('[PvpSync] challenge poll failed', e.message);
      return { awaiting: [], accepted: [], incoming: [], acceptedAsOpponent: [], fightReady: [] };
    }
  }

  /* --- Round sync ------------------------------------------------------- */
  // Table: pvp_rounds (challenge_addr TEXT, round_num INT, attacker_wallet TEXT,
  //                    defender_wallet TEXT, atk_dist FLOAT, atk_zone TEXT,
  //                    def_dist FLOAT, def_zone TEXT, created_at TIMESTAMPTZ)
  // Primary key: (challenge_addr, round_num)

  let roundPollTimer = null;

  /**
   * Submit my lock for the current round.
   * @param {string} challengeAddr
   * @param {number} roundNum
   * @param {string} wallet - my wallet
   * @param {string} role - 'atk' or 'def'
   * @param {object} lock - { dist, zone }
   * @param {string} attackerWallet - who's attacking this round
   * @param {string} defenderWallet - who's defending this round
   */
  async function submitLock(challengeAddr, roundNum, wallet, role, lock, attackerWallet, defenderWallet) {
    const field_prefix = role === 'atk' ? 'atk' : 'def';
    const payload = {
      challenge_addr: challengeAddr,
      round_num: roundNum,
      attacker_wallet: attackerWallet,
      defender_wallet: defenderWallet,
      [`${field_prefix}_dist`]: lock.dist,
      [`${field_prefix}_zone`]: lock.zone,
      [`${field_prefix}_angle`]: lock.angle || 0,
    };
    const upsert = () => api()._req('POST', '/pvp_rounds?on_conflict=challenge_addr,round_num',
      payload, 'return=minimal,resolution=merge-duplicates');
    try {
      // Single atomic upsert. Both phones submit at nearly the same instant,
      // so the old read-then-write raced: both GETs saw no row, both POSTed
      // the same PK, one got a 409 conflict and its lock was silently dropped —
      // stalling the opponent in "waiting for opponent" until the 30s timeout.
      await upsert();
    } catch (e) {
      // One quick retry covers a transient network blip; after that the
      // existing warn + 30s opponent-timeout path takes over.
      try {
        await new Promise(r => setTimeout(r, 700));
        await upsert();
      } catch (e2) {
        console.warn('[PvpSync] submitLock failed', e2.message);
      }
    }
  }

  /**
   * Poll for the opponent's lock. Calls onBothLocks(atkLock, defLock) when both are available.
   */
  function pollForOpponentLock(challengeAddr, roundNum, myRole, onBothLocks, onTimeout) {
    stopRoundPoll();
    const startTime = Date.now();
    const TIMEOUT = 30000; // 30s per round
    const POLL_MS = 500; // faster round sync (was 1000ms)

    const check = async () => {
      // Check timeout
      if (Date.now() - startTime > TIMEOUT) {
        stopRoundPoll();
        if (onTimeout) onTimeout();
        return;
      }

      try {
        const rows = await api()._req('GET',
          `/pvp_rounds?challenge_addr=eq.${encodeURIComponent(challengeAddr)}&round_num=eq.${roundNum}&select=*`);
        const row = rows && rows[0];
        if (!row) return;

        const oppRole = myRole === 'atk' ? 'def' : 'atk';
        const oppDist = row[`${oppRole}_dist`];
        const oppZone = row[`${oppRole}_zone`];
        const oppAngle = row[`${oppRole}_angle`];

        if (oppDist != null && oppZone != null) {
          stopRoundPoll();
          const atkLock = myRole === 'atk'
            ? { dist: row.atk_dist, zone: row.atk_zone, angle: row.atk_angle }
            : { dist: oppDist, zone: oppZone, angle: oppAngle };
          const defLock = myRole === 'def'
            ? { dist: row.def_dist, zone: row.def_zone, angle: row.def_angle }
            : { dist: oppDist, zone: oppZone, angle: oppAngle };
          if (onBothLocks) onBothLocks(atkLock, defLock);
        }
      } catch (e) {
        console.warn('[PvpSync] round poll failed', e.message);
      }
    };
    check(); // immediate first check — don't wait for the first tick
    roundPollTimer = setInterval(check, POLL_MS);
  }

  function stopRoundPoll() {
    if (roundPollTimer) { clearInterval(roundPollTimer); roundPollTimer = null; }
  }

  /* --- Realtime (websocket) round sync ---------------------------------- */
  // Uses supabase-js (loaded via CDN in index.html) for true push-based sync.
  // Falls back to REST polling if the socket can't connect.

  let sbClient = null;
  let rtChannel = null;
  let rtFallbackTimer = null;

  function getSbClient() {
    if (sbClient) return sbClient;
    try {
      if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
        console.warn('[PvpSync] supabase-js not loaded, realtime unavailable');
        return null;
      }
      const cfg = (window.SAK && SAK.BACKEND) || {};
      if (!cfg.url || !cfg.anonKey) {
        console.warn('[PvpSync] no Supabase config, realtime unavailable');
        return null;
      }
      sbClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
        realtime: { params: { eventsPerSecond: 20 } },
      });
      return sbClient;
    } catch (e) {
      console.warn('[PvpSync] realtime client init failed', e.message);
      return null;
    }
  }

  /**
   * Subscribe to the opponent's lock via websocket. Fires onBothLocks the
   * instant both locks are present — typically 50-100ms after the opponent
   * taps, instead of up to 500ms+ with polling.
   *
   * Falls back to REST polling if the realtime channel fails.
   */
  function subscribeToRound(challengeAddr, roundNum, myRole, onBothLocks, onTimeout) {
    stopRoundPoll();
    unsubscribeRound();
    const startTime = Date.now();
    const TIMEOUT = 30000;

    let resolved = false;
    const finish = (atkLock, defLock) => {
      if (resolved) return;
      resolved = true;
      unsubscribeRound();
      if (onBothLocks) onBothLocks(atkLock, defLock);
    };
    const handleRow = (row) => {
      if (!row || resolved) return;
      const oppRole = myRole === 'atk' ? 'def' : 'atk';
      const oppDist = row[`${oppRole}_dist`];
      const oppZone = row[`${oppRole}_zone`];
      if (oppDist == null || oppZone == null) return;
      const oppAngle = row[`${oppRole}_angle`] || 0;
      const atkLock = myRole === 'atk'
        ? { dist: row.atk_dist, zone: row.atk_zone, angle: row.atk_angle || 0 }
        : { dist: oppDist, zone: oppZone, angle: oppAngle };
      const defLock = myRole === 'def'
        ? { dist: row.def_dist, zone: row.def_zone, angle: row.def_angle || 0 }
        : { dist: oppDist, zone: oppZone, angle: oppAngle };
      // Both locks must be complete
      if (atkLock.dist == null || defLock.dist == null) return;
      finish(atkLock, defLock);
    };

    // Timeout guard (same 30s as before)
    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsubscribeRound();
        if (onTimeout) onTimeout();
      }
    }, TIMEOUT);

    const sb = getSbClient();
    if (!sb) {
      // No realtime — fall back to polling
      clearTimeout(timeoutTimer);
      console.log('[PvpSync] realtime unavailable, using REST poll fallback');
      pollForOpponentLock(challengeAddr, roundNum, myRole, onBothLocks, onTimeout);
      return;
    }

    const topic = `pvp-round-${challengeAddr}-${roundNum}`;
    try {
      rtChannel = sb.channel(topic)
        .on('postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'pvp_rounds',
            filter: `challenge_addr=eq.${challengeAddr}`,
          },
          (payload) => {
            const row = payload.new || payload.old;
            if (row && String(row.round_num) === String(roundNum)) handleRow(row);
          })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[PvpSync] realtime subscribed:', topic);
            // Immediate REST check in case the opponent already locked
            // before we subscribed (race between submit and subscribe)
            api()._req('GET',
              `/pvp_rounds?challenge_addr=eq.${encodeURIComponent(challengeAddr)}&round_num=eq.${roundNum}&select=*`)
              .then(rows => { const row = rows && rows[0]; if (row) handleRow(row); })
              .catch(() => {});
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[PvpSync] realtime subscribe failed:', status, '— falling back to poll');
            clearTimeout(timeoutTimer);
            unsubscribeRound();
            pollForOpponentLock(challengeAddr, roundNum, myRole,
              (a, d) => { if (!resolved) { resolved = true; if (onBothLocks) onBothLocks(a, d); } },
              () => { if (!resolved) { resolved = true; if (onTimeout) onTimeout(); } });
          }
        });
    } catch (e) {
      console.warn('[PvpSync] realtime subscribe threw, falling back to poll', e.message);
      clearTimeout(timeoutTimer);
      pollForOpponentLock(challengeAddr, roundNum, myRole, onBothLocks, onTimeout);
    }

    // Store cleanup
    rtChannel._pvpCleanup = () => clearTimeout(timeoutTimer);
  }

  function unsubscribeRound() {
    if (rtChannel) {
      try {
        if (rtChannel._pvpCleanup) rtChannel._pvpCleanup();
        const sb = getSbClient();
        if (sb) sb.removeChannel(rtChannel);
      } catch (e) {}
      rtChannel = null;
    }
    if (rtFallbackTimer) { clearTimeout(rtFallbackTimer); rtFallbackTimer = null; }
  }

  /* --- Pre-fight lobby: both fighters must be online simultaneously ------ */
  // Fixes the "accepted 10 min later, fight starts with nobody there" bug.
  // Uses Supabase Realtime Presence: each phone tracks itself in a lobby
  // channel. The fight only starts when BOTH wallets are present at the
  // same time. If the other fighter never shows, the lobby times out
  // instead of starting a ghost fight.

  let lobbyChannel = null;
  let lobbyTimeoutTimer = null;
  let lobbyBeatTimer = null;
  let lobbyPollTimer = null;
  function stopLobbyRest() {
    if (lobbyBeatTimer) { clearInterval(lobbyBeatTimer); lobbyBeatTimer = null; }
    if (lobbyPollTimer) { clearInterval(lobbyPollTimer); lobbyPollTimer = null; }
  }

  /**
   * Join the pre-fight lobby. Calls onBothReady() when both fighters are
   * confirmed online simultaneously. Calls onTimeout() after 60s if the
   * opponent never shows.
   */
  function joinLobby(challengeAddr, wallet, onBothReady, onTimeout, onPresence) {
    leaveLobby();
    const LOBBY_TIMEOUT = 90000;
    let done = false;
    // REST-based lobby heartbeat — works even if realtime/presence fails.
    // Writes a 'lobby' heartbeat every 3s and polls for the opponent's.
    const sendLobbyBeat = async () => {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/pvp_heartbeats`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            challenge_addr: challengeAddr,
            wallet: wallet,
            last_seen: new Date().toISOString(),
          }),
        });
      } catch (e) {}
    };
    const pollLobbyBeat = async () => {
      if (done) return;
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pvp_heartbeats?challenge_addr=eq.${challengeAddr}&order=last_seen.desc&limit=10`,
          { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
        );
        const beats = await res.json();
        const now = Date.now();
        const wallets = new Set();
        (beats || []).forEach(b => {
          if (b.wallet && (now - new Date(b.last_seen).getTime()) < 15000) {
            wallets.add(b.wallet);
          }
        });
        // Always include ourselves — we just wrote a beat
        wallets.add(wallet);
        console.log('[PvpSync] lobby REST poll:', [...wallets]);
        if (onPresence) onPresence([...wallets]);
        if (wallets.size >= 2) finishReady();
      } catch (e) {}
    };
    const startRestFallback = () => {
      sendLobbyBeat();
      lobbyBeatTimer = setInterval(sendLobbyBeat, 3000);
      lobbyPollTimer = setInterval(pollLobbyBeat, 2000);
      // Immediate first poll
      pollLobbyBeat();
    };
    const stopRestFallback = stopLobbyRest;

    const finishReady = () => {
      if (done) return;
      done = true;
      clearTimeout(lobbyTimeoutTimer);
      stopRestFallback();
      console.log('[PvpSync] lobby: both fighters online — starting fight');
      if (onBothReady) onBothReady();
      // Keep the channel open briefly so the other side also sees us;
      // the fight's startFight() heartbeat takes over from here.
      setTimeout(() => leaveLobby(), 5000);
    };
    const finishTimeout = () => {
      if (done) return;
      done = true;
      stopRestFallback();
      leaveLobby();
      console.log('[PvpSync] lobby: opponent did not show up');
      if (onTimeout) onTimeout();
    };

    lobbyTimeoutTimer = setTimeout(finishTimeout, LOBBY_TIMEOUT);

    // Start REST heartbeat fallback immediately — this is the reliable path.
    // Presence (below) is the fast path; either one can trigger the fight.
    startRestFallback();

    const sb = getSbClient();
    if (!sb) {
      console.warn('[PvpSync] lobby: no realtime client — using REST fallback only');
    } else {

    const checkPresence = () => {
      try {
        const state = lobbyChannel.presenceState();
        const wallets = new Set();
        Object.values(state).forEach(presences => {
          presences.forEach(p => { if (p.wallet) wallets.add(p.wallet); });
        });
        console.log('[PvpSync] lobby presence:', [...wallets]);
        if (onPresence) onPresence([...wallets]);
        if (wallets.size >= 2) finishReady();
      } catch (e) {}
    };

    try {
      lobbyChannel = sb.channel(`pvp-lobby-${challengeAddr}`, {
        config: { presence: { key: wallet } },
      });
      lobbyChannel
        .on('presence', { event: 'sync' }, checkPresence)
        .on('presence', { event: 'join' }, checkPresence)
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await lobbyChannel.track({ wallet, online: true, ts: Date.now() });
            checkPresence();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[PvpSync] lobby presence failed:', status, '— REST fallback continues');
          }
        });
    } catch (e) {
      console.warn('[PvpSync] lobby presence failed', e.message, '— REST fallback continues');
    }
    }
  }

  function leaveLobby() {
    stopLobbyRest();
    if (lobbyTimeoutTimer) { clearTimeout(lobbyTimeoutTimer); lobbyTimeoutTimer = null; }
    if (lobbyChannel) {
      try {
        const sb = getSbClient();
        if (sb) sb.removeChannel(lobbyChannel);
      } catch (e) {}
      lobbyChannel = null;
    }
  }

  /* --- PvP lobby online presence ------------------------------------------ */
  // Real "who's online" for the PvP lobby. When a player opens the PvP lobby,
  // they track themselves in the pvp-online channel. Everyone in the lobby
  // sees the real list of online fighters — no more fake simulated players.
  let onlineChannel = null;

  function startOnlinePresence(wallet, fighterInfo, onOnlineList) {
    stopOnlinePresence();
    const sb = getSbClient();
    if (!sb || !wallet) {
      console.warn('[PvpSync] online presence: no client or wallet');
      if (onOnlineList) onOnlineList([]);
      return;
    }
    const updateList = () => {
      try {
        const state = onlineChannel.presenceState();
        const players = [];
        const seen = new Set();
        Object.values(state).forEach(presences => {
          presences.forEach(p => {
            if (p.wallet && p.wallet !== wallet && !seen.has(p.wallet)) {
              seen.add(p.wallet);
              players.push({
                wallet: p.wallet,
                name: p.name || (p.wallet.slice(0, 4) + '…' + p.wallet.slice(-4)),
                look: p.look || null,
                ts: p.ts || Date.now(),
              });
            }
          });
        });
        // Sort by most recent
        players.sort((a, b) => b.ts - a.ts);
        if (onOnlineList) onOnlineList(players);
      } catch (e) {}
    };
    try {
      onlineChannel = sb.channel('pvp-online', {
        config: { presence: { key: wallet } },
      });
      onlineChannel
        .on('presence', { event: 'sync' }, updateList)
        .on('presence', { event: 'join' }, updateList)
        .on('presence', { event: 'leave' }, updateList)
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await onlineChannel.track({
              wallet,
              name: (fighterInfo && fighterInfo.name) || null,
              look: (fighterInfo && fighterInfo.look) || null,
              ts: Date.now(),
            });
            updateList();
          }
        });
    } catch (e) {
      console.warn('[PvpSync] online presence failed:', e.message);
      if (onOnlineList) onOnlineList([]);
    }
  }

  function stopOnlinePresence() {
    if (onlineChannel) {
      try {
        const sb = getSbClient();
        if (sb) sb.removeChannel(onlineChannel);
      } catch (e) {}
      onlineChannel = null;
    }
  }

  /* --- SMACK TALK message board ------------------------------------------- */
  // Real-time trash talk in the PvP lobby. Table: smack_talk_messages
  let smackTalkChannel = null;

  async function getSmackTalkMessages(limit = 50) {
    const sb = getSbClient();
    if (!sb) return [];
    try {
      const { data, error } = await sb
        .from('smack_talk_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []).reverse(); // oldest first for display
    } catch (e) {
      console.warn('[PvpSync] smack talk load failed:', e.message);
      return [];
    }
  }

  async function postSmackTalk(wallet, name, look, message, replyTo) {
    const sb = getSbClient();
    if (!sb || !wallet || !message || !message.trim()) return null;
    // Strip URLs - no links allowed in Smack Talk
    const noUrls = message.trim().replace(/(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?)/gi, '[link removed]');
    const msg = noUrls.slice(0, 200);
    const insertRow = (withReply) => {
      const r = { wallet, name: name || wallet.slice(0, 8), look: look || null, message: msg };
      if (withReply && replyTo) r.reply_to = replyTo;
      return r;
    };
    try {
      let { data, error } = await sb
        .from('smack_talk_messages')
        .insert(insertRow(true))
        .select()
        .single();
      // Fallback if the reply_to column hasn't been added yet
      if (error && replyTo && /reply_to/i.test(error.message || '')) {
        ({ data, error } = await sb.from('smack_talk_messages').insert(insertRow(false)).select().single());
      }
      if (error) throw error;
      // Auto-cleanup: keep only the latest 50
      try {
        const { data: old } = await sb
          .from('smack_talk_messages')
          .select('id')
          .order('created_at', { ascending: false })
          .range(50, 1000);
        if (old && old.length) {
          await sb.from('smack_talk_messages').delete().in('id', old.map(r => r.id));
        }
      } catch (e) {}
      return data;
    } catch (e) {
      console.warn('[PvpSync] smack talk post failed:', e.message);
      return null;
    }
  }

  async function likeSmackTalk(msgId, wallet) {
    const sb = getSbClient();
    if (!sb || !msgId || !wallet) return null;
    try {
      // Secure RPC — the open UPDATE policy is gone, so direct updates no longer work
      const { data, error } = await sb.rpc('toggle_smack_talk_like', {
        msg_id: msgId, liker_wallet: wallet,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      // Merge into a full message-shaped object for the UI
      return { id: row.id, likes: row.likes, liked_by: row.liked_by };
    } catch (e) {
      console.warn('[PvpSync] smack talk like failed:', e.message);
      return null;
    }
  }

  async function toggleSmackTalkReaction(msgId, wallet, emoji) {
    const sb = getSbClient();
    if (!sb || !msgId || !wallet || !emoji) return null;
    try {
      // Secure RPC — the open UPDATE policy is gone, so direct updates no longer work
      const { data, error } = await sb.rpc('toggle_smack_talk_reaction', {
        msg_id: msgId, reactor_wallet: wallet, emoji,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      return { id: row.id, reactions: row.reactions };
    } catch (e) {
      console.warn('[PvpSync] smack talk reaction failed:', e.message);
      return null;
    }
  }

  function subscribeSmackTalk(onMessage, onUpdate) {
    const sb = getSbClient();
    if (!sb) return;
    unsubscribeSmackTalk();
    try {
      smackTalkChannel = sb.channel('smack-talk')
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'smack_talk_messages' },
          (payload) => { if (onMessage) onMessage(payload.new); })
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'smack_talk_messages' },
          (payload) => { if (onUpdate) onUpdate(payload.new); })
        .subscribe();
    } catch (e) {
      console.warn('[PvpSync] smack talk subscribe failed:', e.message);
    }
  }

  function unsubscribeSmackTalk() {
    if (smackTalkChannel) {
      try {
        const sb = getSbClient();
        if (sb) sb.removeChannel(smackTalkChannel);
      } catch (e) {}
      smackTalkChannel = null;
    }
  }

  /* --- Fighter snapshots -------------------------------------------------- */
  // Both fighters' looks stored on the challenge row at accept time.
  // This guarantees both phones render IDENTICAL fighters — no more
  // "different color on each phone" desync from stale profile reads.
  // Requires: ALTER TABLE pvp_challenges ADD COLUMN IF NOT EXISTS
  //   challenger_look JSONB, acceptor_look JSONB;

  async function publishFighterSnapshot(challengeAddr, role, fighterLook) {
    // role: 'challenger' or 'acceptor'
    const col = role === 'challenger' ? 'challenger_look' : 'acceptor_look';
    try {
      await api()._req('PATCH',
        `/pvp_challenges?challenge_addr=eq.${encodeURIComponent(challengeAddr)}`,
        { [col]: fighterLook, updated_at: new Date().toISOString() },
        'return=minimal');
      console.log('[PvpSync] fighter snapshot published:', role);
    } catch (e) {
      console.warn('[PvpSync] snapshot publish failed (column may not exist yet)', e.message);
    }
  }

  async function getFighterSnapshots(challengeAddr) {
    try {
      const rows = await api()._req('GET',
        `/pvp_challenges?challenge_addr=eq.${encodeURIComponent(challengeAddr)}&select=challenger_look,acceptor_look,challenger,opponent`);
      const row = rows && rows[0];
      if (!row) return null;
      return {
        challengerLook: row.challenger_look || null,
        acceptorLook: row.acceptor_look || null,
        challenger: row.challenger,
        opponent: row.opponent,
      };
    } catch (e) {
      console.warn('[PvpSync] snapshot read failed', e.message);
      return null;
    }
  }

  /* --- SQL for the tables (run once in Supabase) ------------------------ */
  const HEARTBEAT_TABLE_SQL = `
-- Run this once in your Supabase SQL editor:
CREATE TABLE IF NOT EXISTS pvp_challenges (
  challenge_addr TEXT PRIMARY KEY,
  challenger TEXT NOT NULL,
  opponent TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- v2: fighter snapshots so both phones render identical fighters
ALTER TABLE pvp_challenges ADD COLUMN IF NOT EXISTS challenger_look JSONB;
ALTER TABLE pvp_challenges ADD COLUMN IF NOT EXISTS acceptor_look JSONB;
ALTER TABLE pvp_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_challenges" ON pvp_challenges FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_challenges_wallets ON pvp_challenges (challenger, opponent);

CREATE TABLE IF NOT EXISTS pvp_rounds (
  challenge_addr TEXT NOT NULL,
  round_num INT NOT NULL,
  attacker_wallet TEXT NOT NULL,
  defender_wallet TEXT NOT NULL,
  atk_dist FLOAT,
  atk_zone TEXT,
  def_dist FLOAT,
  def_zone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (challenge_addr, round_num)
);
ALTER TABLE pvp_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_rounds" ON pvp_rounds FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_rounds_challenge ON pvp_rounds (challenge_addr);

CREATE TABLE IF NOT EXISTS pvp_heartbeats (
  challenge_addr TEXT NOT NULL,
  wallet TEXT NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'fighting',
  PRIMARY KEY (challenge_addr, wallet)
);
-- Allow anyone to read/write heartbeats (wallet address is the identity)
ALTER TABLE pvp_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_heartbeats" ON pvp_heartbeats FOR ALL USING (true) WITH CHECK (true);
-- Auto-cleanup old heartbeats (older than 1 hour)
CREATE INDEX IF NOT EXISTS idx_heartbeats_seen ON pvp_heartbeats (last_seen);
`;

  return {
    startFight,
    stopFight,
    startStatusPolling,
    stopStatusPolling,
    getMyChallenges,
    trackChallenge,
    updateChallengeStatus,
    submitLock,
    pollForOpponentLock,   // legacy REST poll (fallback)
    subscribeToRound,      // v2: websocket realtime (primary)
    unsubscribeRound,
    stopRoundPoll,
    joinLobby,             // v2: pre-fight presence handshake
    leaveLobby,
    startOnlinePresence,   // v2: real online players list
    stopOnlinePresence,
    getSmackTalkMessages, postSmackTalk, likeSmackTalk, toggleSmackTalkReaction,
    subscribeSmackTalk, unsubscribeSmackTalk,
    publishFighterSnapshot,
    getFighterSnapshots,
    HEARTBEAT_TABLE_SQL,
    DISCONNECT_TIMEOUT,
  };
})();
