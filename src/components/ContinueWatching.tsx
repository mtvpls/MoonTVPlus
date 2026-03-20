/* eslint-disable no-console */
'use client';

import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import PlayRecordsPanel from '@/components/PlayRecordsPanel';
import VideoCard from '@/components/VideoCard';
import VirtualScrollableRow from '@/components/VirtualScrollableRow';

interface ContinueWatchingProps {
  className?: string;
}

type PlayRecordItem = PlayRecord & { key: string };

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const cachedDisplayLimit = storageType !== 'localstorage' ? 10 : undefined;
  const [playRecords, setPlayRecords] = useState<PlayRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPlayRecordsPanel, setShowPlayRecordsPanel] = useState(false);

  const updatePlayRecords = (
    allRecords: Record<string, PlayRecord>,
    limit?: number
  ) => {
    const recordsArray = Object.entries(allRecords).map(([key, record]) => ({
      ...record,
      key,
    }));

    const sortedRecords = recordsArray.sort((a, b) => b.save_time - a.save_time);
    setPlayRecords(limit ? sortedRecords.slice(0, limit) : sortedRecords);
  };

  const applyCachedSnapshot = () => {
    const cachedRecords = getCachedPlayRecordsSnapshot();
    if (Object.keys(cachedRecords).length === 0) {
      return false;
    }

    updatePlayRecords(cachedRecords, cachedDisplayLimit);
    setLoading(false);
    return true;
  };

  useEffect(() => {
    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
        setLoading(false);
      }
    );

    const fetchPlayRecords = async () => {
      try {
        const hasCachedSnapshot = applyCachedSnapshot();
        if (!hasCachedSnapshot) {
          setLoading(true);
        }

        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayRecords();
    return unsubscribe;
  }, [cachedDisplayLimit]);

  if (!loading && playRecords.length === 0) {
    return null;
  }

  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  const handleClearConfirm = async () => {
    await clearAllPlayRecords();
    setPlayRecords([]);
    setShowConfirmDialog(false);
  };

  return (
    <>
      <section className={`mb-8 ${className || ''}`}>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
            继续观看
          </h2>
          {!loading && playRecords.length > 0 && (
            <div className='flex items-center gap-1'>
              <button
                className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                onClick={() => setShowConfirmDialog(true)}
              >
                清空
              </button>
              <button
                className='inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                onClick={() => setShowPlayRecordsPanel(true)}
                aria-label='查看全部播放记录'
              >
                <ChevronRight className='h-4 w-4' />
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
