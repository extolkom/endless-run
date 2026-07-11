import { ethers } from 'ethers';

// ─── CheetahChain leaderboard contract ─────────────────────────────────────────
// CheetahChain leaderboard, deployed on Celo mainnet.
export const LEADERBOARD_ADDRESS = '0xaA713E46cb662d8234d90Fc7D995f0f9A49dC3ea';

export const CELO_CHAIN_ID = 42220;
const CELO_CHAIN_ID_HEX = '0xa4ec'; // 42220

export const LEADERBOARD_ABI = [
  'function submitScore(uint256 score) external',
  'function getTopScores() view returns (tuple(address player, uint128 score, uint64 timestamp)[])',
  'function bestScoreOf(address player) view returns (uint256)',
  'function getPlayer(address player) view returns (tuple(uint128 bestScore, uint64 gamesPlayed, uint64 lastPlayed))',
  'function totalGames() view returns (uint256)',
  'function totalPlayers() view returns (uint256)',
];

export interface TopScore {
  player: string;
  score: number;
  timestamp: number;
}

/**
 * Record a finished run on-chain. Sends a real Celo transaction via the
 * connected wallet (MiniPay / MetaMask). Returns the tx hash, or null if it
 * was skipped (no wallet / not configured) or failed.
 */
export async function submitScoreOnChain(score: number): Promise<string | null> {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  if (!LEADERBOARD_ADDRESS) {
    console.warn('LEADERBOARD_ADDRESS not set — deploy the contract and paste the address.');
    return null;
  }
  if (!Number.isFinite(score) || score <= 0) return null;

  try {
    const provider = new ethers.BrowserProvider(window.ethereum);

    // Make sure the wallet is on Celo mainnet.
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CELO_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CELO_CHAIN_ID_HEX }],
        });
      } catch {
        // MiniPay is always on Celo; other wallets may reject — let the tx try anyway.
      }
    }

    const signer = await provider.getSigner();
    const contract = new ethers.Contract(LEADERBOARD_ADDRESS, LEADERBOARD_ABI, signer);

    // MiniPay only accepts legacy (type-0) transactions and ignores EIP-1559
    // fields, but ethers v6 defaults to EIP-1559. Under MiniPay, force a legacy
    // tx with an explicit gasPrice. Other wallets keep ethers' default behaviour.
    const overrides: ethers.Overrides = {};
    if (window.ethereum?.isMiniPay) {
      const feeData = await provider.getFeeData();
      overrides.type = 0;
      overrides.gasPrice = feeData.gasPrice ?? ethers.parseUnits('5', 'gwei');
    }

    const tx = await contract.submitScore(BigInt(Math.floor(score)), overrides);
    await tx.wait();
    return tx.hash as string;
  } catch (error) {
    console.error('submitScoreOnChain error:', error);
    return null;
  }
}

/** Read the on-chain top-10 leaderboard (read-only, no wallet needed). */
export async function fetchTopScores(): Promise<TopScore[]> {
  if (!LEADERBOARD_ADDRESS) return [];
  try {
    const provider = new ethers.JsonRpcProvider('https://forno.celo.org', CELO_CHAIN_ID);
    const contract = new ethers.Contract(LEADERBOARD_ADDRESS, LEADERBOARD_ABI, provider);
    const raw = await contract.getTopScores();
    return raw.map((e: { player: string; score: bigint; timestamp: bigint }) => ({
      player: e.player,
      score: Number(e.score),
      timestamp: Number(e.timestamp),
    }));
  } catch (error) {
    console.error('fetchTopScores error:', error);
    return [];
  }
}
