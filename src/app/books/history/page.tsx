'use client';

import {
  BookOpen,
  Clock3,
  Database,
  FolderCog,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  deleteBookReadRecord,
  getAllBookReadRecords,
  getAllBookShelf,
  getCachedBookReadRecordsSnapshot,
} from '@/lib/book.db.client';
import { BookReadRecord, BookShelfItem } from '@/lib/book.types';
import {
  type CachedBookFile,
  deleteCachedBookFile,
  listCachedBookFiles,
} from '@/lib/book-cache.client';
import {
  buildBookReadPath,
  cacheBookReadRecord,
  cacheBookShelfItem,
} from '@/lib/book-route-cache.client';
import { subscribeToDataUpdates } from '@/lib/db.client';

function looksLikeInternalHref(value?: string) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    /\.(xhtml|html|htm|xml)(#.*)?$/.test(normalized) ||
    /^nav\b/.test(normalized)
  );
}

function getReadableChapterLabel(item: BookReadRecord) {
  const candidates = [item.chapterTitle, item.locator.chapterTitle];
  for (const candidate of candidates) {
    const text = (candidate || '').trim();
    if (text && !looksLikeInternalHref(text)) return text;
  }
  return '定位已保存';
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function BookHistorySkeleton() {
  return (
    <div className='space-y-4'>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className='rounded-[2rem] border border-emerald-100/80 bg-white/85 p-4 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:bg-gray-950/70'
        >
          <div className='flex gap-4'>
            <div className='h-28 w-20 animate-pulse overflow-hidden rounded-2xl bg-emerald-100 dark:bg-gray-800' />
            <div className='min-w-0 flex-1 space-y-3'>
              <div className='h-5 w-2/3 animate-pulse rounded bg-emerald-100 dark:bg-gray-800' />
              <div className='h-4 w-1/3 animate-pulse rounded bg-emerald-100 dark:bg-gray-800' />
              <div className='h-4 w-1/2 animate-pulse rounded bg-emerald-100 dark:bg-gray-800' />
              <div className='flex gap-2 pt-1'>
                <div className='h-9 w-20 animate-pulse rounded-2xl bg-emerald-100 dark:bg-gray-800' />
                <div className='h-9 w-16 animate-pulse rounded-2xl bg-emerald-100 dark:bg-gray-800' />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BookHistoryPage() {
  const [records, setRecords] = useState<Record<string, BookReadRecord>>({});
  const [shelf, setShelf] = useState<Record<string, BookShelfItem>>({});
  const [loading, setLoading] = useState(true);
  const [cacheModalOpen, setCacheModalOpen] = useState(false);
  const [cacheItems, setCacheItems] = useState<CachedBookFile[]>([]);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete-one' | 'clear-all';
    key?: string;
    title?: string;
  } | null>(null);
  const [displayAll, setDisplayAll] = useState(false);

  const updateRecords = (nextRecords: Record<string, BookReadRecord>) => {
    const count = Object.keys(nextRecords).length;
    setRecords(nextRecords);
    setDisplayAll(count <= 10);
    if (count > 10) {
      setTimeout(() => setDisplayAll(true), 0);
    }
  };

  useEffect(() => {
    setMounted(true);
    const cachedRecords = getCachedBookReadRecordsSnapshot();
    if (Object.keys(cachedRecords).length > 0) {
      updateRecords(cachedRecords);
      setLoading(false);
    }

    getAllBookReadRecords()
      .then(updateRecords)
      .catch(() => undefined)
      .finally(() => setLoading(false));
    getAllBookShelf()
      .then(setShelf)
      .catch(() => undefined);

    const unsubscribeHistory = subscribeToDataUpdates<
      Record<string, BookReadRecord>
    >('bookHistoryUpdated', updateRecords);
    return unsubscribeHistory;
  }, []);

  const loadCacheItems = async () => {
    setCacheLoading(true);
    try {
      const items = await listCachedBookFiles();
      setCacheItems(items.sort((a, b) => b.lastOpenTime - a.lastOpenTime));
    } finally {
      setCacheLoading(false);
    }
  };

  useEffect(() => {
    if (!cacheModalOpen) return;
    void loadCacheItems();
  }, [cacheModalOpen]);

  const items = useMemo(
    () =>
      Object.entries(records)
        .map(([key, item]) => {
          const [fallbackSourceId = '', fallbackBookId = ''] = key.split('+');
          const shelfItem = shelf[key];
          return {
            ...item,
            storageKey: key,
            sourceId: item.sourceId || shelfItem?.sourceId || fallbackSourceId,
            bookId: item.bookId || shelfItem?.bookId || fallbackBookId,
            sourceName: item.sourceName || shelfItem?.sourceName || '',
            detailHref: item.detailHref || shelfItem?.detailHref,
            acquisitionHref: item.acquisitionHref || shelfItem?.acquisitionHref,
            cover: item.cover || shelfItem?.cover,
            author: item.author || shelfItem?.author,
            format: item.format || shelfItem?.format || 'epub',
          };
        })
        .sort((a, b) => b.saveTime - a.saveTime),
    [records, shelf]
  );
  const visibleItems = useMemo(
    () => (displayAll ? items : items.slice(0, 10)),
    [displayAll, items]
  );

  const cacheTotalSize = useMemo(
    () => cacheItems.reduce((sum, item) => sum + item.size, 0),
    [cacheItems]
  );

  return (
    <div className='space-y-5'>
      <section className='relative overflow-hidden rounded-[2rem] border border-emerald-100/80 bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:from-emerald-950/30 dark:via-gray-950 dark:to-lime-950/20'>
        <div className='absolute -right-16 -top-20 h-48 w-48 rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-500/10' />
        <div className='relative flex items-center justify-between gap-4'>
          <div>
            <div className='inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-200'>
              <Clock3 className='h-3.5 w-3.5' />
              Reading Timeline
            </div>
            <h1 className='mt-3 text-3xl font-black tracking-tight text-emerald-950 dark:text-emerald-50'>
              阅读历史
            </h1>
            <div className='mt-2 text-sm text-slate-500 dark:text-slate-400'>
              共 {items.length} 条记录
            </div>
          </div>
          <button
            type='button'
            onClick={() => setCacheModalOpen(true)}
            className='inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl border border-emerald-200 bg-white/80 text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/20 dark:bg-gray-950/60 dark:text-emerald-200 dark:hover:bg-emerald-500/10'
            aria-label='缓存管理'
            title='缓存管理'
          >
            <FolderCog className='h-5 w-5' />
          </button>
        </div>
      </section>

      {loading ? (
        <BookHistorySkeleton />
      ) : (
        visibleItems.map((item) => (
          <article
            key={item.storageKey}
            className='rounded-[2rem] border border-emerald-100/80 bg-white/85 p-4 shadow-sm shadow-emerald-950/5 transition-colors duration-200 hover:border-emerald-200 hover:bg-white dark:border-emerald-500/10 dark:bg-gray-950/70 dark:hover:border-emerald-500/30'
          >
            <div className='flex gap-4'>
              <div className='h-28 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 to-lime-50 ring-1 ring-emerald-100 dark:from-gray-900 dark:to-emerald-950/20 dark:ring-emerald-500/10'>
                {item.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.cover}
                    alt={item.title}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <div className='flex h-full items-center justify-center text-emerald-400'>
                    <BookOpen className='h-7 w-7' />
                  </div>
                )}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate font-semibold text-slate-950 dark:text-white'>
                  {item.title}
                </div>
                <div className='mt-1 truncate text-sm text-slate-500 dark:text-slate-400'>
                  {item.author || item.sourceName}
                </div>
                <div className='mt-3 h-2 overflow-hidden rounded-full bg-emerald-50 dark:bg-gray-900'>
                  <div
                    className='h-full rounded-full bg-emerald-600'
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, Math.round(item.progressPercent || 0))
                      )}%`,
                    }}
                  />
                </div>
                <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                  已读 {Math.round(item.progressPercent || 0)}% ·{' '}
                  {getReadableChapterLabel(item)}
                </div>
                <div className='mt-3 flex flex-wrap gap-2'>
                  {item.sourceId ? (
                    <Link
                      href={buildBookReadPath(item.sourceId, item.bookId)}
                      onClick={() => {
                        cacheBookReadRecord(item);
                        if (item.sourceId && item.bookId) {
                          cacheBookShelfItem({
                            sourceId: item.sourceId,
                            sourceName: item.sourceName,
                            bookId: item.bookId,
                            title: item.title,
                            author: item.author,
                            cover: item.cover,
                            format: item.format,
                            detailHref: item.detailHref,
                            acquisitionHref: item.acquisitionHref,
                            saveTime: item.saveTime,
                          });
                        }
                      }}
                      className='inline-flex cursor-pointer items-center gap-1.5 rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500'
                    >
                      继续阅读
                    </Link>
                  ) : (
                    <span className='rounded-2xl bg-gray-200 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800'>
                      历史记录缺少书源信息
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      const [
                        deleteSourceId = item.sourceId,
                        deleteBookId = item.bookId,
                      ] = item.storageKey.split('+');
                      await deleteBookReadRecord(deleteSourceId, deleteBookId);
                      updateRecords(
                        (() => {
                          const next = { ...records };
                          delete next[item.storageKey];
                          return next;
                        })()
                      );
                    }}
                    className='cursor-pointer rounded-2xl border border-emerald-100 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors duration-200 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/10 dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))
      )}
      {!loading && items.length === 0 ? (
        <div className='rounded-3xl border border-dashed border-emerald-200 bg-white/70 p-8 text-center text-sm text-slate-500 dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-slate-400'>
          暂无阅读历史
        </div>
      ) : null}

      {cacheModalOpen &&
        mounted &&
        createPortal(
          <div
            className='fixed inset-0 z-50 bg-black/45 backdrop-blur-sm'
            onClick={() => setCacheModalOpen(false)}
          >
            <div
              className='absolute right-0 top-0 h-screen w-full max-w-lg overflow-y-auto border-l border-emerald-100 bg-[radial-gradient(circle_at_top_right,#dcfce7_0,transparent_20rem),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-2xl dark:border-emerald-500/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(6,95,70,0.24)_0,transparent_20rem),linear-gradient(180deg,#030712_0%,#09090b_100%)]'
              onClick={(event) => event.stopPropagation()}
            >
              <div className='space-y-5 p-5'>
                <div className='rounded-[2rem] border border-emerald-100/80 bg-white/80 p-4 shadow-sm shadow-emerald-950/5 backdrop-blur dark:border-emerald-500/10 dark:bg-gray-950/70'>
                  <div className='flex items-start justify-between gap-4'>
                    <div>
                      <div className='flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white'>
                        <Database className='h-4 w-4 text-emerald-600 dark:text-emerald-300' />
                        缓存管理
                      </div>
                      <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                        已缓存 {cacheItems.length} 本 ·{' '}
                        {formatBytes(cacheTotalSize)}
                      </div>
                    </div>
                    <div className='flex gap-2'>
                      <button
                        type='button'
                        onClick={() => void loadCacheItems()}
                        className='inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-emerald-200 bg-white/80 text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/20 dark:bg-gray-950/60 dark:text-emerald-200 dark:hover:bg-emerald-500/10'
                        aria-label='刷新缓存'
                        title='刷新缓存'
                      >
                        <RefreshCw className='h-4 w-4' />
                      </button>
                      <button
                        type='button'
                        onClick={() => setConfirmAction({ type: 'clear-all' })}
                        className='inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-red-200 bg-white/80 text-red-600 transition-colors duration-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-500/20 dark:bg-gray-950/60 dark:text-red-300 dark:hover:bg-red-500/10'
                        aria-label='清空全部缓存'
                        title='清空全部缓存'
                      >
                        <Trash2 className='h-4 w-4' />
                      </button>
                      <button
                        type='button'
                        onClick={() => setCacheModalOpen(false)}
                        className='inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-emerald-200 bg-white/80 text-slate-600 transition-colors duration-200 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/20 dark:bg-gray-950/60 dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
                        aria-label='关闭'
                        title='关闭'
                      >
                        <X className='h-4 w-4' />
                      </button>
                    </div>
                  </div>
                </div>

                {cacheLoading ? (
                  <div className='rounded-3xl border border-emerald-100 bg-white/75 p-5 text-center text-sm text-slate-500 shadow-sm dark:border-emerald-500/10 dark:bg-gray-950/60 dark:text-slate-400'>
                    正在读取缓存…
                  </div>
                ) : null}
                {!cacheLoading && cacheItems.length === 0 ? (
                  <div className='rounded-3xl border border-dashed border-emerald-200 bg-white/75 p-8 text-center text-sm text-slate-500 shadow-sm dark:border-emerald-500/20 dark:bg-gray-950/60 dark:text-slate-400'>
                    当前还没有缓存书籍
                  </div>
                ) : null}

                <div className='space-y-3'>
                  {cacheItems.map((item) => (
                    <div
                      key={item.key}
                      className='rounded-[2rem] border border-emerald-100/80 bg-white/85 p-4 shadow-sm shadow-emerald-950/5 transition-colors duration-200 hover:border-emerald-200 hover:bg-white dark:border-emerald-500/10 dark:bg-gray-950/70 dark:hover:border-emerald-500/30'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0 flex-1'>
                          <div className='truncate font-semibold text-slate-950 dark:text-white'>
                            {item.title}
                          </div>
                          <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                            格式 {item.format.toUpperCase()} · 大小{' '}
                            {formatBytes(item.size)}
                          </div>
                          <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                            最近打开{' '}
                            {new Date(item.lastOpenTime).toLocaleString()}
                          </div>
                        </div>
                        <button
                          type='button'
                          onClick={() =>
                            setConfirmAction({
                              type: 'delete-one',
                              key: item.key,
                              title: item.title,
                            })
                          }
                          className='inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-red-100 bg-white/80 text-red-600 transition-colors duration-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-500/20 dark:bg-gray-950/60 dark:text-red-300 dark:hover:bg-red-500/10'
                          aria-label='删除缓存'
                          title='删除缓存'
                        >
                          <Trash2 className='h-4 w-4' />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {confirmAction &&
        mounted &&
        createPortal(
          <div
            className='fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm'
            onClick={() => setConfirmAction(null)}
          >
            <div
              className='w-full max-w-sm rounded-[2rem] border border-emerald-100 bg-white/95 p-5 shadow-2xl shadow-emerald-950/10 dark:border-emerald-500/10 dark:bg-gray-950/95'
              onClick={(event) => event.stopPropagation()}
            >
              <div className='flex items-center gap-2 text-base font-bold text-slate-950 dark:text-white'>
                <Trash2 className='h-4 w-4 text-red-600 dark:text-red-300' />
                {confirmAction.type === 'clear-all'
                  ? '清空全部缓存'
                  : '删除缓存'}
              </div>
              <div className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
                {confirmAction.type === 'clear-all'
                  ? '确认清空当前浏览器中的全部电子书缓存吗？此操作不可撤销。'
                  : `确认删除《${
                      confirmAction.title || '该书'
                    }》的本地缓存吗？`}
              </div>
              <div className='mt-5 flex justify-end gap-3'>
                <button
                  type='button'
                  onClick={() => setConfirmAction(null)}
                  className='cursor-pointer rounded-2xl border border-emerald-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors duration-200 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/20 dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
                >
                  取消
                </button>
                <button
                  type='button'
                  onClick={async () => {
                    if (confirmAction.type === 'clear-all') {
                      await Promise.all(
                        cacheItems.map((item) => deleteCachedBookFile(item.key))
                      );
                      setCacheItems([]);
                    } else if (confirmAction.key) {
                      await deleteCachedBookFile(confirmAction.key);
                      setCacheItems((prev) =>
                        prev.filter((item) => item.key !== confirmAction.key)
                      );
                    }
                    setConfirmAction(null);
                  }}
                  className='cursor-pointer rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition-colors duration-200 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500'
                >
                  确认
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
