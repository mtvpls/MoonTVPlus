/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/special-sources/toggle
 * 只切换 SiteConfig.EnableSpecialSources，供 /sp 页面上的开关使用。
 * ponytail: 不复用 POST /api/admin/site —— 那个接口按整份 body 重建 SiteConfig，
 * 少传字段会把其他站点设置清成 undefined。
 */
export async function PUT(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const { enabled } = await request.json();
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled 必须是布尔值' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    config.SiteConfig.EnableSpecialSources = enabled;
    await db.saveAdminConfig(config);

    return NextResponse.json(
      { success: true, enabled },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('切换特殊源入口失败:', error);
    return NextResponse.json({ error: '切换失败' }, { status: 500 });
  }
}
