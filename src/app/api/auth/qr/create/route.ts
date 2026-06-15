import { NextRequest, NextResponse } from 'next/server';

import { createQrLoginSession } from '@/lib/qr-login/store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await createQrLoginSession();
  const origin = new URL(request.url).origin;
  const qrUrl = `${origin}/qr-login?token=${encodeURIComponent(session.token)}`;
  return NextResponse.json({ token: session.token, qrUrl, expiresAt: session.expiresAt, ttl: 120 });
}
