import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasFeaturePermission } from '@/lib/permissions';

export async function getMusicV2Username(request: NextRequest): Promise<string | null> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) return null;

  if (authInfo.username !== process.env.USERNAME) {
    const userInfo = await db.getUserInfoV2(authInfo.username);
    if (!userInfo || userInfo.banned) {
      return null;
    }
  }

  const allowed = await hasFeaturePermission(authInfo.username, 'music');
  if (!allowed) {
    return null;
  }

  return authInfo.username;
}

export function unauthorized() {
  return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 });
}

export function badRequest(message: string, code = 'BAD_REQUEST') {
  return NextResponse.json({ success: false, error: { code, message } }, { status: 400 });
}

export function internalError(message: string, details?: string) {
  return NextResponse.json(
    { success: false, error: { code: 'INTERNAL_ERROR', message, details } },
    { status: 500 }
  );
}
