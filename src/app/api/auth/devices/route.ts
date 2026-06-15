/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';
import {
  getUserDevices,
  revokeAllRefreshTokens,
  revokeRefreshToken,
} from '@/lib/refresh-token';

export const runtime = 'nodejs';

// 获取所有设备
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const devices = await getUserDevices(authInfo.username);

    // 标记当前设备
    const devicesWithCurrent = devices.map((device) => ({
      ...device,
      isCurrent: device.tokenId === authInfo.tokenId,
    }));

    return NextResponse.json({ devices: devicesWithCurrent });
  } catch (error) {
    console.error('Failed to get devices:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// 撤销指定设备
export async function DELETE(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { tokenId } = await request.json();

    if (!tokenId) {
      return NextResponse.json({ error: 'Token ID required' }, { status: 400 });
    }

    await revokeRefreshToken(authInfo.username, tokenId);
    const storage = getStorage();
    await storage.deletePushSubscriptionsByTokenId?.(authInfo.username, tokenId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to revoke device:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// 登出所有设备
export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await revokeAllRefreshTokens(authInfo.username);
    const storage = getStorage();
    await storage.deleteAllPushSubscriptions?.(authInfo.username);

    const response = NextResponse.json({ ok: true });

    // 清除当前设备的 Cookie
    response.cookies.set('auth', '', {
      path: '/',
      expires: new Date(0),
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    });

    return response;
  } catch (error) {
    console.error('Failed to revoke all devices:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
