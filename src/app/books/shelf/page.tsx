'use client';

import { BookmarkCheck, BookOpen, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { deleteBookShelf, getAllBookShelf } from '@/lib/book.db.client';
import { BookShelfItem } from '@/lib/book.types';
import {
  buildBookDetailPath,
  cacheBookShelfItem,
} from '@/lib/book-route-cache.client';

export default function BookShelfPage() {
  const [shelf, setShelf] = useState<Record<string, BookShelfItem>>({});

  useEffect(() => {
    getAllBookShelf()
      .then(setShelf)
      .catch(() => undefined);
  }, []);

  const items = useMemo(
    () =>
      Object.values(shelf).sort(
        (a, b) =>
          (b.lastReadTime || b.saveTime) - (a.lastReadTime || a.saveTime)
      ),
    [shelf]
  );

  return (
    <div className='space-y-5'>
      <section className='rounded-[2rem] border border-emerald-100/80 bg-white/85 p-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:bg-gray-950/70'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <div className='text-sm font-medium text-emerald-600 dark:text-emerald-300'>
              我的书架
            </div>
            <div className='mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white'>
              共 {items.length} 本电子书
            </div>
          </div>
          <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/20'>
            <BookmarkCheck className='h-6 w-6' />
          </div>
        </div>
      </section>

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {items.map((item) => (
          <article
            key={`${item.sourceId}-${item.bookId}`}
            className='rounded-[2rem] border border-emerald-100/80 bg-white/85 p-4 shadow-sm shadow-emerald-950/5 transition-colors duration-200 hover:border-emerald-200 hover:bg-white dark:border-emerald-500/10 dark:bg-gray-950/70 dark:hover:border-emerald-500/30'
          >
            <div className='flex gap-4'>
              <div className='h-28 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 to-amber-50 ring-1 ring-emerald-100 dark:from-gray-900 dark:to-emerald-950/20 dark:ring-emerald-500/10'>
                {item.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.cover}
                    alt={item.title}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <div className='flex h-full items-center justify-center text-slate-400'>
                    <BookOpen className='h-7 w-7' />
                  </div>
                )}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate font-semibold text-slate-950 dark:text-white'>
                  {item.title}
                </div>
                <div className='mt-1 truncate text-sm text-slate-500 dark:text-slate-400'>
                  {item.author || item.sourceName}
                </div>
                <div className='mt-3 h-2 overflow-hidden rounded-full bg-emerald-50 dark:bg-gray-900'>
                  <div
                    className='h-full rounded-full bg-emerald-600'
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, Math.round(item.progressPercent || 0))
                      )}%`,
                    }}
                  />
                </div>
                <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                  进度 {Math.round(item.progressPercent || 0)}%
                </div>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <Link
                    href={buildBookDetailPath(item.sourceId, item.bookId)}
                    onClick={() => cacheBookShelfItem(item)}
                    className='inline-flex cursor-pointer items-center gap-1.5 rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500'
                  >
                    详情
                  </Link>
                  <button
                    type='button'
                    onClick={async () => {
                      await deleteBookShelf(item.sourceId, item.bookId);
                      setShelf((prev) => {
                        const next = { ...prev };
                        delete next[`${item.sourceId}+${item.bookId}`];
                        return next;
                      });
                    }}
                    className='inline-flex cursor-pointer items-center gap-1.5 rounded-2xl border border-emerald-100 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors duration-200 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/10 dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
                  >
                    <Trash2 className='h-3.5 w-3.5' />
                    移除
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 ? (
        <div className='rounded-3xl border border-dashed border-emerald-200 bg-white/70 p-8 text-center text-sm text-slate-500 dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-slate-400'>
          书架还是空的
        </div>
      ) : null}
    </div>
  );
}
