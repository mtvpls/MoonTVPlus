import { NextRequest, NextResponse } from 'next/server';

import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');
    const tvgId = searchParams.get('tvgId');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源参数' }, { status: 400 });
    }

    if (!tvgId) {
      return NextResponse.json(
        { error: '缺少频道tvg-id参数' },
        { status: 400 },
      );
    }

    const channelData = await getCachedLiveChannels(sourceKey);

    if (!channelData) {
      // 频道信息未找到时返回空的节目单数据
      return NextResponse.json({
        success: true,
        data: {
          tvgId,
          source: sourceKey,
          epgUrl: '',
          programs: [],
        },
      });
    }

    // 从epgs字段中获取对应tvgId的节目单信息
    const epgData = channelData.epgs[tvgId] || [];

    return NextResponse.json({
      success: true,
      data: {
        tvgId,
        source: sourceKey,
        epgUrl: channelData.epgUrl,
        programs: epgData,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '获取节目单信息失败' }, { status: 500 });
  }
}
