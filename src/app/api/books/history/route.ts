import { NextRequest, NextResponse } from 'next/server';

import { BookReadRecord } from '@/lib/book.types';
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
      const record = await db.getBookReadRecord(username, sourceId, bookId);
      return NextResponse.json(record, { status: 200 });
    }

    const records = await db.getAllBookReadRecords(username);
    return NextResponse.json(records, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { key, record }: { key: string; record: BookReadRecord } = await request.json();
    if (!key || !record?.locator?.value) {
      return NextResponse.json({ error: 'Missing key or record' }, { status: 400 });
    }
    const [sourceId, bookId] = key.split('+');
    if (!sourceId || !bookId) return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });

    const shelfItem = await db.getBookShelf(username, sourceId, bookId);
    const existingRecord = await db.getBookReadRecord(username, sourceId, bookId);
    const normalizedRecord: BookReadRecord = {
      ...record,
      sourceId: record.sourceId || sourceId,
      bookId: record.bookId || bookId,
      sourceName: record.sourceName || shelfItem?.sourceName || existingRecord?.sourceName || '',
      detailHref: record.detailHref || shelfItem?.detailHref || existingRecord?.detailHref,
      acquisitionHref: record.acquisitionHref || shelfItem?.acquisitionHref || existingRecord?.acquisitionHref,
      author: record.author || shelfItem?.author || existingRecord?.author,
      cover: record.cover || shelfItem?.cover || existingRecord?.cover,
      saveTime: record.saveTime ?? Date.now(),
    };
    await db.saveBookReadRecord(username, sourceId, bookId, normalizedRecord);

    if (shelfItem) {
      await db.saveBookShelf(username, sourceId, bookId, {
        ...shelfItem,
        format: normalizedRecord.format,
        progressPercent: normalizedRecord.progressPercent,
        lastReadTime: normalizedRecord.saveTime,
        lastLocatorType: normalizedRecord.locator.type,
        lastLocatorValue: normalizedRecord.locator.value,
        lastChapterTitle: normalizedRecord.chapterTitle || normalizedRecord.locator.chapterTitle,
      });
    }

    if ((db as any).storage.cleanupOldBookReadRecords) {
      (db as any).storage.cleanupOldBookReadRecords(username).catch((err: Error) => {
        console.error('异步清理电子书阅读历史失败:', err);
      });
    }

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
      await db.deleteBookReadRecord(username, sourceId, bookId);
    } else {
      const all = await db.getAllBookReadRecords(username);
      await Promise.all(Object.keys(all).map(async (itemKey) => {
        const [sourceId, bookId] = itemKey.split('+');
        if (sourceId && bookId) await db.deleteBookReadRecord(username, sourceId, bookId);
      }));
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
