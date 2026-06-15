import { NextResponse } from 'next/server';

import { fetchBangumiFromServer } from '@/lib/bangumi.server';
import { getConfig } from '@/lib/config';

export async function GET() {
  try {
    const config = await getConfig();
    const response = await fetchBangumiFromServer('/calendar', {
      baseUrl: config.SiteConfig.BangumiApiBaseUrl,
      proxy: config.SiteConfig.BangumiProxy,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Bangumi calendar 请求失败: ${response.status}` },
        { status: response.status || 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=21600',
      },
    });
  } catch (error) {
    console.error('获取 Bangumi calendar 失败:', error);
    return NextResponse.json(
      { error: '获取 Bangumi calendar 失败' },
      { status: 500 }
    );
  }
}
