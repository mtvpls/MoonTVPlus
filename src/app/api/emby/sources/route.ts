import { NextResponse } from 'next/server';

import { embyManager } from '@/lib/emby-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 禁用缓存

/**
 * 获取所有启用的Emby源列表
 */
export async function GET() {
  try {
    const sources = await embyManager.getEnabledSources();

    return NextResponse.json({
      sources: sources.map((s) => ({
        key: s.key,
        name: s.name,
      })),
    });
  } catch (error) {
    console.error('[Emby Sources] 获取Emby源列表失败:', error);
    return NextResponse.json(
      { error: '获取Emby源列表失败', sources: [] },
      { status: 500 },
    );
  }
}
