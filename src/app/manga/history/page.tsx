'use client';

import { History } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { deleteMangaReadRecord, deleteMangaShelf, getAllMangaReadRecords, getAllMangaShelf, getCachedMangaReadRecordsSnapshot, saveMangaShelf, subscribeToDataUpdates } from '@/lib/db.client';
import { MangaReadRecord, MangaShelfItem } from '@/lib/manga.types';

import MangaHistoryCard from '@/components/manga/MangaHistoryCard';

function MangaHistorySkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className='overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950'>
          <div className='aspect-[3/4] w-full animate-pulse bg-gray-200 dark:bg-gray-800' />
          <div className='space-y-3 p-3'>
            <div className='h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-3 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MangaHistoryPage() {
  const [history, setHistory] = useState<Record<string, MangaReadRecord>>({});
  const [loading, setLoading] = useState(true);
  const [shelf, setShelf] = useState<Record<string, MangaShelfItem>>({});
  const [displayAll, setDisplayAll] = useState(false);

  const updateHistory = (nextHistory: Record<string, MangaReadRecord>) => {
    const sortedCount = Object.keys(nextHistory).length;
    setHistory(nextHistory);
    setDisplayAll(sortedCount <= 10);
    if (sortedCount > 10) {
      setTimeout(() => setDisplayAll(true), 0);
    }
  };

  useEffect(() => {
    const cachedHistory = getCachedMangaReadRecordsSnapshot();
    if (Object.keys(cachedHistory).length > 0) {
      updateHistory(cachedHistory);
      setLoading(false);
    }

    Promise.all([getAllMangaReadRecords(), getAllMangaShelf()])
      .then(([historyData, shelfData]) => {
        updateHistory(historyData);
        setShelf(shelfData);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));

    const unsubscribeHistory = subscribeToDataUpdates<Record<string, MangaReadRecord>>('mangaHistoryUpdated', updateHistory);
    const unsubscribeShelf = subscribeToDataUpdates<Record<string, MangaShelfItem>>('mangaShelfUpdated', setShelf);

    return () => {
      unsubscribeHistory();
      unsubscribeShelf();
    };
  }, []);

  const historyList = useMemo(
    () => Object.entries(history).sort(([, a], [, b]) => b.saveTime - a.saveTime),
    [history]
  );
  const visibleHistoryList = useMemo(
    () => (displayAll ? historyList : historyList.slice(0, 10)),
    [displayAll, historyList]
  );


  const toggleShelf = async (item: MangaReadRecord) => {
    const key = `${item.sourceId}+${item.mangaId}`;
    if (shelf[key]) {
      await deleteMangaShelf(item.sourceId, item.mangaId);
      setShelf((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const shelfItem: MangaShelfItem = {
      title: item.title,
      cover: item.cover,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      mangaId: item.mangaId,
      saveTime: Date.now(),
      lastChapterId: item.chapterId,
      lastChapterName: item.chapterName,
    };

    await saveMangaShelf(item.sourceId, item.mangaId, shelfItem);
    setShelf((prev) => ({ ...prev, [key]: shelfItem }));
  };

  const deleteHistory = async (item: MangaReadRecord) => {
    const key = `${item.sourceId}+${item.mangaId}`;
    await deleteMangaReadRecord(item.sourceId, item.mangaId);
    updateHistory((() => {
      const next = { ...history };
      delete next[key];
      return next;
    })());
  };

  return (
    <section className='mx-auto max-w-6xl'>
      <div className='mb-4 flex items-center gap-2 text-sm text-gray-500'>
        <History className='h-4 w-4 text-violet-500' /> 共 {historyList.length} 条阅读记录
      </div>
      {loading ? (
        <MangaHistorySkeleton />
      ) : historyList.length === 0 ? (
        <div className='rounded-2xl bg-gray-50 p-10 text-center text-sm text-gray-500 dark:bg-gray-900/50'>
          暂无阅读历史
        </div>
      ) : (
        <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
          {visibleHistoryList.map(([key, item]) => (
            <MangaHistoryCard
              key={key}
              item={item}
              inShelf={!!shelf[`${item.sourceId}+${item.mangaId}`]}
              onToggleShelf={toggleShelf}
              onDelete={deleteHistory}
            />
          ))}
        </div>
      )}
    </section>
  );
}
