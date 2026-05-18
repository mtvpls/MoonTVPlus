import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { ensureUCPlayFolder, getUCPlayUrls, saveUCShareFile } from '@/lib/netdisk/uc.client';
import { refreshUCNetdiskSession } from '@/lib/netdisk/uc-session-cache';
import { resolveUCSession } from '@/lib/netdisk/uc-session-resolver';

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
    const quality = searchParams.get('quality') || '';
    if (!id || episodeIndexRaw == null) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const episodeIndex = Number.parseInt(episodeIndexRaw, 10);
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0) {
      return NextResponse.json({ error: '无效的 episodeIndex' }, { status: 400 });
    }

    const { session, cookie, token, savePath } = await resolveUCSession(id);
    const file = session.files[episodeIndex];
    if (!file) {
      return NextResponse.json({ error: '播放文件不存在' }, { status: 404 });
    }

    if (!session.playFolderFid || !session.playFolderPath) {
      const folder = await ensureUCPlayFolder(cookie, savePath, session.shareId, session.title);
      session.playFolderFid = folder.folderFid;
      session.playFolderPath = folder.folderPath;
    }

    let savedFileId = session.savedFileIds[file.fid];
    if (!savedFileId) {
      savedFileId = await saveUCShareFile(cookie, {
        shareId: session.shareId,
        shareToken: session.shareToken,
        fileId: file.fid,
        shareFileToken: file.shareFidToken,
        playFolderFid: session.playFolderFid,
      });
      session.savedFileIds[file.fid] = savedFileId;
    }
    refreshUCNetdiskSession(id);

    const playUrls = await getUCPlayUrls(cookie, savedFileId, token);
    const selected = playUrls.find((item) => item.name === quality) || playUrls[0];
    if (!selected) {
      return NextResponse.json({ error: '未获取到 UC 播放地址' }, { status: 500 });
    }

    const range = request.headers.get('range');
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 300000);

    try {
      const upstream = await fetch(selected.url, {
        headers: {
          ...(selected.headers || {}),
          ...(range ? { Range: range } : {}),
        },
        cache: 'no-store',
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!upstream.ok || !upstream.body) {
        return NextResponse.json(
          { error: `UC视频代理失败 (${upstream.status})` },
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
        return NextResponse.json({ error: 'UC网盘代理超时' }, { status: 504 });
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UC网盘代理失败' },
      { status: 500 }
    );
  }
}
