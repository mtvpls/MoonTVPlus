'use client';

import { ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { getAllMangaReadRecords, getAllMangaShelf, saveMangaReadRecord, saveMangaShelf } from '@/lib/db.client';
import type { MangaChapter, MangaDetail, MangaReadRecord, MangaShelfItem } from '@/lib/manga.types';
import { processImageUrl } from '@/lib/utils';

import {
  LIBRARY_BUTTON,
  LIBRARY_FIELD,
  LIBRARY_FOCUS,
  LIBRARY_GHOST_BUTTON,
  LIBRARY_MUTED,
  LIBRARY_ROW,
  LIBRARY_ROW_ACTIVE,
  LIBRARY_SERIF,
  LIBRARY_TEXT,
  READER_CANVAS,
  READER_CANVAS_SKELETON,
  READER_HUD,
  READER_SEGMENT,
  READER_SEGMENT_ACTIVE,
  READER_SEGMENT_IDLE,
  READER_SHEET,
  READER_SLIDER,
  READER_TOOLTIP,
} from '@/components/media/library';
import ProxyImage from '@/components/ProxyImage';

type ReadMode = 'single' | 'double' | 'vertical' | 'horizontal';
type ScaleMode = 'fit' | 'original';

const READ_MODE_STORAGE_KEY = 'mangaReadMode';
const SCALE_MODE_STORAGE_KEY = 'mangaScaleMode';
const PAGE_GAP_STORAGE_KEY = 'mangaPageGap';
const SAVE_INTERVAL_MS = 10000;
const PRELOAD_PAGE_COUNT = 5;
const BOTTOM_REACH_THRESHOLD = 24;
// 图片是懒加载且未预留宽高比，锚定后布局还会被撑开，在这段时间内持续纠偏
const ANCHOR_HOLD_MS = 8000;

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
            <div className={cn('h-full min-h-[calc(100vh-8rem)] w-full', READER_CANVAS_SKELETON)} />
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
            <div key={index} className={cn('min-h-[calc(100vh-8rem)]', READER_CANVAS_SKELETON)} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col' style={{ gap: `${pageGap}px` }}>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className={cn('aspect-[3/4]', READER_CANVAS_SKELETON)} />
      ))}
    </div>
  );
}

function ChapterEndActions({
  nextHref,
  nextName,
  detailHref,
  className = '',
}: {
  nextHref: string | null;
  nextName: string;
  detailHref: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {nextHref ? (
        <Link
          href={nextHref}
          className={cn('w-full max-w-sm px-4 py-3', LIBRARY_BUTTON)}
        >
          下一话：{nextName}
        </Link>
      ) : (
        <div className={cn('text-sm', LIBRARY_MUTED)}>已经是最后一话</div>
      )}
      <Link
        href={detailHref}
        className={cn('w-full max-w-sm px-4 py-3', LIBRARY_GHOST_BUTTON)}
      >
        返回详情
      </Link>
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
  const [jumpDialogOpen, setJumpDialogOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');

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
  const pendingAnchorPageRef = useRef<number | null>(null);
  const pendingAnchorDeadlineRef = useRef(0);

  const releasePendingAnchor = () => {
    pendingAnchorPageRef.current = null;
  };

  // globals.css 给 html/body 都设了 height:100% + overflow-x:hidden，纵向真正滚动的
  // 可能是 body 而不是 documentElement（那样 window.scrollY / scrollingElement.scrollTop
  // 恒为 0），所以读写都按"取真正可滚的那个"处理，两种情形都成立
  const getVerticalScroller = () => {
    const candidates = [document.documentElement, document.body].filter(
      (el): el is HTMLElement => !!el && el.scrollHeight > el.clientHeight + 1
    );
    if (!candidates.length) return document.scrollingElement || document.documentElement;
    return candidates.reduce((best, el) =>
      el.scrollHeight - el.clientHeight > best.scrollHeight - best.clientHeight ? el : best
    );
  };

  const getVerticalScrollTop = () =>
    Math.max(
      window.scrollY || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );

  const getVerticalMaxScrollTop = () => {
    const scroller = getVerticalScroller();
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  };

  const isScrolledToBottom = () => {
    if (typeof window === 'undefined' || !document.body) return false;
    const maxScrollTop = getVerticalMaxScrollTop();
    if (maxScrollTop < BOTTOM_REACH_THRESHOLD) return false;
    return getVerticalScrollTop() >= maxScrollTop - BOTTOM_REACH_THRESHOLD;
  };

  // 进入章节后把目标页钉在固定头部下沿：图片逐个加载会不断把布局撑开，
  // 所以在持有期内反复纠偏。页面上滚动的 scroll-margin-top 见渲染处的 scroll-mt-*
  const applyPendingAnchor = () => {
    if (readMode !== 'vertical') return;
    const target = pendingAnchorPageRef.current;
    if (target === null) return;
    if (Date.now() > pendingAnchorDeadlineRef.current) {
      pendingAnchorPageRef.current = null;
      return;
    }
    verticalPageRefs.current[target]?.scrollIntoView({ block: 'start' });
  };

  const getCurrentVerticalPageIndex = () => {
    if (!verticalPageRefs.current.length || !pages.length) return 0;

    // 末页往往比视口矮，滑到底时它的顶边仍低于 topAnchor，只靠顶边判定会一直停在倒数第二页
    if (isScrolledToBottom()) return pages.length - 1;

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

    // 进入章节时自行接管滚动位置：上一页/上一话残留的偏移不会带进来，
    // 有进度就落到上次读到的那页，没有就从第一页开始
    const applyEntryPosition = (targetPage: number) => {
      if (readMode === 'vertical') {
        pendingAnchorPageRef.current = targetPage;
        pendingAnchorDeadlineRef.current = Date.now() + ANCHOR_HOLD_MS;
        applyPendingAnchor();
        return;
      }

      getVerticalScroller().scrollTo({ top: 0, left: 0, behavior: 'auto' });

      if (readMode === 'horizontal') {
        scrollHorizontalToPage(targetPage, 'auto');
      }
    };

    const scheduleEntryPosition = (targetPage: number) => {
      window.setTimeout(() => applyEntryPosition(targetPage), 0);
    };

    getAllMangaReadRecords()
      .then((records) => {
        if (cancelled) return;

        const record = records[`${sourceId}+${mangaId}`];
        restoredChapterKeyRef.current = chapterKey;

        if (!record || record.chapterId !== chapterId) {
          setActivePage(0);
          scheduleEntryPosition(0);
          return;
        }

        const nextPage = Math.min(Math.max(record.pageIndex || 0, 0), Math.max(pages.length - 1, 0));
        setActivePage(nextPage);
        scheduleEntryPosition(nextPage);
      })
      .catch(() => {
        if (cancelled) return;
        restoredChapterKeyRef.current = chapterKey;
        scheduleEntryPosition(0);
      });

    return () => {
      cancelled = true;
    };
  }, [chapterId, mangaId, pages.length, readMode, sourceId]);

  useEffect(() => {
    setShowChapterComplete(false);
  }, [activePage, chapterId, readMode]);

  // 用户一旦自己操作（滑动/点击翻页/键盘）就停止纠偏，避免把人拽回锚点
  useEffect(() => {
    if (readMode !== 'vertical') return;

    const release = () => releasePendingAnchor();
    window.addEventListener('touchstart', release, { passive: true });
    window.addEventListener('pointerdown', release, { passive: true });
    window.addEventListener('mousedown', release, { passive: true });
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('keydown', release);

    return () => {
      window.removeEventListener('touchstart', release);
      window.removeEventListener('pointerdown', release);
      window.removeEventListener('mousedown', release);
      window.removeEventListener('wheel', release);
      window.removeEventListener('keydown', release);
    };
  }, [readMode]);

  useEffect(() => {
    if (readMode !== 'vertical' || !pages.length || !mangaId || !sourceId || !chapterId) return;

    let ticking = false;
    let rafId = 0;
    let lastScrollTop = -1;
    let lastInnerHeight = -1;

    const updateActivePageFromViewport = () => {
      ticking = false;
      applyPendingAnchor();
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
      const nextScrollTop = getVerticalScrollTop();
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
      // 每屏宽度是容器宽度加图片间隔，用宽度直接算会随间隔累积偏移
      const pitch = (container.clientWidth || 1) + pageGap;
      const nextPage = Math.round(container.scrollLeft / pitch);
      setActivePage(Math.min(Math.max(nextPage, 0), Math.max(pages.length - 1, 0)));
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [readMode, pages.length, pageGap]);

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
        scrollHorizontalToPage(targetPage, 'auto');
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
      return activePage >= pages.length - 1 && isScrolledToBottom();
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

  const scrollHorizontalToPage = (page: number, behavior: ScrollBehavior = 'smooth') => {
    const container = horizontalContainerRef.current;
    if (!container) return;
    // 每屏宽度是容器宽度加图片间隔，只用宽度乘页码会随间隔累积错位
    const pitch = (container.clientWidth || 1) + pageGap;
    container.scrollTo({
      left: pitch * page,
      behavior,
    });
  };

  const openJumpDialog = () => {
    if (pages.length <= 1) return;
    setJumpValue(String(Math.min(activePage + 1, pages.length)));
    setJumpDialogOpen(true);
  };

  const jumpToPage = (page: number) => {
    const next = clampPage(page);

    if (readMode === 'vertical') {
      // 大跨度跳页用瞬时定位，平滑滚动会一路扫过中间所有图
      pendingAnchorPageRef.current = null;
      verticalPageRefs.current[next]?.scrollIntoView({ block: 'start' });
    } else if (readMode === 'horizontal') {
      scrollHorizontalToPage(next, 'auto');
    }

    setActivePage(next);
  };

  const submitJump = () => {
    const parsed = Number.parseInt(jumpValue, 10);
    setJumpDialogOpen(false);
    if (!Number.isFinite(parsed)) return;
    jumpToPage(parsed - 1);
  };

  const goPrev = () => {
    if (!pages.length) return;
    if (readMode === 'vertical') {
      getVerticalScroller().scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
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
      getVerticalScroller().scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
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

  const buildChapterHref = (target: MangaChapter) =>
    `/manga/read?mangaId=${mangaId}&sourceId=${sourceId}&chapterId=${target.id}&title=${encodeURIComponent(title)}&cover=${encodeURIComponent(cover)}&sourceName=${encodeURIComponent(sourceName)}&chapterName=${encodeURIComponent(target.name)}&returnTo=${encodeURIComponent(returnTo)}`;

  const buildDetailHref = () =>
    `/manga/detail?mangaId=${mangaId}&sourceId=${sourceId}&title=${encodeURIComponent(title)}&cover=${encodeURIComponent(cover)}&sourceName=${encodeURIComponent(sourceName)}&returnTo=${encodeURIComponent(returnTo)}`;

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
            className={cn(READER_SHEET, 'w-full max-w-sm p-5')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className='mb-4'>
              <div
                className={cn(
                  'text-base font-semibold',
                  LIBRARY_TEXT,
                  LIBRARY_SERIF
                )}
              >
                阅读设置
              </div>
            </div>

            <div className='space-y-5'>
              <div>
                <div className={cn('mb-2 text-sm font-medium', LIBRARY_TEXT)}>
                  显示方式
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  {READ_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      className={cn(
                        READER_SEGMENT,
                        readMode === option.value
                          ? READER_SEGMENT_ACTIVE
                          : READER_SEGMENT_IDLE
                      )}
                      onClick={() => setReadMode(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className={cn('mb-2 text-sm font-medium', LIBRARY_TEXT)}>
                  缩放类型
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  {SCALE_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      className={cn(
                        READER_SEGMENT,
                        scaleMode === option.value
                          ? READER_SEGMENT_ACTIVE
                          : READER_SEGMENT_IDLE
                      )}
                      onClick={() => setScaleMode(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div
                  className={cn(
                    'mb-2 flex items-center justify-between text-sm font-medium',
                    LIBRARY_TEXT
                  )}
                >
                  <span>图片间隔</span>
                  <span className={cn('text-xs', LIBRARY_MUTED)}>
                    {pageGap}px
                  </span>
                </div>
                <input
                  type='range'
                  min='0'
                  max='48'
                  step='2'
                  value={pageGap}
                  onChange={(e) => setPageGap(Number(e.target.value))}
                  className={READER_SLIDER}
                />
                <div className={cn('mt-1 text-xs', LIBRARY_MUTED)}>
                  滚动阅读时，两张图片之间的间隔
                </div>
              </div>

              <div className='flex justify-end'>
                <button
                  type='button'
                  className={LIBRARY_BUTTON}
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
            className='absolute right-0 top-14 h-[calc(100vh-3.5rem)] w-full max-w-sm overflow-y-auto border-l border-library-edge bg-library-card shadow-xl dark:border-library-night-edge dark:bg-library-night-card sm:top-16 sm:h-[calc(100vh-4rem)]'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='p-4'>
              <div className='mb-3 flex items-center justify-end'>
                <button
                  type='button'
                  className={cn(LIBRARY_GHOST_BUTTON, 'px-3 py-2')}
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
                      href={buildChapterHref(chapter)}
                      className={cn(
                        'group relative block px-4 py-3 text-sm transition-colors duration-200',
                        LIBRARY_FOCUS,
                        active
                          ? cn('rounded-md border', LIBRARY_ROW_ACTIVE)
                          : cn(
                              LIBRARY_ROW,
                              'hover:border-library-ochre dark:hover:border-library-night-ochre'
                            )
                      )}
                      onClick={() => setChapterListOpen(false)}
                    >
                      <span className='block truncate'>{chapter.name}</span>
                      <div
                        className={cn(
                          'pointer-events-none invisible absolute bottom-full left-1/2 z-[100] mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg px-3 py-2 text-sm opacity-0 shadow-xl transition-all duration-200 ease-out group-hover:visible group-hover:opacity-100',
                          READER_TOOLTIP
                        )}
                      >
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
              className={cn(READER_SHEET, 'w-full max-w-sm p-6 text-center')}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className={cn(
                  'text-lg font-semibold',
                  LIBRARY_TEXT,
                  LIBRARY_SERIF
                )}
              >
                {chapterName} 阅读完毕
              </div>
              <div className={cn('mt-2 text-sm', LIBRARY_MUTED)}>
                {nextChapter ? '当前章节已读完，可继续阅读下一话' : '当前章节已读完'}
              </div>
              <div className='mt-6 flex flex-col gap-3'>
                {nextChapter ? (
                  <Link
                    href={buildChapterHref(nextChapter)}
                    className={cn('px-4 py-3', LIBRARY_BUTTON)}
                  >
                    下一话：{nextChapter.name}
                  </Link>
                ) : null}
                <button
                  type='button'
                  className={cn('px-4 py-3', LIBRARY_GHOST_BUTTON)}
                  onClick={() => setShowChapterComplete(false)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {jumpDialogOpen && (
          <div
            className='fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4'
            onClick={(event) => {
              event.stopPropagation();
              setJumpDialogOpen(false);
            }}
          >
            <form
              className={cn(READER_SHEET, 'w-full max-w-xs p-6')}
              onClick={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                submitJump();
              }}
            >
              <div className={cn('text-base font-semibold', LIBRARY_TEXT, LIBRARY_SERIF)}>
                跳转到指定页
              </div>
              <div className={cn('mt-1 text-xs', LIBRARY_MUTED)}>
                共 {pages.length} 页
              </div>
              <input
                autoFocus
                type='number'
                inputMode='numeric'
                min={1}
                max={pages.length}
                value={jumpValue}
                onChange={(event) => setJumpValue(event.target.value)}
                className={cn(LIBRARY_FIELD, 'mt-4 px-3 py-2')}
              />
              <div className='mt-5 flex gap-3'>
                <button
                  type='button'
                  className={cn('flex-1 px-4 py-3', LIBRARY_GHOST_BUTTON)}
                  onClick={() => setJumpDialogOpen(false)}
                >
                  取消
                </button>
                <button type='submit' className={cn('flex-1 px-4 py-3', LIBRARY_BUTTON)}>
                  跳转
                </button>
              </div>
            </form>
          </div>
        )}

        <div
          className={`fixed right-3 top-1/2 z-20 h-40 w-1 -translate-y-1/2 overflow-hidden rounded-full bg-library-edge/80 transition-all duration-200 dark:bg-library-night-edge/80 ${
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div
            className='absolute bottom-0 left-0 w-full rounded-full bg-library-ochre transition-all dark:bg-library-night-ochre'
            style={{ height: `${progress}%` }}
          />
        </div>

        {pages.length > 0 && (
          <button
            type='button'
            onClick={(event) => {
              event.stopPropagation();
              openJumpDialog();
            }}
            className={cn(
              'fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-sm font-medium',
              pages.length > 1 ? 'cursor-pointer' : 'pointer-events-none',
              READER_HUD
            )}
          >
            {Math.min(activePage + 1, pages.length)}/{pages.length}
          </button>
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
                className={cn(
                  'scroll-mt-[calc(3.5rem+var(--safe-top))] overflow-hidden shadow-sm sm:scroll-mt-[calc(4rem+var(--safe-top))]',
                  READER_CANVAS
                )}
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
            <ChapterEndActions
              nextHref={nextChapter ? buildChapterHref(nextChapter) : null}
              nextName={nextChapter?.name || ''}
              detailHref={buildDetailHref()}
              className='px-4 py-8'
            />
          </div>
        ) : readMode === 'horizontal' ? (
          <div
            ref={horizontalContainerRef}
            className='flex min-h-[calc(100vh-8rem)] snap-x snap-mandatory overflow-x-auto overflow-y-hidden scrollbar-hide'
            style={{ gap: `${pageGap}px` }}
          >
            {pages.map((page, index) => (
                <div key={`${page}-${index}`} className='flex min-w-full snap-center items-center justify-center px-1'>
                  <div className={cn('w-full overflow-hidden shadow-sm', READER_CANVAS)}>
                  <ProxyImage
                    originalSrc={page}
                    alt={`${chapterName}-${index + 1}`}
                    className={imageClassName}
                    loading={getImageLoadingStrategy(index)}
                  />
                </div>
              </div>
            ))}
            <div className='flex min-w-full snap-center items-center justify-center px-1'>
              <ChapterEndActions
                nextHref={nextChapter ? buildChapterHref(nextChapter) : null}
                nextName={nextChapter?.name || ''}
                detailHref={buildDetailHref()}
                className='w-full'
              />
            </div>
          </div>
        ) : (
          <div className='flex min-h-[calc(100vh-8rem)] items-center justify-center'>
            <div className={`grid w-full max-w-6xl ${readMode === 'double' ? 'md:grid-cols-2' : 'grid-cols-1'}`} style={{ gap: `${pageGap}px` }}>
              {pagedItems.map((page, index) => (
                <div
                  key={`${page}-${index}`}
                  className={cn('overflow-hidden shadow-sm', READER_CANVAS)}
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
                <div className='hidden md:block' />
              )}
            </div>
          </div>
        )}
      </div>

      <Link
        href={buildDetailHref()}
        className='sr-only'
      >
        返回详情
      </Link>
    </div>
  );
}
