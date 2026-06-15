import { NextRequest, NextResponse } from 'next/server';

import { getQrLoginSession, saveQrLoginSession } from '@/lib/qr-login/store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { token } = await request.json();
  const session = await getQrLoginSession(token);
  if (session) {
    session.status = 'cancelled';
    await saveQrLoginSession(session);
  }
  return NextResponse.json({ ok: true });
}
