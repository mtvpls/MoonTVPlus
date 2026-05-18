import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasFeaturePermission } from '@/lib/permissions';

export async function getAuthorizedUsername(request: NextRequest): Promise<string | NextResponse> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (authInfo.username !== process.env.USERNAME) {
    const userInfoV2 = await db.getUserInfoV2(authInfo.username);
    if (!userInfoV2) {
      return NextResponse.json({ error: '用户不存在' }, { status: 401 });
    }
    if (userInfoV2.banned) {
      return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
    }
  }

  const allowed = await hasFeaturePermission(authInfo.username, 'manga');
  if (!allowed) {
    return NextResponse.json({ error: '无权限访问漫画功能' }, { status: 403 });
  }

  return authInfo.username;
}
