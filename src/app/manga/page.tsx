'use client';

import { Compass, Flame, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteMangaShelf,
  getAllMangaReadRecords,
  getAllMangaShelf,
  saveMangaShelf,
} from '@/lib/db.client';
import {
  MangaReadRecord,
  MangaRecommendResult,
  MangaRecommendType,
  MangaSearchItem,
  MangaShelfItem,
  MangaSource,
} from '@/lib/manga.types';

import { mangaCardItem } from '@/components/media/adapters';
import ContinueReadingCard from '@/components/media/ContinueReadingCard';
import EmptyState from '@/components/media/EmptyState';
import {
  BOOK_RAIL_ITEM,
  SPINE_TAB,
  SPINE_TAB_ACTIVE,
  SPINE_TAB_IDLE,
} from '@/components/media/library';
import MediaCard from '@/components/media/MediaCard';
import MediaGrid from '@/components/media/MediaGrid';
import MediaGridSkeleton from '@/components/media/MediaGridSkeleton';
import MediaRail from '@/components/media/MediaRail';
import MediaSectionHeader from '@/components/media/MediaSectionHeader';
import ShelfChipButton from '@/components/media/ShelfChipButton';

/** 书墙：比通用网格更密，一眼看过去全是封面。 */
const WALL_CLASS =
  'grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8';

function buildDetailHref(item: {
  id: string;
  sourceId: string;
  title: string;
  cover: string;
  sourceName: string;
  returnTo: string;
}) {
  const params = new URLSearchParams({
    mangaId: item.id,
    sourceId: item.sourceId,
    title: item.title,
    cover: item.cover,
    sourceName: item.sourceName,
    returnTo: item.returnTo,
  });
  return `/manga/detail?${params.toString()}`;
}

function buildReadHref(record: MangaReadRecord, returnTo: string) {
  const params = new URLSearchParams({
    mangaId: record.mangaId,
    sourceId: record.sourceId,
    chapterId: record.chapterId,
    title: record.title,
    cover: record.cover,
    sourceName: record.sourceName,
    chapterName: record.chapterName,
    returnTo,
  });
  return `/manga/read?${params.toString()}`;
}

function readRecordMeta(record: MangaReadRecord) {
  const page =
    record.pageCount > 0
      ? `第 ${record.pageIndex + 1}/${record.pageCount} 页`
      : '';
  return [record.sourceName, record.chapterName, page]
    .filter(Boolean)
    .join(' · ');
}

function readRecordProgress(record: MangaReadRecord) {
  if (record.pageCount <= 0) return undefined;
  return Math.min(
    100,
    Math.round(((record.pageIndex + 1) / record.pageCount) * 100)
  );
}

export default function MangaRecommendPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sources, setSources] = useState<MangaSource[]>([]);
  // 书源还没回来时 sourceId 必然是空的——这段时间必须显示加载指示，
  // 否则会先闪一下"没有漫画源"的占位，而我们其实只是还没问完。
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceId, setSourceId] = useState('');
  // 推荐请求是否已经有结果。没有它的话，"sourceId 已设但请求还没发出去"的那一帧
  // 会先渲染成空态占位，然后又跳成骨架屏。
  const [recommendSettled, setRecommendSettled] = useState(false);
  const [recommendType, setRecommendType] =
    useState<MangaRecommendType>('POPULAR');
  const [result, setResult] = useState<MangaRecommendResult>({
    mangas: [],
    hasNextPage: false,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [shelf, setShelf] = useState<Record<string, MangaShelfItem>>({});
  const [readRecords, setReadRecords] = useState<MangaReadRecord[]>([]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const enabled = (
      window as Window & { RUNTIME_CONFIG?: { SUWAYOMI_ENABLED?: boolean } }
    ).RUNTIME_CONFIG?.SUWAYOMI_ENABLED;
    if (!enabled) {
      router.replace('/');
    }
  }, [router]);

  useEffect(() => {
    const query = searchParams.get('q')?.trim();
    if (!query) return;

    const params = new URLSearchParams(searchParams.toString());
    router.replace(`/manga/search?${params.toString()}`);
  }, [router, searchParams]);

  useEffect(() => {
    fetch('/api/manga/sources')
      .then((res) => res.json())
      .then((data) => {
        const nextSources = data.sources || [];
        setSources(nextSources);
        setSourceId((prev) => prev || nextSources[0]?.id || '');
      })
      .catch(() => undefined)
      .finally(() => setSourcesLoading(false));

    getAllMangaShelf()
      .then(setShelf)
      .catch(() => undefined);

    getAllMangaReadRecords()
      .then((records) =>
        setReadRecords(
          Object.values(records).sort((a, b) => b.saveTime - a.saveTime)
        )
      )
      .catch(() => undefined);
  }, []);

  const fetchRecommend = useCallback(
    async (nextPage: number, append: boolean) => {
      if (!sourceId) return;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError('');
      }

      try {
        const params = new URLSearchParams({
          sourceId,
          type: recommendType,
          page: String(nextPage),
        });
        const res = await fetch(`/api/manga/recommend?${params.toString()}`);
        const data = (await res.json()) as MangaRecommendResult & {
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || '获取推荐失败');

        setPage(nextPage);
        setResult((prev) => ({
          mangas: append ? [...prev.mangas, ...data.mangas] : data.mangas,
          hasNextPage: data.hasNextPage,
        }));
      } catch (err) {
        setError((err as Error).message);
        if (!append) {
          setResult({ mangas: [], hasNextPage: false });
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        if (!append) setRecommendSettled(true);
      }
    },
    [recommendType, sourceId]
  );

  useEffect(() => {
    if (!sourceId) return;
    setRecommendSettled(false);
    void fetchRecommend(1, false);
  }, [fetchRecommend, sourceId]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || loading || loadingMore || !result.hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          !entry?.isIntersecting ||
          loadingMore ||
          loading ||
          !result.hasNextPage
        )
          return;
        void fetchRecommend(page + 1, true);
      },
      {
        rootMargin: '240px 0px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchRecommend, loading, loadingMore, page, result.hasNextPage]);

  const recommendOptions = useMemo(
    () => [
      {
        label: '热门',
        value: 'POPULAR',
        icon: <Flame className='h-3.5 w-3.5' />,
      },
      {
        label: '最新',
        value: 'LATEST',
        icon: <Sparkles className='h-3.5 w-3.5' />,
      },
    ],
    []
  );

  const toggleShelf = async (item: MangaSearchItem) => {
    const key = `${item.sourceId}+${item.id}`;
    if (shelf[key]) {
      await deleteMangaShelf(item.sourceId, item.id);
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
      mangaId: item.id,
      saveTime: Date.now(),
      description: item.description,
      author: item.author,
      status: item.status,
    };
    await saveMangaShelf(item.sourceId, item.id, shelfItem);
    setShelf((prev) => ({ ...prev, [key]: shelfItem }));
  };

  const badge = recommendType === 'POPULAR' ? '热门' : '最新';

  // 首屏：书源还在路上，或已经有源但推荐请求还没落定——都还没到能断言"没有内容"的时候。
  const booting =
    sourcesLoading || loading || (Boolean(sourceId) && !recommendSettled);

  const currentRecord = readRecords[0];
  // 顶部「正在读」大卡已经摊开第一本，这里只列其余的，避免同一本重复出现。
  const recentRecords = readRecords.slice(1, 13);

  return (
    <div className='space-y-8'>
      {currentRecord ? (
        <ContinueReadingCard
          title={currentRecord.title}
          image={currentRecord.cover}
          meta={readRecordMeta(currentRecord)}
          progress={readRecordProgress(currentRecord)}
          href={buildReadHref(currentRecord, '/manga')}
        />
      ) : null}

      {recentRecords.length > 0 ? (
        <MediaRail title='最近在读'>
          {recentRecords.map((record) => (
            <div
              key={`${record.sourceId}+${record.mangaId}`}
              className={BOOK_RAIL_ITEM}
            >
              <MediaCard
                item={{
                  key: `${record.sourceId}+${record.mangaId}`,
                  title: record.title,
                  image: record.cover,
                }}
                href={buildReadHref(record, '/manga')}
              />
            </div>
          ))}
        </MediaRail>
      ) : null}

      {sources.length > 0 ? (
        <section className='space-y-3'>
          <div className='flex flex-nowrap gap-1 overflow-x-auto border-b border-library-edge [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-library-night-edge'>
            {sources.map((source) => (
              <button
                key={source.id}
                type='button'
                onClick={() => setSourceId(source.id)}
                aria-pressed={source.id === sourceId}
                className={`${SPINE_TAB} ${
                  source.id === sourceId ? SPINE_TAB_ACTIVE : SPINE_TAB_IDLE
                }`}
              >
                {source.displayName || source.name}
              </button>
            ))}
          </div>
          <div className='flex flex-nowrap gap-1 border-b border-library-edge dark:border-library-night-edge'>
            {recommendOptions.map((option) => (
              <button
                key={option.value}
                type='button'
                onClick={() =>
                  setRecommendType(option.value as MangaRecommendType)
                }
                aria-pressed={option.value === recommendType}
                className={`${SPINE_TAB} inline-flex items-center gap-1.5 ${
                  option.value === recommendType
                    ? SPINE_TAB_ACTIVE
                    : SPINE_TAB_IDLE
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className='space-y-4'>
        <MediaSectionHeader title='书库' subtitle={`按 ${badge} 排序`} />

        {error ? (
          <EmptyState tone='error' description={error} />
        ) : booting ? (
          <MediaGridSkeleton count={18} className={WALL_CLASS} />
        ) : result.mangas.length === 0 ? (
          <EmptyState
            icon={<Compass className='h-7 w-7' />}
            title={sourceId ? '这个源暂时没有推荐' : '暂时没有漫画'}
            description={
              sourceId
                ? '换一个漫画源，或稍后再试。'
                : '稍后再来看看。'
            }
          />
        ) : (
          <>
            <MediaGrid className={WALL_CLASS}>
              {result.mangas.map((item) => {
                const key = `${item.sourceId}+${item.id}`;
                return (
                  <MediaCard
                    key={key}
                    item={{
                      // 墙上的书只留封面与书名：排序已在标题里说明，逐张挂"热门"角标
                      // 在 8 列书墙上只是噪音。
                      ...mangaCardItem(item),
                      badge: undefined,
                      meta: undefined,
                      subtitle: undefined,
                    }}
                    href={buildDetailHref({
                      id: item.id,
                      sourceId: item.sourceId,
                      title: item.title,
                      cover: item.cover,
                      sourceName: item.sourceName,
                      returnTo: '/manga',
                    })}
                    overlayAction={
                      <ShelfChipButton
                        active={Boolean(shelf[key])}
                        onClick={() => toggleShelf(item)}
                      />
                    }
                  />
                );
              })}
            </MediaGrid>

            <div
              ref={loadMoreRef}
              className='flex min-h-10 items-center justify-center text-sm text-library-muted dark:text-library-night-muted'
            >
              {loadingMore
                ? '正在加载更多...'
                : result.hasNextPage
                ? '继续下滑加载更多'
                : '没有更多了'}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
