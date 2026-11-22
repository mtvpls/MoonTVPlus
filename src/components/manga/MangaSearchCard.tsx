'use client';

import {
  ArrowDownUp,
  BookmarkCheck,
  BookmarkPlus,
  BookOpen,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import {
  MangaChapter,
  MangaDetail,
  MangaReadRecord,
  MangaSearchItem,
  MangaShelfItem,
} from '@/lib/manga.types';
import {
  getSelectedMangaSearchItem,
  MangaSearchGroup,
  mangaSearchItemKey,
  sortMangaChapters,
} from '@/lib/manga-search';

import {
  mangaItemDetailHref,
  mangaReadHref,
  mangaRecordReadHref,
} from '@/components/media/adapters';
import {
  BOOK_SPINE_OVERLAY,
  LIBRARY_BUTTON,
  LIBRARY_FOCUS,
  LIBRARY_GHOST_BUTTON,
  LIBRARY_MUTED,
  LIBRARY_PANEL,
  LIBRARY_ROW,
  LIBRARY_ROW_ACTIVE,
  LIBRARY_SERIF,
  LIBRARY_SKELETON,
  LIBRARY_TEXT,
  LIBRARY_TEXT_TAB,
  LIBRARY_TEXT_TAB_ACTIVE,
  LIBRARY_TEXT_TAB_IDLE,
} from '@/components/media/library';
import ProxyImage from '@/components/ProxyImage';

interface MangaSearchCardProps {
  group: MangaSearchGroup;
  selectedKey?: string;
  preferredSourceId?: string;
  onSelectSource: (itemKey: string) => void;
  shelf: Record<string, MangaShelfItem>;
  history: Record<string, MangaReadRecord>;
  returnTo: string;
  onToggleShelf: (item: MangaSearchItem, detail?: MangaDetail) => Promise<void>;
}

const READ_ACTION = cn(
  LIBRARY_BUTTON,
  'min-h-11 whitespace-nowrap px-3 py-2 text-library-chip duration-150 dark:text-library-night'
);

const TEXT_ACTION = cn(
  LIBRARY_FOCUS,
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm px-2 text-sm transition-colors duration-150'
);

const CHAPTER_LIST = 'flex gap-2';

const CHAPTER_SCROLL_AREA =
  'overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1 [scrollbar-width:thin] md:scrollbar-hide';

export function MangaSearchCardSkeleton() {
  return (
    <div className={cn(LIBRARY_PANEL, 'rounded-xl p-4 sm:p-6')} aria-hidden>
      <div className='flex gap-4 sm:gap-6'>
        <div
          className={cn(
            LIBRARY_SKELETON,
            'aspect-[3/4] w-[88px] shrink-0 animate-none sm:w-[120px]'
          )}
        />
        <div className='flex-1 space-y-3'>
          <div className={cn(LIBRARY_SKELETON, 'h-6 w-4/5 animate-none')} />
          <div className={cn(LIBRARY_SKELETON, 'h-4 w-1/2 animate-none')} />
          <div
            className={cn(
              LIBRARY_SKELETON,
              'h-11 w-40 max-w-full animate-none'
            )}
          />
        </div>
      </div>
      <div className={cn(CHAPTER_SCROLL_AREA, 'mt-4')}>
        <div className={CHAPTER_LIST}>
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              className={cn(
                LIBRARY_SKELETON,
                'h-11 w-20 shrink-0 animate-none rounded-md'
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MangaSearchCard({
  group,
  selectedKey,
  preferredSourceId,
  onSelectSource,
  shelf,
  history,
  returnTo,
  onToggleShelf,
}: MangaSearchCardProps) {
  const selectedItem = getSelectedMangaSearchItem(
    group,
    selectedKey,
    preferredSourceId
  );
  const itemKey = mangaSearchItemKey(selectedItem);
  const cardRef = useRef<HTMLElement>(null);
  const chapterListRef = useRef<HTMLDivElement>(null);
  const chapterCacheRef = useRef<Record<string, MangaChapter[]>>({});
  const [chaptersByItem, setChaptersByItem] = useState<
    Record<string, MangaChapter[]>
  >({});
  const [visible, setVisible] = useState(false);
  const [detailError, setDetailError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [descOrder, setDescOrder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shelfError, setShelfError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const sourceChapters = chaptersByItem[itemKey];
  const detail: MangaDetail | undefined = sourceChapters
    ? { ...selectedItem, chapters: sourceChapters }
    : undefined;
  const item = selectedItem;
  const record = history[itemKey];
  const inShelf = Boolean(shelf[itemKey]);
  const error = detailError?.key === itemKey ? detailError.message : '';
  const requestUrl = `/api/manga/chapters?${new URLSearchParams({
    mangaId: selectedItem.id,
  }).toString()}`;
  const detailHref = mangaItemDetailHref(item, returnTo);

  useEffect(() => {
    if (!cardRef.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || chapterCacheRef.current[itemKey]) return;
    const controller = new AbortController();
    setDetailError(null);
    fetch(requestUrl, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '目录加载失败');
        if (!Array.isArray(data.chapters))
          throw new Error('该来源未返回有效目录');
        if (controller.signal.aborted) return;
        const nextChapters = data.chapters as MangaChapter[];
        chapterCacheRef.current[itemKey] = nextChapters;
        setChaptersByItem((prev) => ({ ...prev, [itemKey]: nextChapters }));
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) {
          setDetailError({
            key: itemKey,
            message: err.message || '目录加载失败',
          });
        }
      });
    return () => controller.abort();
  }, [itemKey, requestUrl, retry, visible]);

  const chronologicalChapters = useMemo(
    () => sortMangaChapters(detail?.chapters || []),
    [detail?.chapters]
  );
  const chapters = descOrder
    ? [...chronologicalChapters].reverse()
    : chronologicalChapters;
  const firstChapter = chronologicalChapters[0];

  useEffect(() => {
    if (chapterListRef.current) chapterListRef.current.scrollLeft = 0;
  }, [itemKey, descOrder]);

  useEffect(() => {
    const node = chapterListRef.current;
    if (!node) return;
    const desktop = window.matchMedia('(min-width: 768px)');
    let drag: {
      pointerId: number;
      startX: number;
      startScrollLeft: number;
      moved: boolean;
    } | null = null;
    let suppressClick = false;

    const stopDrag = () => {
      const pointerId = drag?.pointerId;
      drag = null;
      node.removeAttribute('data-dragging');
      if (pointerId !== undefined && node.hasPointerCapture(pointerId)) {
        node.releasePointerCapture(pointerId);
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!desktop.matches || event.ctrlKey || event.metaKey) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 20
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? node.clientWidth
          : 1;
      const next = Math.max(
        0,
        Math.min(
          node.scrollWidth - node.clientWidth,
          node.scrollLeft + delta * unit
        )
      );
      if (next === node.scrollLeft) return;
      event.preventDefault();
      node.scrollLeft = next;
    };

    const onPointerDown = (event: PointerEvent) => {
      suppressClick = false;
      if (
        !desktop.matches ||
        event.pointerType !== 'mouse' ||
        event.button !== 0 ||
        node.scrollWidth <= node.clientWidth
      )
        return;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: node.scrollLeft,
        moved: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!(event.buttons & 1)) {
        stopDrag();
        return;
      }
      const delta = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(delta) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        suppressClick = true;
        node.setAttribute('data-dragging', 'true');
        // 开始拖动后才捕获指针，保留章节链接的普通点击。
        node.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      node.scrollLeft = drag.startScrollLeft - delta;
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === drag?.pointerId) stopDrag();
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (drag && !drag.moved) onPointerEnd(event);
    };
    const onClick = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };
    const onDragStart = (event: DragEvent) => {
      if (desktop.matches) event.preventDefault();
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove);
    node.addEventListener('pointerup', onPointerEnd);
    node.addEventListener('pointercancel', onPointerEnd);
    node.addEventListener('lostpointercapture', onPointerEnd);
    node.addEventListener('pointerleave', onPointerLeave);
    node.addEventListener('click', onClick, true);
    node.addEventListener('dragstart', onDragStart);
    return () => {
      stopDrag();
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerEnd);
      node.removeEventListener('pointercancel', onPointerEnd);
      node.removeEventListener('lostpointercapture', onPointerEnd);
      node.removeEventListener('pointerleave', onPointerLeave);
      node.removeEventListener('click', onClick, true);
      node.removeEventListener('dragstart', onDragStart);
    };
  }, [descOrder, itemKey, sourceChapters]);

  const chapterHref = (chapter: MangaChapter) =>
    mangaReadHref(
      {
        mangaId: item.id,
        sourceId: item.sourceId,
        chapterId: chapter.id,
        title: item.title,
        cover: item.cover,
        sourceName: item.sourceName,
        chapterName: chapter.name,
      },
      returnTo
    );

  const toggleShelf = async () => {
    if (saving) return;
    setSaving(true);
    setShelfError(null);
    try {
      await onToggleShelf(item, detail);
    } catch (err) {
      setShelfError({
        key: itemKey,
        message: (err as Error).message || '书架保存失败，请重试',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      ref={cardRef}
      aria-label={`${group.items[0].title} 搜索结果`}
      className={cn(LIBRARY_PANEL, 'min-w-0 rounded-xl p-4 sm:p-6')}
    >
      <div className='grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-x-6'>
        <Link
          href={detailHref}
          prefetch={false}
          aria-label={`查看${item.title}详情`}
          className={cn(
            LIBRARY_FOCUS,
            'relative row-start-1 aspect-[3/4] self-start overflow-hidden rounded-sm bg-library-paper shadow-sm dark:bg-library-night dark:shadow-none sm:row-span-2'
          )}
        >
          {item.cover ? (
            <>
              <ProxyImage
                key={itemKey}
                originalSrc={item.cover}
                alt={item.title}
                className='h-full w-full object-cover'
              />
              <span className={BOOK_SPINE_OVERLAY} aria-hidden />
            </>
          ) : (
            <div
              className={cn(
                LIBRARY_MUTED,
                'flex h-full items-center justify-center'
              )}
            >
              <BookOpen className='h-6 w-6' strokeWidth={1.5} />
            </div>
          )}
        </Link>
        <div className='min-w-0'>
          <h3
            className={cn(
              LIBRARY_SERIF,
              LIBRARY_TEXT,
              'line-clamp-2 text-lg font-medium leading-6 sm:text-xl sm:leading-7'
            )}
          >
            <Link
              href={detailHref}
              prefetch={false}
              className={cn(
                LIBRARY_FOCUS,
                'rounded-sm transition-colors duration-150 hover:text-library-ochre dark:hover:text-library-night-ochre'
              )}
              title={item.title}
            >
              {item.title}
            </Link>
          </h3>
          <div
            className={cn(
              LIBRARY_MUTED,
              'mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-5'
            )}
          >
            {(item.author || item.artist) && (
              <span className='min-w-0 break-words'>
                {item.author || item.artist}
              </span>
            )}
            {item.status && (
              <>
                {(item.author || item.artist) && <span aria-hidden>·</span>}
                <span>{item.status}</span>
              </>
            )}
          </div>
          <div className='mt-3 flex flex-wrap items-center gap-2'>
            {record || firstChapter ? (
              <Link
                href={
                  record
                    ? mangaRecordReadHref(record, returnTo)
                    : chapterHref(firstChapter)
                }
                prefetch={false}
                className={cn(READ_ACTION, 'cursor-pointer')}
              >
                {record ? '继续阅读' : '开始阅读'}
              </Link>
            ) : (
              <button
                type='button'
                disabled
                className={cn(
                  READ_ACTION,
                  'disabled:cursor-wait disabled:opacity-60'
                )}
              >
                {!detail && !error ? (
                  <Loader2
                    className='h-4 w-4 animate-spin motion-reduce:animate-none'
                    strokeWidth={1.5}
                  />
                ) : null}
                {!detail && !error ? '加载目录' : '开始阅读'}
              </button>
            )}
            <button
              type='button'
              onClick={toggleShelf}
              disabled={saving}
              aria-pressed={inShelf}
              aria-label={inShelf ? '移出书架' : '加入书架'}
              className={cn(
                TEXT_ACTION,
                LIBRARY_MUTED,
                'hover:text-library-ochre disabled:cursor-wait disabled:opacity-60 dark:hover:text-library-night-ochre',
                inShelf && 'text-library-ochre dark:text-library-night-ochre'
              )}
            >
              {saving ? (
                <Loader2
                  className='h-4 w-4 animate-spin motion-reduce:animate-none'
                  strokeWidth={1.5}
                />
              ) : inShelf ? (
                <BookmarkCheck className='h-4 w-4 shrink-0' strokeWidth={1.5} />
              ) : (
                <BookmarkPlus className='h-4 w-4 shrink-0' strokeWidth={1.5} />
              )}
              {inShelf ? '已在书架' : '加入书架'}
            </button>
          </div>
        </div>
        {item.description && (
          <p
            className={cn(
              LIBRARY_MUTED,
              'col-span-2 line-clamp-2 text-sm leading-6 sm:col-span-1 sm:col-start-2'
            )}
          >
            {item.description}
          </p>
        )}
      </div>

      <div
        role='group'
        aria-label='切换漫画来源'
        className='mt-4 flex min-w-0 items-center gap-2 border-b border-library-edge dark:border-library-night-edge'
      >
        <span className={cn(LIBRARY_MUTED, 'shrink-0 text-sm')}>来源</span>
        <div className='flex min-w-0 gap-2 overflow-x-auto [scrollbar-width:thin]'>
          {group.items.map((sourceItem) => {
            const key = mangaSearchItemKey(sourceItem);
            const active = key === itemKey;
            const versions = group.items.filter(
              (candidate) => candidate.sourceId === sourceItem.sourceId
            );
            const label = `${sourceItem.sourceName}${
              versions.length > 1
                ? ` · 版本 ${versions.indexOf(sourceItem) + 1}`
                : ''
            }`;
            return (
              <button
                key={key}
                type='button'
                aria-pressed={active}
                onClick={() => {
                  setVisible(true);
                  onSelectSource(key);
                }}
                className={cn(
                  LIBRARY_TEXT_TAB,
                  active ? LIBRARY_TEXT_TAB_ACTIVE : LIBRARY_TEXT_TAB_IDLE
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <section aria-label='章节目录' className='mt-4 space-y-3'>
        <div className='flex min-h-11 flex-wrap items-center justify-between gap-3'>
          <div className='flex items-baseline gap-3'>
            <h4 className={cn(LIBRARY_TEXT, 'text-sm font-medium')}>
              章节目录
            </h4>
            {detail && (
              <span className={cn(LIBRARY_MUTED, 'text-sm tabular-nums')}>
                {chapters.length} 话
              </span>
            )}
          </div>
          {chapters.length > 1 && (
            <button
              type='button'
              title={
                descOrder
                  ? '切换为正序，从最早章节开始'
                  : '切换为倒序，先看最新章节'
              }
              onClick={() => setDescOrder((prev) => !prev)}
              className={cn(
                LIBRARY_GHOST_BUTTON,
                'min-h-11 gap-2 px-3 py-2 text-library-muted duration-150 dark:text-library-night-muted'
              )}
            >
              <ArrowDownUp className='h-4 w-4' strokeWidth={1.5} />
              {descOrder ? '正序' : '倒序'}
            </button>
          )}
        </div>
        {error ? (
          <div
            role='alert'
            className='flex flex-wrap items-center justify-between gap-2 text-sm'
          >
            <span className={LIBRARY_MUTED}>目录加载失败：{error}</span>
            <button
              type='button'
              onClick={() => {
                setDetailError(null);
                setRetry((prev) => prev + 1);
              }}
              className={cn(
                LIBRARY_GHOST_BUTTON,
                'min-h-11 cursor-pointer px-3 py-2'
              )}
            >
              重试
            </button>
          </div>
        ) : !detail ? (
          <div
            role='status'
            aria-label='正在加载章节目录'
            className={CHAPTER_SCROLL_AREA}
          >
            <div className={CHAPTER_LIST}>
              {Array.from({ length: 12 }, (_, index) => (
                <div
                  key={index}
                  className={cn(
                    LIBRARY_SKELETON,
                    'h-11 w-20 shrink-0 animate-none rounded-md'
                  )}
                />
              ))}
            </div>
          </div>
        ) : chapters.length === 0 ? (
          <p className={cn(LIBRARY_MUTED, 'py-2 text-sm')}>
            该来源暂无章节，可以切换其他来源。
          </p>
        ) : (
          <div
            key={itemKey}
            ref={chapterListRef}
            role='group'
            aria-label='选择章节'
            className={cn(
              CHAPTER_SCROLL_AREA,
              'md:cursor-grab md:select-none md:[&_a]:cursor-grab data-[dragging=true]:cursor-grabbing data-[dragging=true]:[&_a]:cursor-grabbing'
            )}
          >
            <div className={CHAPTER_LIST}>
              {chapters.map((chapter) => {
                const active = record?.chapterId === chapter.id;
                return (
                  <Link
                    key={chapter.id}
                    href={chapterHref(chapter)}
                    prefetch={false}
                    title={chapter.name}
                    aria-label={`阅读${chapter.name}`}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      LIBRARY_FOCUS,
                      LIBRARY_ROW,
                      LIBRARY_TEXT,
                      'flex h-11 min-w-20 max-w-44 shrink-0 cursor-pointer items-center justify-center rounded-md px-3 text-center text-sm leading-5 transition-colors duration-150 hover:border-library-ochre hover:bg-library-ochre-tint/60 hover:text-library-ochre focus-visible:ring-inset dark:hover:border-library-night-ochre dark:hover:bg-library-night-ochre-tint dark:hover:text-library-night-ochre',
                      active && [
                        LIBRARY_ROW_ACTIVE,
                        'font-medium text-library-ochre dark:text-library-night-ochre',
                      ]
                    )}
                  >
                    <span className='truncate'>{chapter.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {shelfError?.key === itemKey && (
        <p role='alert' className={cn(LIBRARY_MUTED, 'mt-3 text-sm')}>
          {shelfError.message}
        </p>
      )}
    </article>
  );
}
