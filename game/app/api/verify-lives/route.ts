import { ethers } from 'ethers';
import { NextRequest, NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/rewardAuth';

// The wallet that must RECEIVE the lives payment, the price, and the chain.
const LIVES_RECEIVER_ADDRESS = '0x54CfcB5DA23dB98762C3919093A9B230D6Ed429D';
const LIVES_PRICE_CELO = '0.1';
const CELO_RPC_URL = 'https://forno.celo.org';
const CELO_CHAIN_ID = 42220;
const MINE_TIMEOUT_MS = 60_000; // how long we'll wait for the tx to be mined

// Tx hashes already redeemed for lives — prevents replaying one payment twice.
// NOTE: in-memory / per-instance only (resets on serverless cold start and is not
// shared across instances). For production-grade replay protection back this with
// Redis/KV, same caveat as the reward endpoint's rate-limit state.
const redeemedTx = new Set<string>();

// Verifies on-chain that a claimed "buy lives" payment is real BEFORE the client
// is allowed to grant lives. The client's word ("I got a txHash") is never trusted.
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { txHash, from } = await request.json();

    // Shape validation up front — cheap rejects before touching the RPC.
    if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return NextResponse.json({ success: false, error: 'Invalid transaction hash' }, { status: 400 });
    }
    if (!from || !ethers.isAddress(from)) {
      return NextResponse.json({ success: false, error: 'Invalid sender address' }, { status: 400 });
    }
    const payer = ethers.getAddress(from);
    const key = txHash.toLowerCase();

    if (redeemedTx.has(key)) {
      return NextResponse.json(
        { success: false, error: 'This payment was already redeemed' },
        { status: 409 }
      );
    }

    const provider = new ethers.JsonRpcProvider(CELO_RPC_URL, CELO_CHAIN_ID);

    // Wait for the tx to be mined (the client returns the hash before it's mined).
    let receipt;
    try {
      receipt = await provider.waitForTransaction(txHash, 1, MINE_TIMEOUT_MS);
    } catch {
      receipt = null;
    }
    if (!receipt) {
      return NextResponse.json(
        { success: false, error: 'Transaction not mined yet — try again in a moment' },
        { status: 400 }
      );
    }
    if (receipt.status !== 1) {
      return NextResponse.json({ success: false, error: 'Transaction failed on-chain' }, { status: 400 });
    }

    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 400 });
    }

    // ── The actual payment checks (all must hold) ──
    // 1. Correct chain.
    if (tx.chainId != null && Number(tx.chainId) !== CELO_CHAIN_ID) {
      return NextResponse.json({ success: false, error: 'Wrong network' }, { status: 400 });
    }
    // 2. Paid to the correct receiver.
    if (!tx.to || ethers.getAddress(tx.to) !== ethers.getAddress(LIVES_RECEIVER_ADDRESS)) {
      return NextResponse.json({ success: false, error: 'Payment sent to the wrong address' }, { status: 400 });
    }
    // 3. Sent by the wallet claiming the lives (can't redeem someone else's tx).
    if (ethers.getAddress(tx.from) !== payer) {
      return NextResponse.json({ success: false, error: 'Payment sender mismatch' }, { status: 400 });
    }
    // 4. Exactly the lives price — not a dust amount.
    if (tx.value !== ethers.parseUnits(LIVES_PRICE_CELO, 18)) {
      return NextResponse.json({ success: false, error: 'Incorrect payment amount' }, { status: 400 });
    }

    // Mark redeemed only after every check passes.
    redeemedTx.add(key);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('verify-lives API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
