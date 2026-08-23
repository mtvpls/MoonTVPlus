/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import { useEffect, useState } from 'react';

import {
  BangumiScheduleData,
  BangumiScheduleItem,
  GetBangumiScheduleData,
} from '@/lib/bangumi.client';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import VideoCard from '@/components/VideoCard';

/** 时刻表加载骨架：模拟时间轴结构（时间标签 + 节点 + 横向卡片条） */
function TimelineSkeleton() {
  const SKELETON_SLOTS = ['00:00', '19:30', '21:00', '23:00'];
  const SKELETON_ITEMS = [3, 2, 2, 1];

  return (
    <div className='space-y-6 animate-pulse'>
      {/* 标题占位 */}
      <div className='flex items-baseline gap-2'>
        <div className='h-5 w-16 bg-gray-200 rounded dark:bg-gray-700' />
        <div className='h-3 w-20 bg-gray-200 rounded dark:bg-gray-700' />
      </div>

      <div className='relative'>
        {/* 垂直主线 */}
        <div className='absolute left-[5.25rem] sm:left-[5.5rem] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700' />

        <div className='space-y-6'>
          {SKELETON_SLOTS.map((time, i) => (
            <div
              key={time}
              className='relative grid grid-cols-[4.5rem_1.5rem_1fr] sm:grid-cols-[5rem_1.5rem_1fr] items-start'
            >
              {/* 时间标签占位 */}
              <div className='text-right pr-3 leading-[1.875rem]'>
                <div className='ml-auto h-3 w-9 bg-gray-200 rounded dark:bg-gray-700' />
              </div>
              {/* 时间节点占位 */}
              <div className='flex justify-center pt-1.5'>
                <span className='w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600' />
              </div>
              {/* 横向卡片条占位 */}
              <div className='flex gap-3 overflow-hidden'>
                {Array.from({ length: SKELETON_ITEMS[i] }, (_, j) => (
                  <div key={j} className='w-32 sm:w-40 shrink-0'>
                    <div className='relative w-full rounded-lg bg-transparent flex flex-col'>
                      <ImagePlaceholder aspectRatio='aspect-[2/3]' />
                      <div className='absolute top-[calc(100%+0.5rem)] left-0 right-0 flex justify-center'>
                        <div className='h-4 w-24 sm:w-32 bg-gray-200 rounded dark:bg-gray-700'></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 挑选一张可用的海报 URL（优先级从大到小） */
function pickPoster(item: BangumiScheduleItem): string {
  const img = item.images;
  if (!img) return '';
  return (
    img.large ||
    img.common ||
    img.medium ||
    img.small ||
    img.grid ||
    ''
  );
}

/** 单条时刻表条目：固定宽度 + 复用 VideoCard（与网格卡片行为一致） */
function TimelineVideoCard({ item }: { item: BangumiScheduleItem }) {
  return (
    <div className='w-32 sm:w-40 shrink-0'>
      <VideoCard
        from='douban'
        title={item.name_cn || item.name}
        poster={pickPoster(item)}
        douban_id={Number(item.id)}
        rate={item.rating}
        year={item.air_date?.split('-')?.[0] || ''}
        isBangumi
        isAnime
      />
    </div>
  );
}

/** 与星期选择器的 value 保持一致：'Mon'..'Sun'，索引即 BGM 星期（0=周一） */
const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface BangumiScheduleTimelineProps {
  /** 当前选中的星期，如 'Mon'；只展示这一天的时刻表 */
  weekday?: string;
}

function BangumiScheduleTimeline({
  weekday = 'Mon',
}: BangumiScheduleTimelineProps) {
  const [data, setData] = useState<BangumiScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    GetBangumiScheduleData()
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error('获取时刻表失败:', err);
        setError('时刻表加载失败，请稍后重试');
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <TimelineSkeleton />;
  }

  if (error) {
    return (
      <div className='flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400'>
        <p className='mb-4'>{error}</p>
        <button
          onClick={load}
          className='px-4 py-2 text-sm rounded-full bg-gray-200/70 hover:bg-gray-300/70 dark:bg-gray-700/60 dark:hover:bg-gray-600/60 transition-colors'
        >
          重新加载
        </button>
      </div>
    );
  }

  if (!data) return null;

  const dayIndex = WEEKDAY_ORDER.indexOf(weekday);
  const day = data.days[dayIndex] ?? data.days[0];
  if (!day) return null;

  // 未知放送时间的条目归属到当天（BGM 有星期、只是没有精确时刻）。
  // 优先用服务端按天分好组的 day.unknown；兼容旧响应退回按 weekday 过滤。
  const dayUnknown = Array.isArray(day.unknown)
    ? day.unknown
    : data.unknown.filter((it) => it.weekday === dayIndex);
  const hasAny = day.slots.length > 0 || dayUnknown.length > 0;

  return (
    <div className='space-y-6'>
      {!hasAny ? (
        <div className='text-center text-gray-500 dark:text-gray-400 py-16'>
          {day.cn}暂无放送安排
        </div>
      ) : (
        <>
          {/* 已知放送时刻：垂直时间轴（仅当天） */}
          <div className='relative'>
            {/* 垂直主线 */}
            <div className='absolute left-[5.25rem] sm:left-[5.5rem] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700' />

            <div className='flex items-baseline gap-2 mb-4'>
              <span className='text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-200'>
                {day.cn}
              </span>
              <span className='text-xs text-gray-400 dark:text-gray-500'>
                {day.en} · 共{' '}
                {day.slots.reduce((n, s) => n + s.items.length, 0) +
                  dayUnknown.length}{' '}
                部
              </span>
            </div>

            {day.slots.length === 0 ? (
              <div className='pl-[6.25rem] sm:pl-[6.5rem] text-xs text-gray-400 dark:text-gray-500'>
                暂无固定放送时刻
              </div>
            ) : (
              <div className='space-y-5'>
                {day.slots.map((slot) => (
                  <div
                    key={slot.time}
                    className='relative grid grid-cols-[4.5rem_1.5rem_1fr] sm:grid-cols-[5rem_1.5rem_1fr] items-start'
                  >
                    {/* 时间标签 */}
                    <div className='text-right pr-3 text-sm font-mono text-gray-500 dark:text-gray-400 leading-[1.875rem]'>
                      {slot.time}
                    </div>
                    {/* 时间节点 */}
                    <div className='relative flex justify-center pt-1.5'>
                      <span className='w-2.5 h-2.5 rounded-full bg-green-500 ring-4 ring-green-500/20' />
                    </div>
                    {/* 同一时间多部番横向排列 */}
                    <div className='flex gap-3 overflow-x-auto pb-1 -mr-2 pr-2'>
                      {slot.items.map((item) => (
                        <TimelineVideoCard key={item.id} item={item} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 该日未知放送时间：与已知时间轴切断开（虚线分隔） */}
          {dayUnknown.length > 0 && (
            <section className='mt-4 border-t-2 border-dashed border-gray-300 dark:border-gray-600 pt-6'>
              <h3 className='flex items-baseline gap-2 mb-5'>
                <span className='text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-200'>
                  未知时间
                </span>
                <span className='text-xs text-gray-400 dark:text-gray-500'>
                  共 {dayUnknown.length} 部
                </span>
              </h3>
              <div className='flex flex-wrap gap-x-3 gap-y-10'>
                {dayUnknown.map((item) => (
                  <TimelineVideoCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default BangumiScheduleTimeline;
