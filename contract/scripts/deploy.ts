import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account. Set PRIVATE_KEY in contract/.env (no 0x prefix)."
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Network :", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.formatEther(balance), "CELO\n");

  const CheetahChain = await ethers.getContractFactory("CheetahChain");
  const contract = await CheetahChain.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ CheetahChain deployed to:", address);
  console.log("\nNext steps:");
  console.log(`  1. Verify : npx hardhat verify --network ${network.name} ${address}`);
  console.log(`  2. Put this address in game/lib/leaderboard.ts (LEADERBOARD_ADDRESS)`);
  console.log(`  3. Add it as a smart contract on your Talent project`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
