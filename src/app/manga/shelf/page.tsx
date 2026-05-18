'use client';

import { BookOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { deleteMangaShelf, getAllMangaShelf, subscribeToDataUpdates } from '@/lib/db.client';
import { MangaShelfItem } from '@/lib/manga.types';

import MangaCard from '@/components/MangaCard';

function MangaShelfSkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className='space-y-2'>
          <div className='overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950'>
            <div className='aspect-[3/4] w-full animate-pulse bg-gray-200 dark:bg-gray-800' />
            <div className='space-y-3 p-3'>
              <div className='h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              <div className='h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            </div>
          </div>
          <div className='h-9 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />
        </div>
      ))}
    </div>
  );
}

export default function MangaShelfPage() {
  const [shelf, setShelf] = useState<Record<string, MangaShelfItem>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToDataUpdates<Record<string, MangaShelfItem>>(
      'mangaShelfUpdated',
      setShelf
    );

    getAllMangaShelf()
      .then(setShelf)
      .catch(() => undefined)
      .finally(() => setLoading(false));

    return unsubscribe;
  }, []);

  const shelfList = useMemo(
    () => Object.entries(shelf).sort(([, a], [, b]) => b.saveTime - a.saveTime),
    [shelf]
  );

  const removeItem = async (sourceId: string, mangaId: string) => {
    const key = `${sourceId}+${mangaId}`;
    await deleteMangaShelf(sourceId, mangaId);
    setShelf((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <section className='mx-auto max-w-6xl'>
      <div className='mb-4 flex items-center gap-2 text-sm text-gray-500'>
        <BookOpen className='h-4 w-4 text-emerald-500' /> 共 {shelfList.length} 本漫画
      </div>
      {loading ? (
        <MangaShelfSkeleton />
      ) : shelfList.length === 0 ? (
        <div className='rounded-2xl bg-gray-50 p-10 text-center text-sm text-gray-500 dark:bg-gray-900/50'>
          暂无书架内容
        </div>
      ) : (
        <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
          {shelfList.map(([key, item]) => (
            <div key={key} className='space-y-2'>
              <MangaCard
                item={item}
                href={`/manga/detail?mangaId=${item.mangaId}&sourceId=${item.sourceId}&title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}`}
                subtitle={
                  item.unreadChapterCount && item.unreadChapterCount > 0
                    ? `更新至 ${item.latestChapterName || '最新章节'} · 新增 ${item.unreadChapterCount} 话`
                    : item.lastChapterName || item.author || item.status
                }
                updateCount={item.unreadChapterCount}
              />
              <button
                onClick={() => removeItem(item.sourceId, item.mangaId)}
                className='w-full rounded-2xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-red-300 hover:text-red-600 dark:border-gray-700 dark:text-gray-200'
              >
                移出书架
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
