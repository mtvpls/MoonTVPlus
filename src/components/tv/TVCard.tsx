'use client';

import { Ban, Play, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { isTVRemoteMenuKey } from '@/lib/tv-remote-core';
import { processImageUrl } from '@/lib/utils';

import { TVItem } from './types';

export type TVCardMenuHandler = (
  item: TVItem,
  trigger: HTMLButtonElement,
  openingEvent?: KeyboardEvent
) => void;

export default function TVCard({
  item,
  onMenu,
}: {
  item: TVItem;
  onMenu?: TVCardMenuHandler;
}) {
  const router = useRouter();
  const poster = item.poster ? processImageUrl(item.poster) : '';
  const rating = !!item.rate && /^\d+(\.\d+)?$/.test(item.rate);
  const progress = item.rate?.endsWith('%')
    ? Math.min(100, Math.max(0, parseFloat(item.rate)))
    : null;
  const metadata = [
    item.year,
    item.origin === 'live'
      ? '直播'
      : item.type === 'movie'
      ? '电影'
      : item.type === 'tv'
      ? '剧集'
      : '',
    !rating && item.rate
      ? progress !== null
        ? `已看 ${item.rate}`
        : item.rate
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const playUrl =
    item.href ||
    `/tv/detail?title=${encodeURIComponent(item.title)}${
      item.year ? `&year=${encodeURIComponent(item.year)}` : ''
    }${item.type ? `&stype=${item.type}` : ''}`;

  return (
    <button
      type='button'
      aria-label={item.isInvalid ? `${item.title}，已失效` : item.title}
      disabled={item.isInvalid}
      data-tv-record-key={onMenu ? item.id : undefined}
      aria-haspopup={onMenu ? 'dialog' : undefined}
      onClick={() => {
        if (!item.isInvalid) router.push(playUrl);
      }}
      onKeyDown={(event) => {
        if (!onMenu || !isTVRemoteMenuKey(event.nativeEvent)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) onMenu(item, event.currentTarget, event.nativeEvent);
      }}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onMenu(item, event.currentTarget);
      }}
      className={`tv-focusable group w-44 shrink-0 rounded-2xl p-2 text-left outline-none lg:w-52 2xl:w-56 ${
        item.isInvalid
          ? 'cursor-not-allowed'
          : 'cursor-pointer hover:bg-[#232325] focus:bg-[#232325]'
      }`}
    >
      <div className='relative aspect-[2/3] overflow-hidden rounded-lg bg-[#232325]'>
        {item.currentEpisode != null && item.totalEpisodes != null && (
          <span
            aria-label={`第 ${item.currentEpisode} 集，共 ${item.totalEpisodes} 集`}
            className='absolute right-2 top-2 z-10 rounded bg-black/80 px-2 py-1 text-base font-medium tabular-nums text-white'
          >
            {item.currentEpisode}/{item.totalEpisodes}
          </span>
        )}
        {poster ? (
          <img
            src={poster}
            alt={item.title}
            className='h-full w-full object-cover'
          />
        ) : (
          <div className='flex h-full w-full items-center justify-center text-[#8d8d93]'>
            {!item.isInvalid && (
              <Play className='h-12 w-12' strokeWidth={1.5} aria-hidden='true' />
            )}
          </div>
        )}
        {item.isInvalid && (
          <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-[#ededed]'>
            <Ban className='h-12 w-12' strokeWidth={1.5} aria-hidden='true' />
            <span className='text-xl font-medium'>已失效</span>
          </div>
        )}
        {progress !== null && Number.isFinite(progress) && (
          <div
            role='progressbar'
            aria-label='观看进度'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className='absolute inset-x-0 bottom-0 h-1 bg-black/60'
          >
            <div
              className='h-full bg-[#ededed]'
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
      <h3 className='mt-3 line-clamp-1 text-xl font-medium leading-7 text-[#ededed]'>
        {item.title}
      </h3>
      <div className='mt-1 flex min-h-6 items-center justify-between gap-2 text-base text-[#a1a1a6] lg:text-lg'>
        <p className='truncate'>{metadata}</p>
        {rating && (
          <span
            className='inline-flex shrink-0 items-center gap-1 tabular-nums'
            aria-label={`评分 ${item.rate}`}
          >
            <Star
              className='h-[18px] w-[18px]'
              strokeWidth={1.5}
              aria-hidden='true'
            />
            {item.rate}
          </span>
        )}
      </div>
    </button>
  );
}
