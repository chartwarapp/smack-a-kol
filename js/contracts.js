/* Smack-a-KOL on-chain contracts (devnet).
 * Handles initialize for escrow + house programs using the connected wallet.
 * Admin must be LT's wallet: 6nocUciCs3o8Usa86NKJxm82p5b2Wzya23DJrFNi4brx
 */
(function() {
  'use strict';

  const ESCROW_PROGRAM = 'F4kqMuoAP4kzDT6x41ha15UPicBpQpQay5Txsg85cSWr';
  const HOUSE_PROGRAM = 'SpYmnT53X3KyYYawSLLzD8hVqWFTkNUQf3a8L3rCzjN';
  const NATIVE_MINT = 'So11111111111111111111111111111111111111112'; // SOL
  const RPC_URL = 'https://api.devnet.solana.com';

  // Anchor discriminators for initialize (from IDL)
  const INIT_DISCRIMINATOR = [175, 175, 109, 31, 13, 152, 155, 237];

  let web3Promise = null;
  function loadWeb3() {
    if (web3Promise) return web3Promise;
    web3Promise = new Promise((resolve, reject) => {
      if (window.solanaWeb3) return resolve(window.solanaWeb3);
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@solana/web3.js@1.95.3/lib/index.iife.min.js';
      s.onload = () => resolve(window.solanaWeb3);
      s.onerror = () => reject(new Error('Failed to load web3.js'));
      document.head.appendChild(s);
    });
    return web3Promise;
  }

  async function findPDA(web3, seeds, programId) {
    const seedBuffers = seeds.map(s => typeof s === 'string' ? Buffer.from(s) : s);
    const [pda] = await web3.PublicKey.findProgramAddress(seedBuffers, new web3.PublicKey(programId));
    return pda;
  }

  function encodeU16(n) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n, 0);
    return b;
  }

  function encodeU64(n) {
    const b = Buffer.alloc(8);
    // n is a JS number, may exceed 32 bits
    const big = BigInt(n);
    b.writeBigUInt64LE(big, 0);
    return b;
  }

  async function initializeEscrow(web3, connection, walletPubkey, signTransaction) {
    const programId = new web3.PublicKey(ESCROW_PROGRAM);
    const admin = new web3.PublicKey(walletPubkey);
    // Config PDA: seeds = ["config"]
    const configPDA = await findPDA(web3, ['config'], ESCROW_PROGRAM);

    // Build initialize instruction: discriminator + fee_bps (u16, 500 = 5%)
    const data = Buffer.concat([
      Buffer.from(INIT_DISCRIMINATOR),
      encodeU16(500) // 5% platform fee
    ]);

    const ix = new web3.TransactionInstruction({
      programId,
      keys: [
        { pubkey: configPDA, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true }, // admin
        { pubkey: admin, isSigner: false, isWritable: false }, // treasury (same as admin for now)
        { pubkey: admin, isSigner: false, isWritable: false }, // resolver (same as admin for now)
        { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data
    });

    const tx = new web3.Transaction().add(ix);
    tx.feePayer = admin;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    return sig;
  }

  async function initializeHouse(web3, connection, walletPubkey, signTransaction) {
    const programId = new web3.PublicKey(HOUSE_PROGRAM);
    const admin = new web3.PublicKey(walletPubkey);
    const mint = new web3.PublicKey(NATIVE_MINT);

    // House PDA: seeds = ["house"], Vault PDA: seeds = ["vault"]
    const housePDA = await findPDA(web3, ['house'], HOUSE_PROGRAM);
    const vaultPDA = await findPDA(web3, ['vault'], HOUSE_PROGRAM);

    // Args: player_win_bps (u16, 4500 = 45%), payout_bps (u64, 19000 = 1.9x),
    //       max_bet_bps_of_vault (u16, 500 = 5%), burn_bps (u16, 100 = 1%)
    const data = Buffer.concat([
      Buffer.from(INIT_DISCRIMINATOR),
      encodeU16(4500),
      encodeU64(19000),
      encodeU16(500),
      encodeU16(100)
    ]);

    const ix = new web3.TransactionInstruction({
      programId,
      keys: [
        { pubkey: housePDA, isSigner: false, isWritable: true },
        { pubkey: vaultPDA, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true }, // admin
        { pubkey: admin, isSigner: false, isWritable: false }, // treasury
        { pubkey: admin, isSigner: false, isWritable: false }, // resolver
        { pubkey: mint, isSigner: false, isWritable: false }, // mint (SOL)
        { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data
    });

    const tx = new web3.Transaction().add(ix);
    tx.feePayer = admin;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    return sig;
  }

  async function checkInitialized(web3, connection) {
    // Check if config PDA has data (initialized)
    try {
      const configPDA = await findPDA(web3, ['config'], ESCROW_PROGRAM);
      const info = await connection.getAccountInfo(configPDA);
      const escrowInit = info && info.data.length > 0;

      const housePDA = await findPDA(web3, ['house'], HOUSE_PROGRAM);
      const houseInfo = await connection.getAccountInfo(housePDA);
      const houseInit = houseInfo && houseInfo.data.length > 0;

      return { escrow: !!escrowInit, house: !!houseInit };
    } catch (e) {
      return { escrow: false, house: false, error: e.message };
    }
  }

  // Public API
  window.SAKContracts = {
    ESCROW_PROGRAM,
    HOUSE_PROGRAM,
    loadWeb3,
    initializeEscrow,
    initializeHouse,
    checkInitialized,
    RPC_URL
  };
})();
