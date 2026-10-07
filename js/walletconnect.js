/* =========================================================================
 * SAK.WalletConnect — Jupiter Mobile (and any WalletConnect wallet) via
 * Reown AppKit. Lazy-loaded only when the user taps "Jupiter Mobile".
 * Implements the same SAK.Wallet interface as js/wallet.js so the rest of
 * the game doesn't change.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.WalletConnect = (() => {
  let modal = null;       // AppKit instance
  let solanaProvider = null;
  let address = null;
  let listeners = [];
  let initializing = null;

  const listeners_emit = (ev, data) => listeners.forEach(fn => { try { fn(ev, data); } catch (e) {} });

  function base58Encode(bytes) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = 0n;
    for (const b of bytes) num = (num << 8n) | BigInt(b);
    let out = '';
    while (num > 0n) { out = ALPHABET[Number(num % 58n)] + out; num /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out || '1';
  }

  async function init() {
    if (modal) return modal;
    if (initializing) return initializing;
    const projectId = SAK.REOWN_PROJECT_ID;
    if (!projectId) throw new Error('WalletConnect not configured');
    initializing = (async () => {
      // Lazy-load Reown AppKit + Solana adapter from CDN (ESM).
      const appkitMod = await import('https://cdn.jsdelivr.net/npm/@reown/appkit@1.8.24/dist/esm/index.js');
      const solanaMod = await import('https://cdn.jsdelivr.net/npm/@reown/appkit-adapter-solana@1.8.24/dist/esm/index.js');
      const networksMod = await import('https://cdn.jsdelivr.net/npm/@reown/appkit@1.8.24/dist/esm/networks/index.js');
      const { createAppKit } = appkitMod;
      const { SolanaAdapter } = solanaMod;
      const solana = networksMod.solana;
      const solanaAdapter = new SolanaAdapter();
      modal = createAppKit({
        adapters: [solanaAdapter],
        networks: [solana],
        defaultNetwork: solana,
        projectId,
        metadata: {
          name: 'Smack-a-KOL',
          description: 'Solana PvP slap-fight game',
          url: 'https://smackakol.com',
          icons: ['https://smackakol.com/assets/smack-a-kol-logo-icon.jpg'],
        },
        features: { analytics: false, email: false, socials: false },
      });
      // Track account changes.
      try {
        modal.subscribeAccount(state => {
          if (state && state.address && state.address !== address) {
            address = state.address;
            listeners_emit('connect', { address, walletName: 'Jupiter' });
          } else if (!state || !state.address) {
            address = null;
            listeners_emit('disconnect', {});
          }
        });
      } catch (e) { /* subscribe optional */ }
      // Grab the Solana provider for signing.
      try {
        solanaProvider = solanaAdapter.getProvider ? solanaAdapter.getProvider() : null;
      } catch (e) { solanaProvider = null; }
      return modal;
    })();
    return initializing;
  }

  async function connect() {
    await init();
    // Open the AppKit modal — user picks Jupiter Mobile (deep link / QR).
    modal.open();
    // Wait for the account to connect (user approves in Jupiter, then
    // manually switches back on iOS).
    const addr = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(Object.assign(new Error('Connection timed out — approve in Jupiter, then switch back here'), { code: 'CONNECT_TIMEOUT' }));
      }, 120000);
      let unsub = null;
      const cleanup = () => { clearTimeout(timeout); try { unsub && unsub(); } catch (e) {} };
      try {
        unsub = modal.subscribeAccount(state => {
          if (state && state.address) { cleanup(); resolve(state.address); }
        });
      } catch (e) {
        // Fallback: poll the account state.
        const iv = setInterval(() => {
          try {
            const st = modal.getAccount ? modal.getAccount() : null;
            if (st && st.address) { clearInterval(iv); cleanup(); resolve(st.address); }
          } catch (e2) {}
        }, 500);
        const origCleanup = cleanup;
      }
      // If already connected, resolve immediately.
      try {
        const st = modal.getAccount ? modal.getAccount() : null;
        if (st && st.address) { cleanup(); resolve(st.address); }
      } catch (e) {}
    });
    address = addr;
    // Refresh provider reference after connect.
    try {
      const st = modal.getState ? modal.getState() : null;
      if (st && st.solanaProvider) solanaProvider = st.solanaProvider;
    } catch (e) {}
    listeners_emit('connect', { address, walletName: 'Jupiter' });
    return { address, walletName: 'Jupiter' };
  }

  function disconnect() {
    try { modal && modal.disconnect(); } catch (e) {}
    address = null;
    solanaProvider = null;
    listeners_emit('disconnect', {});
  }

  function getProvider() {
    // Try the adapter provider first, then AppKit state.
    if (solanaProvider && typeof solanaProvider.signMessage === 'function') return solanaProvider;
    try {
      const st = modal && modal.getState ? modal.getState() : null;
      if (st && st.solanaProvider && typeof st.solanaProvider.signMessage === 'function') {
        solanaProvider = st.solanaProvider;
        return solanaProvider;
      }
    } catch (e) {}
    return null;
  }

  async function signMessage(message) {
    const provider = getProvider();
    if (!provider) throw Object.assign(new Error('NO_WALLET'), { code: 'NO_WALLET' });
    const data = new TextEncoder().encode(message);
    const out = await provider.signMessage(data, 'utf8');
    const sig = out.signature || out;
    let b64;
    if (typeof sig === 'string') b64 = sig;
    else {
      const bytes = sig instanceof Uint8Array ? sig : new Uint8Array(sig);
      b64 = btoa(String.fromCharCode.apply(null, bytes));
    }
    return { signature: b64, address, message };
  }

  async function signLogin(nonce) {
    const msg = `Sign in to Smack-a-KOL\n\nNonce: ${nonce}\nThis proves you own this wallet. No transaction is sent.`;
    const r = await signMessage(msg);
    return { signature: r.signature, address, message: msg };
  }

  function shortAddress() {
    if (!address) return '';
    return address.slice(0, 4) + '…' + address.slice(-4);
  }

  return {
    init,
    connect,
    disconnect,
    signLogin,
    signMessage,
    shortAddress,
    onChange(fn) { listeners.push(fn); },
    get isConnected() { return !!address; },
    get address() { return address; },
    get providerName() { return address ? 'Jupiter' : null; },
  };
})();
