/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getOpenListSources } from '@/lib/openlist-sources';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/sources
 * 返回可选的 OpenList 源名列表（主源在前），供「存到私人影库」弹窗选择。
 * 只暴露名字，不下发账号密码。
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(
      request,
      'magnet_save_private_library',
      '无权限访问私人影库'
    );
    if (authResult instanceof NextResponse) return authResult;

    const config = await getConfig();
    const sources = getOpenListSources(config)
      .filter((source) => source.url && source.username && source.password)
      .map((source) => source.name);

    return NextResponse.json({ success: true, sources });
  } catch (error) {
    console.error('获取 OpenList 源列表失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message, sources: [] },
      { status: 500 }
    );
  }
}
