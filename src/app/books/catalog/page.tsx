'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import BookCard from '@/components/books/BookCard';
import { buildBookDetailPath, cacheBookListItem } from '@/lib/book-route-cache.client';
import { BookCatalogResult, BookListItem, BookSource } from '@/lib/book.types';

function makeHref(sourceId: string, item: BookListItem) {
  return buildBookDetailPath(sourceId, item.id);
}

function CatalogSkeleton() {
  return (
    <div className='space-y-6 animate-pulse'>
      <div className='flex gap-2 overflow-x-auto pb-1'>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className='h-10 w-24 rounded-full bg-gray-200 dark:bg-gray-800' />
        ))}
      </div>
      <div className='rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
        <div className='h-6 w-40 rounded bg-gray-200 dark:bg-gray-800' />
        <div className='mt-3 h-4 w-72 rounded bg-gray-200 dark:bg-gray-800' />
      </div>
      <div className='flex gap-3 overflow-x-auto pb-2'>
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className='h-20 min-w-[180px] rounded-2xl bg-gray-200 dark:bg-gray-800' />
        ))}
      </div>
      <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className='space-y-3'>
            <div className='aspect-[3/4] rounded-2xl bg-gray-200 dark:bg-gray-800' />
            <div className='h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingMoreSkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className='space-y-3 animate-pulse'>
          <div className='aspect-[3/4] rounded-2xl bg-gray-200 dark:bg-gray-800' />
          <div className='h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-800' />
        </div>
      ))}
    </div>
  );
}

function isMeaningfulNavTitle(title?: string) {
  const text = (title || '').trim();
  return !!text && text !== '目录';
}

export default function BooksCatalogPage() {
  const searchParams = useSearchParams();
  const sourceId = searchParams.get('sourceId') || '';
  const href = searchParams.get('href') || '';
  const [sources, setSources] = useState<BookSource[]>([]);
  const [data, setData] = useState<BookCatalogResult | null>(null);
  const [entries, setEntries] = useState<BookListItem[]>([]);
  const [nextHref, setNextHref] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const navScrollerRef = useRef<HTMLDivElement | null>(null);
  const loadedPageHrefsRef = useRef<Set<string>>(new Set());
  const failedPageHrefsRef = useRef<Set<string>>(new Set());
  const navDragStateRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number; moved: boolean; pointerType: string } | null>(null);
  const suppressNavClickRef = useRef(false);

  useEffect(() => {
    fetch('/api/books/sources').then((res) => res.json()).then((json) => setSources(json.sources || []));
  }, []);

  const mergeEntries = useCallback((prev: BookListItem[], next: BookListItem[]) => {
    const seen = new Set(prev.map((item) => `${item.sourceId}::${item.id}::${item.detailHref || item.acquisitionLinks[0]?.href || ''}`));
    const merged = [...prev];
    for (const item of next) {
      const key = `${item.sourceId}::${item.id}::${item.detailHref || item.acquisitionLinks[0]?.href || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  }, []);

  const loadCatalog = useCallback(async (targetHref?: string, append = false) => {
    if (!sourceId) return;
    const normalizedHref = targetHref || '';
    if (append) {
      if (!normalizedHref || loadedPageHrefsRef.current.has(normalizedHref) || failedPageHrefsRef.current.has(normalizedHref)) return;
      setLoadingMore(true);
    } else {
      setError('');
      setData(null);
      setEntries([]);
      setNextHref(undefined);
      loadedPageHrefsRef.current = new Set(normalizedHref ? [normalizedHref] : ['__root__']);
      failedPageHrefsRef.current = new Set();
    }

    try {
      const params = new URLSearchParams({ sourceId });
      if (normalizedHref) params.set('href', normalizedHref);
      const res = await fetch(`/api/books/catalog?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '获取目录失败');
      const nextData = json as BookCatalogResult;
      if (append) {
        loadedPageHrefsRef.current.add(normalizedHref);
        setEntries((prev) => mergeEntries(prev, nextData.entries || []));
      } else {
        setData(nextData);
        setEntries(nextData.entries || []);
      }
      setNextHref(nextData.nextHref || undefined);
      if (!append) setData(nextData);
    } catch (err) {
      if (append && normalizedHref) {
        failedPageHrefsRef.current.add(normalizedHref);
        setNextHref(undefined);
      }
      setError(err instanceof Error ? err.message : '获取目录失败');
    } finally {
      setLoadingMore(false);
    }
  }, [mergeEntries, sourceId]);

  useEffect(() => {
    if (!sourceId) return;
    void loadCatalog(href, false);
  }, [sourceId, href, loadCatalog]);

  useEffect(() => {
    const node = loaderRef.current;
    if (!node || !nextHref || loadingMore || !data) return;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting && nextHref && !loadingMore) {
        void loadCatalog(nextHref, true);
      }
    }, { rootMargin: '800px 0px' });

    observer.observe(node);
    return () => observer.disconnect();
  }, [data, nextHref, loadingMore, loadCatalog]);


  const handleNavPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = navScrollerRef.current;
    if (!node) return;
    navDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: node.scrollLeft,
      moved: false,
      pointerType: event.pointerType,
    };
    suppressNavClickRef.current = false;
    if (event.pointerType !== 'mouse') {
      node.setPointerCapture?.(event.pointerId);
    }
  }, []);

  const handleNavPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const node = navScrollerRef.current;
    const dragState = navDragStateRef.current;
    if (!node || !dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const moveThreshold = dragState.pointerType === 'mouse' ? 8 : 4;
    if (Math.abs(deltaX) > moveThreshold) {
      dragState.moved = true;
      suppressNavClickRef.current = true;
    }
    node.scrollLeft = dragState.startScrollLeft - deltaX;
  }, []);

  const handleNavPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const node = navScrollerRef.current;
    const dragState = navDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.moved) {
      event.preventDefault();
      window.setTimeout(() => {
        suppressNavClickRef.current = false;
      }, 0);
    }
    navDragStateRef.current = null;
    if (dragState.pointerType !== 'mouse') {
      node?.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  const handleNavPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    handleNavPointerUp(event);
  }, [handleNavPointerUp]);

  const handleNavWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const node = navScrollerRef.current;
    if (!node) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    node.scrollLeft += delta;
  }, []);

  const navigationItems = useMemo(() => {
    const items = (data?.navigation || []).filter((item) => {
      const rel = (item.rel || '').toLowerCase();
      if (rel === 'next' || rel === 'previous') return false;
      return isMeaningfulNavTitle(item.title);
    });

    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.href}::${(item.title || '').trim()}`;
      if (!item.href || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap gap-2'>
        {sources.map((source) => (
          <Link key={source.id} href={`/books/catalog?sourceId=${encodeURIComponent(source.id)}`} className={`rounded-full px-4 py-2 text-sm ${source.id === sourceId ? 'bg-sky-600 text-white' : 'border border-gray-200 dark:border-gray-700'}`}>
            {source.name}
          </Link>
        ))}
      </div>
      {error ? <div className='text-sm text-red-500'>{error}</div> : null}
      {data ? (
        <>
          <section className='rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
            <h1 className='text-lg font-semibold'>{data.title}</h1>
            {data.subtitle ? <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>{data.subtitle}</p> : null}
          </section>
          {navigationItems.length > 0 ? (
            <section className='space-y-3'>
              <div className='text-sm font-medium text-gray-700 dark:text-gray-300'>目录</div>
              <div
                ref={navScrollerRef}
                className='flex gap-3 overflow-x-auto pb-2 cursor-grab select-none touch-pan-x active:cursor-grabbing'
                 onPointerDown={handleNavPointerDown}
                 onPointerMove={handleNavPointerMove}
                 onPointerUp={handleNavPointerUp}
                 onPointerCancel={handleNavPointerUp}
                 onPointerLeave={handleNavPointerLeave}
                 onWheel={handleNavWheel}
               >
                {navigationItems.map((item, index) => (
                  <Link
                     key={`${item.href}-${index}`}
                     href={`/books/catalog?sourceId=${encodeURIComponent(sourceId)}&href=${encodeURIComponent(item.href)}`}
                     draggable={false}
                     onDragStart={(event) => event.preventDefault()}
                     onClick={(event) => {
                       if (suppressNavClickRef.current) {
                         event.preventDefault();
                         suppressNavClickRef.current = false;
                       }
                     }}
                     className='min-w-[180px] rounded-2xl border border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-950'
                   >
                    <div className='line-clamp-2 font-medium'>{item.title.trim()}</div>
                    <div className='mt-2 text-xs text-gray-500 dark:text-gray-400'>点击进入子目录</div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <section className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
            {entries.map((item) => <BookCard key={`${item.sourceId}-${item.id}-${item.detailHref || item.acquisitionLinks[0]?.href || ''}`} item={item} href={makeHref(sourceId, item)} onNavigate={() => cacheBookListItem(item)} />)}
          </section>
          {loadingMore ? <LoadingMoreSkeleton /> : null}
          {!loadingMore && nextHref ? <div ref={loaderRef} className='h-8 w-full' /> : null}
        </>
      ) : !error ? <CatalogSkeleton /> : null}
    </div>
  );
}
