import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { listBaiduShareVideos } from '@/lib/netdisk/baidu.client';
import { createBaiduNetdiskSession } from '@/lib/netdisk/baidu-session-cache';
import { NETDISK_BAIDU_SOURCE } from '@/lib/netdisk/source';
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
    const baiduConfig = config.NetDiskConfig?.Baidu;
    if (!baiduConfig?.Enabled || !baiduConfig.Cookie) {
      return NextResponse.json({ error: '百度网盘未配置或未启用' }, { status: 400 });
    }

    const result = await listBaiduShareVideos(shareUrl, baiduConfig.Cookie, passcode || '');
    const session = createBaiduNetdiskSession({
      title: title || result.title,
      shareUrl,
      passcode,
      files: result.files,
      meta: result.meta,
      cookie: result.cookie,
    });

    return NextResponse.json({
      success: true,
      source: NETDISK_BAIDU_SOURCE,
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
