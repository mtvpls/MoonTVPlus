import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getUCNetdiskSession, refreshUCNetdiskSession } from '@/lib/netdisk/uc-session-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const episodeIndexRaw = searchParams.get('episodeIndex');
    const format = searchParams.get('format');
    if (!id || episodeIndexRaw == null) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const episodeIndex = Number.parseInt(episodeIndexRaw, 10);
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0) {
      return NextResponse.json({ error: '无效的 episodeIndex' }, { status: 400 });
    }

    const proxyUrl = `/api/netdisk/uc/proxy?id=${encodeURIComponent(id)}&episodeIndex=${episodeIndex}`;
    refreshUCNetdiskSession(id) || getUCNetdiskSession(id);

    if (format === 'json') {
      return NextResponse.json({ url: proxyUrl, headers: {} });
    }

    return NextResponse.redirect(new URL(proxyUrl, request.url));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取播放地址失败' },
      { status: 500 }
    );
  }
}
