import { NextRequest, NextResponse } from 'next/server';

import {
  handleTelegramWebhookUpdate,
  validateTelegramWebhookRequest,
} from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { secret: string } }
) {
  if (!(await validateTelegramWebhookRequest(request, params.secret))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const update = await request.json();
  await handleTelegramWebhookUpdate(update);
  return NextResponse.json({ ok: true });
}
