/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

// 解析后的上游 URL 短时缓存，避免每个 Range 请求都重新走 OpenList API
const UPSTREAM_CACHE_TTL = 60 * 1000;
const upstreamCache = new Map<string, { url: string; expiresAt: number }>();

function getCachedUpstreamUrl(key: string): string | undefined {
  const entry = upstreamCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    upstreamCache.delete(key);
    return undefined;
  }
  return entry.url;
}

function cacheUpstreamUrl(key: string, url: string) {
  // 简单防扩容：缓存过大时整体清空
  if (upstreamCache.size > 500) {
    upstreamCache.clear();
  }
  upstreamCache.set(key, { url, expiresAt: Date.now() + UPSTREAM_CACHE_TTL });
}

/**
 * 解析 OpenList 上游播放地址（与 /api/openlist/play 逻辑一致）
 * 优先视频预览流，失败降级到直连 raw_url
 */
async function resolveUpstreamUrl(
  client: OpenListClient,
  filePath: string,
  disableVideoPreview: boolean,
  qualityName?: string
): Promise<{ url: string; quality: string }> {
  if (disableVideoPreview) {
    const fileResponse = await client.getFile(filePath);
    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      throw new Error('获取播放链接失败');
    }
    return { url: fileResponse.data.raw_url, quality: '' };
  }

  try {
    const data = await client.getVideoPreview(filePath);
    const taskList =
      data.data?.video_preview_play_info?.live_transcoding_task_list;
    if (!taskList || taskList.length === 0) {
      throw new Error('未找到可用的播放链接');
    }

    const qualityOrder: Record<string, number> = {
      FHD: 1,
      HD: 2,
      LD: 3,
      SD: 4,
    };

    const qualities = taskList
      .filter((task: any) => task.status === 'finished')
      .map((task: any) => ({
        name: task.template_id,
        url: task.url,
      }))
      .filter((quality: any) => quality.url && quality.url.trim() !== '')
      .sort(
        (a: any, b: any) =>
          (qualityOrder[a.name] || 999) - (qualityOrder[b.name] || 999)
      );

    if (qualities.length === 0) {
      throw new Error('未找到已完成的播放链接');
    }

    const selected = qualityName
      ? qualities.find((q: any) => q.name === qualityName)
      : undefined;
    const chosen = selected || qualities[0];
    return { url: chosen.url, quality: chosen.name };
  } catch (error) {
    // 视频预览流失败，降级到直连方法
    console.log(
      '[openlist/video-proxy] 视频预览流失败，降级到直连方法:',
      (error as Error).message
    );
    const fileResponse = await client.getFile(filePath);
    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      throw new Error('获取播放链接失败');
    }
    return { url: fileResponse.data.raw_url, quality: '' };
  }
}

/**
 * GET /api/openlist/video-proxy?folder=xxx&fileName=xxx&quality=xxx
 * 服务端代理播放 OpenList 视频，解决第三方直链（如夸克网盘）无 CORS 头导致的跨域播放失败。
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(
      request,
      'private_library',
      '无权限访问私人影库'
    );
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const folderName = searchParams.get('folder');
    const fileName = searchParams.get('fileName');
    const qualityName = searchParams.get('quality') || '';

    if (!folderName || !fileName) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json(
        { error: 'OpenList 未配置或未启用' },
        { status: 400 }
      );
    }

    const filePath = `${folderName}/${fileName}`;

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    const cacheKey = `${filePath}::${qualityName}`;
    let upstreamUrl = getCachedUpstreamUrl(cacheKey);
    if (!upstreamUrl) {
      const resolved = await resolveUpstreamUrl(
        client,
        filePath,
        openListConfig.DisableVideoPreview || false,
        qualityName
      );
      upstreamUrl = resolved.url;
      cacheUpstreamUrl(cacheKey, upstreamUrl);
    }

    const range = request.headers.get('range');
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 300000);

    try {
      const upstream = await fetch(upstreamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...(range ? { Range: range } : {}),
        },
        redirect: 'follow',
        cache: 'no-store',
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!upstream.ok || !upstream.body) {
        return NextResponse.json(
          { error: `视频代理失败 (${upstream.status})` },
          { status: upstream.status || 500 }
        );
      }

      const responseHeaders = new Headers();
      const copyHeaders = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified',
      ];
      copyHeaders.forEach((name) => {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      });
      responseHeaders.set('Cache-Control', 'private, no-store');
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Accept-Ranges', 'bytes');

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
        status:
          range && upstream.headers.get('content-range') ? 206 : upstream.status,
        headers: responseHeaders,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json({ error: '视频代理超时' }, { status: 504 });
      }
      throw error;
    }
  } catch (error) {
    console.error('视频代理失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}