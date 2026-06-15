'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  Favorite,
  getAllFavorites,
  getAllPlayRecords,
  PlayRecord,
} from '@/lib/db.client';

import TVLayout from '@/components/tv/TVLayout';
import TVRow from '@/components/tv/TVRow';
import { TVItem, TVSection } from '@/components/tv/types';

async function loadDouban(kind: 'movie' | 'tv', tag: string, type: TVItem['type']): Promise<TVItem[]> {
  const res = await fetch(`/api/douban?type=${kind}&tag=${encodeURIComponent(tag)}&pageSize=12`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.list || []).map((item: TVItem) => ({ ...item, type }));
}

function hrefFromKey(key: string, item: { title: string; year?: string; origin?: 'vod' | 'live' }) {
  const plus = key.indexOf('+');
  if (plus > 0) {
    const source = key.slice(0, plus);
    const id = key.slice(plus + 1);
    if (item.origin === 'live') {
      return `/tv/live/play?source=${encodeURIComponent(source.replace(/^live_/, ''))}&id=${encodeURIComponent(id.replace(/^live_/, ''))}`;
    }
    return `/tv/play?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(item.title)}`;
  }
  return `/tv/play?title=${encodeURIComponent(item.title)}${item.year ? `&year=${encodeURIComponent(item.year)}` : ''}`;
}

function recordToItem([key, record]: [string, PlayRecord]): TVItem {
  return {
    id: key,
    title: record.title,
    poster: record.cover,
    year: record.year || `${record.index + 1}/${record.total_episodes || 1}`,
    rate: record.total_time ? `${Math.max(1, Math.round((record.play_time / record.total_time) * 100))}%` : '继续',
    href: hrefFromKey(key, record),
  };
}

function favoriteToItem([key, favorite]: [string, Favorite]): TVItem {
  return {
    id: key,
    title: favorite.title,
    poster: favorite.cover,
    year: favorite.year,
    rate: '收藏',
    href: hrefFromKey(key, favorite),
  };
}

export default function TVHomeClient() {
  const [sections, setSections] = useState<TVSection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      const [records, favorites, hotMovies, hotSeries, anime, variety] = await Promise.all([
        getAllPlayRecords().catch(() => ({})),
        getAllFavorites().catch(() => ({})),
        loadDouban('movie', '热门', 'movie'),
        loadDouban('tv', '热门', 'tv'),
        loadDouban('tv', '动画', 'tv'),
        loadDouban('tv', '综艺', 'tv'),
      ]);
      if (!alive) return;

      const playItems = Object.entries(records)
        .sort((a, b) => (b[1].save_time || 0) - (a[1].save_time || 0))
        .slice(0, 20)
        .map(recordToItem);
      const favoriteItems = Object.entries(favorites)
        .sort((a, b) => (b[1].save_time || 0) - (a[1].save_time || 0))
        .slice(0, 20)
        .map(favoriteToItem);

      const next: TVSection[] = [
        { title: '继续观看', subtitle: '最近 20 条播放记录', items: playItems },
        { title: '我的收藏', subtitle: '最近收藏的内容', items: favoriteItems },
        { title: '热门电影', subtitle: '今晚就看这些高热影片', href: '/tv/movie', items: hotMovies },
        { title: '热门剧集', subtitle: '连续播放更适合电视', href: '/tv/series', items: hotSeries },
        { title: '动漫推荐', subtitle: '新番与经典动画', href: '/tv/anime', items: anime },
        { title: '综艺推荐', subtitle: '轻松下饭大屏看', href: '/tv/variety', items: variety },
      ].filter((section) => section.items.length > 0);

      setSections(next);
      setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, []);

  const empty = useMemo(() => !loading && sections.length === 0, [loading, sections.length]);

  return (
    <TVLayout>
      {loading ? (
        <div className='mt-16 flex items-center justify-center gap-4 text-2xl text-slate-300'>
          <Loader2 className='h-8 w-8 animate-spin' /> 正在加载电视首页...
        </div>
      ) : empty ? (
        <div className='rounded-[36px] border border-white/10 bg-white/[0.04] p-10 text-2xl text-slate-300'>暂无首页内容</div>
      ) : (
        sections.map((section) => <TVRow key={section.title} section={section} />)
      )}
    </TVLayout>
  );
}
