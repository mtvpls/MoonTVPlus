import { NextRequest, NextResponse } from 'next/server';

import { opdsClient } from '@/lib/opds.client';

import { getAuthorizedBooksUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const sourceId = searchParams.get('sourceId')?.trim() || undefined;
    if (!q) {
      return NextResponse.json({ results: [], failedSources: [] });
    }
    const result = await opdsClient.searchBooks(q, sourceId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
