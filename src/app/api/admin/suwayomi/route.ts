import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { SuwayomiClient } from '@/lib/suwayomi.client';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const body = await request.json();
    const {
      ServerURL,
      AuthMode,
      Username,
      Password,
      DefaultLang,
    } = body as {
      ServerURL?: string;
      AuthMode?: 'none' | 'basic_auth' | 'simple_login';
      Username?: string;
      Password?: string;
      DefaultLang?: string;
    };

    if (!ServerURL?.trim()) {
      return NextResponse.json({ success: false, message: '请先填写 Suwayomi 服务地址' }, { status: 400 });
    }

    if ((AuthMode === 'basic_auth' || AuthMode === 'simple_login') && (!Username?.trim() || !Password)) {
      return NextResponse.json({ success: false, message: '当前认证方式需要填写用户名和密码' }, { status: 400 });
    }

    const client = new SuwayomiClient({
      serverUrl: ServerURL.trim(),
      authMode: AuthMode || 'none',
      username: Username?.trim(),
      password: Password,
    });

    const sources = await client.getSources((DefaultLang || 'zh').trim() || 'zh');

    return NextResponse.json({
      success: true,
      message: `连接成功，当前语言下检测到 ${sources.length} 个源`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '测试连接失败',
      },
      { status: 400 }
    );
  }
}
