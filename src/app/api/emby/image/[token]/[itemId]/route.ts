/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

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
 * GET /api/emby/image/{token}/{itemId}?imageType=Primary&maxWidth=300&embyKey=xxx
 * 代理 Emby 图片
 *
 * 权限验证：TVBox Token（路径参数） 或 用户登录（满足其一即可）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; itemId: string } }
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
        if (userInfo && !userInfo.banned) {
          hasValidToken = true;
        }
      }
    }

    // 验证用户登录
    const hasValidAuth = authInfo && authInfo.username;

    // 两者至少满足其一
    if (!hasValidToken && !hasValidAuth) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const itemId = params.itemId;
    const imageType = (searchParams.get('imageType') || 'Primary') as 'Primary' | 'Backdrop' | 'Logo';
    const maxWidth = searchParams.get('maxWidth') ? parseInt(searchParams.get('maxWidth')!) : undefined;
    const embyKey = searchParams.get('embyKey') || undefined;

    // 获取 Emby 客户端
    const client = await getEmbyClient(embyKey);

    // 获取图片 URL（强制获取直接URL，避免代理循环）
    const imageUrl = client.getImageUrl(itemId, imageType, maxWidth, undefined, true);

    // 构建请求头，添加自定义 User-Agent
    const requestHeaders: HeadersInit = {
      'User-Agent': client.getUserAgent(),
    };

    // 创建 AbortController 用于超时控制
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 20000); // 20秒超时

    try {
      // 请求图片
      const imageResponse = await fetch(imageUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
      });

      // 清除超时定时器
      clearTimeout(timeoutId);

    if (!imageResponse.ok) {
      console.error('[Emby Image] 获取图片失败:', {
        itemId,
        imageType,
        status: imageResponse.status,
        statusText: imageResponse.statusText,
      });
      return NextResponse.json(
        { error: '获取图片失败' },
        { status: 500 }
      );
    }

    // 获取 Content-Type
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // 构建响应头
    const headers = new Headers();
    headers.set('Content-Type', contentType);

    // 复制重要的响应头
    const contentLength = imageResponse.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    // 设置缓存头
    headers.set('Cache-Control', 'public, max-age=86400'); // 缓存1天

    // 返回图片内容
    return new NextResponse(imageResponse.body, {
      status: imageResponse.status,
      headers,
    });
    } catch (error) {
      // 清除超时定时器
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[Emby Image] 请求超时');
        return NextResponse.json(
          { error: '请求超时' },
          { status: 504 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('[Emby Image] 错误:', error);
    return NextResponse.json(
      { error: '获取图片失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
