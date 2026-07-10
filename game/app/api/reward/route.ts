import { ethers } from 'ethers';
import { NextRequest, NextResponse } from 'next/server';

const REWARD_WALLET_ADDRESS = '0x54CfcB5DA23dB98762C3919093A9B230D6Ed429D';
const CELO_RPC_URL = 'https://forno.celo.org';
const CELO_CHAIN_ID = 42220;

// ─── Payout policy (server-enforced — the client cannot change these) ───────────
const REWARD_AMOUNT_CELO = '0.002';    // fixed payout per coin; any client `amount` is ignored
const MIN_WALLET_RESERVE_CELO = 0.05;  // stop paying out once the wallet drops below this
const ADDRESS_COOLDOWN_MS = 4_000;     // min gap between payouts to the same address
const MAX_PAYOUTS_PER_MINUTE = 30;     // global throttle across all recipients

// ─── In-memory rate-limit state ─────────────────────────────────────────────────
// NOTE: per-instance only. On serverless this resets on cold start and is not
// shared across instances — for production-grade limits back this with Redis/KV.
const lastPaidAt = new Map<string, number>();
const recentPayouts: number[] = [];

/** Only accept calls that originate from the game front-end itself. */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Reject cross-site calls — this endpoint is not a public faucet.
    if (!sameOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { to } = await request.json();

    // Validate the recipient address (the client-supplied amount is intentionally ignored).
    if (!to || !ethers.isAddress(to)) {
      return NextResponse.json(
        { success: false, error: 'Invalid recipient address' },
        { status: 400 }
      );
    }
    const recipient = ethers.getAddress(to); // checksum-normalise for stable rate-limit keys

    // ── Rate limiting ──
    const now = Date.now();
    if (now - (lastPaidAt.get(recipient) ?? 0) < ADDRESS_COOLDOWN_MS) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }
    while (recentPayouts.length && now - recentPayouts[0] > 60_000) recentPayouts.shift();
    if (recentPayouts.length >= MAX_PAYOUTS_PER_MINUTE) {
      return NextResponse.json(
        { success: false, error: 'Reward pool busy, try again shortly' },
        { status: 429 }
      );
    }

    // Get private key from environment
    const privateKey = process.env.REWARD_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json(
        { success: false, error: 'Reward wallet not configured' },
        { status: 500 }
      );
    }

    // Create provider and signer
    const provider = new ethers.JsonRpcProvider(CELO_RPC_URL, CELO_CHAIN_ID);
    const signer = new ethers.Wallet(privateKey, provider);
    if (signer.address.toLowerCase() !== REWARD_WALLET_ADDRESS.toLowerCase()) {
      console.warn('REWARD_PRIVATE_KEY does not match the expected REWARD_WALLET_ADDRESS');
    }

    // Server-enforced amount — never trust the client for the payout size.
    const amountWei = ethers.parseUnits(REWARD_AMOUNT_CELO, 18);

    // Keep a reserve so a runaway/abused flow can never zero the wallet.
    const balance = await provider.getBalance(signer.address);
    const reserveWei = ethers.parseUnits(String(MIN_WALLET_RESERVE_CELO), 18);
    if (balance - amountWei < reserveWei) {
      return NextResponse.json({ success: false, error: 'Reward pool depleted' }, { status: 503 });
    }

    // Reserve the rate-limit slots BEFORE sending so concurrent calls can't slip past the caps.
    lastPaidAt.set(recipient, now);
    recentPayouts.push(now);

    // Get current gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');

    // Create and send transaction
    const tx = await signer.sendTransaction({
      to: recipient,
      value: amountWei,
      gasPrice,
      gasLimit: 21000, // Standard gas limit for simple transfers
    });

    // Wait for transaction to be mined
    const receipt = await tx.wait();

    return NextResponse.json({
      success: true,
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber,
    });
  } catch (error) {
    console.error('Reward API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
