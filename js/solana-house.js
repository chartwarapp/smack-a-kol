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

  /** Resolve a bet. playerWon=true pays 1.9x, false keeps wager in vault. Resolver must sign (devnet: admin wallet). */
  async function resolveBet(betAddr, playerAddr, nonce, playerWon) {
    const w = web3();
    const { address } = getSigner();
    const playerPk = new w.PublicKey(playerAddr);
    const { house, vault, bet, betVault } = await derivePDAs(playerPk, nonce);
    const data = concat(new Uint8Array(DISC.resolve_bet), new Uint8Array([playerWon ? 1 : 0]));
    const ix = new w.TransactionInstruction({
      programId: new w.PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: house, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: bet, isSigner: false, isWritable: true },
        { pubkey: betVault, isSigner: false, isWritable: true },
        { pubkey: new w.PublicKey(address), isSigner: true, isWritable: false },
        { pubkey: playerPk, isSigner: false, isWritable: true },
        { pubkey: new w.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await buildAndSend([ix], address);
    return { signature };
  }

  window.SAK = window.SAK || {};
  window.SAK.SolanaHouse = { PROGRAM_ID, RPC_URL, placeBet, resolveBet, derivePDAs };
})();
