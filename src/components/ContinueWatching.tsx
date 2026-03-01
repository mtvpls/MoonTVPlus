/* eslint-disable no-console */
'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import VideoCard from '@/components/VideoCard';
import VirtualScrollableRow from '@/components/VirtualScrollableRow';

interface ContinueWatchingProps {
  className?: string;
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // 处理播放记录数据更新的函数
  const updatePlayRecords = (allRecords: Record<string, PlayRecord>, limit?: number) => {
    // 将记录转换为数组并根据 save_time 由近到远排序
    const recordsArray = Object.entries(allRecords).map(([key, record]) => ({
      ...record,
      key,
    }));

    // 按 save_time 降序排序（最新的在前面）
    const sortedRecords = recordsArray.sort(
      (a, b) => b.save_time - a.save_time
    );

    // 如果指定了 limit，只取前 N 条
    const finalRecords = limit ? sortedRecords.slice(0, limit) : sortedRecords;

    setPlayRecords(finalRecords);
  };

  useEffect(() => {
    const fetchPlayRecords = async () => {
      try {
        setLoading(true);

        // 从缓存或API获取所有播放记录
        const allRecords = await getAllPlayRecords();

        // 非 localStorage 模式下，先只显示前 10 条记录
        const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
        if (storageType !== 'localstorage') {
          updatePlayRecords(allRecords, 10);
        } else {
          updatePlayRecords(allRecords);
        }
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayRecords();

    // 监听播放记录更新事件
    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        // 同步完成后，加载完整数据（不限制数量）
        updatePlayRecords(newRecords);
      }
    );

    return unsubscribe;
  }, []);

  // 如果没有播放记录，则不渲染组件
  if (!loading && playRecords.length === 0) {
    return null;
  }

  // 计算播放进度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 从 key 中解析 source 和 id
  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  // 处理清空确认
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
            <button
              className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              onClick={() => setShowConfirmDialog(true)}
            >
              清空
            </button>
          )}
        </div>
      {loading ? (
        // 加载状态显示灰色占位数据（使用原始 ScrollableRow）
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pt-2 pb-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className='min-w-[180px] w-48 sm:min-w-[200px] sm:w-52'
            >
              <div className='relative aspect-[3/2] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
              </div>
              <div className='mt-1 h-1 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
              <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800 w-3/4'></div>
            </div>
          ))}
        </div>
      ) : (
        // 使用虚拟滚动显示真实数据
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
                        prev.filter((r) => r.key !== record.key)
                      )
                    }
                    type={record.total_episodes > 1 ? 'tv' : ''}
                    origin={record.origin}
                    orientation='horizontal'
                    playTime={record.play_time}
                    totalTime={record.total_time}
                  />
                  {/* 新增剧集提示 - 完全独立于 VideoCard */}
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
                      {/* 水波纹动画 - 第一层 */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: '0',
                          borderRadius: '9999px',
                          backgroundColor: 'rgb(14 165 233)',
                          animation: 'ping-scale 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                        }}
                      />
                      {/* 水波纹动画 - 第二层 */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: '0',
                          borderRadius: '9999px',
                          backgroundColor: 'rgb(14 165 233)',
                          animation: 'pulse-scale 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        }}
                      />
                      {/* 主体徽章 */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: '0',
                          borderRadius: '9999px',
                          background: 'linear-gradient(to bottom right, rgb(14 165 233), rgb(2 132 199))',
                          color: 'white',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
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

    {/* 确认对话框 */}
    {showConfirmDialog && createPortal(
      <div
        className='fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4 transition-opacity duration-300'
        onClick={() => setShowConfirmDialog(false)}
      >
        <div
          className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-red-200 dark:border-red-800 transition-all duration-300'
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            {/* 图标和标题 */}
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  清空播放记录
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  确定要清空所有播放记录吗？此操作不可恢复。
                </p>
              </div>
            </div>

            {/* 按钮组 */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleClearConfirm}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                确定清空
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}
  </>
  );
}
