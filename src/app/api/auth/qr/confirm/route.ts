import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getQrLoginSession, saveQrLoginSession } from '@/lib/qr-login/store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { token } = await request.json();
  const session = await getQrLoginSession(token);
  if (!session || session.status === 'expired') return NextResponse.json({ error: '二维码已过期' }, { status: 410 });
  if (session.status === 'cancelled' || session.status === 'used') return NextResponse.json({ error: '二维码不可用' }, { status: 400 });

  const authInfo = getAuthInfoFromCookie(request);
  const authCookie = request.cookies.get('auth')?.value;
  if (!authInfo || !authCookie) return NextResponse.json({ error: '请先在手机端登录后再确认' }, { status: 401 });

  session.status = 'confirmed';
  session.authToken = authCookie;
  session.userAgent = request.headers.get('user-agent') || '';
  await saveQrLoginSession(session);
  return NextResponse.json({ ok: true, status: 'confirmed' });
}
