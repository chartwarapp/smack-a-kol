/* ------------------------------------------------------------------ */
/* SAK.SolanaEscrow — on-chain PvP wager escrow (Solana devnet)          */
/*                                                                       */
/* Wraps the smack_escrow program (F4kqMuoAP4kzDT6x41ha15UPicBpQpQay5Txsg85cSWr) */
/* No Buffer dependency: native Uint8Array / TextEncoder / DataView only, */
/* same approach as init-contracts.html. Requires @solana/web3.js loaded  */
/* (window.solanaWeb3) and a connected wallet via SAK.Wallet.getProvider().*/
/*                                                                       */
/* DEVNET ONLY. Challenge flow:                                          */
/*   1. Challenger: createChallenge(sol) -> challenge PDA -> share link  */
/*   2. Opponent: open link -> acceptChallenge(challengePda)              */
/*   3. After fight: winner (or resolver) -> resolveChallenge(pda, winner)*/
/* ------------------------------------------------------------------ */
(function () {
  'use strict';

  const PROGRAM_ID = 'F4kqMuoAP4kzDT6x41ha15UPicBpQpQay5Txsg85cSWr';
  const RPC_URL = 'https://api.devnet.solana.com';
  const SYSTEM_PROGRAM = '11111111111111111111111111111111';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const NATIVE_MINT = '11111111111111111111111111111111'; // Pubkey::default() = native SOL

  // Anchor discriminators: sha256("global:<name>")[:8]
  const DISC = {
    create_challenge: [170, 244, 47, 1, 1, 15, 173, 239],
    accept_challenge: [195, 227, 139, 241, 55, 193, 153, 105],
    cancel_challenge: [231, 253, 0, 151, 179, 94, 5, 152],
    resolve_challenge: [81, 191, 124, 119, 131, 248, 157, 109],
    refund_expired: [118, 153, 164, 244, 40, 128, 242, 250],
  };

  const te = new TextEncoder();

  // Challenge account layout (after 8-byte discriminator):
  // challenger(32) opponent(32) nonce(u64) wager(u64) mint(32) expiry(i64) state(u8) bump(u8)
  const CHALLENGE_DATA_LEN = 32 + 32 + 8 + 8 + 32 + 8 + 1 + 1;

  const STATE = ['Open', 'Accepted', 'Resolved', 'Cancelled', 'Refunded'];

  function web3() {
    const w = window.solanaWeb3;
    if (!w) throw new Error('Solana web3.js not loaded');
    return w;
  }

  function connection() {
    return new (web3().Connection)(RPC_URL, 'confirmed');
  }

  function programId() {
    return new (web3().PublicKey)(PROGRAM_ID);
  }

  function u64le(n) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    // n may exceed 2^53 for lamports? No — lamports fit in u64, JS safe up to 2^53.
    dv.setBigUint64(0, BigInt(n), true);
    return b;
  }

  function i64le(n) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(n), true);
    return b;
  }

  function concat(...arrs) {
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  async function findPDA(seeds) {
    const w = web3();
    const [pda] = await w.PublicKey.findProgramAddress(seeds, programId());
    return pda;
  }

  /** Derive challenge + vault PDAs for (challenger, nonce). */
  async function derivePDAs(challengerPubkey, nonce) {
    const w = web3();
    const challenger = challengerPubkey instanceof w.PublicKey
      ? challengerPubkey : new w.PublicKey(challengerPubkey);
    const nonceBytes = u64le(nonce);
    const challenge = await findPDA([te.encode('challenge'), challenger.toBytes(), nonceBytes]);
    const vault = await findPDA([te.encode('vault'), challenger.toBytes(), nonceBytes]);
    return { challenge, vault };
  }

  /** Parse a Challenge account's raw data into a JS object. Returns null if not a valid challenge. */
  function parseChallenge(data) {
    if (!data || data.length < 8 + CHALLENGE_DATA_LEN) return null;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 8; // skip discriminator
    const readPubkey = () => {
      const b = data.slice(o, o + 32); o += 32;
      return new (web3().PublicKey)(b).toBase58();
    };
    const challenger = readPubkey();
    const opponent = readPubkey();
    const nonce = dv.getBigUint64(o, true); o += 8;
    const wager = dv.getBigUint64(o, true); o += 8;
    const mint = readPubkey();
    const expiry = dv.getBigInt64(o, true); o += 8;
    const state = data[o]; o += 1;
    const bump = data[o];
    return {
      challenger, opponent, nonce: nonce.toString(), wager: wager.toString(), mint,
      expiry: Number(expiry), state, stateName: STATE[state] || 'Unknown', bump,
      wagerSol: Number(wager) / 1e9,
      isNative: mint === NATIVE_MINT,
    };
  }

  /** Fetch and parse a challenge account by PDA (base58 string or PublicKey). */
  async function getChallenge(challengeAddr) {
    const w = web3();
    const conn = connection();
    const pda = challengeAddr instanceof w.PublicKey ? challengeAddr : new w.PublicKey(challengeAddr);
    const info = await conn.getAccountInfo(pda);
    if (!info || !info.data) return null;
    const parsed = parseChallenge(info.data);
    if (!parsed) return null;
    parsed.address = pda.toBase58();
    // Derive vault PDA for convenience
    const { vault } = await derivePDAs(parsed.challenger, parsed.nonce);
    parsed.vault = vault.toBase58();
    return parsed;
  }

  function getSigner() {
    const SAK = window.SAK || {};
    const W = SAK.Wallet;
    if (!W || !W.isConnected) throw new Error('Wallet not connected');
    // WalletConnect (Reown) path
    if (SAK.WalletConnect && SAK.WalletConnect.isConnected) {
      return { provider: null, address: W.address, viaWalletConnect: true };
    }
    const found = W.getProvider && W.getProvider();
    const provider = found && found.provider ? found.provider : found;
    if (!provider) throw new Error('Wallet provider not available');
    return { provider, address: W.address, viaWalletConnect: false };
  }

  async function buildAndSend(ixs, feePayer) {
    const w = web3();
    const conn = connection();
    const { provider, viaWalletConnect } = getSigner();
    if (viaWalletConnect) {
      throw new Error('On-chain escrow needs an injected wallet (Phantom/Solflare) for now — WalletConnect signing coming soon');
    }
    const payer = new w.PublicKey(feePayer);
    const tx = new w.Transaction();
    for (const ix of ixs) tx.add(ix);
    tx.feePayer = payer;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    let signed;
    if (provider.signTransaction) {
      signed = await provider.signTransaction(tx);
    } else {
      throw new Error('Wallet does not support signTransaction');
    }
    const sig = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  }

  function txIx(discriminator, keys, data) {
    const w = web3();
    return new w.TransactionInstruction({ programId: programId(), keys, data });
  }

  /**
   * Create an on-chain SOL challenge. Returns { challenge, vault, nonce, signature }.
   * @param {number} wagerLamports — integer lamports
   * @param {number} ttlHours — challenge expiry (default 24h)
   */
  async function createChallenge(wagerLamports, ttlHours) {
    const w = web3();
    if (!Number.isInteger(wagerLamports) || wagerLamports <= 0) throw new Error('Wager must be positive lamports');
    const { address } = getSigner();
    const challenger = new w.PublicKey(address);
    const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    const { challenge, vault } = await derivePDAs(challenger, nonce);
    const expiry = Math.floor(Date.now() / 1000) + Math.round((ttlHours || 24) * 3600);

    const data = concat(
      new Uint8Array(DISC.create_challenge),
      u64le(nonce),
      u64le(wagerLamports),
      i64le(expiry),
    );
    const ix = txIx(DISC.create_challenge, [
      { pubkey: challenge, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: challenger, isSigner: true, isWritable: true },
      { pubkey: new w.PublicKey(NATIVE_MINT), isSigner: false, isWritable: false },
      { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new w.PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
    ], data);
    const signature = await buildAndSend([ix], address);
    return { challenge: challenge.toBase58(), vault: vault.toBase58(), nonce: nonce.toString(), signature };
  }

  /** Opponent accepts a challenge by depositing the matching wager. */
  async function acceptChallenge(challengeAddr) {
    const w = web3();
    const ch = await getChallenge(challengeAddr);
    if (!ch) throw new Error('Challenge not found');
    if (ch.stateName !== 'Open') throw new Error('Challenge is not open (state: ' + ch.stateName + ')');
    if (Date.now() / 1000 > ch.expiry) throw new Error('Challenge expired');
    const { address } = getSigner();
    if (address === ch.challenger) throw new Error("You can't accept your own challenge");

    const challenge = new w.PublicKey(ch.address);
    const vault = new w.PublicKey(ch.vault);
    const opponent = new w.PublicKey(address);
    const ix = txIx(DISC.accept_challenge, [
      { pubkey: challenge, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: opponent, isSigner: true, isWritable: true },
      { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new w.PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
    ], new Uint8Array(DISC.accept_challenge));
    const signature = await buildAndSend([ix], address);
    return { signature };
  }

  /** Challenger cancels an open challenge for a full refund. */
  async function cancelChallenge(challengeAddr) {
    const w = web3();
    const ch = await getChallenge(challengeAddr);
    if (!ch) throw new Error('Challenge not found');
    if (ch.stateName !== 'Open') throw new Error('Only open challenges can be cancelled');
    const { address } = getSigner();
    if (address !== ch.challenger) throw new Error('Only the challenger can cancel');

    const challenge = new w.PublicKey(ch.address);
    const vault = new w.PublicKey(ch.vault);
    const challenger = new w.PublicKey(address);
    const ix = txIx(DISC.cancel_challenge, [
      { pubkey: challenge, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: challenger, isSigner: true, isWritable: true },
      { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
    ], new Uint8Array(DISC.cancel_challenge));
    const signature = await buildAndSend([ix], address);
    return { signature };
  }

  /**
   * Resolve a challenge: pays winner (pot minus fee). Must be signed by the
   * config resolver. On devnet the resolver is the admin wallet; a backend
   * resolver service signs this in production.
   */
  async function resolveChallenge(challengeAddr, winnerAddr) {
    const w = web3();
    const ch = await getChallenge(challengeAddr);
    if (!ch) throw new Error('Challenge not found');
    if (ch.stateName !== 'Accepted') throw new Error('Challenge must be accepted before resolving');
    if (winnerAddr !== ch.challenger && winnerAddr !== ch.opponent) {
      throw new Error('Winner must be challenger or opponent');
    }
    const { address } = getSigner();
    const conn = connection();
    const [configPda] = await w.PublicKey.findProgramAddress([te.encode('config')], programId());
    const cfgInfo = await conn.getAccountInfo(configPda);
    if (!cfgInfo) throw new Error('Escrow config not found');
    // Config layout: disc(8) admin(32) treasury(32) resolver(32) fee_bps(u16) bump(u8)
    const cfgData = cfgInfo.data;
    const treasury = new w.PublicKey(cfgData.slice(8 + 32, 8 + 32 + 32)).toBase58();
    const resolver = new w.PublicKey(cfgData.slice(8 + 32 + 32, 8 + 32 + 32 + 32)).toBase58();
    if (address !== resolver) {
      throw Object.assign(new Error('Only the resolver can settle. Connected wallet is not the resolver.'),
        { code: 'NOT_RESOLVER', resolver });
    }

    const challenge = new w.PublicKey(ch.address);
    const vault = new w.PublicKey(ch.vault);
    const winner = new w.PublicKey(winnerAddr);
    const treasuryPk = new w.PublicKey(treasury);
    const resolverPk = new w.PublicKey(address);
    const data = concat(new Uint8Array(DISC.resolve_challenge), winner.toBytes());
    const ix = txIx(DISC.resolve_challenge, [
      { pubkey: challenge, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: resolverPk, isSigner: true, isWritable: false },
      { pubkey: winner, isSigner: false, isWritable: true },
      { pubkey: treasuryPk, isSigner: false, isWritable: true },
      { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
    ], data);
    const signature = await buildAndSend([ix], address);
    return { signature };
  }

  /** Refund an expired, unaccepted challenge (anyone can call). */
  async function refundExpired(challengeAddr) {
    const w = web3();
    const ch = await getChallenge(challengeAddr);
    if (!ch) throw new Error('Challenge not found');
    if (ch.stateName !== 'Open') throw new Error('Only open challenges can be refunded');
    if (Date.now() / 1000 <= ch.expiry) throw new Error('Challenge has not expired yet');
    const { address } = getSigner();

    const challenge = new w.PublicKey(ch.address);
    const vault = new w.PublicKey(ch.vault);
    const challenger = new w.PublicKey(ch.challenger);
    const ix = txIx(DISC.refund_expired, [
      { pubkey: challenge, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: challenger, isSigner: false, isWritable: true },
      { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
    ], new Uint8Array(DISC.refund_expired));
    const signature = await buildAndSend([ix], address);
    return { signature };
  }

  /** Shareable challenge link for the game site. */
  function challengeUrl(challengeAddr) {
    return 'https://smackakol.com/challenge.html?sol_challenge=' + challengeAddr;
  }

  window.SAK = window.SAK || {};
  window.SAK.SolanaEscrow = {
    PROGRAM_ID, RPC_URL,
    createChallenge, acceptChallenge, cancelChallenge, resolveChallenge, refundExpired,
    getChallenge, derivePDAs, challengeUrl, parseChallenge,
  };
})();
