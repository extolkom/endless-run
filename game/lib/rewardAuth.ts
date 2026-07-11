import crypto from 'crypto';
import type { NextRequest } from 'next/server';

// ─── Shared server-side guards for the reward / lives endpoints ─────────────────
// Nothing here trusts the client: tokens are HMAC-signed with a server-only secret
// and same-origin is a cheap first filter (browsers only — a scripted client can
// forge Origin/Host, so this is NOT the real defence, the signed token is).

const TOKEN_TTL_MS = 5 * 60_000; // a session token is valid for 5 minutes
const CLOCK_SKEW_MS = 60_000;    // tolerate small clock skew on the issued-at check

export interface SessionPayload {
  addr: string; // checksummed wallet the token is bound to
  sid: string;  // random per-session id (used for per-session payout caps)
  iat: number;  // issued-at, epoch ms
}

function getSecret(): string {
  const secret = process.env.GAME_SESSION_SECRET;
  if (!secret) {
    throw new Error('GAME_SESSION_SECRET is not configured');
  }
  return secret;
}

function sign(body: string): string {
  return crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
}

/** Issue a signed, short-lived token binding a game session to a wallet. */
export function issueSessionToken(addr: string, sid: string, iat: number): string {
  const body = Buffer.from(JSON.stringify({ addr, sid, iat } satisfies SessionPayload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Verify a token's signature + freshness. Returns the payload, or null if the
 * token is missing, tampered with, or expired. Never throws on bad input.
 */
export function verifySessionToken(token: unknown, now: number): SessionPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  // Constant-time signature comparison.
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.addr !== 'string' || typeof payload.sid !== 'string' || typeof payload.iat !== 'number') {
    return null;
  }
  if (now - payload.iat > TOKEN_TTL_MS) return null;      // expired
  if (payload.iat - now > CLOCK_SKEW_MS) return null;      // issued in the future → bogus
  return payload;
}

/**
 * Only accept calls that originate from the game front-end itself. Cheap filter
 * against other websites' JS; a non-browser client can forge these headers, so
 * this is defence-in-depth, not the primary control.
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
