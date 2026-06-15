'use client';

import React, { useMemo, useState } from 'react';

import { M3U8DownloadTask, M3U8SegmentLogStatus } from '@/lib/m3u8-downloader';

import { useDownload } from '@/contexts/DownloadContext';

export function DownloadPanel() {
  const { tasks, showDownloadPanel, setShowDownloadPanel, startTask, pauseTask, cancelTask, retryFailedSegments, getProgress } = useDownload();
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | M3U8SegmentLogStatus>('all');

  const logTask = useMemo(
    () => tasks.find((task) => task.id === logTaskId) || null,
    [logTaskId, tasks]
  );

  const filteredLogs = useMemo(() => {
    if (!logTask) return [];
    const logs = logFilter === 'all'
      ? logTask.segmentLogs
      : logTask.segmentLogs.filter((log) => log.status === logFilter);
    return [...logs].reverse();
  }, [logFilter, logTask]);

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
        return 'text-gray-500 dark:text-slate-400';
      case 'downloading':
        return 'text-blue-500 dark:text-sky-400';
      case 'pause':
        return 'text-yellow-600 dark:text-amber-400';
      case 'done':
        return 'text-green-600 dark:text-emerald-400';
      case 'error':
        return 'text-red-600 dark:text-rose-400';
      default:
        return 'text-gray-500 dark:text-slate-400';
    }
  };

  const getLogBadgeClass = (status: M3U8SegmentLogStatus) => {
    switch (status) {
      case 'downloading':
        return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300';
      case 'success':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300';
      case 'retry':
        return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300';
      case 'timeout':
      case 'error':
        return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300';
      case 'aborted':
        return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300';
      default:
        return 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-500/30 dark:bg-gray-500/10 dark:text-gray-300';
    }
  };

  const getLogStatusText = (status: M3U8SegmentLogStatus) => {
    switch (status) {
      case 'queued':
        return '排队';
      case 'downloading':
        return '下载中';
      case 'success':
        return '成功';
      case 'retry':
        return '重试';
      case 'error':
        return '失败';
      case 'timeout':
        return '超时';
      case 'aborted':
        return '中止';
      default:
        return status;
    }
  };

  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString();

  const logStats = logTask ? {
    total: logTask.segmentLogs.length,
    success: logTask.finishList.filter((item) => item.status === 'is-success').length,
    downloading: logTask.finishList.filter((item) => item.status === 'is-downloading').length,
    error: logTask.finishList.filter((item) => item.status === 'is-error').length,
  } : null;

  return (
    <div className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6'>
      <div className='flex max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-950'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between border-b border-gray-200 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-950/90'>
          <div>
            <h2 className='text-xl font-bold text-gray-900 dark:text-slate-50'>下载任务列表</h2>
            <p className='mt-1 text-xs text-gray-500 dark:text-slate-400'>支持查看每个分片的下载、重试、超时和失败日志</p>
          </div>
          <button
            onClick={() => setShowDownloadPanel(false)}
            className='cursor-pointer rounded-lg p-2 text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
            aria-label='关闭下载任务列表'
          >
            <svg className='h-6 w-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M6 18L18 6M6 6l12 12' />
            </svg>
          </button>
        </div>

        {/* 任务列表 */}
        <div className='flex-1 overflow-y-auto p-4 space-y-3'>
          {tasks.length === 0 ? (
            <div className='flex min-h-[320px] flex-col items-center justify-center text-gray-500 dark:text-slate-400'>
              <svg className='mb-4 h-16 w-16' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
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
                  className='rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-900/70'
                >
                  {/* 任务信息 */}
                  <div className='mb-3 flex items-start justify-between gap-4'>
                    <div className='min-w-0 flex-1'>
                      <h3 className='mb-1 truncate text-sm font-semibold text-gray-900 dark:text-slate-50'>
                        {task.title}
                      </h3>
                      <p className='truncate text-xs text-gray-500 dark:text-slate-400'>{task.url}</p>
                    </div>
                    <div className='flex shrink-0 items-center gap-2'>
                      <span className={`text-xs font-medium ${getStatusColor(task.status)}`}>
                        {getStatusText(task.status)}
                      </span>
                      <span className='rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 dark:border-slate-700 dark:text-slate-400'>
                        {task.type}
                      </span>
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div className='mb-3'>
                    <div className='mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-slate-300'>
                      <span>
                        {task.finishNum} / {task.rangeDownload.targetSegment} 片段
                      </span>
                      <span>{progress.toFixed(1)}%</span>
                    </div>
                    <div className='h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-800'>
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          task.status === 'downloading'
                            ? 'bg-gradient-to-r from-sky-500 to-emerald-500 motion-safe:animate-pulse'
                            : task.status === 'done'
                            ? 'bg-emerald-500'
                            : task.status === 'error'
                            ? 'bg-rose-500'
                            : 'bg-slate-400'
                        }`}
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* 错误信息 */}
                  {task.errorNum > 0 && (
                    <div className='mb-3 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-400/30 dark:bg-rose-400/10'>
                      <div className='text-xs text-rose-600 dark:text-rose-300' role='alert'>
                        {task.errorNum} 个片段下载失败
                      </div>
                      <button
                        onClick={() => retryFailedSegments(task.id)}
                        className='cursor-pointer text-xs text-sky-600 underline transition-colors hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-sky-300 dark:hover:text-sky-200'
                      >
                        重试失败片段
                      </button>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      onClick={() => {
                        setLogTaskId(task.id);
                        setLogFilter('all');
                      }}
                      className='flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    >
                      <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M9 17v-6m4 6V7m4 10v-3M5 19h14M5 5h14' />
                      </svg>
                      查看日志
                      {task.segmentLogs.length > 0 && (
                        <span className='rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-200'>
                          {task.segmentLogs.length}
                        </span>
                      )}
                    </button>

                    {task.status === 'downloading' && (
                      <button
                        onClick={() => pauseTask(task.id)}
                        className='flex cursor-pointer items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400'
                      >
                        <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M10 9v6m4-6v6' />
                        </svg>
                        暂停
                      </button>
                    )}

                    {(task.status === 'pause' || task.status === 'ready' || task.status === 'error') && (
                      <button
                        onClick={() => startTask(task.id)}
                        className='flex cursor-pointer items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-400'
                      >
                        <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z' />
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z' />
                        </svg>
                        {task.status === 'error' ? '重试' : '开始'}
                      </button>
                    )}

                    <button
                      onClick={() => cancelTask(task.id)}
                      className='flex cursor-pointer items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400'
                    >
                      <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' />
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
          <div className='border-t border-gray-200 bg-gray-50 p-4 dark:border-slate-800 dark:bg-slate-900/80'>
            <div className='grid grid-cols-2 gap-2 text-sm text-gray-600 dark:text-slate-300 sm:grid-cols-4'>
              <span>总任务数: {tasks.length}</span>
              <span>下载中: {tasks.filter(t => t.status === 'downloading').length}</span>
              <span>已完成: {tasks.filter(t => t.status === 'done').length}</span>
              <span>已暂停: {tasks.filter(t => t.status === 'pause').length}</span>
            </div>
          </div>
        )}
      </div>

      {logTask && (
        <div className='fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6'>
          <div className='flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950'>
            <div className='border-b border-gray-200 bg-white/95 p-4 dark:border-slate-800 dark:bg-slate-950/95'>
              <div className='flex items-start justify-between gap-4'>
                <div className='min-w-0'>
                  <h3 className='truncate text-lg font-bold text-gray-900 dark:text-slate-50'>分片下载日志</h3>
                  <p className='mt-1 truncate text-xs text-gray-500 dark:text-slate-400'>{logTask.title}</p>
                </div>
                <button
                  onClick={() => setLogTaskId(null)}
                  className='cursor-pointer rounded-lg p-2 text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                  aria-label='关闭分片下载日志'
                >
                  <svg className='h-5 w-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M6 18L18 6M6 6l12 12' />
                  </svg>
                </button>
              </div>

              {logStats && (
                <div className='mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                  <div className='rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900'>
                    <div className='text-xs text-slate-500 dark:text-slate-400'>日志数</div>
                    <div className='mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50'>{logStats.total}</div>
                  </div>
                  <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-400/30 dark:bg-emerald-400/10'>
                    <div className='text-xs text-emerald-700 dark:text-emerald-300'>成功分片</div>
                    <div className='mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-200'>{logStats.success}</div>
                  </div>
                  <div className='rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-400/30 dark:bg-sky-400/10'>
                    <div className='text-xs text-sky-700 dark:text-sky-300'>下载中</div>
                    <div className='mt-1 text-lg font-semibold text-sky-700 dark:text-sky-200'>{logStats.downloading}</div>
                  </div>
                  <div className='rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-400/30 dark:bg-rose-400/10'>
                    <div className='text-xs text-rose-700 dark:text-rose-300'>失败分片</div>
                    <div className='mt-1 text-lg font-semibold text-rose-700 dark:text-rose-200'>{logStats.error}</div>
                  </div>
                </div>
              )}

              <div className='mt-4 flex flex-wrap gap-2'>
                {(['all', 'downloading', 'success', 'retry', 'timeout', 'error', 'aborted'] as Array<'all' | M3U8SegmentLogStatus>).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setLogFilter(filter)}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      logFilter === filter
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {filter === 'all' ? '全部' : getLogStatusText(filter)}
                  </button>
                ))}
              </div>
            </div>

            <div className='flex-1 overflow-y-auto p-4'>
              {filteredLogs.length === 0 ? (
                <div className='flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-500 dark:border-slate-700 dark:text-slate-400'>
                  <svg className='mb-3 h-10 w-10' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M9 12h6m-6 4h6M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z' />
                  </svg>
                  <p className='text-sm'>暂无匹配的分片日志</p>
                </div>
              ) : (
                <div className='space-y-2'>
                  {filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className='grid gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[120px_110px_1fr_160px]'
                    >
                      <div className='font-mono text-xs text-slate-500 dark:text-slate-400'>
                        {formatTime(log.timestamp)}
                      </div>
                      <div>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getLogBadgeClass(log.status)}`}>
                          {getLogStatusText(log.status)}
                        </span>
                      </div>
                      <div className='min-w-0'>
                        <div className='truncate text-slate-900 dark:text-slate-100'>{log.message}</div>
                        <div className='mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-500'>segment #{log.index + 1}</div>
                      </div>
                      <div className='flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 md:justify-end'>
                        {typeof log.retryCount === 'number' && <span>重试 {log.retryCount}</span>}
                        {typeof log.durationMs === 'number' && <span>{log.durationMs}ms</span>}
                        {typeof log.httpStatus === 'number' && <span>HTTP {log.httpStatus}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
