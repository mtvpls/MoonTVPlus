import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { createQuarkMultiThreadStream } from '@/lib/netdisk/quark-multithread-proxy';
import {
  ensureQuarkPlayFolder,
  getQuarkPlayHeaders,
  getQuarkPlayUrls,
  probeQuarkPlayRange,
  saveQuarkShareFile,
} from '@/lib/netdisk/quark.client';
import { refreshQuarkNetdiskSession } from '@/lib/netdisk/quark-session-cache';
import { resolveQuarkSession } from '@/lib/netdisk/quark-session-resolver';

export const runtime = process.env.EDGEONE_PAGES === '1' ? 'edge' : 'nodejs';

const QUARK_PC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch';

async function pipeUpstream(response: Response, range: string | null) {
  const responseHeaders = new Headers();
  const copyHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
  copyHeaders.forEach((name) => {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  });
  responseHeaders.set('Cache-Control', 'private, no-store');

  const { readable, writable } = new TransformStream();
  const reader = response.body!.getReader();

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
    status: range && response.headers.get('content-range') ? 206 : response.status,
    headers: responseHeaders,
  });
}

function getPassthroughHeaders(request: NextRequest) {
  const passthroughHeaderNames = [
    'accept',
    'accept-language',
    'accept-encoding',
    'connection',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
  ];
  const passthroughHeaders: Record<string, string> = {};
  for (const name of passthroughHeaderNames) {
    const value = request.headers.get(name);
    if (value) passthroughHeaders[name] = value;
  }
  return passthroughHeaders;
}

function buildHeaderProfiles(request: NextRequest, cookie: string) {
  const passthroughHeaders = getPassthroughHeaders(request);
  return [
    {
      name: 'quark-empty-ua',
      headers: {
        ...passthroughHeaders,
        ...getQuarkPlayHeaders(cookie),
      },
    },
    {
      name: 'quark-api-ua',
      headers: {
        ...passthroughHeaders,
        cookie,
        referer: 'https://pan.quark.cn/',
        'user-agent': QUARK_PC_UA,
      },
    },
    {
      name: 'quark-no-ua',
      headers: {
        ...passthroughHeaders,
        cookie,
        referer: 'https://pan.quark.cn/',
      },
    },
    {
      name: 'browser-origin',
      headers: {
        ...passthroughHeaders,
        cookie,
        origin: 'https://pan.quark.cn',
        referer: 'https://pan.quark.cn/',
        'user-agent':
          request.headers.get('user-agent') ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      },
    },
  ];
}

function parseRequestedRange(range: string | null): { start: number; end?: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: match[2] ? Number(match[2]) : undefined,
  };
}

function buildRangeHeaders(start: number, end: number, total: number) {
  return {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': String(end - start + 1),
  };
}

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

    const { session, cookie, savePath, playMode, multiThreadPlayback } = await resolveQuarkSession(id);
    const file = session.files[episodeIndex];
    if (!file) {
      return NextResponse.json({ error: '播放文件不存在' }, { status: 404 });
    }

    if (!session.playFolderFid || !session.playFolderPath) {
      const folder = await ensureQuarkPlayFolder(cookie, savePath, session.shareId, session.title);
      session.playFolderFid = folder.folderFid;
      session.playFolderPath = folder.folderPath;
    }

    let savedFileId = session.savedFileIds[file.fid];
    if (!savedFileId) {
      savedFileId = await saveQuarkShareFile(cookie, {
        shareId: session.shareId,
        shareToken: session.shareToken,
        fileId: file.fid,
        fileName: file.name,
        size: file.size,
        shareFileToken: file.shareFidToken,
        playFolderFid: session.playFolderFid,
      });
      session.savedFileIds[file.fid] = savedFileId;
    }
    refreshQuarkNetdiskSession(id);

    session.playUrlCaches = session.playUrlCaches || {};
    const playUrlCacheKey = `${savedFileId}:${playMode}`;
    const cachedPlayUrls = session.playUrlCaches[playUrlCacheKey];
    const playUrls =
      cachedPlayUrls && cachedPlayUrls.expiresAt > Date.now()
        ? cachedPlayUrls.urls
        : await getQuarkPlayUrls(cookie, savedFileId, playMode);
    if (!cachedPlayUrls || cachedPlayUrls.expiresAt <= Date.now()) {
      session.playUrlCaches[playUrlCacheKey] = {
        urls: playUrls,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
    }
    const selected = playUrls.find((item) => item.name === quality) || playUrls[0];
    const candidates = selected
      ? [
          selected,
          ...playUrls.filter((item) => item.url !== selected.url),
        ]
      : [];
    if (candidates.length === 0) {
      return NextResponse.json({ error: '未获取到夸克播放地址' }, { status: 500 });
    }

    const range = request.headers.get('range');
    let lastStatus = 500;

    for (const candidate of candidates) {
      for (const profile of buildHeaderProfiles(request, cookie)) {
        try {
          const requestedRange = parseRequestedRange(range);
          const probeRange =
            multiThreadPlayback && requestedRange
              ? `bytes=${requestedRange.start}-${requestedRange.start}`
              : range || undefined;
          const probed = await probeQuarkPlayRange(candidate.url, profile.headers, probeRange);
          if (probed?.response.body) {
            if (multiThreadPlayback && requestedRange && probed.window) {
              const trunkEnd = Math.min(
                requestedRange.end ?? requestedRange.start + 8 * 1024 * 1024 - 1,
                requestedRange.start + 8 * 1024 * 1024 - 1,
                probed.window.total - 1
              );
              const window = {
                start: requestedRange.start,
                end: trunkEnd,
                total: probed.window.total,
              };
              const responseHeaders = new Headers();
              const copyHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
              copyHeaders.forEach((name) => {
                const value = probed.response.headers.get(name);
                if (value) responseHeaders.set(name, value);
              });
              responseHeaders.set('Cache-Control', 'private, no-store');
              const rangeHeaders = buildRangeHeaders(window.start, window.end, window.total);
              responseHeaders.set('Content-Range', rangeHeaders['Content-Range']);
              responseHeaders.set('Content-Length', rangeHeaders['Content-Length']);
              try {
                await probed.response.body.cancel();
              } catch {
                void 0;
              }
              return createQuarkMultiThreadStream({
                url: candidate.url,
                headers: profile.headers,
                window,
                contentHeaders: responseHeaders,
                status: 206,
              });
            }

            return pipeUpstream(probed.response, range);
          }

          lastStatus = probed?.response.status || lastStatus;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return NextResponse.json({ error: '夸克网盘代理超时' }, { status: 504 });
          }
        }
      }
    }

    return NextResponse.json(
      { error: `夸克视频代理失败 (${lastStatus})` },
      { status: lastStatus }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '夸克网盘代理失败' },
      { status: 500 }
    );
  }
}
