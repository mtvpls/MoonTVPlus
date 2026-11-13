/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { resolveFolderSource } from '@/lib/openlist-sources';
import { invalidateVideoInfoCache } from '@/lib/openlist-cache';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/refresh-video
 * 刷新单个视频的 videoinfo.json
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '无权限访问私人影库');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json();
    const { folder } = body;

    if (!folder) {
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

    // folder 是完整路径，可能带「源名@」前缀
    const resolved = resolveFolderSource(config, folder);
    if (!resolved) {
      return NextResponse.json({ error: 'OpenList 未配置' }, { status: 400 });
    }

    // 缓存键用带源前缀的完整路径（与 detail 路由保持一致）
    invalidateVideoInfoCache(folder);

    return NextResponse.json({
      success: true,
      message: '刷新成功',
    });
  } catch (error) {
    console.error('刷新视频失败:', error);
    return NextResponse.json(
      { error: '刷新失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
