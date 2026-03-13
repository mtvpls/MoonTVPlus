import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { generateTvboxToken } from '@/lib/tvbox-token';

export const runtime = 'nodejs';

/**
 * 重置用户的TVBox订阅token
 * 旧token将失效
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const username = authInfo.username;

    // 生成新token
    const newToken = generateTvboxToken();
    await db.setTvboxSubscribeToken(username, newToken);

    console.log(`用户 ${username} 重置了TVBox订阅token`);

    return NextResponse.json({
      token: newToken,
      message: '订阅token已重置，旧链接已失效',
    });
  } catch (error) {
    console.error('重置TVBox订阅token失败:', error);
    return NextResponse.json(
      {
        error: '重置订阅token失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
