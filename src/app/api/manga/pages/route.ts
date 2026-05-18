import { NextRequest, NextResponse } from 'next/server';

import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const chapterId = new URL(request.url).searchParams.get('chapterId')?.trim();
    if (!chapterId) {
      return NextResponse.json({ error: '缺少 chapterId' }, { status: 400 });
    }

    const pages = await suwayomiClient.getChapterPages(chapterId);
    return NextResponse.json({ pages });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
