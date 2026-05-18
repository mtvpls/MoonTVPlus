import { NextRequest, NextResponse } from 'next/server';

import { BookShelfItem } from '@/lib/book.types';
import { db } from '@/lib/db';

import { getAuthorizedBooksUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const key = new URL(request.url).searchParams.get('key');
    if (key) {
      const [sourceId, bookId] = key.split('+');
      if (!sourceId || !bookId) return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
      const item = await db.getBookShelf(username, sourceId, bookId);
      return NextResponse.json(item, { status: 200 });
    }

    const records = await db.getAllBookShelf(username);
    return NextResponse.json(records, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { key, item }: { key: string; item: BookShelfItem } = await request.json();
    if (!key || !item?.title) return NextResponse.json({ error: 'Missing key or item' }, { status: 400 });
    const [sourceId, bookId] = key.split('+');
    if (!sourceId || !bookId) return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });

    await db.saveBookShelf(username, sourceId, bookId, {
      ...item,
      sourceId: item.sourceId || sourceId,
      bookId: item.bookId || bookId,
      saveTime: item.saveTime ?? Date.now(),
    });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const key = new URL(request.url).searchParams.get('key');
    if (key) {
      const [sourceId, bookId] = key.split('+');
      if (!sourceId || !bookId) return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
      await db.deleteBookShelf(username, sourceId, bookId);
    } else {
      const all = await db.getAllBookShelf(username);
      await Promise.all(Object.keys(all).map(async (itemKey) => {
        const [sourceId, bookId] = itemKey.split('+');
        if (sourceId && bookId) await db.deleteBookShelf(username, sourceId, bookId);
      }));
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
