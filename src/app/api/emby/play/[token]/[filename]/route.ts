/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * 获取 Emby 客户端
 */
async function getEmbyClient(embyKey?: string) {
  const config = await getConfig();

  if (!config.EmbyConfig?.Sources || config.EmbyConfig.Sources.length === 0) {
    throw new Error('Emby 未配置或未启用');
  }

  const { embyManager } = await import('@/lib/emby-manager');
  return await embyManager.getClient(embyKey);
}

/**
 * GET /api/emby/play/{token}/{filename}?itemId=xxx
 * 代理 Emby 视频播放链接，URL 中包含文件扩展名（如 video.mp4）
 * 实际返回的内容根据 Emby 服务器的 Content-Type 决定
 *
 * 权限验证：TVBox Token（路径参数） 或 用户登录（满足其一即可）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; filename: string } }
) {
  try {
    const { searchParams } = new URL(request.url);

    // 双重验证：TVBox Token（全局或用户） 或 用户登录
    const requestToken = params.token;
    const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
    const authInfo = getAuthInfoFromCookie(request);

    // 验证 TVBox Token（全局token或用户token）
    let hasValidToken = false;
    if (requestToken === 'proxy') {
      // 使用固定的 'proxy' token，跳过token验证，依赖用户登录验证
      hasValidToken = false;
    } else if (globalToken && requestToken === globalToken) {
      // 全局token
      hasValidToken = true;
    } else {
      // 检查是否是用户token
      const { db } = await import('@/lib/db');
      const username = await db.getUsernameByTvboxToken(requestToken);
      if (username) {
        // 检查用户是否被封禁
        const userInfo = await db.getUserInfoV2(username);
        const allowed = await hasFeaturePermission(username, 'emby');
        if (userInfo && !userInfo.banned && allowed) {
          hasValidToken = true;
        }
      }
    }

    // 验证用户登录
    const hasValidAuth = !!(
      authInfo?.username &&
      (await hasFeaturePermission(authInfo.username, 'emby'))
    );

    // 两者至少满足其一
    if (!hasValidToken && !hasValidAuth) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const itemId = searchParams.get('itemId');
    const embyKey = searchParams.get('embyKey') || undefined;

    if (!itemId) {
      return NextResponse.json({ error: '缺少 itemId 参数' }, { status: 400 });
    }

    // 获取 Emby 客户端
    let client = await getEmbyClient(embyKey);

    // 构建 Emby 原始播放链接（强制获取直接URL，避免代理循环）
    let embyStreamUrl = await client.getStreamUrl(itemId, true, true);
	console.log(embyStreamUrl)

    // 构建请求头，转发 Range 请求，并添加自定义 User-Agent
    const requestHeaders: HeadersInit = {
      'User-Agent': client.getUserAgent(),
    };
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      requestHeaders['Range'] = rangeHeader;
    }

    // 创建 AbortController 用于超时控制
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 300000); // 5分钟超时

    try {
      // 流式代理视频内容
      let videoResponse = await fetch(embyStreamUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
      });

      // 如果返回 401，尝试重新认证并重试
      if (videoResponse.status === 401) {
        console.log('[Emby Play] 收到 401 错误，尝试重新认证');
        const { embyManager } = await import('@/lib/emby-manager');
        embyManager.clearCache();
        client = await getEmbyClient(embyKey);
        embyStreamUrl = await client.getStreamUrl(itemId, true, true);

        // 重置超时
        clearTimeout(timeoutId);
        const retryAbortController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryAbortController.abort(), 300000);

        try {
          videoResponse = await fetch(embyStreamUrl, {
            headers: requestHeaders,
            signal: retryAbortController.signal,
          });
        } finally {
          clearTimeout(retryTimeoutId);
        }
      }

      // 清除超时定时器
      clearTimeout(timeoutId);

    if (!videoResponse.ok) {
      console.error('[Emby Play] 获取视频流失败:', {
        itemId,
        status: videoResponse.status,
        statusText: videoResponse.statusText,
      });
      return NextResponse.json(
        { error: '获取视频流失败' },
        { status: 500 }
      );
    }

    // 获取 Content-Type
    const contentType = videoResponse.headers.get('content-type') || 'video/mp4';

    // 构建响应头
    const headers = new Headers();
    headers.set('Content-Type', contentType);

    // 复制重要的响应头
    const contentLength = videoResponse.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    const acceptRanges = videoResponse.headers.get('accept-ranges');
    if (acceptRanges) {
      headers.set('Accept-Ranges', acceptRanges);
    }

    const contentRange = videoResponse.headers.get('content-range');
    if (contentRange) {
      headers.set('Content-Range', contentRange);
    }

    // 使用 URL 中的文件名
    headers.set('Content-Disposition', `inline; filename="${params.filename}"`);

    // 创建一个可以被中断的流
    const { readable, writable } = new TransformStream();
    const reader = videoResponse.body?.getReader();

    if (!reader) {
      return NextResponse.json(
        { error: '无法读取视频流' },
        { status: 500 }
      );
    }

    // 异步管道传输，确保在客户端断开时清理资源
    (async () => {
      const writer = writable.getWriter();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      } catch (error) {
        // 客户端断开连接或其他错误
        console.log('[Emby Play] 流传输中断:', error instanceof Error ? error.message : 'Unknown error');
        // 取消上游 fetch，停止继续下载
        try {
          await reader.cancel();
        } catch (e) {
          // 忽略取消错误
        }
      } finally {
        // 确保资源被释放
        try {
          reader.releaseLock();
          await writer.close();
        } catch (e) {
          // 忽略关闭错误
        }
      }
    })();

    // 流式返回视频内容
    return new NextResponse(readable, {
      status: videoResponse.status,
      headers,
    });
    } catch (error) {
      // 清除超时定时器
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[Emby Play] 请求超时');
        return NextResponse.json(
          { error: '请求超时' },
          { status: 504 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('[Emby Play] 错误:', error);
    return NextResponse.json(
      { error: '播放失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
