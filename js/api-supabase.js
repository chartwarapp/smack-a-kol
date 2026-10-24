/* =========================================================================
 * SAK.Api Supabase backend — swap in with:
 *   SAK.Api.use(new SAK.Api.SupabaseBackend(SUPABASE_URL, SUPABASE_ANON_KEY));
 * Uses the REST API directly (no SDK) to stay light. RLS policies in
 * supabase/rls.sql govern access. Wallet address = identity (no passwords).
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Api.SupabaseBackend = function (url, anonKey) {
  const base = url.replace(/\/$/, '') + '/rest/v1';
  const H = {
    'apikey': anonKey,
    'Authorization': 'Bearer ' + anonKey,
    'Content-Type': 'application/json',
  };
  async function req(method, path, body, prefer) {
    const h = Object.assign({}, H);
    if (prefer) h['Prefer'] = prefer;
    const r = await fetch(base + path, {
      method, headers: h, body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`);
    }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }
  const one = rows => (rows && rows[0]) || null;

  return {
    name: 'supabase',
    _req: req, // exposed for PvpSync heartbeats

    async getProfile(wallet) {
      const rows = await req('GET', `/profiles?wallet=eq.${encodeURIComponent(wallet)}&select=*`);
      return one(rows);
    },
    async saveProfile(wallet, data) {
      const payload = Object.assign({ wallet, updated_at: new Date().toISOString() }, data);
      const rows = await req('POST', '/profiles?on_conflict=wallet',
        payload, 'return=representation,resolution=merge-duplicates');
      return one(rows);
    },
    async getConfig() {
      const rows = await req('GET', '/game_config?select=key,value');
      const out = {};
      (rows || []).forEach(r => { out[r.key] = r.value; });
      return out;
    },
    async setConfig(key, value, adminWallet) {
      // Admin writes go through the admin-config Edge Function, which verifies
      // a Solana wallet signature. Direct anon writes to game_config are
      // blocked by RLS — this keeps the admin panel working for the real
      // admin while nobody else can change anything.
      const message = JSON.stringify({ key, value, ts: Date.now() });
      const signed = await SAK.Wallet.signMessage(message);
      const sig = signed && signed.signature;
      if (!sig) throw new Error('Wallet signature required');
      const r = await fetch(url.replace(/\/$/, '') + '/functions/v1/admin-config-', {
        method: 'POST',
        headers: {
          'apikey': anonKey,
          'Authorization': 'Bearer ' + anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, value, wallet: adminWallet, signature: sig, message }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`admin-config ${r.status}: ${t.slice(0, 120)}`);
      }
    },
    async createChallenge({ challenger, wager_lamports, mint, ttl_hours }) {
      const rows = await req('POST', '/challenges', {
        challenger_wallet: challenger,
        wager_lamports, mint: mint || null,
        nonce: Date.now(),
        status: 'open',
        expires_at: new Date(Date.now() + (ttl_hours || 24) * 3600e3).toISOString(),
        x_share_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
      }, 'return=representation');
      return one(rows);
    },
    async getChallenge(idOrCode) {
      // Try UUID first, then share code.
      let rows = await req('GET', `/challenges?id=eq.${encodeURIComponent(idOrCode)}&select=*`);
      if (rows && rows[0]) return rows[0];
      rows = await req('GET', `/challenges?x_share_code=eq.${encodeURIComponent(idOrCode)}&select=*`);
      return one(rows);
    },
    async acceptChallenge(id, opponentWallet) {
      const rows = await req('PATCH', `/challenges?id=eq.${encodeURIComponent(id)}&status=eq.open`,
        { opponent_wallet: opponentWallet, status: 'accepted', updated_at: new Date().toISOString() },
        'return=representation');
      const ch = one(rows);
      if (!ch) throw new Error('Challenge not open');
      return ch;
    },
    async resolveChallenge(id, winnerWallet) {
      const rows = await req('PATCH', `/challenges?id=eq.${encodeURIComponent(id)}&status=eq.accepted`,
        { winner_wallet: winnerWallet, status: 'resolved', updated_at: new Date().toISOString() },
        'return=representation');
      const ch = one(rows);
      if (!ch) throw new Error('Challenge not accepted');
      return ch;
    },
    async listChallenges(status) {
      const q = status ? `?status=eq.${encodeURIComponent(status)}` : '';
      return await req('GET', `/challenges${q}&select=*&order=created_at.desc&limit=50`) || [];
    },
    async recordMatch(data) {
      const rows = await req('POST', '/matches', Object.assign({ status: 'complete' }, data),
        'return=representation');
      return one(rows);
    },
    // Player fight-history tracker (profile section): one row per
    // finished fight — mode, wager, payout, result, PTS, score.
    async recordFightHistory(data) {
      await req('POST', '/fight_history', data, 'return=minimal');
      return data;
    },
    async getFightHistory(wallet, limit) {
      const rows = await req('GET',
        `/fight_history?wallet=eq.${encodeURIComponent(wallet)}&select=*&order=created_at.desc&limit=${limit || 200}`);
      return rows || [];
    },
    // Admin player tracker: one profiles row per wallet that signed on
    // (connected + created a fighter); fought = distinct wallets with
    // at least one recorded fight.
    async getPlayerStats() {
      const signups = await req('GET', '/profiles?select=wallet,name,created_at&order=created_at.desc&limit=500');
      let fought = 0;
      try {
        const fh = await req('GET', '/fight_history?select=wallet&limit=2000');
        fought = new Set((fh || []).map(r => r.wallet)).size;
      } catch (e) { /* fight_history may not exist yet */ }
      return { signups: signups || [], fought };
    },
    async audit(adminWallet, action, details) {
      await req('POST', '/admin_audit', {
        admin_wallet: adminWallet, action, details: details || {},
      }).catch(() => {});
    },
    // Best-effort referral tracking. Requires a `referrals` table; fails
    // silently if it doesn't exist — the referee reward is always local.
    async recordReferral(data) {
      await req('POST', '/referrals', Object.assign({
        created_at: new Date().toISOString(),
      }, data)).catch(() => {});
      return data;
    },
  };
};
