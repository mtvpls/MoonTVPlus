import { NextRequest, NextResponse } from 'next/server';

import { BookAcquisitionLink } from '@/lib/book.types';
import { db } from '@/lib/db';
import { opdsClient } from '@/lib/opds.client';

import { getAuthorizedBooksUsername } from '../_utils';

export const runtime = 'nodejs';

type DetailPayload = {
  sourceId?: string;
  bookId?: string;
  href?: string;
  title?: string;
  author?: string;
  cover?: string;
  summary?: string;
  acquisitionLinks?: BookAcquisitionLink[];
};

async function resolveDetail(username: string, payload: DetailPayload) {
  const sourceId = payload.sourceId?.trim();
  if (!sourceId) {
    return NextResponse.json({ error: '缺少 sourceId' }, { status: 400 });
  }

  const bookId = payload.bookId?.trim();
  if (!bookId) {
    return NextResponse.json({ error: '缺少 bookId' }, { status: 400 });
  }

  const shelfItem = await db.getBookShelf(username, sourceId, bookId);
  const readRecord = await db.getBookReadRecord(username, sourceId, bookId);
  const href = payload.href?.trim() || shelfItem?.detailHref || readRecord?.detailHref || '';
  const acquisitionLinks = (payload.acquisitionLinks && payload.acquisitionLinks.length > 0)
    ? payload.acquisitionLinks
    : shelfItem?.acquisitionHref
      ? [{
          rel: 'http://opds-spec.org/acquisition',
          type: shelfItem.format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
          href: shelfItem.acquisitionHref,
        }]
      : readRecord?.acquisitionHref
        ? [{
            rel: 'http://opds-spec.org/acquisition',
            type: readRecord.format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
            href: readRecord.acquisitionHref,
          }]
        : undefined;

  const detail = await opdsClient.getBookDetail(sourceId, href, {
    id: bookId,
    title: payload.title || shelfItem?.title || readRecord?.title || undefined,
    author: payload.author || shelfItem?.author || readRecord?.author || undefined,
    cover: payload.cover || shelfItem?.cover || readRecord?.cover || undefined,
    summary: payload.summary || undefined,
    detailHref: href || undefined,
    acquisitionLinks,
  });

  return NextResponse.json(detail);
}

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    return await resolveDetail(username, {
      sourceId: searchParams.get('sourceId') || undefined,
      bookId: searchParams.get('bookId') || undefined,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const payload = await request.json() as DetailPayload;
    return await resolveDetail(username, payload);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
