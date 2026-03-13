/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { XiaoyaClient } from '@/lib/xiaoya.client';

export const runtime = 'nodejs';

/**
 * GET /api/xiaoya/browse?path=<path>
 * 浏览小雅目录
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '/';

    const config = await getConfig();
    const xiaoyaConfig = config.XiaoyaConfig;

    if (!xiaoyaConfig || !xiaoyaConfig.Enabled || !xiaoyaConfig.ServerURL) {
      return NextResponse.json(
        { error: '小雅未配置或未启用' },
        { status: 400 },
      );
    }

    const client = new XiaoyaClient(
      xiaoyaConfig.ServerURL,
      xiaoyaConfig.Username,
      xiaoyaConfig.Password,
      xiaoyaConfig.Token,
    );

    const result = await client.listDirectory(path);

    // 过滤出文件夹和视频文件
    const videoExtensions = [
      '.mp4',
      '.mkv',
      '.avi',
      '.m3u8',
      '.flv',
      '.ts',
      '.mov',
      '.wmv',
      '.webm',
    ];

    const folders = result.content
      .filter((item) => item.is_dir)
      .map((item) => ({
        name: item.name,
        path: `${path}${path.endsWith('/') ? '' : '/'}${item.name}`,
      }));

    const files = result.content
      .filter(
        (item) =>
          !item.is_dir &&
          videoExtensions.some((ext) => item.name.toLowerCase().endsWith(ext)),
      )
      .map((item) => ({
        name: item.name,
        path: `${path}${path.endsWith('/') ? '' : '/'}${item.name}`,
      }));

    return NextResponse.json({
      folders,
      files,
      currentPath: path,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
