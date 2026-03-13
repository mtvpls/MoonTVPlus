import { NextRequest, NextResponse } from 'next/server';

import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源参数' }, { status: 400 });
    }

    const channelData = await getCachedLiveChannels(sourceKey);

    if (!channelData) {
      return NextResponse.json({ error: '频道信息未找到' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: channelData.channels,
    });
  } catch (error) {
    return NextResponse.json({ error: '获取频道信息失败' }, { status: 500 });
  }
}
