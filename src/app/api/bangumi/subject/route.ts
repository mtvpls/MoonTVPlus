import { NextRequest, NextResponse } from 'next/server';

import { fetchBangumiFromServer } from '@/lib/bangumi.server';
import { getConfig } from '@/lib/config';

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id') || '';
    if (!/^\d+$/.test(id)) {
      return NextResponse.json(
        { error: 'Bangumi ID 格式错误' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const response = await fetchBangumiFromServer(`/v0/subjects/${id}`, {
      baseUrl: config.SiteConfig.BangumiApiBaseUrl,
      proxy: config.SiteConfig.BangumiProxy,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Bangumi subject 请求失败: ${response.status}` },
        { status: response.status || 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('获取 Bangumi subject 失败:', error);
    return NextResponse.json(
      { error: '获取 Bangumi subject 失败' },
      { status: 500 }
    );
  }
}
