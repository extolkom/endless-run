import { ethers } from 'ethers';
import { NextRequest, NextResponse } from 'next/server';

const REWARD_WALLET_ADDRESS = '0x54CfcB5DA23dB98762C3919093A9B230D6Ed429D';
const CELO_RPC_URL = 'https://forno.celo.org';
const CELO_CHAIN_ID = 42220;

export async function POST(request: NextRequest) {
  try {
    const { to, amount } = await request.json();

    // Validate inputs
    if (!to || !amount) {
      return NextResponse.json(
        { success: false, error: 'Missing to or amount' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!ethers.isAddress(to)) {
      return NextResponse.json(
        { success: false, error: 'Invalid recipient address' },
        { status: 400 }
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

    // Convert amount to Wei
    const amountWei = ethers.parseUnits(amount, 18);

    // Get current gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');

    // Create and send transaction
    const tx = await signer.sendTransaction({
      to,
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
