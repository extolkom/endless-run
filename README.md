# Endless Run (Celo MiniPay Edition)

An HTML5 action runner game integrated with the Celo blockchain, featuring MiniPay wallet auto-detection, USDm stablecoin micro-rewards, and on-chain leaderboard verification.

## Current Project Capabilities

### 🪙 MiniPay & USDm Integration
- **Auto-Detection**: Implicitly detects MiniPay webview environment and configures legacy transaction signing paths without requiring explicit wallet connection prompts.
- **USDm Stablecoin Payouts**: In-game coin collections pay out direct USDm rewards to player wallets via MiniPay.
- **Lives Purchases**: Players can buy extra lives for 0.01 USDm on MiniPay or equivalent CELO on web browsers.

### 🔒 Security Hardening
- **Signed Session Tokens**: Reward claims and score submissions require signed session tokens generated during gameplay initialization (`/api/game-session`).
- **On-Chain Verification**: Purchases and leaderboard submissions are verified against Celo RPC nodes (`/api/verify-lives`, `game/lib/leaderboard.ts`).

### 🥷 Ninja UI Revamp (In Progress)
- Modernized dark theme design system (`NINJA_THEME`, `PAL`, `FONT_FAMILY`, `SHADOWS`, `BORDER_RADIUS`).
- Custom **Vampire Wars** font integration across title cards and modal headers.
- Restyled Start Screen, Game Over Screen, Leaderboard Modal, Buy Lives Card, and HUD overlay.
