/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { checkSubscription } from '@/lib/anime-subscription';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/admin/anime-subscription/[id]/check
 * 手动触发检查单个订阅
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 权限检查
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const config = await getConfig();
    const subscriptions = config.AnimeSubscriptionConfig?.Subscriptions || [];

    const subscription = subscriptions.find((sub) => sub.id === params.id);
    if (!subscription) {
      return NextResponse.json({ error: '订阅不存在' }, { status: 404 });
    }

    // 执行检查逻辑（忽略时间间隔限制）
    const result = await checkSubscription(subscription);

    // 保存配置
    await db.saveAdminConfig(config);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('检查追番订阅失败:', error);
    return NextResponse.json(
      { error: error.message || '检查失败' },
      { status: 500 }
    );
  }
}
