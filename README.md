# Endless Run (Celo MiniPay Edition)

An HTML5 action runner game integrated with the Celo blockchain, featuring MiniPay wallet auto-detection, USDm stablecoin micro-rewards, and on-chain leaderboard verification.

## Tech Stack
- **Framework**: Next.js 14 (App Router) & React 18
- **Language**: TypeScript
- **Styling**: Vanilla CSS, Design System Tokens (`styleConstants.ts`), Vampire Wars `@font-face`
- **Blockchain & Payments**: Celo Mainnet / Alfajores, MiniPay Wallet Webview, USDm (cUSD) ERC-20
- **Smart Contracts**: Solidity Leaderboard Contract (`contract/`)

## Recent Architecture & Security Updates
- **MiniPay USDm Payout Pipeline**: Enabled USDm token rewards for coin collection inside MiniPay environment (`/api/reward`).
- **Session Token Security**: Gated reward APIs behind cryptographic session tokens (`rewardAuth.ts`).
- **On-Chain Verification**: Added automated verification for purchase receipts and score entries before state mutation.
- **Ninja UI Design System**: Harmonized typography, dark navy frosted glass cards, cyan/purple glows, and mobile touch targets across all screens.

## Project Structure
```
├── contract/             # Solidity smart contracts & ABI
└── game/                 # Next.js web application
    ├── app/              # Next.js App Router (pages & API routes)
    ├── components/       # Core Game canvas & UI components
    └── lib/              # Leaderboard integration & style constants
```
