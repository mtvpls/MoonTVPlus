import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { listMobileShareVideos } from '@/lib/netdisk/mobile.client';
import { createMobileNetdiskSession } from '@/lib/netdisk/mobile-session-cache';
import { NETDISK_MOBILE_SOURCE } from '@/lib/netdisk/source';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (!(await hasFeaturePermission(authInfo.username, 'netdisk_temp_play'))) {
      return NextResponse.json({ error: '无权限使用临时播放' }, { status: 403 });
    }

    const { shareUrl, passcode, title } = await request.json();
    if (!shareUrl) {
      return NextResponse.json({ error: '分享链接不能为空' }, { status: 400 });
    }

    const config = await getConfig();
    const mobileConfig = config.NetDiskConfig?.Mobile;
    if (!mobileConfig?.Enabled || !mobileConfig.Authorization) {
      return NextResponse.json({ error: '移动云盘未配置或未启用' }, { status: 400 });
    }

    const result = await listMobileShareVideos(shareUrl, mobileConfig.Authorization);
    const session = createMobileNetdiskSession({
      title: title || result.title,
      shareUrl,
      passcode,
      files: result.files,
    });

    return NextResponse.json({
      success: true,
      source: NETDISK_MOBILE_SOURCE,
      id: session.id,
      title: title || result.title,
      totalFiles: result.files.length,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '立即播放失败' },
      { status: 500 }
    );
  }
}
