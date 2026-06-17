import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Private key of the deploying wallet (no 0x prefix), read from contract/.env
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const CELOSCAN_API_KEY = process.env.CELOSCAN_API_KEY ?? "";

const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Celo mainnet — this is what Talent Protocol tracks for on-chain impact.
    celo: {
      url: "https://forno.celo.org",
      accounts,
      chainId: 42220,
    },
    // Celo Alfajores testnet — free CELO for testing before mainnet.
    alfajores: {
      url: "https://alfajores-forno.celo-testnet.org",
      accounts,
      chainId: 44787,
    },
  },
  // Contract verification on Celoscan (so the source shows up on the explorer).
  etherscan: {
    apiKey: {
      celo: CELOSCAN_API_KEY,
      alfajores: CELOSCAN_API_KEY,
    },
    customChains: [
      {
        network: "celo",
        chainId: 42220,
        urls: {
          apiURL: "https://api.celoscan.io/api",
          browserURL: "https://celoscan.io",
        },
      },
      {
        network: "alfajores",
        chainId: 44787,
        urls: {
          apiURL: "https://api-alfajores.celoscan.io/api",
          browserURL: "https://alfajores.celoscan.io",
        },
      },
    ],
  },
};

export default config;
