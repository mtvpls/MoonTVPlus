import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getPan115PlayUrl } from '@/lib/netdisk/pan115.client';
import { getPan115NetdiskSession, refreshPan115NetdiskSession } from '@/lib/netdisk/pan115-session-cache';
import { resolvePan115Session } from '@/lib/netdisk/pan115-session-resolver';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || searchParams.get('session');
    const episodeIndexRaw = searchParams.get('episodeIndex');
    const format = searchParams.get('format');
    if (!id || episodeIndexRaw == null) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const episodeIndex = Number.parseInt(episodeIndexRaw, 10);
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0) {
      return NextResponse.json({ error: '无效的 episodeIndex' }, { status: 400 });
    }

    refreshPan115NetdiskSession(id) || getPan115NetdiskSession(id);
    const { session, cookie } = await resolvePan115Session(id);
    const file = session.files[episodeIndex];
    if (!file) {
      return NextResponse.json({ error: '播放文件不存在' }, { status: 404 });
    }

    const url = await getPan115PlayUrl(file, cookie);
    refreshPan115NetdiskSession(id);

    if (format === 'json') {
      return NextResponse.json({ url, headers: {} });
    }

    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取播放地址失败' },
      { status: 500 }
    );
  }
}
