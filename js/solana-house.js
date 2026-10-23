/* Wraps the smack_house program (LwLXTnzwZAB3BhSmNmCKZVa7F6R7nwDyegcmfD5dXzy) — devnet */
(function () {
  const PROGRAM_ID = 'LwLXTnzwZAB3BhSmNmCKZVa7F6R7nwDyegcmfD5dXzy';
  const RPC_URL = 'https://api.devnet.solana.com';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

  // sha256("global:<name>")[:8]
  const DISC = {
    place_bet: [222, 62, 67, 220, 63, 166, 126, 33],
    resolve_bet: [137, 132, 33, 97, 48, 208, 30, 159],
  };

  function web3() { return window.solanaWeb3; }
  function connection() { return new (web3().Connection)(RPC_URL, 'confirmed'); }
  function te() { return new TextEncoder(); }
  function u64(n) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; }
  function concat(...arrs) {
    const t = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of arrs) { t.set(a, o); o += a.length; }
    return t;
  }

  async function derivePDAs(playerPk, nonce) {
    const w = web3();
    const programId = new w.PublicKey(PROGRAM_ID);
    const nonceBytes = u64(nonce);
    const [house] = await w.PublicKey.findProgramAddress([te().encode('house')], programId);
    const [vault] = await w.PublicKey.findProgramAddress([te().encode('house_vault')], programId);
    const [bet] = await w.PublicKey.findProgramAddress([te().encode('bet'), playerPk.toBuffer(), nonceBytes], programId);
    const [betVault] = await w.PublicKey.findProgramAddress([te().encode('bet_vault'), playerPk.toBuffer(), nonceBytes], programId);
    return { house, vault, bet, betVault };
  }

  function getSigner() {
    const SAK = window.SAK || {};
    const W = SAK.Wallet;
    if (!W || !W.isConnected) throw new Error('Wallet not connected');
    const found = W.getProvider && W.getProvider();
    const provider = found && found.provider ? found.provider : found;
    if (!provider) throw new Error('Wallet provider not available');
    return { provider, address: W.address };
  }

  async function buildAndSend(ixs, feePayer) {
    const w = web3();
    const conn = connection();
    const { provider } = getSigner();
    const payer = new w.PublicKey(feePayer);
    const tx = new w.Transaction();
    for (const ix of ixs) tx.add(ix);
    tx.feePayer = payer;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const signed = await provider.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  }

  /** Place a SOL bet vs the house. Returns { signature, bet, nonce }. */
  async function placeBet(lamports) {
    const w = web3();
    const { address } = getSigner();
    const playerPk = new w.PublicKey(address);
    const nonce = Date.now();
    const { house, vault, bet, betVault } = await derivePDAs(playerPk, nonce);
    const NATIVE_MINT = w.PublicKey.default;
    const data = concat(new Uint8Array(DISC.place_bet), u64(nonce), u64(lamports));
    const ix = new w.TransactionInstruction({
      programId: new w.PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: house, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: false },
        { pubkey: bet, isSigner: false, isWritable: true },
        { pubkey: betVault, isSigner: false, isWritable: true },
        { pubkey: playerPk, isSigner: true, isWritable: true },
        { pubkey: playerPk, isSigner: false, isWritable: false },
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
        { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await buildAndSend([ix], address);
    return { signature, bet: bet.toBase58(), nonce, wagerSol: lamports / 1e9 };
  }

  /** Build one resolve_bet instruction. playerWon=true pays the player
   *  their full payout, false returns the wager to the house vault. */
  async function buildResolveIx(playerAddr, nonce, playerWon, resolverAddr) {
    const w = web3();
    const playerPk = new w.PublicKey(playerAddr);
    const { house, vault, bet, betVault } = await derivePDAs(playerPk, nonce);
    const data = concat(new Uint8Array(DISC.resolve_bet), new Uint8Array([playerWon ? 1 : 0]));
    return new w.TransactionInstruction({
      programId: new w.PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: house, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: bet, isSigner: false, isWritable: true },
        { pubkey: betVault, isSigner: false, isWritable: true },
        { pubkey: new w.PublicKey(resolverAddr), isSigner: true, isWritable: false },
        { pubkey: playerPk, isSigner: false, isWritable: true },
        { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  /** Resolve a bet. playerWon=true pays 1.9x, false keeps wager in vault. Resolver must sign (devnet: admin wallet). */
  async function resolveBet(betAddr, playerAddr, nonce, playerWon) {
    const { address } = getSigner();
    const ix = await buildResolveIx(playerAddr, nonce, playerWon, address);
    const signature = await buildAndSend([ix], address);
    return { signature };
  }

  /** Settle many open bets as LOSS in batched transactions (8 resolve
   *  instructions per tx — a legacy transaction cannot fit many more).
   *  Returns { settled, signatures }; if a batch fails midway, the
   *  thrown error carries .settled so the caller can report partial
   *  progress truthfully instead of pretending nothing happened. */
  async function resolveAllLoss(bets) {
    const { address } = getSigner();
    let settled = 0;
    const signatures = [];
    for (let i = 0; i < bets.length; i += 8) {
      const chunk = bets.slice(i, i + 8);
      const ixs = [];
      for (const b of chunk) ixs.push(await buildResolveIx(b.player, b.nonce, false, address));
      try {
        signatures.push(await buildAndSend(ixs, address));
        settled += chunk.length;
      } catch (e) {
        e.settled = settled;
        throw e;
      }
    }
    return { settled, signatures };
  }

  window.SAK = window.SAK || {};

  /** Read the live house config + vault balance and compute the biggest bet
   *  the vault can cover, using the contract's own rule:
   *  payout_bps x wager <= max_bet_bps_of_vault x vault_lamports. */
  async function getHouseState() {
    const w = web3();
    const conn = connection();
    const programId = new w.PublicKey(PROGRAM_ID);
    const [house] = await w.PublicKey.findProgramAddress([te().encode('house')], programId);
    const [vault] = await w.PublicKey.findProgramAddress([te().encode('house_vault')], programId);
    const [hInfo, vaultLamports] = await Promise.all([conn.getAccountInfo(house), conn.getBalance(vault)]);
    if (!hInfo) throw new Error('House is not initialized');
    const d = hInfo.data;
    const dv = new DataView(d.buffer, d.byteOffset || 0, d.byteLength);
    // House account layout (smack_house `House` struct after 8-byte discriminator):
    // admin 8..40, treasury 40..72, resolver 72..104, mint 104..136,
    // player_win_bps u16 @136, payout_bps u64 @138, max_bet_bps_of_vault u16 @146, burn_bps u16 @148
    const winBps = dv.getUint16(136, true);
    const payoutBps = Number(dv.getBigUint64(138, true));
    const maxBetBps = dv.getUint16(146, true);
    const burnBps = dv.getUint16(148, true);
    const maxBetLamports = Math.floor(vaultLamports * maxBetBps / payoutBps);
    return {
      winBps, payoutBps, maxBetBps, burnBps,
      vaultLamports, vaultSol: vaultLamports / 1e9,
      maxBetLamports, maxBetSol: maxBetLamports / 1e9,
      vaultAddress: vault.toBase58(),
    };
  }

  /** Scan the house program's Bet accounts (59 bytes each) and summarise
   *  gameplay: totals in, what is settled vs still open, and the SOL
   *  actually sitting in the open bets' bet_vault PDAs. Bet layout after
   *  the 8-byte discriminator: player 8..40, nonce u64 @40, wager u64 @48,
   *  state u8 @56 (0 = open, 1 = resolved), bump @57, vault_bump @58. */
  async function getOpenBetsSummary() {
    const w = web3();
    const conn = connection();
    const programId = new w.PublicKey(PROGRAM_ID);
    const accts = await conn.getProgramAccounts(programId, { filters: [{ dataSize: 59 }] });
    let openCount = 0, resolvedCount = 0, openWagerLamports = 0;
    let totalWagerLamports = 0, maxWagerLamports = 0;
    const betVaultKeys = [];
    for (const { account } of accts) {
      const d = account.data;
      const dv = new DataView(d.buffer, d.byteOffset || 0, d.byteLength);
      const wager = Number(dv.getBigUint64(48, true));
      totalWagerLamports += wager;
      if (wager > maxWagerLamports) maxWagerLamports = wager;
      if (dv.getUint8(56) !== 0) { resolvedCount++; continue; }
      openCount++;
      openWagerLamports += wager;
      const player = new w.PublicKey(d.slice(8, 40));
      const [betVault] = await w.PublicKey.findProgramAddress(
        [te().encode('bet_vault'), player.toBuffer(), d.slice(40, 48)], programId);
      betVaultKeys.push(betVault);
    }
    let betVaultLamports = 0;
    if (betVaultKeys.length) {
      const infos = await conn.getMultipleAccountsInfo(betVaultKeys);
      for (const info of infos) if (info) betVaultLamports += info.lamports;
    }
    return {
      totalBets: accts.length, openCount, resolvedCount,
      openWagerLamports, betVaultLamports,
      totalWagerLamports, maxWagerLamports,
      avgWagerLamports: accts.length ? Math.floor(totalWagerLamports / accts.length) : 0,
    };
  }

  /** List every OPEN Bet account (state 0) for the admin settle tool.
   *  The nonce is the placement time (placeBet uses Date.now()), so rows
   *  sort oldest first — the longest-stuck bets surface at the top. */
  async function getOpenBets() {
    const w = web3();
    const conn = connection();
    const programId = new w.PublicKey(PROGRAM_ID);
    const accts = await conn.getProgramAccounts(programId, { filters: [{ dataSize: 59 }] });
    const out = [];
    for (const { pubkey, account } of accts) {
      const d = account.data;
      const dv = new DataView(d.buffer, d.byteOffset || 0, d.byteLength);
      if (dv.getUint8(56) !== 0) continue;
      out.push({
        bet: pubkey.toBase58(),
        player: new w.PublicKey(d.slice(8, 40)).toBase58(),
        nonce: Number(dv.getBigUint64(40, true)),
        wagerLamports: Number(dv.getBigUint64(48, true)),
      });
    }
    out.sort((a, b) => a.nonce - b.nonce);
    return out;
  }

  /** Recent money movement on the main vault PDA: for each of the latest
   *  transactions touching the vault, the signed lamport delta. Callers
   *  classify: big inflow = funding, small inflow = a lost wager collected,
   *  outflow = the 0.9x profit paid on a win (stakes move via bet_vaults
   *  and never touch the main vault). */
  async function getVaultActivity(limit = 8) {
    const w = web3();
    const conn = connection();
    const programId = new w.PublicKey(PROGRAM_ID);
    const [vault] = await w.PublicKey.findProgramAddress([te().encode('house_vault')], programId);
    const vaultStr = vault.toBase58();
    const sigs = await conn.getSignaturesForAddress(vault, { limit });
    const out = [];
    for (const s of sigs) {
      try {
        const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx || !tx.meta) continue;
        const keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
        const idx = keys.findIndex(k => k.toBase58() === vaultStr);
        if (idx < 0) continue;
        const delta = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
        if (!delta) continue;
        out.push({ signature: s.signature, blockTime: tx.blockTime || s.blockTime || null, deltaLamports: delta });
      } catch (e) { /* skip a tx that will not load; the rest still render */ }
    }
    return out;
  }

  window.SAK.SolanaHouse = { PROGRAM_ID, RPC_URL, placeBet, resolveBet, resolveAllLoss, derivePDAs, getHouseState, getOpenBetsSummary, getOpenBets, getVaultActivity };
})();

/* Second house instance for the $SMACK token (LT's dual-currency design,
 * 2026-10-23) — the SAME smack_house program (with the SPL plumbing fix:
 * vault/bet-vault token accounts are created by the program) deployed
 * under its own program ID and initialized with the $SMACK mint.
 * Config-swap ready: when the real $SMACK launches, PROGRAM_ID/MINT/
 * DECIMALS below are the only values that change.
 * Test mint on devnet: CBW7VQ8mz5V6hsPXoedaFNJTVHHpTJrfPPybYUphggBf */
(function () {
  const PROGRAM_ID = 'Hi82Vgt15emWPy8YFLwCH4QLnerSMm81YHYkgqv3NBBH';
  const MINT = 'CBW7VQ8mz5V6hsPXoedaFNJTVHHpTJrfPPybYUphggBf';
  const DECIMALS = 6;
  const RPC_URL = 'https://api.devnet.solana.com';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

  // sha256("global:<name>")[:8]
  const DISC = {
    initialize: [175, 175, 109, 31, 13, 152, 155, 237],
    place_bet: [222, 62, 67, 220, 63, 166, 126, 33],
    resolve_bet: [137, 132, 33, 97, 48, 208, 30, 159],
  };

  function web3() { return window.solanaWeb3; }
  function connection() { return new (web3().Connection)(RPC_URL, 'confirmed'); }
  function te() { return new TextEncoder(); }
  function u64(n) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; }
  function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
  function concat(...arrs) {
    const t = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of arrs) { t.set(a, o); o += a.length; }
    return t;
  }

  async function derivePDAs(playerPk, nonce) {
    const w = web3();
    const programId = new w.PublicKey(PROGRAM_ID);
    const [house] = await w.PublicKey.findProgramAddress([te().encode('house')], programId);
    const [vault] = await w.PublicKey.findProgramAddress([te().encode('house_vault')], programId);
    const out = { house, vault };
    if (playerPk && nonce !== undefined) {
      const nonceBytes = u64(nonce);
      const [bet] = await w.PublicKey.findProgramAddress([te().encode('bet'), playerPk.toBuffer(), nonceBytes], programId);
      const [betVault] = await w.PublicKey.findProgramAddress([te().encode('bet_vault'), playerPk.toBuffer(), nonceBytes], programId);
      out.bet = bet; out.betVault = betVault;
    }
    return out;
  }
  async function getAta(ownerPk) {
    const w = web3();
    const [ata] = await w.PublicKey.findProgramAddress(
      [ownerPk.toBuffer(), new w.PublicKey(TOKEN_PROGRAM).toBuffer(), new w.PublicKey(MINT).toBuffer()],
      new w.PublicKey(ATA_PROGRAM));
    return ata;
  }

  function getSigner() {
    const SAK = window.SAK || {};
    const W = SAK.Wallet;
    if (!W || !W.isConnected) throw new Error('Wallet not connected');
    const found = W.getProvider && W.getProvider();
    const provider = found && found.provider ? found.provider : found;
    if (!provider) throw new Error('Wallet provider not available');
    return { provider, address: W.address };
  }
  async function buildAndSend(ixs, feePayer) {
    const w = web3();
    const conn = connection();
    const { provider } = getSigner();
    const tx = new w.Transaction();
    for (const ix of ixs) tx.add(ix);
    tx.feePayer = new w.PublicKey(feePayer);
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const signed = await provider.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  }
  const K = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

  /** House state for the $SMACK instance. initialized=false (not an
   *  error) when the config account doesn't exist yet. */
  async function getState() {
    const w = web3();
    const conn = connection();
    const { house, vault } = await derivePDAs();
    const [hInfo, vInfo] = await Promise.all([conn.getAccountInfo(house), conn.getAccountInfo(vault)]);
    if (!hInfo) return { initialized: false, houseAddress: house.toBase58(), vaultAddress: vault.toBase58() };
    const d = hInfo.data;
    const dv = new DataView(d.buffer, d.byteOffset || 0, d.byteLength);
    const pk = off => new w.PublicKey(d.slice(off, off + 32)).toBase58();
    const winBps = dv.getUint16(136, true);
    const payoutBps = Number(dv.getBigUint64(138, true));
    const maxBetBps = dv.getUint16(146, true);
    const burnBps = dv.getUint16(148, true);
    let vaultBase = 0n;
    if (vInfo && vInfo.data && vInfo.data.length >= 72) {
      const vd = new DataView(vInfo.data.buffer, vInfo.data.byteOffset || 0, vInfo.data.byteLength);
      vaultBase = vd.getBigUint64(64, true); // token account amount @64
    }
    const maxBetBase = Number(vaultBase) * maxBetBps / payoutBps;
    return {
      initialized: true,
      admin: pk(8), treasury: pk(40), resolver: pk(72), mint: pk(104),
      winBps, payoutBps, maxBetBps, burnBps,
      vaultBase: Number(vaultBase), maxBetBase: Math.floor(maxBetBase),
      houseAddress: house.toBase58(), vaultAddress: vault.toBase58(),
    };
  }

  /** Connected wallet's $SMACK balance in base units (0n when no ATA). */
  async function getTokenBalance(walletAddr) {
    const w = web3();
    const conn = connection();
    const ata = await getAta(new w.PublicKey(walletAddr));
    const info = await conn.getAccountInfo(ata);
    if (!info || info.data.length < 72) return 0n;
    const dv = new DataView(info.data.buffer, info.data.byteOffset || 0, info.data.byteLength);
    return dv.getBigUint64(64, true);
  }

  /** One-time setup: the connected wallet becomes admin/treasury/resolver
   *  of the $SMACK house (same household shape as the SOL house). */
  async function initialize() {
    const w = web3();
    const { address } = getSigner();
    const me = new w.PublicKey(address);
    const { house, vault } = await derivePDAs();
    const data = concat(new Uint8Array(DISC.initialize), u16(4500), u64(19000), u16(500), u16(100));
    const ix = new w.TransactionInstruction({
      programId: new w.PublicKey(PROGRAM_ID),
      keys: [
        K(house, false, true), K(vault, false, true), K(me, true, true),
        K(me, false, false), K(me, false, false), K(new w.PublicKey(MINT), false, false),
        K(new w.PublicKey(TOKEN_PROGRAM), false, false), K(w.SystemProgram.programId, false, false),
      ],
      data,
    });
    const signature = await buildAndSend([ix], address);
    return { signature };
  }

  /** Place a $SMACK bet. Amounts are base units (10^DECIMALS per token).
   *  Creates the player's token account first if they don't have one. */
  async function placeBet(baseUnits) {
    const w = web3();
    const { address } = getSigner();
    const playerPk = new w.PublicKey(address);
    const nonce = Date.now();
    const { house, vault, bet, betVault } = await derivePDAs(playerPk, nonce);
    const ata = await getAta(playerPk);
    const ixs = [];
    const conn = connection();
    if (!(await conn.getAccountInfo(ata))) {
      ixs.push(new w.TransactionInstruction({
        programId: new w.PublicKey(ATA_PROGRAM),
        keys: [
          K(playerPk, true, true), K(ata, false, true), K(playerPk, false, false),
          K(new w.PublicKey(MINT), false, false), K(w.SystemProgram.programId, false, false),
          K(new w.PublicKey(TOKEN_PROGRAM), false, false),
        ],
        data: new Uint8Array(0),
      }));
    }
    const data = concat(new Uint8Array(DISC.place_bet), u64(nonce), u64(baseUnits));
    ixs.push(new w.TransactionInstruction({
      programId: new w.PublicKey(PROGRAM_ID),
      keys: [
        K(house, false, false), K(vault, false, false), K(bet, false, true), K(betVault, false, true),
        K(playerPk, true, true), K(ata, false, true), K(new w.PublicKey(MINT), false, true),
        K(new w.PublicKey(TOKEN_PROGRAM), false, false), K(w.SystemProgram.programId, false, false),
      ],
      data,
    }));
    const signature = await buildAndSend(ixs, address);
    return { signature, bet: bet.toBase58(), nonce, wagerBase: baseUnits };
  }

  async function buildResolveIx(playerAddr, nonce, playerWon, resolverAddr) {
    const w = web3();
    const playerPk = new w.PublicKey(playerAddr);
    const { house, vault, bet, betVault } = await derivePDAs(playerPk, nonce);
    const ata = await getAta(playerPk);
    const data = concat(new Uint8Array(DISC.resolve_bet), new Uint8Array([playerWon ? 1 : 0]));
    return new w.TransactionInstruction({
      programId: new w.PublicKey(PROGRAM_ID),
      keys: [
        K(house, false, false), K(vault, false, true), K(bet, false, true), K(betVault, false, true),
        K(new w.PublicKey(resolverAddr), true, false), K(playerPk, false, true), K(ata, false, true),
        K(new w.PublicKey(TOKEN_PROGRAM), false, false), K(w.SystemProgram.programId, false, false),
      ],
      data,
    });
  }
  async function resolveBet(betAddr, playerAddr, nonce, playerWon) {
    const { address } = getSigner();
    const ix = await buildResolveIx(playerAddr, nonce, playerWon, address);
    const signature = await buildAndSend([ix], address);
    return { signature };
  }
  async function resolveAllLoss(bets) {
    const { address } = getSigner();
    let settled = 0;
    const signatures = [];
    for (let i = 0; i < bets.length; i += 8) {
      const chunk = bets.slice(i, i + 8);
      const ixs = [];
      for (const b of chunk) ixs.push(await buildResolveIx(b.player, b.nonce, false, address));
      try {
        signatures.push(await buildAndSend(ixs, address));
        settled += chunk.length;
      } catch (e) { e.settled = settled; throw e; }
    }
    return { settled, signatures };
  }
  async function getOpenBets() {
    const w = web3();
    const conn = connection();
    const programId = new w.PublicKey(PROGRAM_ID);
    const accts = await conn.getProgramAccounts(programId, { filters: [{ dataSize: 59 }] });
    const out = [];
    for (const { pubkey, account } of accts) {
      const d = account.data;
      const dv = new DataView(d.buffer, d.byteOffset || 0, d.byteLength);
      if (dv.getUint8(56) !== 0) continue;
      out.push({
        bet: pubkey.toBase58(),
        player: new w.PublicKey(d.slice(8, 40)).toBase58(),
        nonce: Number(dv.getBigUint64(40, true)),
        wagerBase: Number(dv.getBigUint64(48, true)),
      });
    }
    out.sort((a, b) => a.nonce - b.nonce);
    return out;
  }

  window.SAK = window.SAK || {};
  window.SAK.SolanaTokenHouse = { PROGRAM_ID, MINT, DECIMALS, RPC_URL, getState, getTokenBalance, getAta, initialize, placeBet, resolveBet, resolveAllLoss, getOpenBets, derivePDAs };
})();
