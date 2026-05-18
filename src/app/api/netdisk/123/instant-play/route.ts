import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { listPan123ShareVideos } from '@/lib/netdisk/pan123.client';
import { createPan123NetdiskSession } from '@/lib/netdisk/pan123-session-cache';
import { NETDISK_123_SOURCE } from '@/lib/netdisk/source';
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
    const pan123Config = config.NetDiskConfig?.Pan123;
    if (!pan123Config?.Enabled || !pan123Config.Account || !pan123Config.Password) {
      return NextResponse.json({ error: '123网盘未配置或未启用' }, { status: 400 });
    }

    const result = await listPan123ShareVideos(shareUrl, passcode || '');
    const session = createPan123NetdiskSession({
      title: title || result.title,
      shareUrl,
      passcode,
      files: result.files,
    });

    return NextResponse.json({
      success: true,
      source: NETDISK_123_SOURCE,
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
