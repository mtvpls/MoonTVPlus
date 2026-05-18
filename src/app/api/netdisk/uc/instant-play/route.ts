import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { NETDISK_UC_SOURCE } from '@/lib/netdisk/source';
import { listUCShareVideos } from '@/lib/netdisk/uc.client';
import { createUCNetdiskSession } from '@/lib/netdisk/uc-session-cache';
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
    const ucConfig = config.NetDiskConfig?.UC;
    if (!ucConfig?.Enabled || !ucConfig.Cookie) {
      return NextResponse.json({ error: 'UC网盘未配置或未启用' }, { status: 400 });
    }

    const result = await listUCShareVideos(shareUrl, ucConfig.Cookie, passcode || '');
    const session = createUCNetdiskSession({
      title: title || result.title,
      shareUrl,
      passcode,
      shareId: result.shareId,
      shareToken: result.shareToken,
      files: result.files,
    });

    return NextResponse.json({
      success: true,
      source: NETDISK_UC_SOURCE,
      id: session.id,
      title: title || result.title,
      fileCount: result.files.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '立即播放失败' },
      { status: 500 }
    );
  }
}
