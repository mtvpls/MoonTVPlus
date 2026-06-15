import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { isTVModeEnabled } from '@/lib/tv-mode';

const { listTVRemoteDevices } = require('@/lib/tv-remote-hub');

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isTVModeEnabled()) {
    return NextResponse.json({ error: 'TV 模式未启用' }, { status: 404 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  return NextResponse.json({
    devices: listTVRemoteDevices(authInfo.username),
  });
}
