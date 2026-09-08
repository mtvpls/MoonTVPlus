/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * 使用 HEAD 请求跟随重定向获取最终 URL（直连方法 - 降级使用）
 * HEAD 不支持（405/501）或请求异常时，降级使用普通 GET（无 Range）让 fetch 跟随重定向
 */
async function getFinalUrl(url: string, maxRedirects = 5): Promise<string> {
  let currentUrl = url;
  let redirectCount = 0;
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  while (redirectCount < maxRedirects) {
    let response: Response | null = null;

    // 1) HEAD 请求跟随重定向（无响应体，成本低）
    try {
      response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': userAgent,
        },
      });
    } catch (error) {
      console.log(
        '[openlist/play] HEAD 请求失败，降级使用 GET:',
        (error as Error).message
      );
    }

    // 2) 部分服务器不支持 HEAD（返回 405/501 或直接抛错），用普通 GET 兜底
    //    不带 Range（可能被服务器拒绝），直接让 fetch 跟随重定向，取 response.url 为最终地址
    if (!response || response.status === 405 || response.status === 501) {
      try {
        const getResponse = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': userAgent,
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
        console.error('[openlist/play] 获取最终 URL 失败:', error);
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
 * 探测播放 URL 的媒体类型，供前端分流（mkv/mp4 等单文件直链由浏览器原生播放，
 * 避免无扩展名直链被误判为 m3u8 走 HLS 解析导致播放失败）：
 * - hls：m3u8/fmp4 流
 * - file：单文件视频容器（浏览器 <video> no-cors 可直接播放）
 * - unknown：无法判断（前端回退到 URL 扩展名逻辑）
 */
async function detectOpenListMediaType(
  playUrl: string
): Promise<'hls' | 'file' | 'unknown'> {
  try {
    const path = playUrl.split('?')[0].toLowerCase();
    if (/\.m3u8?$/i.test(path) || path.includes('m3u8')) return 'hls';
    if (/\.(mp4|mkv|webm|mov|avi|m4v|flv|ts|mpeg|mpg|3gp|rmvb|rm|wmv|vob)$/i.test(path)) {
      return 'file';
    }
  } catch {
    return 'unknown';
  }

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 6000);
  let response: Response | undefined;
  try {
    response = await fetch(playUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        accept: '*/*',
        range: 'bytes=0-0',
      },
      redirect: 'follow',
      signal: abortController.signal,
    });
    if (response.status !== 200 && response.status !== 206) {
      return 'unknown';
    }
    const contentType = (response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (
      contentType.includes('mpegurl') ||
      contentType === 'application/x-mpegurl' ||
      contentType.includes('x-mpegurl')
    ) {
      return 'hls';
    }
    if (contentType.startsWith('video/') || contentType === 'application/octet-stream') {
      return 'file';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
    response?.body?.cancel().catch(() => {});
  }
}

/**
 * GET /api/openlist/play?folder=xxx&fileName=xxx&format=json
 * 获取单个视频文件的播放链接（优先使用视频预览流，失败时降级到直连）
 * format=json: 返回 JSON 格式（用于 play 页面）
 * 默认: 返回重定向（用于 tvbox 等）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '无权限访问私人影库');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const folderName = searchParams.get('folder');
    const fileName = searchParams.get('fileName');
    const format = searchParams.get('format'); // 新增 format 参数

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

    // folderName 已经是完整路径，直接使用
    const folderPath = folderName;
    const filePath = `${folderPath}/${fileName}`;

    const { resolvePathMeta } = await import('@/lib/openlist-path-meta');
    const pathMetaResolved = resolvePathMeta(
      folderPath,
      openListConfig.PathMeta
    );

    // 路径开启了代理播放：直接返回服务器代理地址（代理端负责解析链接与缓存）
    const { buildOpenListProxyUrl } = await import('@/lib/openlist-play-url');
    const proxyUrl = pathMetaResolved.proxyPlay
      ? buildOpenListProxyUrl({
          token: 'proxy', // 固定 token，由登录 cookie 校验
          folder: folderName,
          fileName,
        })
      : '';

    if (proxyUrl) {
      if (format === 'json') {
        return NextResponse.json({
          url: proxyUrl,
          refresh14m: false, // 代理链接稳定，无需 14 分钟续期
          category: pathMetaResolved.category,
          proxied: true,
        });
      }

      // 默认返回重定向到代理地址（用于外部播放器）
      const host =
        request.headers.get('host') || request.headers.get('x-forwarded-host');
      const proto =
        request.headers.get('x-forwarded-proto') ||
        (host?.includes('localhost') || host?.includes('127.0.0.1')
          ? 'http'
          : 'https');
      const baseUrl = process.env.SITE_BASE || `${proto}://${host}`;
      return NextResponse.redirect(`${baseUrl}${proxyUrl}`);
    }

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 如果启用了禁用预览视频，直接使用直连方法
    if (openListConfig.DisableVideoPreview) {
      const fileResponse = await client.getFile(filePath);

      if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
        console.error('[OpenList Play] 获取播放URL失败:', {
          fileName,
          code: fileResponse.code,
          message: fileResponse.message,
        });
        return NextResponse.json(
          { error: '获取播放链接失败' },
          { status: 500 }
        );
      }

      // 如果指定了 format=json，使用 getFinalUrl 并返回 JSON
      if (format === 'json') {
        const finalUrl = await getFinalUrl(fileResponse.data.raw_url);

        // 检查URL是否为空
        if (!finalUrl || finalUrl.trim() === '') {
          throw new Error('获取到的播放链接为空');
        }

        return NextResponse.json({
          url: finalUrl,
          mediaType: await detectOpenListMediaType(finalUrl),
          refresh14m: pathMetaResolved.refresh14m,
          category: pathMetaResolved.category,
        });
      }

      // 检查URL是否为空
      if (!fileResponse.data.raw_url || fileResponse.data.raw_url.trim() === '') {
        throw new Error('获取到的播放链接为空');
      }

      // 默认返回重定向（用于 tvbox）
      return NextResponse.redirect(fileResponse.data.raw_url);
    }

    // 优先尝试视频预览流方法
    try {
      const data = await client.getVideoPreview(filePath);

      const taskList = data.data?.video_preview_play_info?.live_transcoding_task_list;
      if (!taskList || taskList.length === 0) {
        throw new Error('未找到可用的播放链接');
      }

      const qualityOrder: Record<string, number> = {
        'FHD': 1,
        'HD': 2,
        'LD': 3,
        'SD': 4,
      };

      const qualities = taskList
        .filter((task: any) => task.status === 'finished')
        .map((task: any) => ({
          name: task.template_id,
          url: task.url,
        }))
        .filter((quality: any) => quality.url && quality.url.trim() !== '') // 过滤空URL
        .sort((a: any, b: any) => (qualityOrder[a.name] || 999) - (qualityOrder[b.name] || 999));

      if (qualities.length === 0) {
        throw new Error('未找到已完成的播放链接');
      }

      // 如果指定了 format=json，尝试解析到最终直链后再返回 JSON
      if (format === 'json') {
        const resolvedQualities = await Promise.all(
          qualities.map(async (quality: any) => ({
            ...quality,
            url: await getFinalUrl(quality.url),
          }))
        );

        return NextResponse.json({
          url: resolvedQualities[0].url,
          mediaType: await detectOpenListMediaType(
            resolvedQualities[0].url
          ),
          qualities: resolvedQualities,
          refresh14m: pathMetaResolved.refresh14m,
          category: pathMetaResolved.category,
        });
      }

      // 默认返回重定向（用于 tvbox）
      return NextResponse.redirect(qualities[0].url);
    } catch (error) {
      // 视频预览流失败，降级到直连方法
      console.log('[openlist/play] 视频预览流失败，降级到直连方法:', (error as Error).message);

      const fileResponse = await client.getFile(filePath);

      if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
        console.error('[OpenList Play] 获取播放URL失败:', {
          fileName,
          code: fileResponse.code,
          message: fileResponse.message,
        });
        return NextResponse.json(
          { error: '获取播放链接失败' },
          { status: 500 }
        );
      }

      // 如果指定了 format=json，使用 getFinalUrl 并返回 JSON
      if (format === 'json') {
        const finalUrl = await getFinalUrl(fileResponse.data.raw_url);

        // 检查URL是否为空
        if (!finalUrl || finalUrl.trim() === '') {
          throw new Error('获取到的播放链接为空');
        }

        return NextResponse.json({
          url: finalUrl,
          mediaType: await detectOpenListMediaType(finalUrl),
          refresh14m: pathMetaResolved.refresh14m,
          category: pathMetaResolved.category,
        });
      }

      // 检查URL是否为空
      if (!fileResponse.data.raw_url || fileResponse.data.raw_url.trim() === '') {
        throw new Error('获取到的播放链接为空');
      }

      // 默认返回重定向（用于 tvbox）
      return NextResponse.redirect(fileResponse.data.raw_url);
    }
  } catch (error) {
    console.error('获取播放链接失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}