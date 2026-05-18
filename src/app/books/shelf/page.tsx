'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { buildBookDetailPath, cacheBookShelfItem } from '@/lib/book-route-cache.client';
import { deleteBookShelf, getAllBookShelf } from '@/lib/book.db.client';
import { BookShelfItem } from '@/lib/book.types';

export default function BookShelfPage() {
  const [shelf, setShelf] = useState<Record<string, BookShelfItem>>({});

  useEffect(() => {
    getAllBookShelf().then(setShelf).catch(() => undefined);
  }, []);

  const items = useMemo(() => Object.values(shelf).sort((a, b) => (b.lastReadTime || b.saveTime) - (a.lastReadTime || a.saveTime)), [shelf]);

  return (
    <div className='space-y-4'>
      <div className='text-sm text-gray-500'>共 {items.length} 本电子书</div>
      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {items.map((item) => (
          <div key={`${item.sourceId}-${item.bookId}`} className='rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
            <div className='flex gap-4'>
              <div className='h-28 w-20 overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-900'>{item.cover ? <img src={item.cover} alt={item.title} className='h-full w-full object-cover' /> : null}</div>
              <div className='min-w-0 flex-1'>
                <div className='truncate font-medium'>{item.title}</div>
                <div className='mt-1 text-sm text-gray-500'>{item.author || item.sourceName}</div>
                <div className='mt-2 text-xs text-gray-500'>进度 {Math.round(item.progressPercent || 0)}%</div>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <Link href={buildBookDetailPath(item.sourceId, item.bookId)} onClick={() => cacheBookShelfItem(item)} className='rounded-2xl bg-sky-600 px-3 py-2 text-xs text-white'>详情</Link>
                  <button onClick={async () => { await deleteBookShelf(item.sourceId, item.bookId); setShelf((prev) => { const next = { ...prev }; delete next[`${item.sourceId}+${item.bookId}`]; return next; }); }} className='rounded-2xl border border-gray-200 px-3 py-2 text-xs dark:border-gray-700'>移除</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 ? <div className='text-sm text-gray-500'>书架还是空的</div> : null}
    </div>
  );
}
