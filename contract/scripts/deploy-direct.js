// Standalone deploy — no hardhat/ts-node, just ethers + the compiled artifact.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  let pk = (process.env.PRIVATE_KEY || '').trim();
  if (pk && !pk.startsWith('0x')) pk = '0x' + pk;
  if (pk.length !== 66) {
    throw new Error('PRIVATE_KEY in contract/.env must be 64 hex chars. Got: ' + (pk.length - 2));
  }

  const provider = new ethers.JsonRpcProvider('https://forno.celo.org', 42220);
  const wallet = new ethers.Wallet(pk, provider);

  const bal = await provider.getBalance(wallet.address);
  console.log('Network : Celo mainnet (42220)');
  console.log('Deployer:', wallet.address);
  console.log('Balance :', ethers.formatEther(bal), 'CELO\n');

  const artifactPath = path.join(
    __dirname, '..', 'artifacts', 'contracts', 'CheetahChain.sol', 'CheetahChain.json'
  );
  const art = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  console.log('Deploying CheetahChain...');
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const contract = await factory.deploy();
  const txHash = contract.deploymentTransaction().hash;
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log('\n✅ CheetahChain deployed to:', address);
  console.log('   Deploy tx :', txHash);
  console.log('   Celoscan  : https://celoscan.io/address/' + address);
}

main().catch((e) => { console.error(e); process.exit(1); });
