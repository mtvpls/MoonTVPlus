/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedOpenListProxyUrl,
  setCachedOpenListProxyUrl,
} from '@/lib/openlist-proxy-cache';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

const OPENLIST_PLAY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * 使用 HEAD 请求跟随重定向获取最终 URL
 * HEAD 不支持（405/501）或请求异常时，降级使用普通 GET（无 Range）让 fetch 跟随重定向
 */
async function getFinalUrl(url: string, maxRedirects = 5): Promise<string> {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < maxRedirects) {
    let response: Response | null = null;

    // 1) HEAD 请求跟随重定向（无响应体，成本低）
    try {
      response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': OPENLIST_PLAY_UA,
        },
      });
    } catch (error) {
      console.log(
        '[openlist/proxy] HEAD 请求失败，降级使用 GET:',
        (error as Error).message
      );
    }

    // 2) 部分服务器不支持 HEAD（返回 405/501 或直接抛错），用普通 GET 兜底
    //    不带 Range（可能被服务器拒绝），直接让 fetch 跟随重定向，取 response.url 为最终地址
    if (
      !response ||
      response.status === 405 ||
      response.status === 501
    ) {
      try {
        const getResponse = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': OPENLIST_PLAY_UA,
          },
        });
        const finalUrl = getResponse.url || currentUrl;
        // 只取响应头，立即取消响应体避免下载整份内容
        if (getResponse.body) {
          try {
            await getResponse.body.cancel();
          } catch (e) {
            // 忽略取消错误
          }
        }
        return getResponse.status < 400 ? finalUrl : currentUrl;
      } catch (error) {
        console.error('[openlist/proxy] 获取最终 URL 失败:', error);
        return currentUrl;
      }
    }

    if (!response) {
      return currentUrl;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return currentUrl;
      }

      if (location.startsWith('http://') || location.startsWith('https://')) {
        currentUrl = location;
      } else if (location.startsWith('/')) {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.protocol}//${urlObj.host}${location}`;
      } else {
        const urlObj = new URL(currentUrl);
        const pathParts = urlObj.pathname.split('/');
        pathParts.pop();
        pathParts.push(location);
        currentUrl = `${urlObj.protocol}//${urlObj.host}${pathParts.join('/')}`;
      }

      redirectCount++;
    } else {
      return currentUrl;
    }
  }

  return currentUrl;
}

/**
 * 解析文件的最终播放 URL（优先视频预览流，失败降级到直连），并跟随重定向
 */
async function resolveFinalPlayUrl(
  client: OpenListClient,
  filePath: string,
  openListConfig: any
): Promise<string> {
  // 禁用预览视频时，直接使用直连链接
  if (openListConfig.DisableVideoPreview) {
    const fileResponse = await client.getFile(filePath);
    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      throw new Error('获取播放链接失败');
    }
    return getFinalUrl(fileResponse.data.raw_url);
  }

  // 优先尝试视频预览流方法
  try {
    const data = await client.getVideoPreview(filePath);

    const taskList = data.data?.video_preview_play_info?.live_transcoding_task_list;
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

    return getFinalUrl(qualities[0].url);
  } catch (error) {
    // 视频预览流失败，降级到直连方法
    console.log(
      '[openlist/proxy] 视频预览流失败，降级到直连方法:',
      (error as Error).message
    );

    const fileResponse = await client.getFile(filePath);
    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      throw new Error('获取播放链接失败');
    }

    return getFinalUrl(fileResponse.data.raw_url);
  }
}

/**
 * GET /api/openlist/proxy/{token}/{filename}?folder=xxx&fileName=xxx
 * 服务器代理播放 OpenList 视频（支持 Range / 断点续播）
 * 权限验证：TVBox Token（路径参数） 或 用户登录（满足其一即可）
 * 仅允许 PathMeta 中开启了代理播放的路径使用，最终播放链接带重定向缓存（默认 1 小时）
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
      const username = await db.getUsernameByTvboxToken(requestToken);
      if (username) {
        // 检查用户是否被封禁
        const userInfo = await db.getUserInfoV2(username);
        const allowed = await hasFeaturePermission(username, 'private_library');
        if (userInfo && !userInfo.banned && allowed) {
          hasValidToken = true;
        }
      }
    }

    // 验证用户登录
    const hasValidAuth = !!(
      authInfo?.username &&
      (await hasFeaturePermission(authInfo.username, 'private_library'))
    );

    // 两者至少满足其一
    if (!hasValidToken && !hasValidAuth) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const folderName = searchParams.get('folder');
    const fileName = searchParams.get('fileName');

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
      return NextResponse.json({ error: 'OpenList 未配置或未启用' }, { status: 400 });
    }

    // 解析路径元信息：仅允许开启了代理播放的路径走服务器代理
    const { resolvePathMeta } = await import('@/lib/openlist-path-meta');
    const pathMetaResolved = resolvePathMeta(
      folderName,
      openListConfig.PathMeta
    );
    if (!pathMetaResolved.proxyPlay) {
      return NextResponse.json(
        { error: '该路径未开启代理播放' },
        { status: 403 }
      );
    }

    // folderName 为 metainfo 中的完整路径，直接拼接文件路径
    const filePath = `${folderName}/${fileName}`;

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 1. 优先使用缓存的最终播放 URL
    let finalUrl = getCachedOpenListProxyUrl(filePath);

    // 2. 缓存未命中：解析最终播放 URL 并写入缓存
    if (!finalUrl || !finalUrl.trim()) {
      finalUrl = await resolveFinalPlayUrl(client, filePath, openListConfig);
      if (!finalUrl || !finalUrl.trim()) {
        return NextResponse.json(
          { error: '获取播放链接失败' },
          { status: 500 }
        );
      }
      setCachedOpenListProxyUrl(
        filePath,
        finalUrl,
        pathMetaResolved.proxyCacheMinutes
      );
    }

    // 3. 流式代理视频内容，转发 Range 请求，并添加自定义 User-Agent
    const requestHeaders: HeadersInit = {
      'User-Agent': OPENLIST_PLAY_UA,
    };
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      requestHeaders['Range'] = rangeHeader;
    }

    // 创建 AbortController 用于超时控制
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 300000); // 5分钟超时

    try {
      let videoResponse = await fetch(finalUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
      });

      // 缓存链接失效（签名过期等），重新解析并重试一次
      if (videoResponse.status === 401 || videoResponse.status === 403) {
        console.log('[OpenList Proxy] 缓存的播放链接失效，重新解析');
        finalUrl = await resolveFinalPlayUrl(client, filePath, openListConfig);
        if (!finalUrl || !finalUrl.trim()) {
          return NextResponse.json(
            { error: '获取播放链接失败' },
            { status: 500 }
          );
        }
        setCachedOpenListProxyUrl(
          filePath,
          finalUrl,
          pathMetaResolved.proxyCacheMinutes
        );

        // 重置超时
        clearTimeout(timeoutId);
        const retryAbortController = new AbortController();
        const retryTimeoutId = setTimeout(
          () => retryAbortController.abort(),
          300000
        );

        try {
          videoResponse = await fetch(finalUrl, {
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
        console.error('[OpenList Proxy] 获取视频流失败:', {
          fileName,
          status: videoResponse.status,
          statusText: videoResponse.statusText,
        });
        return NextResponse.json(
          { error: '获取视频流失败' },
          { status: 500 }
        );
      }

      // 获取 Content-Type
      const contentType =
        videoResponse.headers.get('content-type') || 'video/mp4';

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
          let done = false;
          while (!done) {
            const chunk = await reader.read();
            done = chunk.done;
            if (!done) {
              await writer.write(chunk.value);
            }
          }
        } catch (error) {
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
        console.error('[OpenList Proxy] 请求超时');
        return NextResponse.json(
          { error: '请求超时' },
          { status: 504 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('[OpenList Proxy] 错误:', error);
    return NextResponse.json(
      { error: '播放失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
