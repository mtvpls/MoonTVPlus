'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';

import TVLayout from '@/components/tv/TVLayout';
import TVRow from '@/components/tv/TVRow';
import { TVItem, TVSection } from '@/components/tv/types';

const weekdayMap: Record<string, string> = {
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六',
  Sun: '周日',
};

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

function bangumiToItem(anime: BangumiCalendarData['items'][number]): TVItem {
  const title = anime.name_cn || anime.name;
  return {
    id: String(anime.id),
    title,
    poster:
      anime.images?.large ||
      anime.images?.common ||
      anime.images?.medium ||
      anime.images?.small ||
      anime.images?.grid ||
      '',
    rate: anime.rating?.score ? anime.rating.score.toFixed(1) : '新番',
    year: anime.air_date?.split('-')?.[0] || '更新中',
    type: 'tv',
    href: `/tv/play?title=${encodeURIComponent(title)}&stype=tv`,
  };
}

export default function TVAnimePage() {
  const [calendar, setCalendar] = useState<BangumiCalendarData[]>([]);
  const [rows, setRows] = useState<TVSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState('');

  useEffect(() => {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    setActiveDay(weekdays[new Date().getDay()]);
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      const [calendarData, hotAnime, jpAnime, cnAnime, animeMovies] =
        await Promise.all([
          GetBangumiCalendarData().catch(() => []),
          loadDouban('tv', '动画', 'tv').catch(() => []),
          loadDouban('tv', '日本动画', 'tv').catch(() => []),
          loadDouban('tv', '国产动画', 'tv').catch(() => []),
          loadDouban('movie', '动画', 'movie').catch(() => []),
        ]);
      if (!alive) return;
      setCalendar(calendarData);
      setRows(
        [
          {
            title: '热门动漫',
            subtitle: '热门动画与新番推荐',
            items: hotAnime,
          },
          {
            title: '日本动画',
            subtitle: '番剧、经典与口碑动画',
            items: jpAnime,
          },
          { title: '国产动画', subtitle: '国创动画专区', items: cnAnime },
          {
            title: '动画电影',
            subtitle: '适合大屏观看的剧场版',
            items: animeMovies,
          },
        ].filter((section) => section.items.length > 0)
      );
      setLoading(false);
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const activeCalendar = useMemo(() => {
    return calendar.find((item) => item.weekday.en === activeDay);
  }, [calendar, activeDay]);

  const activeItems = useMemo(() => {
    return (activeCalendar?.items || [])
      .filter((item) => item.images)
      .map(bangumiToItem);
  }, [activeCalendar]);

  return (
    <TVLayout>
      <section className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6'>
        <h1 className='text-4xl font-medium leading-tight'>动漫更新时间表</h1>
        <p className='mt-2 text-lg leading-7 text-[#a1a1a6] lg:text-xl'>
          按周查看新番放送，左右选择日期
        </p>

        {calendar.length > 0 && (
          <div className='-mx-2 mt-4 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
            <div
              data-tv-focus-row='horizontal'
              aria-label='放送日期'
              className='flex w-max min-w-full gap-3'
            >
              {calendar.map((day) => (
                <button
                  key={day.weekday.en}
                  type='button'
                  aria-pressed={activeDay === day.weekday.en}
                  onClick={() => setActiveDay(day.weekday.en)}
                  className={`tv-focusable flex h-14 min-w-28 shrink-0 cursor-pointer items-center justify-center gap-3 whitespace-nowrap rounded-lg border px-4 text-xl outline-none ${
                    activeDay === day.weekday.en
                      ? 'border-white/10 bg-[#232325] font-medium text-[#ededed]'
                      : 'border-transparent text-[#a1a1a6] hover:bg-[#232325] hover:text-[#ededed]'
                  }`}
                >
                  {weekdayMap[day.weekday.en] || day.weekday.en}
                  <span className='text-lg tabular-nums text-[#a1a1a6]'>
                    {day.items?.length || 0}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {loading ? (
        <div
          role='status'
          className='mt-12 flex items-center justify-center gap-3 text-xl text-[#a1a1a6]'
        >
          <Loader2
            className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
            strokeWidth={1.5}
            aria-hidden='true'
          />
          正在加载动漫内容
        </div>
      ) : (
        <div className='mt-8'>
          {activeItems.length > 0 ? (
            <TVRow
              section={{
                title: `${weekdayMap[activeDay] || activeDay}更新`,
                subtitle: '当天放送的新番',
                items: activeItems,
              }}
            />
          ) : (
            <section>
              <h2 className='text-2xl font-medium lg:text-3xl'>
                {weekdayMap[activeDay] || activeDay}更新
              </h2>
              <p
                role='status'
                className='mt-4 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-xl text-[#a1a1a6]'
              >
                {calendar.length === 0
                  ? '暂时无法获取放送日历'
                  : '当天暂无新番放送'}
              </p>
            </section>
          )}
          {rows.map((section) => (
            <TVRow key={section.title} section={section} />
          ))}
        </div>
      )}
    </TVLayout>
  );
}
