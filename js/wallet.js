/* =========================================================================
 * Wallet adapter — real Solana wallet integration.
 * -------------------------------------------------------------------------
 * Interface (unchanged from the mock so the game UI keeps working):
 *   connect()    -> { address, walletName }  (throws {code:'NO_WALLET'} if none)
 *   disconnect()
 *   signLogin(nonce) -> { signature (base64), address }  (proves ownership)
 *   shortAddress()
 *   onChange(fn) / emit('connect'|'disconnect'|'no-provider')
 *   isConnected / address
 *
 * Detection order: Phantom > Solflare > Backpack > generic window.solana.
 * Mobile (no injected provider): the caller should show the "open in wallet
 * app browser" guidance — see SAK.Wallet.NO_WALLET_HELP.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Wallet = (function () {
  const S = () => SAK.Storage.state;
  const listeners = [];
  const emit = (ev, data) => listeners.forEach(fn => { try { fn(ev, data); } catch (e) { console.error(e); } });

  const NO_WALLET_HELP = {
    title: 'No wallet found',
    body: 'Open this page inside your wallet app\'s browser (Phantom, Solflare or Jupiter), then tap Connect again.',
  };

  function getProvider() {
    const w = window;
    if (w.phantom && w.phantom.solana && w.phantom.solana.isPhantom)
      return { name: 'Phantom', provider: w.phantom.solana };
    if (w.solflare && w.solflare.isSolflare)
      return { name: 'Solflare', provider: w.solflare };
    if (w.backpack && w.backpack.isBackpack)
      return { name: 'Backpack', provider: w.backpack };
    if (w.jupiter && w.jupiter.solana)
      return { name: 'Jupiter', provider: w.jupiter.solana };
    if (w.solana && w.solana.isPhantom)
      return { name: 'Phantom', provider: w.solana };
    if (w.solana && typeof w.solana.connect === 'function')
      return { name: 'Solana', provider: w.solana };
    return null;
  }

  async function connect() {
    const found = getProvider();
    if (!found) {
      const err = new Error('NO_WALLET');
      err.code = 'NO_WALLET';
      err.help = NO_WALLET_HELP;
      emit('no-provider', NO_WALLET_HELP);
      throw err;
    }
    // If already connected, reuse.
    try {
      if (found.provider.isConnected && found.provider.publicKey) {
        const address = found.provider.publicKey.toBase58();
        persist(found.name, address);
        emit('connect', { address, walletName: found.name });
        return { address, walletName: found.name };
      }
    } catch (e) { /* fall through to connect() */ }
    const resp = await found.provider.connect(); // opens the wallet popup
    const address = resp.publicKey.toBase58();
    persist(found.name, address);
    emit('connect', { address, walletName: found.name });
    // Re-emit if the user switches account / disconnects in the wallet.
    try {
      found.provider.on('accountChanged', pk => {
        if (pk) { persist(found.name, pk.toBase58()); emit('connect', { address: pk.toBase58(), walletName: found.name }); }
        else { disconnect(); }
      });
      found.provider.on('disconnect', () => disconnect());
    } catch (e) { /* provider without events */ }
    return { address, walletName: found.name };
  }

  /** Sign a login challenge to prove wallet ownership. Returns base64 sig. */
  async function signLogin(nonce) {
    const found = getProvider();
    if (!found) throw Object.assign(new Error('NO_WALLET'), { code: 'NO_WALLET' });
    const msg = `Sign in to Smack-a-KOL\n\nNonce: ${nonce}\nThis proves you own this wallet. No transaction is sent.`;
    const data = new TextEncoder().encode(msg);
    const out = await found.provider.signMessage(data, 'utf8');
    const sig = out.signature || out;
    let b64;
    if (typeof sig === 'string') b64 = sig;
    else b64 = btoa(String.fromCharCode.apply(null, sig));
    return { signature: b64, address: S().wallet.address, message: msg };
  }

  // Sign an exact message (for admin actions) — the signature verifies
  // against these exact bytes, unlike signLogin which wraps in a template.
  async function signMessage(message) {
    const found = getProvider();
    if (!found) throw Object.assign(new Error('NO_WALLET'), { code: 'NO_WALLET' });
    const data = new TextEncoder().encode(message);
    const out = await found.provider.signMessage(data, 'utf8');
    const sig = out.signature || out;
    let b64;
    if (typeof sig === 'string') b64 = sig;
    else b64 = btoa(String.fromCharCode.apply(null, sig));
    return { signature: b64, address: S().wallet.address, message };
  }

  function persist(walletName, address) {
    const st = S();
    st.wallet.connected = true;
    st.wallet.address = address;
    st.wallet.provider = walletName;
    SAK.Storage.save();
  }

  function disconnect() {
    const found = getProvider();
    if (found) { try { found.provider.disconnect(); } catch (e) {} }
    S().wallet.connected = false;
    S().wallet.address = null;
    SAK.Storage.save();
    emit('disconnect', {});
  }

  function shortAddress() {
    const a = S().wallet.address;
    return a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  }

  return {
    connect, disconnect, signLogin, signMessage, shortAddress,
    NO_WALLET_HELP,
    onChange(fn) { listeners.push(fn); },
    get isConnected() { return !!S().wallet.connected && !!S().wallet.address; },
    get address() { return S().wallet.address; },
    get providerName() { return S().wallet.provider || null; },
  };
})();
