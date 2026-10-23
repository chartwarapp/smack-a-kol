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
