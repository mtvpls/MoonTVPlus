import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getBaiduDirectPlayUrl } from '@/lib/netdisk/baidu.client';
import { resolveBaiduSession } from '@/lib/netdisk/baidu-session-resolver';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const episodeIndexRaw = searchParams.get('episodeIndex');
    if (!id || episodeIndexRaw == null) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const episodeIndex = Number.parseInt(episodeIndexRaw, 10);
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0) {
      return NextResponse.json({ error: '无效的 episodeIndex' }, { status: 400 });
    }

    const { session, cookie } = await resolveBaiduSession(id);
    const file = session.files[episodeIndex];
    if (!file) {
      return NextResponse.json({ error: '播放文件不存在' }, { status: 404 });
    }

    const { url, headers } = await getBaiduDirectPlayUrl(session.meta, file.fid, cookie);
    const range = request.headers.get('range');

    const upstream = await fetch(url, {
      headers: {
        ...headers,
        Cookie: cookie,
        ...(range ? { Range: range } : {}),
      },
      cache: 'no-store',
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `百度网盘视频代理失败 (${upstream.status})` },
        { status: upstream.status || 500 }
      );
    }

    const responseHeaders = new Headers();
    const copyHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
    copyHeaders.forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    });
    responseHeaders.set('Cache-Control', 'private, no-store');

    return new Response(upstream.body, {
      status: range && upstream.headers.get('content-range') ? 206 : upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '百度网盘代理失败' },
      { status: 500 }
    );
  }
}
