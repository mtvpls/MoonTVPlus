/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db, getStorage } from '@/lib/db';
import {
  getUserDevices,
  revokeRefreshToken,
} from '@/lib/refresh-token';

export const runtime = 'nodejs';

async function getOperatorRole(username: string): Promise<'owner' | 'admin' | 'user'> {
  if (username === process.env.USERNAME) return 'owner';

  const operatorInfo = await db.getUserInfoV2(username);
  if (operatorInfo) {
    if (operatorInfo.banned) return 'user';
    return operatorInfo.role;
  }

  const adminConfig = await getConfig();
  const userEntry = adminConfig.UserConfig.Users.find(
    (u) => u.username === username
  );
  if (userEntry?.banned) return 'user';
  return userEntry?.role || 'user';
}

async function getTargetRole(username: string): Promise<'owner' | 'admin' | 'user' | null> {
  if (username === process.env.USERNAME) return 'owner';

  const targetInfo = await db.getUserInfoV2(username);
  if (targetInfo) return targetInfo.role;

  const adminConfig = await getConfig();
  const userEntry = adminConfig.UserConfig.Users.find(
    (u) => u.username === username
  );
  return userEntry?.role || null;
}

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行用户设备查询' },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const targetUsername = (searchParams.get('username') || '').trim();
    if (!targetUsername) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    const operatorRole = await getOperatorRole(authInfo.username);
    if (operatorRole !== 'owner' && operatorRole !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const targetRole = await getTargetRole(targetUsername);
    if (!targetRole) {
      return NextResponse.json({ error: '目标用户不存在' }, { status: 404 });
    }

    // 管理员仅可查看普通用户和自己的设备；站长可查看所有用户设备。
    if (
      operatorRole === 'admin' &&
      targetUsername !== authInfo.username &&
      targetRole !== 'user'
    ) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const devices = await getUserDevices(targetUsername);
    const devicesWithCurrent = devices.map((device) => ({
      ...device,
      isCurrent:
        targetUsername === authInfo.username && device.tokenId === authInfo.tokenId,
    }));

    return NextResponse.json(
      { devices: devicesWithCurrent },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('获取用户设备失败:', error);
    return NextResponse.json(
      { error: '获取用户设备失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行用户设备登出' },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username: targetUsername, tokenId } = (await request.json()) as {
      username?: string;
      tokenId?: string;
    };

    if (!targetUsername?.trim() || !tokenId?.trim()) {
      return NextResponse.json(
        { error: '缺少目标用户名或设备 Token' },
        { status: 400 }
      );
    }

    const operatorRole = await getOperatorRole(authInfo.username);
    if (operatorRole !== 'owner' && operatorRole !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const targetRole = await getTargetRole(targetUsername);
    if (!targetRole) {
      return NextResponse.json({ error: '目标用户不存在' }, { status: 404 });
    }

    // 管理员仅可登出普通用户和自己的设备；站长可登出所有用户设备。
    if (
      operatorRole === 'admin' &&
      targetUsername !== authInfo.username &&
      targetRole !== 'user'
    ) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    // 避免通过管理面板误登出当前会话；当前设备可在个人设备管理中处理。
    if (targetUsername === authInfo.username && tokenId === authInfo.tokenId) {
      return NextResponse.json(
        { error: '不能在此处登出当前设备' },
        { status: 400 }
      );
    }

    await revokeRefreshToken(targetUsername, tokenId);
    const storage = getStorage();
    await storage.deletePushSubscriptionsByTokenId?.(targetUsername, tokenId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('登出用户设备失败:', error);
    return NextResponse.json(
      { error: '登出用户设备失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
