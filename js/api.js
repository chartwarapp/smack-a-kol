/* =========================================================================
 * SAK.Api — backend abstraction layer.
 * -------------------------------------------------------------------------
 * All game features (profiles, challenges, config, admin) talk to THIS
 * interface. Today it runs on a local mock (localStorage) so the game is
 * fully playable offline. To go live, set SAK.Api.use(new SupabaseBackend(url, key))
 * and every feature keeps working unchanged.
 *
 * Interface:
 *   getProfile(wallet) -> Promise<profile|null>
 *   saveProfile(wallet, {name, fighter_look}) -> Promise<profile>
 *   getConfig() -> Promise<{key: value}>
 *   setConfig(key, value, adminWallet) -> Promise<void>   (admin)
 *   createChallenge({challenger, wager_lamports, mint, ttl_hours}) -> Promise<challenge>
 *   getChallenge(idOrCode) -> Promise<challenge|null>
 *   acceptChallenge(id, opponentWallet) -> Promise<challenge>
 *   resolveChallenge(id, winnerWallet) -> Promise<challenge>
 *   listChallenges(status) -> Promise<challenge[]>
 *   recordMatch({challenge_id, a, b, rounds, winner}) -> Promise<match>
 *   audit(adminWallet, action, details) -> Promise<void>  (admin)
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Api = (function () {
  let backend = null;
  const listeners = [];
  const emit = (ev, data) => listeners.forEach(fn => { try { fn(ev, data); } catch (e) { console.error(e); } });
  return {
    use(b) { backend = b; emit('backend', { backend: b && b.name }); },
    on(fn) { listeners.push(fn); },
    get name() { return backend ? backend.name : 'none'; },
    getProfile(w, ...a) { return backend.getProfile(w, ...a); },
    saveProfile(w, d, ...a) { return backend.saveProfile(w, d, ...a); },
    getConfig(...a) { return backend.getConfig(...a); },
    setConfig(k, v, aw, ...a) { return backend.setConfig(k, v, aw, ...a); },
    createChallenge(d, ...a) { return backend.createChallenge(d, ...a); },
    getChallenge(id, ...a) { return backend.getChallenge(id, ...a); },
    acceptChallenge(id, w, ...a) { return backend.acceptChallenge(id, w, ...a); },
    resolveChallenge(id, w, ...a) { return backend.resolveChallenge(id, w, ...a); },
    listChallenges(s, ...a) { return backend.listChallenges(s, ...a); },
    recordMatch(d, ...a) { return backend.recordMatch(d, ...a); },
    audit(w, act, det, ...a) { return backend.audit(w, act, det, ...a); },
    recordReferral(d, ...a) { return backend.recordReferral ? backend.recordReferral(d, ...a) : Promise.resolve(null); },
  };
})();

/* ------------------------------------------------------------------ mock */
SAK.Api.MockBackend = function () {
  const K = 'slapakol.api.mock.v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
  const save = d => localStorage.setItem(K, JSON.stringify(d));
  const db = () => Object.assign({ profiles: {}, config: null, challenges: {}, matches: [] }, load());
  const persist = d => save(d);
  const uid = () => 'xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  const code = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  const DEFAULT_CONFIG = {
    wager_min_sol: 0.01, wager_max_sol: 100, challenge_ttl_hours: 24,
    pts_per_win: 100, platform_fee_bps_default: 500, maintenance_mode: false,
    house_win_bps: 4500, house_payout_bps: 19000,
  };

  return {
    name: 'mock',
    async getProfile(wallet) {
      const d = db(); return d.profiles[wallet] || null;
    },
    async saveProfile(wallet, data) {
      const d = db();
      const p = Object.assign({ wallet, wins: 0, losses: 0, is_admin: false }, d.profiles[wallet] || {}, data);
      d.profiles[wallet] = p; persist(d); return p;
    },
    async getConfig() {
      const d = db();
      if (!d.config) { d.config = Object.assign({}, DEFAULT_CONFIG); persist(d); }
      return d.config;
    },
    async setConfig(key, value, adminWallet) {
      const d = db(); await this.getConfig();
      d.config[key] = value; persist(d);
      await this.audit(adminWallet, 'update_config', { key, value });
    },
    async createChallenge({ challenger, wager_lamports, mint, ttl_hours }) {
      const d = db();
      const id = uid() + '-' + Date.now().toString(36);
      const ch = {
        id, challenger_wallet: challenger, opponent_wallet: null,
        wager_lamports, mint: mint || null, status: 'open', winner_wallet: null,
        fee_bps: 500, nonce: Date.now(),
        expires_at: new Date(Date.now() + (ttl_hours || 24) * 3600e3).toISOString(),
        x_share_code: code(), created_at: new Date().toISOString(),
      };
      d.challenges[id] = ch; persist(d); return ch;
    },
    async getChallenge(idOrCode) {
      const d = db();
      if (d.challenges[idOrCode]) return d.challenges[idOrCode];
      return Object.values(d.challenges).find(c => c.x_share_code === idOrCode) || null;
    },
    async acceptChallenge(id, opponentWallet) {
      const d = db(); const ch = d.challenges[id];
      if (!ch || ch.status !== 'open') throw new Error('Challenge not open');
      ch.opponent_wallet = opponentWallet; ch.status = 'accepted'; persist(d); return ch;
    },
    async resolveChallenge(id, winnerWallet) {
      const d = db(); const ch = d.challenges[id];
      if (!ch || ch.status !== 'accepted') throw new Error('Challenge not accepted');
      ch.winner_wallet = winnerWallet; ch.status = 'resolved'; persist(d); return ch;
    },
    async listChallenges(status) {
      const all = Object.values(db().challenges);
      return status ? all.filter(c => c.status === status) : all;
    },
    async recordMatch(data) {
      const d = db();
      const m = Object.assign({ id: uid(), status: 'complete', created_at: new Date().toISOString() }, data);
      d.matches.push(m); persist(d); return m;
    },
    async audit(adminWallet, action, details) {
      // mock: no-op (real backend writes to admin_audit)
    },
    async recordReferral(data) {
      // mock: store locally; referrer credit is manual in the mock backend
      const d = db();
      if (!d.referrals) d.referrals = [];
      d.referrals.push(Object.assign({ created_at: new Date().toISOString() }, data));
      persist(d); return data;
    },
  };
};

// Default: mock backend so everything works today. Swap for Supabase when live.
SAK.Api.use(new SAK.Api.MockBackend());
