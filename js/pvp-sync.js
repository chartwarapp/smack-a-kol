/* =========================================================================
 * SAK.PvpSync — Realtime PvP coordination via Supabase
 *
 * Two features:
 * 1. Challenge status indicators: poll for open challenges involving the
 *    player, show badges on the main menu (AWAITING / ACCEPTED).
 * 2. Disconnect detection: heartbeat during fights. If the opponent's
 *    heartbeat goes stale (>60s), they forfeit and the remaining player wins.
 *
 * Uses the existing SAK.Api Supabase backend (REST). No SDK needed.
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

  async function trackChallenge(challengeAddr, challenger, opponent) {
    try {
      await api()._req('POST', '/pvp_challenges?on_conflict=challenge_addr',
        {
          challenge_addr: challengeAddr,
          challenger, opponent,
          status: 'open',
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
      const rows = await api()._req('GET',
        `/pvp_challenges?or=(challenger.eq.${encodeURIComponent(wallet)},opponent.eq.${encodeURIComponent(wallet)})&status=in.(open,accepted)&select=*&order=created_at.desc`);
      const awaiting = (rows || []).filter(c => c.status === 'open' && c.challenger === wallet);
      const accepted = (rows || []).filter(c => c.status === 'accepted');
      return { awaiting, accepted };
    } catch (e) {
      console.warn('[PvpSync] challenge poll failed', e.message);
      return { awaiting: [], accepted: [] };
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
ALTER TABLE pvp_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_challenges" ON pvp_challenges FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_challenges_wallets ON pvp_challenges (challenger, opponent);

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
    HEARTBEAT_TABLE_SQL,
    DISCONNECT_TIMEOUT,
  };
})();
