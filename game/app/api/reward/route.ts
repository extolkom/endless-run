import { ethers } from 'ethers';
import { NextRequest, NextResponse } from 'next/server';
import { sameOrigin, verifySessionToken } from '@/lib/rewardAuth';

const REWARD_WALLET_ADDRESS = '0x54CfcB5DA23dB98762C3919093A9B230D6Ed429D';
const CELO_RPC_URL = 'https://forno.celo.org';
const CELO_CHAIN_ID = 42220;

// ─── Payout policy (server-enforced — the client cannot change these) ───────────
const REWARD_AMOUNT_CELO = '0.002';    // fixed payout per coin; any client `amount` is ignored
const MIN_WALLET_RESERVE_CELO = 0.05;  // stop paying out once the wallet drops below this
const ADDRESS_COOLDOWN_MS = 4_000;     // min gap between payouts to the same address
const MAX_PAYOUTS_PER_MINUTE = 30;     // global throttle across all recipients
const MAX_PAYOUTS_PER_SESSION = 100;   // hard cap of coins paid per signed session token

// ─── USDm (MiniPay) payout path ─────────────────────────────────────────────────
// MiniPay users hold stablecoin, not native CELO, so we pay their coin rewards in
// USDm (Mento Dollar, an ERC-20) instead. Same token the buy-lives flow uses.
const REWARD_AMOUNT_USDM = '0.002';    // fixed USDm payout per coin (mirrors REWARD_AMOUNT_CELO)
const MIN_WALLET_RESERVE_USDM = 0.01;  // stop paying USDm once the wallet drops below this
const USDM_ADDRESS = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const USDM_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];
// Gas limit for an ERC-20 transfer() (gas is paid in native CELO). Used both to
// guard the wallet's CELO balance up front and as the actual tx gas limit.
const USDM_TRANSFER_GAS_LIMIT = BigInt(100000);

// ─── In-memory rate-limit state ─────────────────────────────────────────────────
// NOTE: per-instance only. On serverless this resets on cold start and is not
// shared across instances — for production-grade limits back this with Redis/KV.
const lastPaidAt = new Map<string, number>();
const recentPayouts: number[] = [];
const sessionPayouts = new Map<string, number>(); // sid → payouts so far

export async function POST(request: NextRequest) {
  try {
    // Reject cross-site calls — this endpoint is not a public faucet.
    if (!sameOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { to, token, isMiniPay } = await request.json();
    // Client-supplied hint that the player is on MiniPay (a stablecoin wallet).
    // Low stakes if spoofed: the worst case is a reward paid in the wrong currency,
    // never extra funds — the amount and recipient stay server-enforced either way.
    const payInUsdm = isMiniPay === true;

    // Validate the recipient address (the client-supplied amount is intentionally ignored).
    if (!to || !ethers.isAddress(to)) {
      return NextResponse.json(
        { success: false, error: 'Invalid recipient address' },
        { status: 400 }
      );
    }
    const recipient = ethers.getAddress(to); // checksum-normalise for stable rate-limit keys

    // ── Session token: proves the caller started a game via /api/game-session and
    //    binds this payout to that wallet + session. Signed server-side, so the
    //    client cannot forge it or point it at a different wallet. ──
    const now = Date.now();
    const session = verifySessionToken(token, now);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired game session' },
        { status: 401 }
      );
    }
    if (ethers.getAddress(session.addr) !== recipient) {
      return NextResponse.json(
        { success: false, error: 'Session does not match recipient' },
        { status: 403 }
      );
    }
    if ((sessionPayouts.get(session.sid) ?? 0) >= MAX_PAYOUTS_PER_SESSION) {
      return NextResponse.json(
        { success: false, error: 'Session payout limit reached' },
        { status: 429 }
      );
    }

    // ── Rate limiting ──
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

    // Server-enforced amounts — never trust the client for the payout size.
    const amountCeloWei = ethers.parseUnits(REWARD_AMOUNT_CELO, 18);
    const amountUsdmWei = ethers.parseUnits(REWARD_AMOUNT_USDM, 18);
    const usdm = new ethers.Contract(USDM_ADDRESS, USDM_ABI, signer);

    // Current gas price (gas is paid in native CELO for both payout paths).
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');

    // Keep a reserve so a runaway/abused flow can never zero the wallet. Each path
    // checks the balance of the asset it actually pays out (USDm vs native CELO).
    if (payInUsdm) {
      const usdmBalance: bigint = await usdm.balanceOf(signer.address);
      const reserveWei = ethers.parseUnits(String(MIN_WALLET_RESERVE_USDM), 18);
      if (usdmBalance - amountUsdmWei < reserveWei) {
        return NextResponse.json({ success: false, error: 'Reward pool depleted (USDm)' }, { status: 503 });
      }
      // Gas is still paid in native CELO on the USDm path. Verify the wallet can
      // cover the transfer()'s gas up front, so we fail early with a clear error
      // instead of at broadcast time when CELO runs low.
      const nativeBalance = await provider.getBalance(signer.address);
      const gasCostWei = gasPrice * USDM_TRANSFER_GAS_LIMIT;
      if (nativeBalance < gasCostWei) {
        return NextResponse.json({ success: false, error: 'Insufficient CELO for gas' }, { status: 503 });
      }
    } else {
      const balance = await provider.getBalance(signer.address);
      const reserveWei = ethers.parseUnits(String(MIN_WALLET_RESERVE_CELO), 18);
      if (balance - amountCeloWei < reserveWei) {
        return NextResponse.json({ success: false, error: 'Reward pool depleted' }, { status: 503 });
      }
    }

    // Reserve the rate-limit slots BEFORE sending so concurrent calls can't slip past the caps.
    lastPaidAt.set(recipient, now);
    recentPayouts.push(now);
    sessionPayouts.set(session.sid, (sessionPayouts.get(session.sid) ?? 0) + 1);

    // Send the payout. MiniPay players get an ERC-20 USDm transfer; everyone else
    // gets the original native CELO transfer (unchanged).
    if (payInUsdm) {
      console.error('[reward] USDm payout attempt', {
        recipient,
        rewardWallet: signer.address,
        amountUsdmWei: amountUsdmWei.toString(),
        gasPrice: gasPrice.toString(),
        gasLimit: USDM_TRANSFER_GAS_LIMIT.toString(),
      });
    }
    const tx = payInUsdm
      ? await usdm.transfer(recipient, amountUsdmWei, { gasPrice, gasLimit: USDM_TRANSFER_GAS_LIMIT })
      : await signer.sendTransaction({
          to: recipient,
          value: amountCeloWei,
          gasPrice,
          gasLimit: 21000, // Standard gas limit for simple transfers
        });

    console.error('[reward] payout tx submitted', { txHash: tx.hash, payInUsdm, recipient });

    // Wait for transaction to be mined
    const receipt = await tx.wait();
    console.error('[reward] payout receipt', { txHash: tx.hash, receiptStatus: receipt?.status, blockNumber: receipt?.blockNumber });

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
