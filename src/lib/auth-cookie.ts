/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  generateRefreshToken,
  generateTokenId,
  storeRefreshToken,
  TOKEN_CONFIG,
} from './refresh-token';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | 'd1'
    | 'postgres'
    | undefined) || 'localstorage';

export async function generateAuthSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getDeviceInfoFromUserAgent(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (ua.includes('moontvplus')) return 'MoonTVPlus APP';
  if (ua.includes('oriontv')) return 'OrionTV';
  if (ua.includes('telegram')) return 'Telegram Login';
  if (ua.includes('chrome')) return 'Chrome';
  if (ua.includes('firefox')) return 'Firefox';
  if (ua.includes('safari')) return 'Safari';
  if (ua.includes('edge')) return 'Edge';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ios')) return 'iOS';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac')) return 'macOS';
  if (ua.includes('linux')) return 'Linux';

  return 'Unknown Device';
}

export async function generateAuthCookieValue(input: {
  username?: string;
  password?: string;
  role?: 'owner' | 'admin' | 'user';
  includePassword?: boolean;
  deviceInfo?: string;
}): Promise<string> {
  const now = Date.now();
  const authData: any = { role: input.role || 'user' };

  if (input.includePassword && input.password) {
    authData.password = input.password;
  }

  if (input.username && process.env.PASSWORD) {
    authData.username = input.username;
    authData.timestamp = now;

    if (!input.includePassword && STORAGE_TYPE !== 'localstorage') {
      const tokenId = generateTokenId();
      const refreshToken = generateRefreshToken();
      const refreshExpires = now + TOKEN_CONFIG.REFRESH_TOKEN_AGE;

      authData.tokenId = tokenId;
      authData.refreshToken = refreshToken;
      authData.refreshExpires = refreshExpires;

      await storeRefreshToken(input.username, tokenId, {
        token: refreshToken,
        deviceInfo: input.deviceInfo || 'Unknown Device',
        createdAt: now,
        expiresAt: refreshExpires,
        lastUsed: now,
      });
    }

    const dataToSign = JSON.stringify({
      username: authData.username,
      role: authData.role,
      timestamp: authData.timestamp,
    });
    authData.signature = await generateAuthSignature(
      dataToSign,
      process.env.PASSWORD
    );
  }

  return encodeURIComponent(JSON.stringify(authData));
}
