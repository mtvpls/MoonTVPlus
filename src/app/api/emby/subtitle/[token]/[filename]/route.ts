/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

async function getEmbyClient(embyKey?: string) {
  const config = await getConfig();

  if (!config.EmbyConfig?.Sources || config.EmbyConfig.Sources.length === 0) {
    throw new Error('Emby 未配置或未启用');
  }

  const { embyManager } = await import('@/lib/emby-manager');
  return await embyManager.getClient(embyKey);
}

async function validateEmbyProxyAccess(request: NextRequest, requestToken: string) {
  const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
  const authInfo = getAuthInfoFromCookie(request);

  let hasValidToken = false;
  if (requestToken === 'proxy') {
    // 固定 proxy token 仅用于同源登录态访问，仍需下面的 cookie 权限校验
    hasValidToken = false;
  } else if (globalToken && requestToken === globalToken) {
    hasValidToken = true;
  } else {
    const { db } = await import('@/lib/db');
    const username = await db.getUsernameByTvboxToken(requestToken);
    if (username) {
      const userInfo = await db.getUserInfoV2(username);
      const allowed = await hasFeaturePermission(username, 'emby');
      if (userInfo && !userInfo.banned && allowed) {
        hasValidToken = true;
      }
    }
  }

  const hasValidAuth = !!(
    authInfo?.username &&
    (await hasFeaturePermission(authInfo.username, 'emby'))
  );

  return hasValidToken || hasValidAuth;
}

function getFormatFromFilename(filename: string) {
  return filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
}

function getSubtitleContentType(format: string, fallback?: string | null) {
  if (fallback) return fallback;
  if (format === 'vtt') return 'text/vtt; charset=utf-8';
  if (format === 'ass' || format === 'ssa' || format === 'srt') {
    return 'text/plain; charset=utf-8';
  }
  return 'application/octet-stream';
}

/**
 * GET /api/emby/subtitle/{token}/subtitle.ass?itemId=xxx&mediaSourceId=xxx&streamIndex=2&format=ass
 * 代理 Emby 字幕，避免浏览器/JASSUB Worker 直接访问 Emby 时遇到 CORS、鉴权或自定义 UA 问题。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; filename: string } }
) {
  try {
    const allowed = await validateEmbyProxyAccess(request, params.token);
    if (!allowed) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');
    const mediaSourceId = searchParams.get('mediaSourceId');
    const streamIndexValue = searchParams.get('streamIndex');
    const embyKey = searchParams.get('embyKey') || undefined;
    const requestedFormat =
      searchParams.get('format')?.toLowerCase() ||
      getFormatFromFilename(params.filename) ||
      'vtt';

    if (!itemId || !mediaSourceId || streamIndexValue === null) {
      return NextResponse.json(
        { error: '缺少 itemId、mediaSourceId 或 streamIndex 参数' },
        { status: 400 }
      );
    }

    if (!/^[a-z0-9]+$/i.test(requestedFormat)) {
      return NextResponse.json({ error: '字幕格式非法' }, { status: 400 });
    }

    const streamIndex = Number(streamIndexValue);
    if (!Number.isInteger(streamIndex) || streamIndex < 0) {
      return NextResponse.json({ error: 'streamIndex 参数非法' }, { status: 400 });
    }

    let client = await getEmbyClient(embyKey);
    let subtitleUrl = await client.getSubtitleStreamUrl(
      itemId,
      mediaSourceId,
      streamIndex,
      requestedFormat,
      true
    );

    const requestHeaders: HeadersInit = {
      'User-Agent': client.getUserAgent(),
    };

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 60000);

    let subtitleResponse: Response;
    try {
      subtitleResponse = await fetch(subtitleUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (subtitleResponse.status === 401) {
      const { embyManager } = await import('@/lib/emby-manager');
      embyManager.clearCache();
      client = await getEmbyClient(embyKey);
      subtitleUrl = await client.getSubtitleStreamUrl(
        itemId,
        mediaSourceId,
        streamIndex,
        requestedFormat,
        true
      );

      const retryAbortController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryAbortController.abort(), 60000);
      try {
        subtitleResponse = await fetch(subtitleUrl, {
          headers: requestHeaders,
          signal: retryAbortController.signal,
        });
      } finally {
        clearTimeout(retryTimeoutId);
      }
    }

    if (!subtitleResponse.ok) {
      console.error('[Emby Subtitle] 获取字幕失败:', {
        itemId,
        mediaSourceId,
        streamIndex,
        requestedFormat,
        status: subtitleResponse.status,
        statusText: subtitleResponse.statusText,
      });
      return NextResponse.json(
        { error: '获取字幕失败' },
        { status: subtitleResponse.status || 500 }
      );
    }

    const headers = new Headers();
    headers.set(
      'Content-Type',
      getSubtitleContentType(
        requestedFormat,
        subtitleResponse.headers.get('content-type')
      )
    );
    headers.set('Cache-Control', 'private, max-age=3600');

    const contentLength = subtitleResponse.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    return new NextResponse(subtitleResponse.body, {
      status: subtitleResponse.status,
      headers,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return NextResponse.json({ error: '字幕请求超时' }, { status: 504 });
    }

    console.error('[Emby Subtitle] 错误:', error);
    return NextResponse.json(
      { error: '字幕代理失败: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
