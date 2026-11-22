import { NextRequest, NextResponse } from 'next/server';

import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const mangaId = new URL(request.url).searchParams.get('mangaId')?.trim();
    if (!mangaId) {
      return NextResponse.json({ error: '缺少 mangaId' }, { status: 400 });
    }

    const chapters = await suwayomiClient.getChapters(mangaId);
    return NextResponse.json({ chapters });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
