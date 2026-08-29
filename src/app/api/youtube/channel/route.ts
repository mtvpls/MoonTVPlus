import { NextResponse } from 'next/server';

import {
  fetchYouTubeChannelFeed,
  resolveYouTubeChannelId,
} from '@/lib/youtube';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get('input')?.trim();
  if (!input) {
    return NextResponse.json(
      { error: '缺少频道地址或频道 ID' },
      { status: 400 }
    );
  }

  try {
    const channelId = await resolveYouTubeChannelId(input);
    const feed = await fetchYouTubeChannelFeed(channelId);
    return NextResponse.json(feed, {
      headers: {
        'Cache-Control':
          'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '读取 YouTube 频道失败',
      },
      { status: 400 }
    );
  }
}
