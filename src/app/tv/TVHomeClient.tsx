'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deletePlayRecords,
  Favorite,
  getAllFavorites,
  getAllPlayRecords,
  PlayRecord,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import { TVCardMenuHandler } from '@/components/tv/TVCard';
import TVLayout from '@/components/tv/TVLayout';
import TVRecordMenu from '@/components/tv/TVRecordMenu';
import TVRow from '@/components/tv/TVRow';
import { TVItem, TVSection } from '@/components/tv/types';

async function loadDouban(
  kind: 'movie' | 'tv',
  tag: string,
  type: TVItem['type']
): Promise<TVItem[]> {
  const res = await fetch(
    `/api/douban?type=${kind}&tag=${encodeURIComponent(tag)}&pageSize=12`,
    { cache: 'no-store' }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.list || []).map((item: TVItem) => ({ ...item, type }));
}

function hrefFromKey(
  key: string,
  item: { title: string; year?: string; origin?: 'vod' | 'live' },
  page: 'play' | 'detail' = 'play'
) {
  const plus = key.indexOf('+');
  if (plus > 0) {
    const source = key.slice(0, plus);
    const id = key.slice(plus + 1);
    if (item.origin === 'live') {
      return `/tv/live/play?source=${encodeURIComponent(
        source.replace(/^live_/, '')
      )}&id=${encodeURIComponent(id.replace(/^live_/, ''))}`;
    }
    return `/tv/${page}?source=${encodeURIComponent(
      source
    )}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(item.title)}${
      item.year ? `&year=${encodeURIComponent(item.year)}` : ''
    }`;
  }
  return `/tv/${page}?title=${encodeURIComponent(item.title)}${
    item.year ? `&year=${encodeURIComponent(item.year)}` : ''
  }`;
}

function recordToItem([key, record]: [string, PlayRecord]): TVItem {
  const currentEpisode = Math.max(1, record.index + 1);
  return {
    id: key,
    title: record.title,
    poster: record.cover,
    year: record.year,
    ...(record.origin !== 'live' && {
      currentEpisode,
      totalEpisodes: Math.max(currentEpisode, record.total_episodes || 1),
    }),
    origin: record.origin,
    rate: record.total_time
      ? `${Math.max(
          1,
          Math.round((record.play_time / record.total_time) * 100)
        )}%`
      : '继续',
    href: hrefFromKey(key, record),
    detailHref: hrefFromKey(key, record, 'detail'),
  };
}

function recordsToItems(records: Record<string, PlayRecord>): TVItem[] {
  return Object.entries(records)
    .sort((a, b) => (b[1].save_time || 0) - (a[1].save_time || 0))
    .slice(0, 20)
    .map(recordToItem);
}

function favoriteToItem([key, favorite]: [string, Favorite]): TVItem {
  return {
    id: key,
    title: favorite.title,
    poster: favorite.cover,
    year: favorite.year,
    rate: favorite.is_invalid ? undefined : '收藏',
    isInvalid: favorite.is_invalid,
    href: favorite.is_invalid ? undefined : hrefFromKey(key, favorite),
  };
}

export default function TVHomeClient() {
  const [sections, setSections] = useState<TVSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordMenu, setRecordMenu] = useState<{
    item: TVItem;
    trigger: HTMLButtonElement;
    neighbors: HTMLButtonElement[];
    openingEvent?: KeyboardEvent;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    let latestRecords: Record<string, PlayRecord> | null = null;
    const unsubscribe = subscribeToDataUpdates<Record<string, PlayRecord>>(
      'playRecordsUpdated',
      (records) => {
        if (!alive) return;
        latestRecords = records;
        setSections((current) =>
          [
            {
              title: '继续观看',
              subtitle: '最近 20 条播放记录',
              items: recordsToItems(records),
            },
            ...current.filter((section) => section.title !== '继续观看'),
          ].filter((section) => section.items.length > 0)
        );
      }
    );
    async function load() {
      setLoading(true);
      const [records, favorites, hotMovies, hotSeries, anime, variety] =
        await Promise.all([
          getAllPlayRecords().catch(() => ({})),
          getAllFavorites().catch(() => ({})),
          loadDouban('movie', '热门', 'movie').catch(() => []),
          loadDouban('tv', '热门', 'tv').catch(() => []),
          loadDouban('tv', '动画', 'tv').catch(() => []),
          loadDouban('tv', '综艺', 'tv').catch(() => []),
        ]);
      if (!alive) return;

      const playItems = recordsToItems(latestRecords || records);
      const favoriteItems = Object.entries(favorites)
        .sort((a, b) => (b[1].save_time || 0) - (a[1].save_time || 0))
        .slice(0, 20)
        .map(favoriteToItem);

      const next: TVSection[] = [
        { title: '继续观看', subtitle: '最近 20 条播放记录', items: playItems },
        { title: '我的收藏', subtitle: '最近收藏的内容', items: favoriteItems },
        {
          title: '热门电影',
          subtitle: '豆瓣热门影片',
          href: '/tv/movie',
          items: hotMovies,
        },
        {
          title: '热门剧集',
          subtitle: '豆瓣热门剧集',
          href: '/tv/series',
          items: hotSeries,
        },
        {
          title: '动漫推荐',
          subtitle: '新番与经典动画',
          href: '/tv/anime',
          items: anime,
        },
        {
          title: '综艺推荐',
          subtitle: '热门综艺节目',
          href: '/tv/variety',
          items: variety,
        },
      ].filter((section) => section.items.length > 0);

      setSections(next);
      setLoading(false);
    }
    load();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const openRecordMenu = useCallback<TVCardMenuHandler>(
    (item, trigger, openingEvent) => {
      const cards = Array.from(
        trigger
          .closest('[data-tv-focus-row]')
          ?.querySelectorAll<HTMLButtonElement>('[data-tv-record-key]') || []
      );
      const index = cards.indexOf(trigger);
      setRecordMenu({
        item,
        trigger,
        neighbors: [
          ...cards.slice(index + 1),
          ...cards.slice(0, index).reverse(),
        ],
        openingEvent,
      });
    },
    []
  );

  const closeRecordMenu = useCallback(
    (restoreFocus = true) => {
      setRecordMenu(null);
      if (!restoreFocus || !recordMenu) return;
      window.requestAnimationFrame(() => {
        const target =
          [recordMenu.trigger, ...recordMenu.neighbors].find(
            (element) => element.isConnected
          ) ||
          document.querySelector<HTMLElement>(
            '[data-tv-focus-row="horizontal"] button'
          ) ||
          document.querySelector<HTMLElement>('[data-tv-home-nav="true"]');
        target?.focus({ preventScroll: true });
        if (target && !target.closest('header')) {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    },
    [recordMenu]
  );

  const removeRecord = async (item: TVItem) => {
    await deletePlayRecords([item.id]);
    setSections((current) =>
      current
        .map((section) =>
          section.title === '继续观看'
            ? {
                ...section,
                items: section.items.filter((record) => record.id !== item.id),
              }
            : section
        )
        .filter((section) => section.items.length > 0)
    );
  };

  const empty = useMemo(
    () => !loading && sections.length === 0,
    [loading, sections.length]
  );

  return (
    <TVLayout>
      {loading ? (
        <div
          role='status'
          className='mt-12 flex items-center justify-center gap-3 text-xl text-[#a1a1a6]'
        >
          <Loader2
            className='h-6 w-6 animate-spin motion-reduce:animate-none'
            strokeWidth={1.5}
            aria-hidden='true'
          />{' '}
          正在加载影片
        </div>
      ) : empty ? (
        <div
          role='status'
          className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-8 text-xl text-[#a1a1a6]'
        >
          暂无首页内容，可以使用搜索选片
        </div>
      ) : (
        sections.map((section) => (
          <TVRow
            key={section.title}
            section={section}
            onItemMenu={
              section.title === '继续观看' ? openRecordMenu : undefined
            }
          />
        ))
      )}
      {recordMenu && (
        <TVRecordMenu
          key={recordMenu.item.id}
          item={recordMenu.item}
          openingEvent={recordMenu.openingEvent}
          onClose={closeRecordMenu}
          onDelete={() => removeRecord(recordMenu.item)}
        />
      )}
    </TVLayout>
  );
}
