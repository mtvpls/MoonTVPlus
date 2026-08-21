/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * 构建同源代理播放 URL（format=json 时使用）
 * 绕过第三方直链（如夸克网盘）无 CORS 头导致的跨域播放失败
 */
function buildProxyUrl(
  folderName: string,
  fileName: string,
  quality?: string
): string {
  const params = new URLSearchParams({
    folder: folderName,
    fileName,
  });
  if (quality) {
    params.set('quality', quality);
  }
  return `/api/openlist/video-proxy?${params.toString()}`;
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

      // 如果指定了 format=json，返回同源代理地址（避免第三方直链无 CORS 头导致跨域播放失败）
      if (format === 'json') {
        const proxyUrl = buildProxyUrl(folderName, fileName);

        return NextResponse.json({
          url: proxyUrl,
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

      // 如果指定了 format=json，返回同源代理地址（避免第三方直链无 CORS 头导致跨域播放失败）
      if (format === 'json') {
        const proxyQualities = qualities.map((quality: any) => ({
          name: quality.name,
          url: buildProxyUrl(folderName, fileName, quality.name),
        }));

        return NextResponse.json({
          url: buildProxyUrl(folderName, fileName, qualities[0].name),
          qualities: proxyQualities,
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

      // 如果指定了 format=json，返回同源代理地址（避免第三方直链无 CORS 头导致跨域播放失败）
      if (format === 'json') {
        const proxyUrl = buildProxyUrl(folderName, fileName);

        return NextResponse.json({
          url: proxyUrl,
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