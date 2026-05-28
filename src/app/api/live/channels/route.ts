import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getCachedLiveChannels, refreshLiveChannels } from '@/lib/live';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'live', '无权限访问电视直播');
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');
    const shouldRefresh = searchParams.get('refresh') === '1';

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源参数' }, { status: 400 });
    }

    let channelData = null;
    if (shouldRefresh) {
      const config = await getConfig();
      const liveInfo = config.LiveConfig?.find((live) => live.key === sourceKey);
      if (!liveInfo) {
        return NextResponse.json({ error: '频道信息未找到' }, { status: 404 });
      }
      const channelNumber = await refreshLiveChannels(liveInfo);
      if (channelNumber === 0) {
        return NextResponse.json({ error: '频道信息未找到' }, { status: 404 });
      }
      liveInfo.channelNumber = channelNumber;
      await db.saveAdminConfig(config);
      channelData = await getCachedLiveChannels(sourceKey);
    } else {
      channelData = await getCachedLiveChannels(sourceKey);
    }

    if (!channelData) {
      return NextResponse.json({ error: '频道信息未找到' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: channelData.channels
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取频道信息失败' },
      { status: 500 }
    );
  }
}
