import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { transferQuarkShare } from '@/lib/netdisk/quark.client';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (!(await hasFeaturePermission(authInfo.username, 'netdisk_transfer'))) {
      return NextResponse.json({ error: '无权限使用网盘转存' }, { status: 403 });
    }

    const { shareUrl, passcode } = await request.json();
    if (!shareUrl) {
      return NextResponse.json({ error: '分享链接不能为空' }, { status: 400 });
    }

    const config = await getConfig();
    const quarkConfig = config.NetDiskConfig?.Quark;

    if (!quarkConfig?.Enabled || !quarkConfig.Cookie) {
      return NextResponse.json({ error: '夸克网盘未配置或未启用' }, { status: 400 });
    }

    const result = await transferQuarkShare(quarkConfig.Cookie, {
      shareUrl,
      passcode,
      savePath: quarkConfig.SavePath,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '转存失败' },
      { status: 500 }
    );
  }
}
