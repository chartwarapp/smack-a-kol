/* =========================================================================
 * SAK.FighterLock — custom fighter lock payment (0.05 SOL one-time fee)
 * -------------------------------------------------------------------------
 * Flow: player randomizes a custom fighter → taps "Lock for 0.05 SOL" →
 * SOL transfer to treasury via connected wallet → fighter saved to profile.
 * Uses @solana/web3.js from CDN (loaded on demand).
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.FighterLock = (() => {
  const WEB3_CDN = 'https://unpkg.com/@solana/web3.js@1.95.3/lib/index.iife.min.js';
  let web3Promise = null;

  function loadWeb3() {
    if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3);
    if (web3Promise) return web3Promise;
    web3Promise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = WEB3_CDN;
      s.onload = () => window.solanaWeb3 ? resolve(window.solanaWeb3) : reject(new Error('web3.js failed to load'));
      s.onerror = () => reject(new Error('web3.js CDN unreachable'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('web3.js load timeout')), 15000);
    });
    return web3Promise;
  }

  function getProvider() {
    const w = window;
    if (w.phantom && w.phantom.solana && w.phantom.solana.isPhantom) return w.phantom.solana;
    if (w.solflare && w.solflare.isSolflare) return w.solflare;
    if (w.solana && typeof w.solana.signTransaction === 'function') return w.solana;
    return null;
  }

  /**
   * Send `solAmount` SOL from the connected wallet to the treasury.
   * Returns { signature } on success, throws on failure.
   */
  async function payLockFee(solAmount) {
    const cfg = SAK.FIGHTER_LOCK;
    const provider = getProvider();
    if (!provider) throw new Error('No wallet found. Connect Phantom or Solflare first.');
    if (!provider.publicKey) throw new Error('Wallet not connected.');

    const web3 = await loadWeb3();
    const connection = new web3.Connection(cfg.rpcUrl, 'confirmed');
    const from = provider.publicKey;
    const to = new web3.PublicKey(cfg.treasury);
    const lamports = Math.round(solAmount * web3.LAMPORTS_PER_SOL);

    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports })
    );
    tx.feePayer = from;
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;

    let signature;
    if (typeof provider.signAndSendTransaction === 'function') {
      const res = await provider.signAndSendTransaction(tx);
      signature = res.signature || res;
    } else {
      const signed = await provider.signTransaction(tx);
      signature = await connection.sendRawTransaction(signed.serialize());
    }
    // Best-effort confirmation (don't hard-fail on timeout — the tx may still land)
    try {
      await connection.confirmTransaction(signature, 'confirmed');
    } catch (e) { console.warn('[SAK] confirm timeout, tx may still land:', signature); }
    return { signature };
  }

  /**
   * Full lock flow: pay fee, then persist the locked fighter to the profile.
   * `fighterLook` is the trait object. Returns { signature } on success.
   */
  async function lockFighter(fighterLook) {
    const cfg = SAK.FIGHTER_LOCK;
    const { signature } = await payLockFee(cfg.feeSol);

    // Persist to local profile
    const S = SAK.Storage.state;
    if (S && S.profile) {
      S.profile.avatar = SAK.Account.sanitize(fighterLook);
      S.profile.locked_fighter = {
        look: SAK.Account.sanitize(fighterLook),
        tx: signature,
        locked_at: Date.now(),
        fee_sol: cfg.feeSol,
      };
      SAK.Storage.save();
    }
    // Persist to backend when a wallet is linked
    try {
      const W = SAK.Wallet;
      if (W && W.isConnected && W.address && SAK.Api && SAK.Api.saveProfile) {
        await SAK.Api.saveProfile(W.address, {
          fighter_look: SAK.Account.sanitize(fighterLook),
          locked_fighter_tx: signature,
        });
      }
    } catch (e) { console.warn('[SAK] lock profile sync failed', e); }
    return { signature };
  }

  return { payLockFee, lockFighter, loadWeb3 };
})();
