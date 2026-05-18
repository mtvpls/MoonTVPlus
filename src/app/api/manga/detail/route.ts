import { NextRequest, NextResponse } from 'next/server';

import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const mangaId = searchParams.get('mangaId')?.trim();
    const sourceId = searchParams.get('sourceId')?.trim();

    if (!mangaId || !sourceId) {
      return NextResponse.json({ error: '缺少 mangaId 或 sourceId' }, { status: 400 });
    }

    const detail = await suwayomiClient.getMangaDetail({
      mangaId,
      sourceId,
      title: searchParams.get('title') || undefined,
      cover: searchParams.get('cover') || undefined,
      sourceName: searchParams.get('sourceName') || undefined,
      description: searchParams.get('description') || undefined,
      author: searchParams.get('author') || undefined,
      status: searchParams.get('status') || undefined,
    });

    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
