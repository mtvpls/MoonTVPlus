/* eslint-disable no-console */
'use client';

import { AlertTriangle, ChevronRight, History, Play } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import dashboard from '@/components/home/HomeDashboard.module.css';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import PlayRecordsPanel from '@/components/PlayRecordsPanel';
import ProxyImage from '@/components/ProxyImage';
import VideoCard from '@/components/VideoCard';
import VirtualScrollableRow from '@/components/VirtualScrollableRow';

interface ContinueWatchingProps {
  className?: string;
  variant?: 'row' | 'dashboard';
}

type PlayRecordItem = PlayRecord & { key: string };

const DASHBOARD_HISTORY_LIMIT = 10;

export default function ContinueWatching({
  className,
  variant = 'row',
}: ContinueWatchingProps) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const displayLimit =
    variant === 'dashboard' ? DASHBOARD_HISTORY_LIMIT : undefined;
  const cachedDisplayLimit =
    displayLimit ?? (storageType !== 'localstorage' ? 10 : undefined);
  const [playRecords, setPlayRecords] = useState<PlayRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPlayRecordsPanel, setShowPlayRecordsPanel] = useState(false);

  useEffect(() => {
    let active = true;
    const updatePlayRecords = (
      allRecords: Record<string, PlayRecord>,
      limit = displayLimit
    ) => {
      if (!active) return;
      const sortedRecords = Object.entries(allRecords)
        .map(([key, record]) => ({ ...record, key }))
        .sort((a, b) => b.save_time - a.save_time);
      // Limit only the dashboard preview, never the source cache or full panel.
      setPlayRecords(limit ? sortedRecords.slice(0, limit) : sortedRecords);
    };

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        if (!active) return;
        updatePlayRecords(newRecords);
        setLoading(false);
      }
    );

    const fetchPlayRecords = async () => {
      try {
        const cachedRecords = getCachedPlayRecordsSnapshot();
        if (Object.keys(cachedRecords).length > 0) {
          updatePlayRecords(cachedRecords, cachedDisplayLimit);
          setLoading(false);
        } else {
          setLoading(true);
        }

        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        if (!active) return;
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchPlayRecords();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [cachedDisplayLimit, displayLimit]);

  if (variant !== 'dashboard' && !loading && playRecords.length === 0) {
    return null;
  }

  const getProgress = (record: PlayRecord) => {
    if (
      !Number.isFinite(record.total_time) ||
      record.total_time <= 0 ||
      !Number.isFinite(record.play_time)
    )
      return 0;
    return Math.min(
      100,
      Math.max(0, (record.play_time / record.total_time) * 100)
    );
  };

  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  const getResumeHref = (record: PlayRecordItem) => {
    const { source, id } = parseKey(record.key);
    if (record.origin === 'live') {
      return `/live?${new URLSearchParams({
        source: source.replace(/^live_/, ''),
        id: (id || '').replace(/^live_/, ''),
      })}`;
    }
    const params = new URLSearchParams({
      source,
      id: id || '',
      title: record.title,
    });
    if (record.year) params.set('year', record.year);
    if (record.search_title) params.set('stitle', record.search_title);
    if (record.total_episodes > 1) params.set('stype', 'tv');
    return `/play?${params}`;
  };

  const handleClearConfirm = async () => {
    await clearAllPlayRecords();
    setPlayRecords([]);
    setShowConfirmDialog(false);
  };

  return (
    <>
      {variant === 'dashboard' ? (
        <section
          className={`${dashboard.panel} ${dashboard.historyPanel} ${
            className || ''
          }`}
          aria-labelledby='home-history-title'
          aria-busy={loading}
        >
          <div className={dashboard.panelHeader}>
            <h2 id='home-history-title' className={dashboard.panelTitle}>
              <History aria-hidden='true' />
              观看记录
            </h2>
            <button
              type='button'
              className={dashboard.textAction}
              onClick={() => setShowPlayRecordsPanel(true)}
              aria-label='查看全部播放记录'
            >
              查看全部
              <ChevronRight aria-hidden='true' />
            </button>
          </div>
          <p className={dashboard.subtitle}>继续上次的精彩</p>
          {loading ? (
            <div
              className={dashboard.historyList}
              role='status'
              aria-label='正在加载观看记录'
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className={dashboard.historySkeleton}
                  aria-hidden='true'
                >
                  <div
                    className={`${dashboard.skeleton} ${dashboard.skeletonThumb}`}
                  />
                  <div>
                    <div
                      className={`${dashboard.skeleton} ${dashboard.skeletonText}`}
                    />
                    <div
                      className={`${dashboard.skeleton} ${dashboard.skeletonText}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : playRecords.length === 0 ? (
            <div className={dashboard.emptyHistory}>
              <History aria-hidden='true' />
              <strong>还没有观看记录</strong>
              <span>开始一部好片，下次从这里接着看。</span>
              <Link href='/search'>去找一部想看的影片</Link>
            </div>
          ) : (
            <div
              className={dashboard.historyList}
              role='region'
              aria-label='最近观看记录'
              tabIndex={0}
            >
              {playRecords.slice(0, DASHBOARD_HISTORY_LIMIT).map((record) => {
                const progress = getProgress(record);
                const category =
                  record.origin === 'live'
                    ? '直播'
                    : record.is_anime
                    ? '动画'
                    : record.total_episodes > 1
                    ? '剧集'
                    : '电影';
                const runtime =
                  record.total_episodes > 1
                    ? `第${record.index}集`
                    : record.total_time > 0
                    ? `${
                        Math.floor(record.total_time / 3600)
                          ? `${Math.floor(record.total_time / 3600)}小时`
                          : ''
                      }${Math.floor(record.total_time / 60) % 60}分`
                    : '';
                return (
                  <Link
                    key={record.key}
                    href={getResumeHref(record)}
                    prefetch={false}
                    className={dashboard.historyItem}
                    aria-label={`继续观看${record.title}`}
                  >
                    {record.cover ? (
                      <ProxyImage
                        originalSrc={record.cover}
                        alt=''
                        className={dashboard.historyImage}
                      />
                    ) : (
                      <div className={dashboard.historyImage} />
                    )}
                    <div className={dashboard.historyCopy}>
                      <span
                        className={dashboard.historyName}
                        title={record.title}
                      >
                        {record.title}
                      </span>
                      <span className={dashboard.historyMeta}>
                        {[category, record.year, runtime]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <div className={dashboard.progressLine}>
                        <div
                          className={dashboard.progressTrack}
                          role='progressbar'
                          aria-label={`${record.title}观看进度`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(progress)}
                        >
                          <span
                            className={dashboard.progressValue}
                            style={{ transform: `scaleX(${progress / 100})` }}
                          />
                        </div>
                        <span className={dashboard.progressText}>
                          {Math.round(progress)}%
                        </span>
                      </div>
                    </div>
                    <span className={dashboard.resumeIcon}>
                      <Play aria-hidden='true' />
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section
          className={`mb-8 rounded-2xl border border-slate-200/80 bg-white/70 p-4 text-slate-900 sm:p-6 dark:border-slate-700/50 dark:bg-[#081a2d]/75 dark:text-slate-100 ${
            className || ''
          }`}
          aria-labelledby='home-history-title'
          aria-busy={loading}
        >
          <div className='mb-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1'>
            <h2
              id='home-history-title'
              className='flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl'
            >
              <History
                className='h-5 w-5 text-emerald-700 dark:text-emerald-300'
                aria-hidden='true'
              />
              观看记录
            </h2>
            {!loading && playRecords.length > 0 && (
              <div className='flex items-center gap-1'>
                <button
                  type='button'
                  className='min-h-11 rounded-lg px-3 text-xs text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300'
                  onClick={() => setShowConfirmDialog(true)}
                  aria-label='清空播放记录'
                >
                  清空
                </button>
                <button
                  type='button'
                  className='inline-flex min-h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-emerald-300'
                  onClick={() => setShowPlayRecordsPanel(true)}
                  aria-label='查看全部播放记录'
                >
                  全部记录
                  <ChevronRight className='h-4 w-4' aria-hidden='true' />
                </button>
              </div>
            )}
          </div>
          {loading ? (
            <div className='flex gap-2 overflow-x-auto scrollbar-hide pb-2 pt-2'>
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className='min-w-[180px] w-48 sm:min-w-[200px] sm:w-52'
                >
                  <div className='relative aspect-[3/2] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                    <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700' />
                  </div>
                  <div className='mt-1 h-1 rounded bg-gray-200 animate-pulse dark:bg-gray-800' />
                  <div className='mt-2 h-4 w-3/4 rounded bg-gray-200 animate-pulse dark:bg-gray-800' />
                </div>
              ))}
            </div>
          ) : (
            <div>
              <VirtualScrollableRow>
                {playRecords.map((record) => {
                  const { source, id } = parseKey(record.key);
                  return (
                    <div
                      key={record.key}
                      className='min-w-[180px] w-48 sm:min-w-[200px] sm:w-52'
                      style={{ position: 'relative' }}
                    >
                      <VideoCard
                        id={id}
                        title={record.title}
                        poster={record.cover}
                        year={record.year}
                        source={source}
                        source_name={record.source_name}
                        progress={getProgress(record)}
                        episodes={record.total_episodes}
                        currentEpisode={record.index}
                        query={record.search_title}
                        from='playrecord'
                        onDelete={() =>
                          setPlayRecords((prev) =>
                            prev.filter((item) => item.key !== record.key)
                          )
                        }
                        type={record.total_episodes > 1 ? 'tv' : ''}
                        origin={record.origin}
                        orientation='horizontal'
                        playTime={record.play_time}
                        totalTime={record.total_time}
                        isAnime={Boolean(record.is_anime)}
                      />
                      {record.new_episodes && record.new_episodes > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '-6px',
                            right: '-6px',
                            zIndex: 100,
                            pointerEvents: 'none',
                            width: '28px',
                            height: '28px',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              inset: '0',
                              borderRadius: '9999px',
                              backgroundColor: 'rgb(14 165 233)',
                              animation:
                                'ping-scale 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                            }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              inset: '0',
                              borderRadius: '9999px',
                              backgroundColor: 'rgb(14 165 233)',
                              animation:
                                'pulse-scale 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                            }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              inset: '0',
                              borderRadius: '9999px',
                              background:
                                'linear-gradient(to bottom right, rgb(14 165 233), rgb(2 132 199))',
                              color: 'white',
                              fontSize: '11px',
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow:
                                '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                              animation: 'badge-scale 2s ease-in-out infinite',
                            }}
                          >
                            +{record.new_episodes}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </VirtualScrollableRow>
            </div>
          )}
        </section>
      )}

      {showConfirmDialog &&
        createPortal(
          <div
            className='fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 p-4 transition-opacity duration-300'
            onClick={() => setShowConfirmDialog(false)}
          >
            <div
              className='max-w-md w-full rounded-lg border border-red-200 bg-white shadow-xl transition-all duration-300 dark:border-red-800 dark:bg-gray-800'
              onClick={(event) => event.stopPropagation()}
            >
              <div className='p-6'>
                <div className='mb-4 flex items-start gap-4'>
                  <div className='flex-shrink-0'>
                    <AlertTriangle className='h-8 w-8 text-red-500' />
                  </div>
                  <div className='flex-1'>
                    <h3 className='mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100'>
                      清空播放记录
                    </h3>
                    <p className='text-sm text-gray-600 dark:text-gray-400'>
                      确定要清空所有播放记录吗？此操作不可恢复。
                    </p>
                  </div>
                </div>

                <div className='mt-6 flex gap-3'>
                  <button
                    onClick={() => setShowConfirmDialog(false)}
                    className='flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  >
                    取消
                  </button>
                  <button
                    onClick={handleClearConfirm}
                    className='flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700'
                  >
                    确定清空
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showPlayRecordsPanel &&
        createPortal(
          <PlayRecordsPanel
            isOpen={showPlayRecordsPanel}
            onClose={() => setShowPlayRecordsPanel(false)}
          />,
          document.body
        )}
    </>
  );
}
