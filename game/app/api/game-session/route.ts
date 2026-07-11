import { ethers } from 'ethers';
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { issueSessionToken, sameOrigin } from '@/lib/rewardAuth';

// Issues a short-lived, HMAC-signed session token when a game run starts.
// The token is later required by /api/reward so payouts can be bound to a wallet
// and capped per session. The token proves the caller went through this endpoint;
// it does NOT prove real gameplay (the game is client-authoritative).
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { address } = await request.json();
    if (!address || !ethers.isAddress(address)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address' },
        { status: 400 }
      );
    }

    const addr = ethers.getAddress(address);
    const sid = crypto.randomUUID();
    const token = issueSessionToken(addr, sid, Date.now());

    return NextResponse.json({ success: true, token });
  } catch (error) {
    console.error('game-session API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
