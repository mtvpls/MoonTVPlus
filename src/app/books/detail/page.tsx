'use client';

import { BookmarkPlus, BookOpen, Download, FileText, Tags } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  deleteBookShelf,
  getAllBookShelf,
  saveBookShelf,
} from '@/lib/book.db.client';
import { BookChapter, BookDetail, BookShelfItem } from '@/lib/book.types';
import {
  buildBookReadPath,
  cacheBookDetail,
  getBookRouteCache,
} from '@/lib/book-route-cache.client';

function DetailSkeleton() {
  return (
    <div className='space-y-6 animate-pulse'>
      <section className='grid gap-6 rounded-[2rem] border border-emerald-100/80 bg-white/85 p-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:bg-gray-950/70 md:grid-cols-[220px_1fr]'>
        <div className='aspect-[3/4] rounded-3xl bg-emerald-100 dark:bg-gray-800' />
        <div className='space-y-4'>
          <div className='h-8 w-2/3 rounded bg-emerald-100 dark:bg-gray-800' />
          <div className='h-4 w-1/3 rounded bg-emerald-100 dark:bg-gray-800' />
          <div className='space-y-2'>
            <div className='h-4 w-full rounded bg-emerald-100 dark:bg-gray-800' />
            <div className='h-4 w-11/12 rounded bg-emerald-100 dark:bg-gray-800' />
            <div className='h-4 w-10/12 rounded bg-emerald-100 dark:bg-gray-800' />
          </div>
          <div className='flex gap-3'>
            <div className='h-10 w-24 rounded-2xl bg-gray-200 dark:bg-gray-800' />
            <div className='h-10 w-24 rounded-2xl bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
      </section>
    </div>
  );
}

function parseDownloadFilename(disposition: string | null) {
  if (!disposition) return '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return '';
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || '';
}

function sanitizeFilename(name: string) {
  return name.replace(/[/:*?"<>|]/g, '_').trim();
}

async function openBookFile(
  sourceId: string,
  bookId: string,
  format?: 'epub' | 'pdf' | 'chapters',
  download = false,
  href?: string,
  title?: string
) {
  const response = await fetch('/api/books/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceId,
      bookId,
      format: format || null,
      href: href || undefined,
    }),
  });
  if (!response.ok) {
    let message = '打开文件失败';
    try {
      const json = await response.json();
      message = json.error || message;
    } catch {
      // Keep fallback error message.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  if (download) {
    const headerFilename = parseDownloadFilename(
      response.headers.get('content-disposition')
    );
    const fallbackBaseName =
      sanitizeFilename(title || bookId || 'book') || 'book';
    const extension = format === 'pdf' ? 'pdf' : 'epub';
    const finalFilename = headerFilename || `${fallbackBaseName}.${extension}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = finalFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function BookDetailPage() {
  const searchParams = useSearchParams();
  const sourceId = searchParams.get('sourceId') || '';
  const bookId = searchParams.get('bookId') || '';
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [shelf, setShelf] = useState<Record<string, BookShelfItem>>({});
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState('');
  const [error, setError] = useState('');
  const [fileBusy, setFileBusy] = useState<'open' | 'download' | ''>('');

  const cached = useMemo(
    () => (sourceId && bookId ? getBookRouteCache(sourceId, bookId) : null),
    [sourceId, bookId]
  );

  useEffect(() => {
    getAllBookShelf()
      .then((items) => {
        setShelf(items);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!sourceId || !bookId) return;
    fetch('/api/books/detail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        bookId,
        href: cached?.detailHref,
        title: cached?.title,
        author: cached?.author,
        cover: cached?.cover,
        summary: cached?.summary,
        acquisitionLinks: cached?.acquisitionLinks || [],
      }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '获取详情失败');
        setDetail(json);
        cacheBookDetail(json);
      })
      .catch((err) => setError(err.message || '获取详情失败'));
  }, [sourceId, bookId, cached]);

  const readable = detail?.acquisitionLinks.find((item) => {
    const type = item.type.toLowerCase();
    return (
      type.includes('epub') ||
      type.includes('pdf') ||
      type.includes('legado-chapters') ||
      item.rel === 'legado:chapters'
    );
  });
  const readableFormat = readable?.type.toLowerCase().includes('pdf')
    ? 'pdf'
    : readable?.type.toLowerCase().includes('legado-chapters') ||
      readable?.rel === 'legado:chapters'
    ? 'chapters'
    : 'epub';

  useEffect(() => {
    if (!detail || !readable || readableFormat !== 'chapters') {
      setChapters([]);
      setChaptersError('');
      setChaptersLoading(false);
      return;
    }
    let cancelled = false;
    setChapters([]);
    setChaptersLoading(true);
    setChaptersError('');
    const params = new URLSearchParams({
      sourceId: detail.sourceId,
      bookId: detail.id,
    });
    fetch(`/api/books/read/chapters?${params.toString()}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '获取章节失败');
        if (cancelled) return;
        setChapters((json.chapters || []) as BookChapter[]);
      })
      .catch((err) => {
        if (cancelled) return;
        setChapters([]);
        setChaptersError(err.message || '获取章节失败');
      })
      .finally(() => {
        if (!cancelled) setChaptersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detail, readable, readableFormat]);

  const toggleShelf = async () => {
    if (!detail) return;
    const bookKey = `${detail.sourceId}+${detail.id}`;
    if (shelf[bookKey]) {
      await deleteBookShelf(detail.sourceId, detail.id);
      setShelf((prev) => {
        const next = { ...prev };
        delete next[bookKey];
        return next;
      });
      return;
    }
    const item: BookShelfItem = {
      sourceId: detail.sourceId,
      sourceName: detail.sourceName,
      bookId: detail.id,
      title: detail.title,
      author: detail.author,
      cover: detail.cover,
      format: readableFormat,
      detailHref: detail.detailHref,
      acquisitionHref: readable?.href,
      saveTime: Date.now(),
    };
    await saveBookShelf(detail.sourceId, detail.id, item);
    setShelf((prev) => ({ ...prev, [bookKey]: item }));
    cacheBookDetail(detail);
  };

  if (error)
    return (
      <div className='rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-950/20 dark:text-red-300'>
        {error}
      </div>
    );
  if (!detail) return <DetailSkeleton />;

  return (
    <div className='space-y-6'>
      <section className='relative overflow-hidden rounded-[2.25rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:from-emerald-950/30 dark:via-gray-950 dark:to-lime-950/20'>
        <div className='absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-500/10' />
        <div className='relative grid gap-6 md:grid-cols-[220px_1fr]'>
          <div className='overflow-hidden rounded-[2rem] bg-gradient-to-br from-emerald-50 to-lime-50 shadow-xl shadow-emerald-950/10 ring-1 ring-emerald-100 dark:from-gray-900 dark:to-emerald-950/20 dark:ring-emerald-500/10'>
            {detail.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detail.cover}
                alt={detail.title}
                className='h-full w-full object-cover'
              />
            ) : (
              <div className='flex aspect-[3/4] flex-col items-center justify-center gap-2 text-sm text-emerald-500 dark:text-emerald-300'>
                <BookOpen className='h-9 w-9' />
                无封面
              </div>
            )}
          </div>
          <div className='flex min-w-0 flex-col justify-between gap-5'>
            <div>
              <div className='inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-200'>
                <BookOpen className='h-3.5 w-3.5' />
                {detail.sourceName}
              </div>
              <h1 className='mt-4 text-3xl font-black tracking-tight text-emerald-950 dark:text-emerald-50 sm:text-4xl'>
                {detail.title}
              </h1>
              <div className='mt-2 text-sm font-medium text-slate-500 dark:text-slate-400'>
                {detail.author || '未知作者'}
              </div>
              {detail.summary ? (
                <div className='mt-4 line-clamp-5 text-sm leading-7 text-slate-600 dark:text-slate-300'>
                  {detail.summary}
                </div>
              ) : null}
              <div className='mt-4 flex flex-wrap gap-2'>
                {(detail.categories || detail.tags || []).map((tag) => (
                  <span
                    key={tag}
                    className='inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/20'
                  >
                    <Tags className='h-3 w-3' />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className='flex flex-wrap gap-3'>
              {readable ? (
                <Link
                  href={buildBookReadPath(detail.sourceId, detail.id)}
                  onClick={() => cacheBookDetail(detail)}
                  className='inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition-colors duration-200 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950'
                >
                  <BookOpen className='h-4 w-4' />
                  在线阅读
                </Link>
              ) : null}
              <button
                type='button'
                onClick={toggleShelf}
                className='inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-emerald-200 bg-white/70 px-5 py-2.5 text-sm font-semibold text-emerald-800 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-100 dark:hover:bg-emerald-500/10'
              >
                <BookmarkPlus className='h-4 w-4' />
                {shelf[`${detail.sourceId}+${detail.id}`]
                  ? '移出书架'
                  : '加入书架'}
              </button>
              {readable && readableFormat !== 'chapters' ? (
                <button
                  type='button'
                  onClick={async () => {
                    try {
                      setFileBusy('download');
                      await openBookFile(
                        detail.sourceId,
                        detail.id,
                        readableFormat,
                        true,
                        readable?.href,
                        detail.title
                      );
                    } catch (err) {
                      setError((err as Error).message || '下载文件失败');
                    } finally {
                      setFileBusy('');
                    }
                  }}
                  disabled={fileBusy !== ''}
                  className='inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-emerald-200 bg-white/70 px-5 py-2.5 text-sm font-semibold text-emerald-800 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-100 dark:hover:bg-emerald-500/10'
                >
                  <Download className='h-4 w-4' />
                  {fileBusy === 'download' ? '下载中...' : '下载文件'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className='rounded-[2rem] border border-emerald-100/80 bg-white/85 p-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:bg-gray-950/70'>
        <div className='flex items-center gap-2'>
          <FileText className='h-5 w-5 text-emerald-600 dark:text-emerald-300' />
          <h2 className='text-lg font-bold text-slate-950 dark:text-white'>
            可用格式
          </h2>
        </div>
        <div className='mt-4 space-y-3'>
          {detail.acquisitionLinks.map((item) => {
            const type = item.type.toLowerCase();
            const format = type.includes('pdf')
              ? 'pdf'
              : type.includes('epub')
              ? 'epub'
              : type.includes('legado-chapters') ||
                item.rel === 'legado:chapters'
              ? 'chapters'
              : undefined;
            return (
              <div
                key={`${item.href}-${item.type}`}
                className='flex items-center justify-between gap-4 rounded-2xl bg-emerald-50/70 px-4 py-3 text-sm ring-1 ring-emerald-100 dark:bg-emerald-500/5 dark:ring-emerald-500/10'
              >
                <div className='min-w-0'>
                  <div className='truncate font-medium text-slate-900 dark:text-white'>
                    {item.title || item.type}
                  </div>
                  <div className='mt-1 truncate text-xs text-slate-500 dark:text-slate-400'>
                    {item.rel}
                  </div>
                </div>
                <button
                  type='button'
                  disabled={!format || fileBusy !== ''}
                  onClick={async () => {
                    if (!format) return;
                    if (format === 'epub' || format === 'chapters') {
                      cacheBookDetail(detail);
                      window.location.href = buildBookReadPath(
                        detail.sourceId,
                        detail.id
                      );
                      return;
                    }
                    try {
                      setFileBusy('open');
                      await openBookFile(
                        detail.sourceId,
                        detail.id,
                        format,
                        false,
                        item.href
                      );
                    } catch (err) {
                      setError((err as Error).message || '打开文件失败');
                    } finally {
                      setFileBusy('');
                    }
                  }}
                  className='cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors duration-200 hover:bg-white disabled:cursor-not-allowed disabled:text-gray-400 dark:text-emerald-200 dark:hover:bg-emerald-500/10'
                >
                  打开
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {readableFormat === 'chapters' ? (
        <section className='rounded-[2rem] border border-emerald-100/80 bg-white/85 p-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:bg-gray-950/70'>
          <div className='flex items-center justify-between gap-3'>
            <h2 className='text-lg font-bold text-slate-950 dark:text-white'>
              章节目录
            </h2>
            <div className='rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'>
              {chaptersLoading ? '加载中...' : `${chapters.length} 章`}
            </div>
          </div>
          {chaptersError ? (
            <div className='mt-4 text-sm text-red-500'>{chaptersError}</div>
          ) : null}
          {!chaptersLoading && !chaptersError && chapters.length === 0 ? (
            <div className='mt-4 rounded-2xl bg-lime-50 px-4 py-3 text-sm text-lime-800 dark:bg-lime-900/20 dark:text-lime-200'>
              源站当前没有返回章节，这不是 EPUB 文件缺失；请换有章节的搜索结果。
            </div>
          ) : null}
          {chapters.length > 0 ? (
            <div className='mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
              {chapters.slice(0, 60).map((chapter) => (
                <Link
                  key={`${chapter.href}-${chapter.order}`}
                  href={buildBookReadPath(
                    detail.sourceId,
                    detail.id,
                    chapter.href
                  )}
                  onClick={() => cacheBookDetail(detail)}
                  className='truncate rounded-2xl bg-emerald-50/70 px-4 py-3 text-sm text-slate-700 ring-1 ring-emerald-100 transition-colors duration-200 hover:bg-white hover:text-emerald-700 dark:bg-emerald-500/5 dark:text-slate-200 dark:ring-emerald-500/10 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
                  title={chapter.title}
                >
                  {chapter.title}
                </Link>
              ))}
            </div>
          ) : null}
          {chapters.length > 60 ? (
            <div className='mt-3 text-xs text-slate-500 dark:text-slate-400'>
              仅预览前 60 章，完整目录请进入阅读页侧边栏查看。
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
