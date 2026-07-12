import { ethers } from 'ethers';

// ─── CheetahChain leaderboard contract ─────────────────────────────────────────
// CheetahChain leaderboard, deployed on Celo mainnet.
export const LEADERBOARD_ADDRESS = '0xaA713E46cb662d8234d90Fc7D995f0f9A49dC3ea';

export const CELO_CHAIN_ID = 42220;
const CELO_CHAIN_ID_HEX = '0xa4ec'; // 42220

// USDm / Mento Dollar on Celo mainnet — verified on-chain: symbol "USDm",
// name "Mento Dollar", 18 decimals. NOT Mountain Protocol's USDM. USDm is a
// registered Celo fee currency, so MiniPay can pay gas in it. (Same address is
// duplicated in Game.tsx and api/verify-lives/route.ts — kept local per the
// existing pattern rather than sharing a module in this pass.)
const USDM_ADDRESS = '0x765DE816845861e75A25fCA122bb6898B8B1282a';

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

    // MiniPay users typically hold no native CELO, so a normal gas-in-CELO tx
    // fails (the likely cause of "NOT SAVED (TX SKIPPED)"). Pay gas in USDm via
    // Celo's feeCurrency field. ethers v6 dropped Celo support and would strip
    // feeCurrency from its Overrides, so for MiniPay we bypass the Contract
    // helper and send a raw eth_sendTransaction that carries feeCurrency. Let
    // MiniPay build the fee-currency (CIP-64) tx and price gas itself.
    if (window.ethereum?.isMiniPay) {
      const from = await (await provider.getSigner()).getAddress();
      const iface = new ethers.Interface(LEADERBOARD_ABI);
      const data = iface.encodeFunctionData('submitScore', [BigInt(Math.floor(score))]);
      const hash: string = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from,
            to: LEADERBOARD_ADDRESS,
            data,
            feeCurrency: USDM_ADDRESS, // pay gas in USDm, not native CELO
            chainId: CELO_CHAIN_ID,
          },
        ],
      });
      // Preserve the "hash only on confirmed success" contract the caller relies
      // on to show SAVED vs NOT SAVED.
      const receipt = await provider.waitForTransaction(hash, 1);
      if (!receipt || receipt.status !== 1) return null;
      return hash;
    }

    // ── Non-MiniPay path (unchanged) ──
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(LEADERBOARD_ADDRESS, LEADERBOARD_ABI, signer);
    const tx = await contract.submitScore(BigInt(Math.floor(score)));
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
