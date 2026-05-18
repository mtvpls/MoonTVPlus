import { NextRequest, NextResponse } from 'next/server';

import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const lang = new URL(request.url).searchParams.get('lang') || process.env.SUWAYOMI_DEFAULT_LANG || 'zh';
    const sources = await suwayomiClient.getSources(lang);
    return NextResponse.json({ sources });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
