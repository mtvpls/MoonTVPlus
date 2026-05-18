'use client';

import { ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

import { getAllMangaReadRecords, getAllMangaShelf, saveMangaReadRecord, saveMangaShelf } from '@/lib/db.client';
import type { MangaChapter, MangaDetail, MangaReadRecord, MangaShelfItem } from '@/lib/manga.types';
import { processImageUrl } from '@/lib/utils';

import ProxyImage from '@/components/ProxyImage';

type ReadMode = 'single' | 'double' | 'vertical' | 'horizontal';
type ScaleMode = 'fit' | 'original';

const READ_MODE_STORAGE_KEY = 'mangaReadMode';
const SCALE_MODE_STORAGE_KEY = 'mangaScaleMode';
const PAGE_GAP_STORAGE_KEY = 'mangaPageGap';
const SAVE_INTERVAL_MS = 10000;
const PRELOAD_PAGE_COUNT = 5;

const READ_MODE_OPTIONS: Array<{ value: ReadMode; label: string }> = [
  { value: 'single', label: '单页' },
  { value: 'double', label: '双页' },
  { value: 'vertical', label: '垂直滚动' },
  { value: 'horizontal', label: '水平滚动' },
];

const SCALE_MODE_OPTIONS: Array<{ value: ScaleMode; label: string }> = [
  { value: 'fit', label: '适配屏幕' },
  { value: 'original', label: '原始大小' },
];

function MangaReadSkeleton({ readMode, pageGap }: { readMode: ReadMode; pageGap: number }) {
  if (readMode === 'horizontal') {
    return (
      <div className='flex min-h-[calc(100vh-8rem)] overflow-hidden' style={{ gap: `${pageGap}px` }}>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className='flex min-w-full items-center justify-center px-1'>
            <div className='h-full min-h-[calc(100vh-8rem)] w-full animate-pulse bg-gray-100 dark:bg-gray-900' />
          </div>
        ))}
      </div>
    );
  }

  if (readMode === 'single' || readMode === 'double') {
    return (
      <div className='flex min-h-[calc(100vh-8rem)] items-center justify-center'>
        <div
          className={`grid w-full max-w-6xl ${readMode === 'double' ? 'md:grid-cols-2' : 'grid-cols-1'}`}
          style={{ gap: `${pageGap}px` }}
        >
          {Array.from({ length: readMode === 'double' ? 2 : 1 }).map((_, index) => (
            <div key={index} className='min-h-[calc(100vh-8rem)] animate-pulse bg-gray-100 dark:bg-gray-900' />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col' style={{ gap: `${pageGap}px` }}>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className='aspect-[3/4] animate-pulse bg-gray-100 dark:bg-gray-900' />
      ))}
    </div>
  );
}

export default function MangaReadPage() {
  const searchParams = useSearchParams();
  const mangaId = searchParams.get('mangaId') || '';
  const sourceId = searchParams.get('sourceId') || '';
  const chapterId = searchParams.get('chapterId') || '';
  const title = searchParams.get('title') || '漫画阅读';
  const cover = searchParams.get('cover') || '';
  const sourceName = searchParams.get('sourceName') || sourceId;
  const chapterName = searchParams.get('chapterName') || '章节';
  const returnTo = searchParams.get('returnTo') || '/manga';

  const [pages, setPages] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(0);
  const [readMode, setReadMode] = useState<ReadMode>('vertical');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [pageGap, setPageGap] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  const [chapterListDesc, setChapterListDesc] = useState(false);
  const [mangaDetail, setMangaDetail] = useState<MangaDetail | null>(null);
  const [showChapterComplete, setShowChapterComplete] = useState(false);

  const verticalPageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const horizontalContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingRecordRef = useRef<MangaReadRecord | null>(null);
  const pendingRecordDirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const restoredChapterKeyRef = useRef<string | null>(null);
  const previousReadModeRef = useRef<ReadMode>('vertical');
  const requestVerticalPageSyncRef = useRef<(() => void) | null>(null);
  const currentVerticalPageIndexRef = useRef(0);
  const preloadedImageUrlsRef = useRef<Set<string>>(new Set());
  const activeChapterRef = useRef<HTMLAnchorElement | null>(null);

  const getCurrentVerticalPageIndex = () => {
    if (!verticalPageRefs.current.length) return 0;
    const topAnchor = 80;
    let currentIndex = 0;

    for (let index = 0; index < verticalPageRefs.current.length; index += 1) {
      const node = verticalPageRefs.current[index];
      if (!node) continue;

      const rect = node.getBoundingClientRect();
      if (rect.top <= topAnchor) {
        currentIndex = index;
      }
    }

    return currentIndex;
  };

  const handleVerticalImageLoad = () => {
    requestVerticalPageSyncRef.current?.();
  };

  const getPreloadAnchorPage = () => (
    readMode === 'vertical' ? currentVerticalPageIndexRef.current : activePage
  );

  const getImageLoadingStrategy = (index: number): 'eager' | 'lazy' => {
    const anchorPage = getPreloadAnchorPage();
    return index >= Math.max(anchorPage - 1, 0) && index <= anchorPage + PRELOAD_PAGE_COUNT
      ? 'eager'
      : 'lazy';
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedMode = window.localStorage.getItem(READ_MODE_STORAGE_KEY) as ReadMode | null;
    if (savedMode && READ_MODE_OPTIONS.some((item) => item.value === savedMode)) {
      setReadMode(savedMode);
    }
    const savedScaleMode = window.localStorage.getItem(SCALE_MODE_STORAGE_KEY) as ScaleMode | null;
    if (savedScaleMode && SCALE_MODE_OPTIONS.some((item) => item.value === savedScaleMode)) {
      setScaleMode(savedScaleMode);
    }
    const savedGap = Number(window.localStorage.getItem(PAGE_GAP_STORAGE_KEY) || 0);
    if (!Number.isNaN(savedGap)) {
      setPageGap(Math.min(Math.max(savedGap, 0), 48));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(READ_MODE_STORAGE_KEY, readMode);
  }, [readMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SCALE_MODE_STORAGE_KEY, scaleMode);
  }, [scaleMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PAGE_GAP_STORAGE_KEY, String(pageGap));
  }, [pageGap]);

  useEffect(() => {
    const handleToggleSettings = () => {
      setSettingsOpen((prev) => !prev);
      setControlsVisible(false);
      setChapterListOpen(false);
    };

    window.addEventListener('manga-read-toggle-settings', handleToggleSettings);
    return () => {
      window.removeEventListener('manga-read-toggle-settings', handleToggleSettings);
    };
  }, []);

  useEffect(() => {
    const handleToggleChapters = () => {
      setChapterListOpen((prev) => !prev);
      setControlsVisible(false);
      setSettingsOpen(false);
    };

    window.addEventListener('manga-read-toggle-chapters', handleToggleChapters);
    return () => {
      window.removeEventListener('manga-read-toggle-chapters', handleToggleChapters);
    };
  }, []);

  useEffect(() => {
    if (!chapterId) return;
    fetch(`/api/manga/pages?chapterId=${encodeURIComponent(chapterId)}`)
      .then((res) => res.json())
      .then((data) => setPages(data.pages || []))
      .catch(() => setPages([]));
  }, [chapterId]);

  useEffect(() => {
    if (!mangaId || !sourceId) return;

    const params = new URLSearchParams({
      mangaId,
      sourceId,
      title,
      cover,
      sourceName,
    });

    fetch(`/api/manga/detail?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setMangaDetail(data))
      .catch(() => setMangaDetail(null));
  }, [cover, mangaId, sourceId, sourceName, title]);

  useEffect(() => {
    setActivePage(0);
    restoredChapterKeyRef.current = null;
    preloadedImageUrlsRef.current.clear();
  }, [chapterId]);

  useEffect(() => {
    if (!pages.length || !mangaId || !sourceId || !chapterId) return;

    const chapterKey = `${sourceId}+${mangaId}+${chapterId}`;
    if (restoredChapterKeyRef.current === chapterKey) return;

    let cancelled = false;

    getAllMangaReadRecords()
      .then((records) => {
        if (cancelled) return;

        const record = records[`${sourceId}+${mangaId}`];
        if (!record || record.chapterId !== chapterId) {
          restoredChapterKeyRef.current = chapterKey;
          return;
        }

        const nextPage = Math.min(Math.max(record.pageIndex || 0, 0), Math.max(pages.length - 1, 0));
        setActivePage(nextPage);
        restoredChapterKeyRef.current = chapterKey;

        if (readMode === 'vertical') {
          window.setTimeout(() => {
            const node = verticalPageRefs.current[nextPage];
            node?.scrollIntoView({ block: 'start' });
          }, 0);
          return;
        }

        if (readMode === 'horizontal') {
          window.setTimeout(() => {
            const container = horizontalContainerRef.current;
            if (!container) return;
            container.scrollTo({
              left: container.clientWidth * nextPage,
              behavior: 'auto',
            });
          }, 0);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [chapterId, mangaId, pages.length, readMode, sourceId]);

  useEffect(() => {
    setShowChapterComplete(false);
  }, [activePage, chapterId, readMode]);

  useEffect(() => {
    if (readMode !== 'vertical' || !pages.length || !mangaId || !sourceId || !chapterId) return;

    let ticking = false;
    let rafId = 0;
    let lastScrollTop = -1;
    let lastInnerHeight = -1;
    const scrollingElement = document.scrollingElement || document.documentElement;

    const updateActivePageFromViewport = () => {
      ticking = false;
      const nextIndex = getCurrentVerticalPageIndex();
      currentVerticalPageIndexRef.current = nextIndex;

      setActivePage((prev) => (prev === nextIndex ? prev : nextIndex));
    };

    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateActivePageFromViewport);
    };

    requestVerticalPageSyncRef.current = requestUpdate;

    const watchScrollPosition = () => {
      const nextScrollTop = scrollingElement.scrollTop;
      const nextInnerHeight = window.innerHeight;

      if (nextScrollTop !== lastScrollTop || nextInnerHeight !== lastInnerHeight) {
        lastScrollTop = nextScrollTop;
        lastInnerHeight = nextInnerHeight;
        requestUpdate();
      }

      rafId = window.requestAnimationFrame(watchScrollPosition);
    };

    requestUpdate();
    rafId = window.requestAnimationFrame(watchScrollPosition);
    window.addEventListener('scroll', requestUpdate, { passive: true });
    document.addEventListener('scroll', requestUpdate, { passive: true, capture: true });
    window.addEventListener('resize', requestUpdate);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        requestUpdate();
      });

      verticalPageRefs.current.forEach((node) => {
        if (node) {
          resizeObserver?.observe(node);
        }
      });
    }

    return () => {
      requestVerticalPageSyncRef.current = null;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', requestUpdate);
      document.removeEventListener('scroll', requestUpdate, true);
      window.removeEventListener('resize', requestUpdate);
      resizeObserver?.disconnect();
    };
  }, [readMode, pages, mangaId, sourceId, chapterId]);

  useEffect(() => {
    if (readMode !== 'horizontal') return;
    const container = horizontalContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      const width = container.clientWidth || 1;
      const nextPage = Math.round(container.scrollLeft / width);
      setActivePage(Math.min(Math.max(nextPage, 0), Math.max(pages.length - 1, 0)));
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [readMode, pages.length]);

  useEffect(() => {
    if (!pages.length) {
      previousReadModeRef.current = readMode;
      return;
    }

    const previousReadMode = previousReadModeRef.current;
    previousReadModeRef.current = readMode;
    if (previousReadMode === readMode) return;

    const targetPage = Math.min(Math.max(activePage, 0), Math.max(pages.length - 1, 0));

    if (readMode === 'vertical') {
      window.setTimeout(() => {
        const node = verticalPageRefs.current[targetPage];
        node?.scrollIntoView({ block: 'start' });
      }, 0);
      return;
    }

    if (readMode === 'horizontal') {
      window.setTimeout(() => {
        const container = horizontalContainerRef.current;
        if (!container) return;
        container.scrollTo({
          left: container.clientWidth * targetPage,
          behavior: 'auto',
        });
      }, 0);
    }
  }, [activePage, pages.length, readMode]);

  useEffect(() => {
    if (!pages.length || !mangaId || !sourceId || !chapterId) return;
    const currentPageIndex = readMode === 'vertical' ? currentVerticalPageIndexRef.current : activePage;

    pendingRecordRef.current = {
      title,
      cover,
      sourceId,
      sourceName,
      mangaId,
      chapterId,
      chapterName,
      pageIndex: currentPageIndex,
      pageCount: pages.length,
      saveTime: Date.now(),
    };
    pendingRecordDirtyRef.current = true;
  }, [activePage, chapterId, chapterName, cover, mangaId, pages.length, readMode, sourceId, sourceName, title]);

  useEffect(() => {
    if (typeof window === 'undefined' || !pages.length) return;

    const anchorPage = getPreloadAnchorPage();
    const preloadTargets = pages.slice(anchorPage + 1, anchorPage + 1 + PRELOAD_PAGE_COUNT);

    preloadTargets.forEach((page) => {
      const resolvedUrl = processImageUrl(page);
      if (!resolvedUrl || preloadedImageUrlsRef.current.has(resolvedUrl)) return;

      const img = new window.Image();
      img.decoding = 'async';
      img.src = resolvedUrl;
      preloadedImageUrlsRef.current.add(resolvedUrl);
    });
  }, [activePage, pages, readMode]);

  useEffect(() => {
    if (!mangaId || !sourceId || !chapterId) return;

    const flushPendingRecord = () => {
      const record = pendingRecordRef.current;
      if (!record || !pendingRecordDirtyRef.current || saveInFlightRef.current) return;

      const recordToSave =
        readMode === 'vertical'
          ? {
              ...record,
              pageIndex: getCurrentVerticalPageIndex(),
            }
          : record;

      saveInFlightRef.current = true;
      saveMangaReadRecord(sourceId, mangaId, {
        ...recordToSave,
        saveTime: Date.now(),
      })
        .then(() => {
          pendingRecordRef.current = recordToSave;
          pendingRecordDirtyRef.current = false;
        })
        .catch(() => undefined)
        .finally(() => {
          saveInFlightRef.current = false;
        });
    };

    const flushPendingRecordOnLeave = () => {
      if (!pendingRecordDirtyRef.current || saveInFlightRef.current) return;
      flushPendingRecord();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingRecordOnLeave();
      }
    };

    const intervalId = window.setInterval(flushPendingRecord, SAVE_INTERVAL_MS);
    window.addEventListener('pagehide', flushPendingRecordOnLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pagehide', flushPendingRecordOnLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [chapterId, mangaId, readMode, sourceId]);

  useEffect(() => {
    if (!mangaId || !sourceId || !chapterId || !mangaDetail) return;

    const key = `${sourceId}+${mangaId}`;
    const orderedChapters = [...(mangaDetail.chapters || [])].sort((a, b) => {
      const diff = (a.chapterNumber || 0) - (b.chapterNumber || 0);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });
    const latestChapter = orderedChapters[orderedChapters.length - 1];
    const currentChapterIndex = orderedChapters.findIndex((chapter) => chapter.id === chapterId);
    const nextUnreadChapterCount =
      currentChapterIndex >= 0
        ? Math.max(orderedChapters.length - currentChapterIndex - 1, 0)
        : undefined;

    getAllMangaShelf()
      .then(async (shelf) => {
        const item = shelf[key];
        if (!item) return;

        const nextItem: MangaShelfItem = {
          ...item,
          lastChapterId: chapterId,
          lastChapterName: chapterName,
          latestChapterId: latestChapter?.id || item.latestChapterId,
          latestChapterName: latestChapter?.name || item.latestChapterName,
          latestChapterCount: orderedChapters.length || item.latestChapterCount,
          unreadChapterCount: nextUnreadChapterCount,
        };

        const changed =
          nextItem.lastChapterId !== item.lastChapterId ||
          nextItem.lastChapterName !== item.lastChapterName ||
          nextItem.latestChapterId !== item.latestChapterId ||
          nextItem.latestChapterName !== item.latestChapterName ||
          nextItem.latestChapterCount !== item.latestChapterCount ||
          nextItem.unreadChapterCount !== item.unreadChapterCount;

        if (!changed) return;
        await saveMangaShelf(sourceId, mangaId, nextItem);
      })
      .catch(() => undefined);
  }, [chapterId, chapterName, mangaDetail, mangaId, sourceId]);

  const hideTransientUi = () => {
    setControlsVisible(false);
    setSettingsOpen(false);
    setChapterListOpen(false);
    setShowChapterComplete(false);
  };

  const isAtChapterEnd = () => {
    if (!pages.length) return false;

    if (readMode === 'double') {
      return activePage >= Math.max(pages.length - 2, 0);
    }

    if (readMode === 'vertical') {
      const scrollBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight;
      return activePage >= pages.length - 1 && scrollBottom >= pageBottom - 24;
    }

    return activePage >= pages.length - 1;
  };

  const openChapterComplete = () => {
    if (!isAtChapterEnd()) return false;
    setShowChapterComplete(true);
    setControlsVisible(false);
    setSettingsOpen(false);
    return true;
  };

  const clampPage = (page: number) => {
    if (!pages.length) return 0;
    return Math.min(Math.max(page, 0), pages.length - 1);
  };

  const scrollHorizontalToPage = (page: number) => {
    const container = horizontalContainerRef.current;
    if (!container) return;
    container.scrollTo({
      left: container.clientWidth * page,
      behavior: 'smooth',
    });
  };

  const goPrev = () => {
    if (!pages.length) return;
    if (readMode === 'vertical') {
      window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
      hideTransientUi();
      return;
    }
    if (readMode === 'horizontal') {
      const nextPage = clampPage(activePage - 1);
      setActivePage(nextPage);
      scrollHorizontalToPage(nextPage);
      hideTransientUi();
      return;
    }
    setActivePage((prev) => clampPage(prev - (readMode === 'double' ? 2 : 1)));
    hideTransientUi();
  };

  const goNext = () => {
    if (!pages.length) return;
    if (readMode === 'vertical') {
      if (openChapterComplete()) return;
      window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
      hideTransientUi();
      return;
    }
    if (readMode === 'horizontal') {
      if (openChapterComplete()) return;
      const nextPage = clampPage(activePage + 1);
      setActivePage(nextPage);
      scrollHorizontalToPage(nextPage);
      hideTransientUi();
      return;
    }
    if (openChapterComplete()) return;
    setActivePage((prev) => clampPage(prev + (readMode === 'double' ? 2 : 1)));
    hideTransientUi();
  };

  const progress = useMemo(
    () => (pages.length ? Math.round(((activePage + 1) / pages.length) * 100) : 0),
    [activePage, pages.length]
  );

  const nextChapter = useMemo<MangaChapter | null>(() => {
    const chapters = mangaDetail?.chapters || [];
    if (!chapters.length) return null;

    const orderedChapters = [...chapters].sort((a, b) => {
      const chapterDiff = (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0);
      if (chapterDiff !== 0) return chapterDiff;
      return (a.uploadDate ?? 0) - (b.uploadDate ?? 0);
    });

    const currentIndex = orderedChapters.findIndex((item) => item.id === chapterId);
    if (currentIndex === -1 || currentIndex >= orderedChapters.length - 1) return null;

    return orderedChapters[currentIndex + 1];
  }, [chapterId, mangaDetail?.chapters]);

  const chapterList = useMemo(() => {
    const chapters = mangaDetail?.chapters || [];
    return [...chapters].sort((a, b) => {
      const chapterDiff = (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0);
      if (chapterDiff !== 0) return chapterDiff;
      return (a.uploadDate ?? 0) - (b.uploadDate ?? 0);
    });
  }, [mangaDetail?.chapters]);

  const orderedChapterList = useMemo(
    () => (chapterListDesc ? [...chapterList].reverse() : chapterList),
    [chapterList, chapterListDesc]
  );

  useEffect(() => {
    if (!chapterListOpen) return;

    const rafId = window.requestAnimationFrame(() => {
      activeChapterRef.current?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'auto',
      });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [chapterId, chapterListOpen, orderedChapterList]);

  const pagedItems = useMemo(() => {
    if (readMode === 'single') {
      return pages[activePage] ? [pages[activePage]] : [];
    }
    if (readMode === 'double') {
      return pages.slice(activePage, activePage + 2);
    }
    return [];
  }, [activePage, pages, readMode]);

  const imageClassName = useMemo(() => {
    if (scaleMode === 'original') {
      return 'block mx-auto h-auto w-auto max-w-none object-none';
    }
    if (readMode === 'single' || readMode === 'double') {
      return 'block h-auto w-full object-contain sm:mx-auto sm:max-h-[calc(100vh-8rem)] sm:w-auto sm:max-w-full';
    }
    return 'block h-auto w-full object-contain';
  }, [readMode, scaleMode]);

  const handleReaderClick = (event: MouseEvent<HTMLDivElement>) => {
    if (settingsOpen) return;
    if (readMode === 'vertical') {
      setControlsVisible((prev) => !prev);
      setShowChapterComplete(false);
      return;
    }

    const { clientX } = event;
    const width = window.innerWidth;
    const leftBoundary = width / 3;
    const rightBoundary = (width / 3) * 2;

    if (clientX < leftBoundary) {
      goPrev();
      return;
    }
    if (clientX > rightBoundary) {
      goNext();
      return;
    }
    setControlsVisible((prev) => !prev);
    setSettingsOpen(false);
  };

  return (
    <div className='mx-auto max-w-6xl'>
      {settingsOpen && (
        <div
          className='fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4'
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className='w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-950'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='mb-4'>
              <div className='text-base font-semibold text-gray-900 dark:text-gray-100'>阅读设置</div>
              <div className='mt-1 text-xs text-gray-500'>可继续扩展更多阅读参数</div>
            </div>

            <div className='space-y-5'>
              <div>
                <div className='mb-2 text-sm font-medium text-gray-700 dark:text-gray-200'>显示方式</div>
                <div className='grid grid-cols-2 gap-2'>
                  {READ_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      className={`rounded-2xl px-3 py-2 text-sm transition ${
                        readMode === option.value
                          ? 'bg-sky-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                      }`}
                      onClick={() => setReadMode(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className='mb-2 text-sm font-medium text-gray-700 dark:text-gray-200'>缩放类型</div>
                <div className='grid grid-cols-2 gap-2'>
                  {SCALE_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      className={`rounded-2xl px-3 py-2 text-sm transition ${
                        scaleMode === option.value
                          ? 'bg-sky-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                      }`}
                      onClick={() => setScaleMode(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className='mb-2 flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200'>
                  <span>图片间隔</span>
                  <span className='text-xs text-gray-500'>{pageGap}px</span>
                </div>
                <input
                  type='range'
                  min='0'
                  max='48'
                  step='2'
                  value={pageGap}
                  onChange={(e) => setPageGap(Number(e.target.value))}
                  className='w-full accent-sky-600'
                />
                <div className='mt-1 text-xs text-gray-500'>滚动阅读时，两张图片之间的间隔</div>
              </div>

              <div className='flex justify-end'>
                <button
                  type='button'
                  className='rounded-2xl bg-sky-600 px-4 py-2 text-sm font-medium text-white'
                  onClick={() => setSettingsOpen(false)}
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {chapterListOpen && (
        <div className='fixed inset-0 z-40 bg-black/30' onClick={() => setChapterListOpen(false)}>
          <div
            className='absolute right-0 top-14 h-[calc(100vh-3.5rem)] w-full max-w-sm overflow-y-auto border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-950 sm:top-16 sm:h-[calc(100vh-4rem)]'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='p-4'>
              <div className='mb-3 flex items-center justify-end'>
                <button
                  type='button'
                  className='inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                  onClick={() => setChapterListDesc((prev) => !prev)}
                >
                  {chapterListDesc ? <ArrowDownWideNarrow className='h-4 w-4' /> : <ArrowUpWideNarrow className='h-4 w-4' />}
                  {chapterListDesc ? '倒序' : '正序'}
                </button>
              </div>
              <div className='space-y-2'>
                {orderedChapterList.map((chapter) => {
                  const active = chapter.id === chapterId;
                  return (
                    <Link
                      key={chapter.id}
                      ref={active ? activeChapterRef : null}
                      href={`/manga/read?mangaId=${mangaId}&sourceId=${sourceId}&chapterId=${chapter.id}&title=${encodeURIComponent(title)}&cover=${encodeURIComponent(cover)}&sourceName=${encodeURIComponent(sourceName)}&chapterName=${encodeURIComponent(chapter.name)}&returnTo=${encodeURIComponent(returnTo)}`}
                      className={`group relative block rounded-2xl px-4 py-3 text-sm transition ${
                        active
                          ? 'bg-sky-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900'
                      }`}
                      onClick={() => setChapterListOpen(false)}
                    >
                      <span className='block truncate'>{chapter.name}</span>
                      <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 dark:bg-gray-900 text-white text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-out whitespace-nowrap z-[100] pointer-events-none'>
                        <div className='text-sm'>{chapter.name}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className='relative min-h-[calc(100vh-5rem)] select-none px-0 py-3 sm:px-3'
        onClick={handleReaderClick}
      >
        {showChapterComplete && (
          <div className='fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4' onClick={() => setShowChapterComplete(false)}>
            <div
              className='w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-xl dark:border-gray-700 dark:bg-gray-950'
              onClick={(event) => event.stopPropagation()}
            >
              <div className='text-lg font-semibold text-gray-900 dark:text-gray-100'>{chapterName} 阅读完毕</div>
              <div className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
                {nextChapter ? '当前章节已读完，可继续阅读下一话' : '当前章节已读完'}
              </div>
              <div className='mt-6 flex flex-col gap-3'>
                {nextChapter ? (
                  <Link
                    href={`/manga/read?mangaId=${mangaId}&sourceId=${sourceId}&chapterId=${nextChapter.id}&title=${encodeURIComponent(title)}&cover=${encodeURIComponent(cover)}&sourceName=${encodeURIComponent(sourceName)}&chapterName=${encodeURIComponent(nextChapter.name)}&returnTo=${encodeURIComponent(returnTo)}`}
                    className='rounded-2xl bg-sky-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-700'
                  >
                    下一话：{nextChapter.name}
                  </Link>
                ) : null}
                <button
                  type='button'
                  className='rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                  onClick={() => setShowChapterComplete(false)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        <div
          className={`fixed right-3 top-1/2 z-20 h-40 w-1 -translate-y-1/2 overflow-hidden rounded-full bg-gray-200/80 transition-all duration-200 dark:bg-gray-700/80 ${
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div
            className='absolute bottom-0 left-0 w-full rounded-full bg-sky-500 transition-all'
            style={{ height: `${progress}%` }}
          />
        </div>

        {pages.length > 0 && (
          <div className='pointer-events-none fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/15 px-2 py-0.5 text-sm font-medium text-white/90 backdrop-blur-sm dark:bg-white/10 dark:text-white/85'>
            {Math.min(activePage + 1, pages.length)}/{pages.length}
          </div>
        )}

        {pages.length === 0 && <MangaReadSkeleton readMode={readMode} pageGap={pageGap} />}

        {pages.length === 0 ? (
          null
        ) : readMode === 'vertical' ? (
          <div className='flex flex-col' style={{ gap: `${pageGap}px` }}>
            {pages.map((page, index) => (
              <div
                key={`${page}-${index}`}
                ref={(node) => {
                  verticalPageRefs.current[index] = node;
                }}
                data-index={index}
                className='overflow-hidden bg-gray-100 shadow-sm dark:bg-gray-900'
              >
                <ProxyImage
                  originalSrc={page}
                  alt={`${chapterName}-${index + 1}`}
                  className={imageClassName}
                  loading={getImageLoadingStrategy(index)}
                  onLoad={handleVerticalImageLoad}
                />
              </div>
            ))}
          </div>
        ) : readMode === 'horizontal' ? (
          <div
            ref={horizontalContainerRef}
            className='flex min-h-[calc(100vh-8rem)] snap-x snap-mandatory overflow-x-auto overflow-y-hidden scrollbar-hide'
            style={{ gap: `${pageGap}px` }}
          >
            {pages.map((page, index) => (
                <div key={`${page}-${index}`} className='flex min-w-full snap-center items-center justify-center px-1'>
                  <div className='w-full overflow-hidden bg-gray-100 shadow-sm dark:bg-gray-900'>
                  <ProxyImage
                    originalSrc={page}
                    alt={`${chapterName}-${index + 1}`}
                    className={imageClassName}
                    loading={getImageLoadingStrategy(index)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='flex min-h-[calc(100vh-8rem)] items-center justify-center'>
            <div className={`grid w-full max-w-6xl ${readMode === 'double' ? 'md:grid-cols-2' : 'grid-cols-1'}`} style={{ gap: `${pageGap}px` }}>
              {pagedItems.map((page, index) => (
                <div
                  key={`${page}-${index}`}
                  className='overflow-hidden bg-gray-100 shadow-sm dark:bg-gray-900'
                >
                  <ProxyImage
                    originalSrc={page}
                    alt={`${chapterName}-${activePage + index + 1}`}
                    className={imageClassName}
                    loading='eager'
                  />
                </div>
              ))}
              {readMode === 'double' && pagedItems.length === 1 && (
                <div className='hidden rounded-[24px] bg-transparent md:block' />
              )}
            </div>
          </div>
        )}
      </div>

      <Link
        href={`/manga/detail?mangaId=${mangaId}&sourceId=${sourceId}&title=${encodeURIComponent(title)}&cover=${encodeURIComponent(cover)}&sourceName=${encodeURIComponent(sourceName)}&returnTo=${encodeURIComponent(returnTo)}`}
        className='sr-only'
      >
        返回详情
      </Link>
    </div>
  );
}
