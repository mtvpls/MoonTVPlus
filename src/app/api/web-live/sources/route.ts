import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic'; // 禁用缓存

export async function GET(request: NextRequest) {
  try {
    const config = await getConfig();
    if (!config?.WebLiveConfig) {
      return NextResponse.json([]);
    }

    const sources = config.WebLiveConfig.filter((s) => !s.disabled);
    return NextResponse.json(sources);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 },
    );
  }
}
