'use client';

import { FolderCog, RefreshCw, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { deleteCachedBookFile, listCachedBookFiles, type CachedBookFile } from '@/lib/book-cache.client';
import { buildBookReadPath, cacheBookReadRecord, cacheBookShelfItem } from '@/lib/book-route-cache.client';
import { deleteBookReadRecord, getAllBookReadRecords, getAllBookShelf, getCachedBookReadRecordsSnapshot } from '@/lib/book.db.client';
import { BookReadRecord, BookShelfItem } from '@/lib/book.types';
import { subscribeToDataUpdates } from '@/lib/db.client';

function looksLikeInternalHref(value?: string) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return /\.(xhtml|html|htm|xml)(#.*)?$/.test(normalized) || /^nav\b/.test(normalized);
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
        <div key={index} className='rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
          <div className='flex gap-4'>
            <div className='h-28 w-20 animate-pulse overflow-hidden rounded-2xl bg-gray-200 dark:bg-gray-800' />
            <div className='min-w-0 flex-1 space-y-3'>
              <div className='h-5 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              <div className='h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              <div className='h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              <div className='flex gap-2 pt-1'>
                <div className='h-9 w-20 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />
                <div className='h-9 w-16 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />
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
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete-one' | 'clear-all'; key?: string; title?: string } | null>(null);
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

    getAllBookReadRecords().then(updateRecords).catch(() => undefined).finally(() => setLoading(false));
    getAllBookShelf().then(setShelf).catch(() => undefined);

    const unsubscribeHistory = subscribeToDataUpdates<Record<string, BookReadRecord>>('bookHistoryUpdated', updateRecords);
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

  const items = useMemo(() => Object.entries(records)
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
    .sort((a, b) => b.saveTime - a.saveTime), [records, shelf]);
  const visibleItems = useMemo(
    () => (displayAll ? items : items.slice(0, 10)),
    [displayAll, items]
  );

  const cacheTotalSize = useMemo(() => cacheItems.reduce((sum, item) => sum + item.size, 0), [cacheItems]);

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div className='text-sm text-gray-500'>共 {items.length} 条阅读历史</div>
        <button
          type='button'
          onClick={() => setCacheModalOpen(true)}
          className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700'
          aria-label='缓存管理'
          title='缓存管理'
        >
          <FolderCog className='h-4 w-4' />
        </button>
      </div>

      {loading ? (
        <BookHistorySkeleton />
      ) : (
        visibleItems.map((item) => (
          <div key={item.storageKey} className='rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
            <div className='flex gap-4'>
              <div className='h-28 w-20 overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-900'>{item.cover ? <img src={item.cover} alt={item.title} className='h-full w-full object-cover' /> : null}</div>
              <div className='min-w-0 flex-1'>
                <div className='truncate font-medium'>{item.title}</div>
                <div className='mt-1 text-sm text-gray-500'>{item.author || item.sourceName}</div>
                <div className='mt-1 text-xs text-gray-500'>已读 {Math.round(item.progressPercent || 0)}% · {getReadableChapterLabel(item)}</div>
                <div className='mt-3 flex flex-wrap gap-2'>
                  {item.sourceId ? (
                    <Link
                      href={buildBookReadPath(item.sourceId, item.bookId)}
                      onClick={() => { cacheBookReadRecord(item); if (item.sourceId && item.bookId) { cacheBookShelfItem({ sourceId: item.sourceId, sourceName: item.sourceName, bookId: item.bookId, title: item.title, author: item.author, cover: item.cover, format: item.format, detailHref: item.detailHref, acquisitionHref: item.acquisitionHref, saveTime: item.saveTime }); } }}
                      className='rounded-2xl bg-sky-600 px-3 py-2 text-xs text-white'
                    >
                      继续阅读
                    </Link>
                  ) : (
                    <span className='rounded-2xl bg-gray-200 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800'>历史记录缺少书源信息</span>
                  )}
                  <button onClick={async () => { const [deleteSourceId = item.sourceId, deleteBookId = item.bookId] = item.storageKey.split('+'); await deleteBookReadRecord(deleteSourceId, deleteBookId); updateRecords((() => { const next = { ...records }; delete next[item.storageKey]; return next; })()); }} className='rounded-2xl border border-gray-200 px-3 py-2 text-xs dark:border-gray-700'>删除</button>
                </div>
              </div>
            </div>
          </div>
        ))
      )}
      {!loading && items.length === 0 ? <div className='text-sm text-gray-500'>暂无阅读历史</div> : null}

      {cacheModalOpen && mounted && createPortal(
        <div className='fixed inset-0 z-50 bg-black/40' onClick={() => setCacheModalOpen(false)}>
          <div className='absolute right-0 top-0 h-screen w-full max-w-lg overflow-y-auto bg-white shadow-2xl dark:bg-gray-950' onClick={(event) => event.stopPropagation()}>
            <div className='space-y-4 p-5'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <div className='text-base font-semibold'>缓存管理</div>
                  <div className='mt-1 text-xs text-gray-500'>已缓存 {cacheItems.length} 本 · {formatBytes(cacheTotalSize)}</div>
                </div>
                <div className='flex gap-2'>
                  <button type='button' onClick={() => void loadCacheItems()} className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700' aria-label='刷新缓存' title='刷新缓存'><RefreshCw className='h-4 w-4' /></button>
                  <button type='button' onClick={() => setConfirmAction({ type: 'clear-all' })} className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 text-red-600 dark:border-red-900/60 dark:text-red-400' aria-label='清空全部缓存' title='清空全部缓存'><Trash2 className='h-4 w-4' /></button>
                  <button type='button' onClick={() => setCacheModalOpen(false)} className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700' aria-label='关闭' title='关闭'><X className='h-4 w-4' /></button>
                </div>
              </div>

              {cacheLoading ? <div className='text-sm text-gray-500'>正在读取缓存…</div> : null}
              {!cacheLoading && cacheItems.length === 0 ? <div className='text-sm text-gray-500'>当前还没有缓存书籍</div> : null}

              <div className='space-y-3'>
                {cacheItems.map((item) => (
                  <div key={item.key} className='rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate font-medium'>{item.title}</div>
                        <div className='mt-1 text-xs text-gray-500'>格式 {item.format.toUpperCase()} · 大小 {formatBytes(item.size)}</div>
                        <div className='mt-1 text-xs text-gray-500'>最近打开 {new Date(item.lastOpenTime).toLocaleString()}</div>
                      </div>
                      <button
                        type='button'
                        onClick={() => setConfirmAction({ type: 'delete-one', key: item.key, title: item.title })}
                        className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700'
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


      {confirmAction && mounted && createPortal(
        <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4' onClick={() => setConfirmAction(null)}>
          <div className='w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-950' onClick={(event) => event.stopPropagation()}>
            <div className='text-base font-semibold text-gray-900 dark:text-gray-100'>
              {confirmAction.type === 'clear-all' ? '清空全部缓存' : '删除缓存'}
            </div>
            <div className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
              {confirmAction.type === 'clear-all'
                ? '确认清空当前浏览器中的全部电子书缓存吗？此操作不可撤销。'
                : `确认删除《${confirmAction.title || '该书'}》的本地缓存吗？`}
            </div>
            <div className='mt-5 flex justify-end gap-3'>
              <button type='button' onClick={() => setConfirmAction(null)} className='rounded-2xl border border-gray-200 px-4 py-2 text-sm dark:border-gray-700'>取消</button>
              <button
                type='button'
                onClick={async () => {
                  if (confirmAction.type === 'clear-all') {
                    await Promise.all(cacheItems.map((item) => deleteCachedBookFile(item.key)));
                    setCacheItems([]);
                  } else if (confirmAction.key) {
                    await deleteCachedBookFile(confirmAction.key);
                    setCacheItems((prev) => prev.filter((item) => item.key !== confirmAction.key));
                  }
                  setConfirmAction(null);
                }}
                className='rounded-2xl bg-red-600 px-4 py-2 text-sm text-white'
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
