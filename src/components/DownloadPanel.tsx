'use client';

import React from 'react';

import { M3U8DownloadTask } from '@/lib/m3u8-downloader';

import { useDownload } from '@/contexts/DownloadContext';

export function DownloadPanel() {
  const {
    tasks,
    showDownloadPanel,
    setShowDownloadPanel,
    startTask,
    pauseTask,
    cancelTask,
    retryFailedSegments,
    getProgress,
  } = useDownload();

  if (!showDownloadPanel) {
    return null;
  }

  const getStatusText = (status: M3U8DownloadTask['status']) => {
    switch (status) {
      case 'ready':
        return '等待中';
      case 'downloading':
        return '下载中';
      case 'pause':
        return '已暂停';
      case 'done':
        return '已完成';
      case 'error':
        return '错误';
      default:
        return '未知';
    }
  };

  const getStatusColor = (status: M3U8DownloadTask['status']) => {
    switch (status) {
      case 'ready':
        return 'text-gray-500';
      case 'downloading':
        return 'text-blue-500';
      case 'pause':
        return 'text-yellow-500';
      case 'done':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm'>
      <div className='bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
          <h2 className='text-xl font-bold text-gray-900 dark:text-white'>
            下载任务列表
          </h2>
          <button
            onClick={() => setShowDownloadPanel(false)}
            className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
          >
            <svg
              className='w-6 h-6'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth='2'
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>

        {/* 任务列表 */}
        <div className='flex-1 overflow-y-auto p-4 space-y-3'>
          {tasks.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400'>
              <svg
                className='w-16 h-16 mb-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4'
                />
              </svg>
              <p className='text-lg'>暂无下载任务</p>
            </div>
          ) : (
            tasks.map((task) => {
              const progress = getProgress(task.id);
              return (
                <div
                  key={task.id}
                  className='bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600'
                >
                  {/* 任务信息 */}
                  <div className='flex items-start justify-between mb-3'>
                    <div className='flex-1 min-w-0'>
                      <h3 className='text-sm font-medium text-gray-900 dark:text-white truncate mb-1'>
                        {task.title}
                      </h3>
                      <p className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                        {task.url}
                      </p>
                    </div>
                    <div className='flex items-center gap-2 ml-4'>
                      <span
                        className={`text-xs font-medium ${getStatusColor(task.status)}`}
                      >
                        {getStatusText(task.status)}
                      </span>
                      <span className='text-xs text-gray-500 dark:text-gray-400'>
                        {task.type}
                      </span>
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div className='mb-3'>
                    <div className='flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 mb-1'>
                      <span>
                        {task.finishNum} / {task.rangeDownload.targetSegment}{' '}
                        片段
                      </span>
                      <span>{progress.toFixed(1)}%</span>
                    </div>
                    <div className='w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2 overflow-hidden'>
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          task.status === 'downloading'
                            ? 'bg-gradient-to-r from-blue-500 to-purple-600 animate-pulse'
                            : task.status === 'done'
                              ? 'bg-green-500'
                              : task.status === 'error'
                                ? 'bg-red-500'
                                : 'bg-gray-400'
                        }`}
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* 错误信息 */}
                  {task.errorNum > 0 && (
                    <div className='mb-3 flex items-center justify-between'>
                      <div className='text-xs text-red-500 dark:text-red-400'>
                        {task.errorNum} 个片段下载失败
                      </div>
                      <button
                        onClick={() => retryFailedSegments(task.id)}
                        className='text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline'
                      >
                        重试失败片段
                      </button>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className='flex items-center gap-2'>
                    {task.status === 'downloading' && (
                      <button
                        onClick={() => pauseTask(task.id)}
                        className='flex items-center gap-1 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-medium rounded transition-colors'
                      >
                        <svg
                          className='w-4 h-4'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth='2'
                            d='M10 9v6m4-6v6'
                          />
                        </svg>
                        暂停
                      </button>
                    )}

                    {(task.status === 'pause' ||
                      task.status === 'ready' ||
                      task.status === 'error') && (
                      <button
                        onClick={() => startTask(task.id)}
                        className='flex items-center gap-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors'
                      >
                        <svg
                          className='w-4 h-4'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth='2'
                            d='M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z'
                          />
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth='2'
                            d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                        </svg>
                        {task.status === 'error' ? '重试' : '开始'}
                      </button>
                    )}

                    <button
                      onClick={() => cancelTask(task.id)}
                      className='flex items-center gap-1 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors'
                    >
                      <svg
                        className='w-4 h-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'
                        />
                      </svg>
                      删除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部统计 */}
        {tasks.length > 0 && (
          <div className='p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30'>
            <div className='flex items-center justify-between text-sm text-gray-600 dark:text-gray-300'>
              <span>总任务数: {tasks.length}</span>
              <span>
                下载中: {tasks.filter((t) => t.status === 'downloading').length}
              </span>
              <span>
                已完成: {tasks.filter((t) => t.status === 'done').length}
              </span>
              <span>
                已暂停: {tasks.filter((t) => t.status === 'pause').length}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
