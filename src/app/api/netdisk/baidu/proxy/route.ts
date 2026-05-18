import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getBaiduDirectPlayUrl } from '@/lib/netdisk/baidu.client';
import { resolveBaiduSession } from '@/lib/netdisk/baidu-session-resolver';

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
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 300000);

    try {
      const upstream = await fetch(url, {
        headers: {
          ...headers,
          Cookie: cookie,
          ...(range ? { Range: range } : {}),
        },
        cache: 'no-store',
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

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

      const { readable, writable } = new TransformStream();
      const reader = upstream.body.getReader();

      void (async () => {
        const writer = writable.getWriter();
        try {
          let streamDone = false;
          while (!streamDone) {
            const { done, value } = await reader.read();
            if (done) {
              streamDone = true;
            } else {
              await writer.write(value);
            }
          }
        } catch {
          try {
            await reader.cancel();
          } catch {
            void 0;
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            void 0;
          }
          try {
            await writer.close();
          } catch {
            void 0;
          }
        }
      })();

      return new Response(readable, {
        status: range && upstream.headers.get('content-range') ? 206 : upstream.status,
        headers: responseHeaders,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json({ error: '百度网盘代理超时' }, { status: 504 });
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '百度网盘代理失败' },
      { status: 500 }
    );
  }
}
