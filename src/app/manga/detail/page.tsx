'use client';

import { ArrowDownWideNarrow, ArrowUpWideNarrow, BookOpen, Clock3 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { deleteMangaShelf, getAllMangaReadRecords, getAllMangaShelf, saveMangaShelf } from '@/lib/db.client';
import { MangaChapter, MangaDetail, MangaReadRecord, MangaShelfItem } from '@/lib/manga.types';

import ProxyImage from '@/components/ProxyImage';

function MangaDetailSkeleton() {
  return (
    <div className='space-y-6'>
      <div className='grid gap-6 rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950 md:grid-cols-[260px_1fr]'>
        <div className='aspect-[3/4] animate-pulse rounded-3xl bg-gray-200 dark:bg-gray-800' />
        <div className='space-y-4'>
          <div className='h-8 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='flex gap-2'>
            <div className='h-7 w-24 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800' />
            <div className='h-7 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800' />
          </div>
          <div className='space-y-3'>
            <div className='h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-4 w-11/12 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-4 w-4/5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
          <div className='flex flex-wrap gap-3'>
            <div className='h-12 w-32 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />
            <div className='h-12 w-40 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />
            <div className='h-12 w-32 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
      </div>
      <div className='rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
        <div className='mb-4 h-6 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        <div className='space-y-3'>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className='rounded-2xl border border-gray-200 px-4 py-3 dark:border-gray-700'>
              <div className='h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              <div className='mt-2 h-3 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatChapterMeta(chapter: MangaChapter): string | null {
  if (typeof chapter.pageCount === 'number' && chapter.pageCount > 0) {
    return `${chapter.pageCount} 页`;
  }

  if (typeof chapter.uploadDate === 'number' && chapter.uploadDate > 0) {
    const timestamp =
      chapter.uploadDate > 1_000_000_000_000
        ? chapter.uploadDate
        : chapter.uploadDate * 1000;
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('zh-CN');
    }
  }

  return null;
}

export default function MangaDetailPage() {
  const searchParams = useSearchParams();
  const mangaId = searchParams.get('mangaId') || '';
  const sourceId = searchParams.get('sourceId') || '';
  const returnTo = searchParams.get('returnTo') || '/manga';
  const [detail, setDetail] = useState<MangaDetail | null>(null);
  const [history, setHistory] = useState<Record<string, MangaReadRecord>>({});
  const [shelf, setShelf] = useState<Record<string, MangaShelfItem>>({});
  const [descOrder, setDescOrder] = useState(true);
  const clearedOnOpenRef = useRef<string | null>(null);

  const key = `${sourceId}+${mangaId}`;
  const currentRecord = history[key];

  useEffect(() => {
    if (!mangaId || !sourceId) return;

    const params = new URLSearchParams({
      mangaId,
      sourceId,
      title: searchParams.get('title') || '',
      cover: searchParams.get('cover') || '',
      sourceName: searchParams.get('sourceName') || '',
      description: searchParams.get('description') || '',
      author: searchParams.get('author') || '',
      status: searchParams.get('status') || '',
    });

    fetch(`/api/manga/detail?${params.toString()}`)
      .then((res) => res.json())
      .then(setDetail)
      .catch(() => undefined);

    getAllMangaReadRecords().then(setHistory).catch(() => undefined);
    getAllMangaShelf().then(setShelf).catch(() => undefined);
  }, [mangaId, searchParams, sourceId]);

  const chapters = useMemo(() => {
    const list = detail?.chapters || [];
    return [...list].sort((a, b) => {
      const diff = (a.chapterNumber || 0) - (b.chapterNumber || 0);
      return descOrder ? -diff : diff;
    });
  }, [detail?.chapters, descOrder]);

  const chronologicalChapters = useMemo(() => {
    const list = detail?.chapters || [];
    return [...list].sort((a, b) => {
      const diff = (a.chapterNumber || 0) - (b.chapterNumber || 0);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });
  }, [detail?.chapters]);

  const latestChapter = chronologicalChapters[chronologicalChapters.length - 1];
  const unreadChapterCount = shelf[key]?.unreadChapterCount || 0;
  const newChapterIds = useMemo(() => {
    if (unreadChapterCount <= 0) return new Set<string>();
    return new Set(chronologicalChapters.slice(-unreadChapterCount).map((chapter) => chapter.id));
  }, [chronologicalChapters, unreadChapterCount]);

  useEffect(() => {
    const shelfItem = shelf[key];
    if (!detail || !shelfItem || !latestChapter || (shelfItem.unreadChapterCount || 0) <= 0) {
      return;
    }

    if (clearedOnOpenRef.current === key) {
      return;
    }
    clearedOnOpenRef.current = key;

    const nextItem: MangaShelfItem = {
      ...shelfItem,
      latestChapterId: latestChapter.id,
      latestChapterName: latestChapter.name,
      latestChapterCount: chronologicalChapters.length,
      unreadChapterCount: 0,
    };

    // 只后台清零，当前页保留进入时看到的更新提示，刷新后再消失。
    saveMangaShelf(sourceId, mangaId, nextItem).catch(() => undefined);
  }, [chronologicalChapters.length, detail, key, latestChapter, mangaId, shelf, sourceId]);

  const toggleShelf = async () => {
    if (!detail) return;
    if (shelf[key]) {
      await deleteMangaShelf(sourceId, mangaId);
      setShelf((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const item: MangaShelfItem = {
      title: detail.title,
      cover: detail.cover,
      sourceId: detail.sourceId,
      sourceName: detail.sourceName,
      mangaId: detail.id,
      saveTime: Date.now(),
      description: detail.description,
      author: detail.author,
      status: detail.status,
      lastChapterId: currentRecord?.chapterId,
      lastChapterName: currentRecord?.chapterName,
      latestChapterId: latestChapter?.id,
      latestChapterName: latestChapter?.name,
      latestChapterCount: chronologicalChapters.length,
      unreadChapterCount: 0,
    };
    await saveMangaShelf(sourceId, mangaId, item);
    setShelf((prev) => ({ ...prev, [key]: item }));
  };

  const chapterHref = (chapter: MangaChapter) =>
    `/manga/read?mangaId=${mangaId}&sourceId=${sourceId}&chapterId=${chapter.id}&title=${encodeURIComponent(detail?.title || '')}&cover=${encodeURIComponent(detail?.cover || '')}&sourceName=${encodeURIComponent(detail?.sourceName || '')}&chapterName=${encodeURIComponent(chapter.name)}&returnTo=${encodeURIComponent(returnTo)}`;

  if (!detail) return <MangaDetailSkeleton />;


  return (
    <div className='space-y-6'>
      <div className='grid gap-6 rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950 md:grid-cols-[260px_1fr]'>
        <div className='overflow-hidden rounded-3xl bg-gray-100 dark:bg-gray-800'>
          {detail.cover ? (
            <ProxyImage originalSrc={detail.cover} alt={detail.title} className='h-full w-full object-cover' />
          ) : (
            <div className='flex aspect-[3/4] items-center justify-center text-sm text-gray-400'>暂无封面</div>
          )}
        </div>
        <div className='space-y-4'>
          <div>
            <h1 className='text-3xl font-bold'>{detail.title}</h1>
            <div className='mt-3 flex flex-wrap gap-2 text-xs text-gray-500'>
              <span className='rounded-full bg-sky-50 px-3 py-1 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'>
                {detail.sourceName}
              </span>
              {detail.author && <span className='rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800'>{detail.author}</span>}
              {detail.status && <span className='rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800'>{detail.status}</span>}
            </div>
          </div>
          {detail.description && <p className='text-sm leading-7 text-gray-600 dark:text-gray-300'>{detail.description}</p>}
          <div className='flex flex-wrap gap-3'>
            {chapters[0] && (
              <Link href={chapterHref(chapters[0])} className='rounded-2xl bg-sky-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-700'>
                <BookOpen className='mr-2 inline h-4 w-4' />开始阅读
              </Link>
            )}
            {currentRecord && (
              <Link
                href={`/manga/read?mangaId=${mangaId}&sourceId=${sourceId}&chapterId=${currentRecord.chapterId}&title=${encodeURIComponent(detail.title)}&cover=${encodeURIComponent(detail.cover)}&sourceName=${encodeURIComponent(detail.sourceName)}&chapterName=${encodeURIComponent(currentRecord.chapterName)}&returnTo=${encodeURIComponent(returnTo)}`}
                className='rounded-2xl border border-sky-300 px-5 py-3 text-sm font-medium text-sky-700 transition hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/30'
              >
                <Clock3 className='mr-2 inline h-4 w-4' />继续阅读 第 {currentRecord.pageIndex + 1}/{currentRecord.pageCount} 页
              </Link>
            )}
            <button onClick={toggleShelf} className='rounded-2xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-700 transition hover:border-sky-300 hover:text-sky-600 dark:border-gray-700 dark:text-gray-200'>
              {shelf[key] ? '移出书架' : '加入书架'}
            </button>
          </div>
        </div>
      </div>

      <div className='rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-semibold'>章节列表</h2>
          <button onClick={() => setDescOrder((prev) => !prev)} className='rounded-2xl border border-gray-200 px-4 py-2 text-sm dark:border-gray-700'>
            {descOrder ? <ArrowDownWideNarrow className='inline h-4 w-4' /> : <ArrowUpWideNarrow className='inline h-4 w-4' />} {descOrder ? '倒序' : '正序'}
          </button>
        </div>
        {unreadChapterCount > 0 && latestChapter && (
          <div className='mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300'>
            已更新 {unreadChapterCount} 话，最新章节：{latestChapter.name}
          </div>
        )}
        <div className='grid gap-3'>
          {chapters.map((chapter) => {
            const active = currentRecord?.chapterId === chapter.id;
            const isNewChapter = newChapterIds.has(chapter.id);
            return (
              <Link
                key={chapter.id}
                href={chapterHref(chapter)}
                className={`rounded-2xl border px-4 py-3 text-sm transition ${active ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/30' : isNewChapter ? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-gray-200 hover:border-sky-300 dark:border-gray-700'}`}
              >
                <div className='flex items-center justify-between gap-3'>
                  <div className='font-medium text-gray-900 dark:text-gray-100'>{chapter.name}</div>
                  {isNewChapter && (
                    <span className='rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300'>
                      NEW
                    </span>
                  )}
                </div>
                <div className='mt-1 text-xs text-gray-500'>
                  {(() => {
                    const meta = formatChapterMeta(chapter);
                    const progress = active && currentRecord ? `上次看到第 ${currentRecord.pageIndex + 1} 页` : null;
                    return [meta, progress].filter(Boolean).join(' · ');
                  })()}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
