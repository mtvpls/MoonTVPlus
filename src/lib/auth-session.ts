import { isAccessTokenInvalidated } from './access-token-invalidation';
import type { AuthInfo } from './auth';

/**
 * Server-rendering gate, matching middleware's page-session semantics.
 * Expired access tokens may still enter the app when their refresh period is
 * valid, so the existing TokenRefreshManager can renew them. APIs remain gated
 * by middleware and their existing permission checks.
 */
export async function isValidPageSession(
  auth: AuthInfo | null
): Promise<boolean> {
  const secret = process.env.PASSWORD;
  if (
    !secret ||
    !auth ||
    typeof auth !== 'object' ||
    isAccessTokenInvalidated(auth)
  ) {
    return false;
  }
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return typeof auth.password === 'string' && auth.password === secret;
  }
  if (
    typeof auth.username !== 'string' ||
    !auth.username ||
    !['owner', 'admin', 'user'].includes(auth.role || '') ||
    typeof auth.timestamp !== 'number' ||
    !Number.isFinite(auth.timestamp) ||
    auth.timestamp <= 0 ||
    auth.timestamp > Date.now() + 30_000 ||
    typeof auth.signature !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(auth.signature) ||
    typeof auth.tokenId !== 'string' ||
    !auth.tokenId ||
    typeof auth.refreshToken !== 'string' ||
    !auth.refreshToken ||
    typeof auth.refreshExpires !== 'number' ||
    !Number.isFinite(auth.refreshExpires) ||
    auth.refreshExpires <= Date.now()
  ) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = new Uint8Array(
      (auth.signature.match(/.{2}/g) || []).map((byte) => parseInt(byte, 16))
    );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(
        JSON.stringify({
          username: auth.username,
          role: auth.role,
          timestamp: auth.timestamp,
        })
      )
    );
  } catch {
    return false;
  }
}
