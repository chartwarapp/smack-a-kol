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
    body: 'Open this page inside your wallet app\'s browser (Phantom or Solflare), then tap Connect again.',
  };

  function getProvider() {
    const w = window;
    if (w.phantom && w.phantom.solana && w.phantom.solana.isPhantom)
      return { name: 'Phantom', provider: w.phantom.solana };
    if (w.solflare && w.solflare.isSolflare)
      return { name: 'Solflare', provider: w.solflare };
    if (w.backpack && w.backpack.isBackpack)
      return { name: 'Backpack', provider: w.backpack };
    // Jupiter: check multiple injection patterns (mobile app, extension)
    if (w.jupiter) {
      const jp = w.jupiter.solana || w.jupiter;
      if (jp && typeof jp.connect === 'function')
        return { name: 'Jupiter', provider: jp };
    }
    if (w.solana && w.solana.isPhantom)
      return { name: 'Phantom', provider: w.solana };
    if (w.solana && typeof w.solana.connect === 'function')
      return { name: 'Solana', provider: w.solana };
    // Wallet Standard (modern mobile browsers register here)
    try {
      const wallets = (w.navigator && w.navigator.wallets) || [];
      const list = typeof wallets.get === 'function' ? wallets.get() : wallets;
      const arr = Array.isArray(list) ? list : [];
      for (const wallet of arr) {
        const name = (wallet.name || '').toLowerCase();
        if (wallet && typeof wallet.connect === 'function') {
          if (name.includes('jupiter')) return { name: 'Jupiter', provider: wallet };
          if (name.includes('phantom')) return { name: 'Phantom', provider: wallet };
          if (name.includes('solflare')) return { name: 'Solflare', provider: wallet };
          if (name.includes('backpack')) return { name: 'Backpack', provider: wallet };
        }
      }
      // Fallback: any wallet-standard wallet with connect
      const any = arr.find(x => x && typeof x.connect === 'function');
      if (any) return { name: any.name || 'Wallet', provider: any };
    } catch (e) { /* wallet standard unavailable */ }
    return null;
  }

  /** Debug: list all detected wallet injections. Exposed as SAK.Wallet.debug(). */
  function debug() {
    const w = window;
    const out = { ua: navigator.userAgent.slice(0, 120) };
    const probe = (label, obj) => {
      if (!obj) return null;
      try {
        return {
          exists: true,
          keys: Object.keys(obj).slice(0, 12),
          isPhantom: !!obj.isPhantom,
          isSolflare: !!obj.isSolflare,
          isBackpack: !!obj.isBackpack,
          hasConnect: typeof obj.connect === 'function',
          hasSignMessage: typeof obj.signMessage === 'function',
          isConnected: !!obj.isConnected,
        };
      } catch (e) { return { exists: true, error: String(e).slice(0, 60) }; }
    };
    out.phantom_solana = probe('phantom.solana', w.phantom && w.phantom.solana);
    out.solflare = probe('solflare', w.solflare);
    out.backpack = probe('backpack', w.backpack);
    out.jupiter = probe('jupiter', w.jupiter);
    out.jupiter_solana = probe('jupiter.solana', w.jupiter && w.jupiter.solana);
    out.solana = probe('solana', w.solana);
    try {
      const ws = w.navigator && w.navigator.wallets;
      out.walletStandard = ws ? (typeof ws.get === 'function' ? 'has-get' : (Array.isArray(ws) ? ws.length + ' wallets' : typeof ws)) : 'absent';
    } catch (e) { out.walletStandard = 'error'; }
    out.detected = getProvider() ? getProvider().name : null;
    return out;
  }

  /** Minimal base58 encoder for raw public-key bytes (Wallet Standard accounts). */
  function base58Encode(bytes) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = 0n;
    for (const b of bytes) num = (num << 8n) | BigInt(b);
    let out = '';
    while (num > 0n) { out = ALPHABET[Number(num % 58n)] + out; num /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out || '1';
  }

  /** Wait for async wallet injection (mobile browsers inject after page load). */
  function waitForProvider(timeoutMs) {
    return new Promise(resolve => {
      const found = getProvider();
      if (found) { resolve(found); return; }
      const t0 = Date.now();
      const limit = timeoutMs || 4000;
      const iv = setInterval(() => {
        const f = getProvider();
        if (f || Date.now() - t0 > limit) {
          clearInterval(iv);
          resolve(f || null);
        }
      }, 250);
      // Also catch providers that announce via events
      const onReady = () => {
        const f = getProvider();
        if (f) { clearInterval(iv); window.removeEventListener('wallet-ready', onReady); resolve(f); }
      };
      window.addEventListener('wallet-ready', onReady);
      setTimeout(() => window.removeEventListener('wallet-ready', onReady), limit + 500);
    });
  }

  async function connect() {
    let found = getProvider();
    if (!found) found = await waitForProvider(4000);
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
    // Wrap connect in a timeout so a hanging provider can't stall forever.
    const connectWithTimeout = (provider, ms) => Promise.race([
      provider.connect(),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Connection timed out'), { code: 'CONNECT_TIMEOUT' })), ms)),
    ]);
    let resp;
    try {
      resp = await connectWithTimeout(found.provider, 15000);
    } catch (e) {
      throw Object.assign(new Error(e && e.message || 'Wallet connection rejected'), { code: e.code || 'CONNECT_FAILED', cause: e });
    }
    // Resolve the address: legacy (publicKey.toBase58) or Wallet Standard (accounts[0]).
    let address = null;
    try {
      const pk = (resp && resp.publicKey) || found.provider.publicKey;
      if (pk && typeof pk.toBase58 === 'function') address = pk.toBase58();
      else if (resp && Array.isArray(resp.accounts) && resp.accounts[0]) {
        const acc = resp.accounts[0];
        if (acc.publicKey) {
          // base58-encode the raw bytes
          const bytes = acc.publicKey instanceof Uint8Array ? acc.publicKey : new Uint8Array(acc.publicKey);
          address = base58Encode(bytes);
        } else if (typeof acc.address === 'string') address = acc.address;
      } else if (found.provider.account && found.provider.account.publicKey) {
        const bytes = found.provider.account.publicKey;
        address = base58Encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      }
    } catch (e) { /* fall through to NO_ADDRESS */ }
    if (!address) throw Object.assign(new Error('Wallet did not return an address'), { code: 'NO_ADDRESS' });
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
    if (SAK.WalletConnect && SAK.WalletConnect.isConnected) {
      return SAK.WalletConnect.signLogin(nonce);
    }
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
  // Delegates to WalletConnect when a WC session is active.
  async function signMessage(message) {
    if (SAK.WalletConnect && SAK.WalletConnect.isConnected) {
      return SAK.WalletConnect.signMessage(message);
    }
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
    try { if (SAK.WalletConnect) SAK.WalletConnect.disconnect(); } catch (e) {}
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
    connect, disconnect, signLogin, signMessage, shortAddress, debug, getProvider,
    NO_WALLET_HELP,
    onChange(fn) { listeners.push(fn); },
    get isConnected() { return !!S().wallet.connected && !!S().wallet.address; },
    get address() { return S().wallet.address; },
    get providerName() { return S().wallet.provider || null; },
  };
})();
