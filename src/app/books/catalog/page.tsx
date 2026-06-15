'use client';

import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  WheelEvent as ReactWheelEvent,
} from 'react';

import { BookCatalogResult, BookListItem, BookSource } from '@/lib/book.types';
import {
  buildBookDetailPath,
  cacheBookListItem,
} from '@/lib/book-route-cache.client';

import BookCard from '@/components/books/BookCard';

function makeHref(sourceId: string, item: BookListItem) {
  return buildBookDetailPath(sourceId, item.id);
}

function CatalogSkeleton() {
  return (
    <div className='space-y-6 animate-pulse'>
      <div className='flex gap-2 overflow-x-auto pb-1'>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className='h-10 w-24 rounded-full bg-gray-200 dark:bg-gray-800'
          />
        ))}
      </div>
      <div className='flex gap-2 overflow-x-auto pb-1'>
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className='h-10 w-28 shrink-0 rounded-full bg-gray-200 dark:bg-gray-800'
          />
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceId = searchParams.get('sourceId') || '';
  const href = searchParams.get('href') || '';
  const [sources, setSources] = useState<BookSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState(sourceId);
  const [selectedHref, setSelectedHref] = useState(href);
  const [data, setData] = useState<BookCatalogResult | null>(null);
  const [catalogNavigation, setCatalogNavigation] = useState<
    BookCatalogResult['navigation']
  >([]);
  const [entries, setEntries] = useState<BookListItem[]>([]);
  const [nextHref, setNextHref] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const sourceScrollerRef = useRef<HTMLDivElement | null>(null);
  const activeSourceItemRef = useRef<HTMLAnchorElement | null>(null);
  const navScrollerRef = useRef<HTMLDivElement | null>(null);
  const activeNavItemRef = useRef<HTMLAnchorElement | null>(null);
  const loadedPageHrefsRef = useRef<Set<string>>(new Set());
  const failedPageHrefsRef = useRef<Set<string>>(new Set());
  const sourceDragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
    pointerType: string;
  } | null>(null);
  const suppressSourceClickRef = useRef(false);
  const navDragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
    pointerType: string;
  } | null>(null);
  const suppressNavClickRef = useRef(false);

  const showImmediateContentLoading = useCallback(() => {
    setError('');
    setLoadingCatalog(true);
    setEntries([]);
    setNextHref(undefined);
  }, []);

  useEffect(() => {
    fetch('/api/books/sources')
      .then((res) => res.json())
      .then((json) => setSources(json.sources || []));
  }, []);

  useEffect(() => {
    setSelectedSourceId(sourceId);
    setCatalogNavigation([]);
  }, [sourceId]);

  useEffect(() => {
    setSelectedHref(href);
  }, [href]);

  useEffect(() => {
    if (!sourceId || !href || catalogNavigation.length > 0) return;
    let cancelled = false;

    const loadRootNavigation = async () => {
      try {
        const params = new URLSearchParams({ sourceId });
        const res = await fetch(`/api/books/catalog?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) return;
        if (!cancelled)
          setCatalogNavigation((json as BookCatalogResult).navigation || []);
      } catch {
        // 当前分类内容仍可正常展示，根目录分类加载失败时忽略。
      }
    };

    void loadRootNavigation();
    return () => {
      cancelled = true;
    };
  }, [sourceId, href, catalogNavigation.length]);

  useEffect(() => {
    if (!sourceId || href || catalogNavigation.length === 0) return;
    const firstNavigationItem = catalogNavigation.find((item) => {
      const rel = (item.rel || '').toLowerCase();
      return (
        item.href &&
        rel !== 'next' &&
        rel !== 'previous' &&
        isMeaningfulNavTitle(item.title)
      );
    });
    if (!firstNavigationItem?.href) return;
    setSelectedHref(firstNavigationItem.href);
    router.replace(
      `/books/catalog?sourceId=${encodeURIComponent(
        sourceId
      )}&href=${encodeURIComponent(firstNavigationItem.href)}`
    );
  }, [catalogNavigation, href, router, sourceId]);

  const mergeEntries = useCallback(
    (prev: BookListItem[], next: BookListItem[]) => {
      const seen = new Set(
        prev.map(
          (item) =>
            `${item.sourceId}::${item.id}::${
              item.detailHref || item.acquisitionLinks[0]?.href || ''
            }`
        )
      );
      const merged = [...prev];
      for (const item of next) {
        const key = `${item.sourceId}::${item.id}::${
          item.detailHref || item.acquisitionLinks[0]?.href || ''
        }`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
      return merged;
    },
    []
  );

  const loadCatalog = useCallback(
    async (targetHref?: string, append = false) => {
      if (!sourceId) return;
      const normalizedHref = targetHref || '';
      if (append) {
        if (
          !normalizedHref ||
          loadedPageHrefsRef.current.has(normalizedHref) ||
          failedPageHrefsRef.current.has(normalizedHref)
        )
          return;
        setLoadingMore(true);
      } else {
        setError('');
        setLoadingCatalog(true);
        if (!normalizedHref) setData(null);
        setEntries([]);
        setNextHref(undefined);
        loadedPageHrefsRef.current = new Set(
          normalizedHref ? [normalizedHref] : ['__root__']
        );
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
          setCatalogNavigation((prev) =>
            normalizedHref
              ? prev.length > 0
                ? prev
                : nextData.navigation || []
              : nextData.navigation || []
          );
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
        if (!append) setLoadingCatalog(false);
        setLoadingMore(false);
      }
    },
    [mergeEntries, sourceId]
  );

  useEffect(() => {
    if (!sourceId) return;
    void loadCatalog(href, false);
  }, [sourceId, href, loadCatalog]);

  useEffect(() => {
    const node = loaderRef.current;
    if (!node || !nextHref || loadingMore || !data) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && nextHref && !loadingMore) {
          void loadCatalog(nextHref, true);
        }
      },
      { rootMargin: '800px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [data, nextHref, loadingMore, loadCatalog]);

  const handleSourcePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const node = sourceScrollerRef.current;
      if (!node) return;
      sourceDragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: node.scrollLeft,
        moved: false,
        pointerType: event.pointerType,
      };
      suppressSourceClickRef.current = false;
      if (event.pointerType !== 'mouse') {
        node.setPointerCapture?.(event.pointerId);
      }
    },
    []
  );

  const handleSourcePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = sourceScrollerRef.current;
      const dragState = sourceDragStateRef.current;
      if (!node || !dragState || dragState.pointerId !== event.pointerId)
        return;
      const deltaX = event.clientX - dragState.startX;
      const moveThreshold = dragState.pointerType === 'mouse' ? 8 : 4;
      if (Math.abs(deltaX) > moveThreshold) {
        dragState.moved = true;
        suppressSourceClickRef.current = true;
      }
      node.scrollLeft = dragState.startScrollLeft - deltaX;
    },
    []
  );

  const handleSourcePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = sourceScrollerRef.current;
      const dragState = sourceDragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      if (dragState.moved) {
        event.preventDefault();
        window.setTimeout(() => {
          suppressSourceClickRef.current = false;
        }, 0);
      }
      sourceDragStateRef.current = null;
      if (dragState.pointerType !== 'mouse') {
        node?.releasePointerCapture?.(event.pointerId);
      }
    },
    []
  );

  const handleSourcePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') return;
      handleSourcePointerUp(event);
    },
    [handleSourcePointerUp]
  );

  const handleSourceWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const node = sourceScrollerRef.current;
      if (!node) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (!delta) return;
      node.scrollLeft += delta;
    },
    []
  );

  const handleNavPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
    },
    []
  );

  const handleNavPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = navScrollerRef.current;
      const dragState = navDragStateRef.current;
      if (!node || !dragState || dragState.pointerId !== event.pointerId)
        return;
      const deltaX = event.clientX - dragState.startX;
      const moveThreshold = dragState.pointerType === 'mouse' ? 8 : 4;
      if (Math.abs(deltaX) > moveThreshold) {
        dragState.moved = true;
        suppressNavClickRef.current = true;
      }
      node.scrollLeft = dragState.startScrollLeft - deltaX;
    },
    []
  );

  const handleNavPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
    },
    []
  );

  const handleNavPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') return;
      handleNavPointerUp(event);
    },
    [handleNavPointerUp]
  );

  const handleNavWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const node = navScrollerRef.current;
      if (!node) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (!delta) return;
      node.scrollLeft += delta;
    },
    []
  );

  const navigationItems = useMemo(() => {
    const items = (catalogNavigation || []).filter((item) => {
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
  }, [catalogNavigation]);

  useLayoutEffect(() => {
    if (!selectedHref || navigationItems.length === 0) return;

    const frameId = window.requestAnimationFrame(() => {
      const container = navScrollerRef.current;
      const activeItem = activeNavItemRef.current;
      if (!container || !activeItem) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeItem.getBoundingClientRect();
      const targetLeft =
        container.scrollLeft +
        activeRect.left -
        containerRect.left -
        (container.clientWidth - activeItem.clientWidth) / 2;
      container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectedHref, navigationItems]);

  useLayoutEffect(() => {
    if (!selectedSourceId || sources.length === 0) return;

    const frameId = window.requestAnimationFrame(() => {
      const container = sourceScrollerRef.current;
      const activeItem = activeSourceItemRef.current;
      if (!container || !activeItem) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeItem.getBoundingClientRect();
      const targetLeft =
        container.scrollLeft +
        activeRect.left -
        containerRect.left -
        (container.clientWidth - activeItem.clientWidth) / 2;
      container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectedSourceId, sources.length]);

  return (
    <div className='space-y-4'>
      <div
        ref={sourceScrollerRef}
        className='flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1.5 pt-2 cursor-grab select-none touch-pan-x active:cursor-grabbing'
        onPointerDown={handleSourcePointerDown}
        onPointerMove={handleSourcePointerMove}
        onPointerUp={handleSourcePointerUp}
        onPointerCancel={handleSourcePointerUp}
        onPointerLeave={handleSourcePointerLeave}
        onWheel={handleSourceWheel}
      >
        {sources.map((source) => (
          <Link
            key={source.id}
            ref={
              source.id === selectedSourceId ? activeSourceItemRef : undefined
            }
            href={`/books/catalog?sourceId=${encodeURIComponent(source.id)}`}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onClick={(event) => {
              if (suppressSourceClickRef.current) {
                event.preventDefault();
                suppressSourceClickRef.current = false;
                return;
              }
              setSelectedSourceId(source.id);
              setSelectedHref('');
              showImmediateContentLoading();
            }}
            className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              source.id === selectedSourceId
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                : 'border border-emerald-100 bg-white/70 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-500/10 dark:bg-gray-950/50 dark:text-gray-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
            }`}
          >
            {source.name}
          </Link>
        ))}
      </div>
      {data || navigationItems.length > 0 || error ? (
        <>
          {navigationItems.length > 0 ? (
            <div
              ref={navScrollerRef}
              className='flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1.5 pt-2 cursor-grab select-none touch-pan-x active:cursor-grabbing'
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
                  ref={
                    item.href === selectedHref ? activeNavItemRef : undefined
                  }
                  href={`/books/catalog?sourceId=${encodeURIComponent(
                    sourceId
                  )}&href=${encodeURIComponent(item.href)}`}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (suppressNavClickRef.current) {
                      event.preventDefault();
                      suppressNavClickRef.current = false;
                      return;
                    }
                    setSelectedHref(item.href);
                    showImmediateContentLoading();
                  }}
                  className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    item.href === selectedHref
                      ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                      : 'border border-emerald-100 bg-white/70 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-500/10 dark:bg-gray-950/50 dark:text-gray-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
                  }`}
                >
                  {item.title.trim()}
                </Link>
              ))}
            </div>
          ) : null}
          {error ? (
            <div className='flex min-h-[45vh] items-center justify-center px-4'>
              <div className='w-full max-w-md rounded-[2rem] border border-red-200 bg-white/85 p-6 text-center shadow-xl shadow-red-950/10 backdrop-blur dark:border-red-500/20 dark:bg-gray-950/75'>
                <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300'>
                  <AlertCircle className='h-6 w-6' />
                </div>
                <h2 className='mt-4 text-lg font-bold text-slate-950 dark:text-white'>
                  目录加载失败
                </h2>
                <p className='mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400'>
                  {error}
                </p>
              </div>
            </div>
          ) : loadingCatalog ? (
            <LoadingMoreSkeleton />
          ) : (
            <section className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
              {entries.map((item) => (
                <BookCard
                  key={`${item.sourceId}-${item.id}-${
                    item.detailHref || item.acquisitionLinks[0]?.href || ''
                  }`}
                  item={item}
                  href={makeHref(sourceId, item)}
                  onNavigate={() => cacheBookListItem(item)}
                />
              ))}
            </section>
          )}
          {loadingMore ? <LoadingMoreSkeleton /> : null}
          {!loadingMore && nextHref ? (
            <div ref={loaderRef} className='h-8 w-full' />
          ) : null}
        </>
      ) : !error ? (
        <CatalogSkeleton />
      ) : null}
    </div>
  );
}
