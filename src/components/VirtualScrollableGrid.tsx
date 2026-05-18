'use client';

import React, { useEffect, useRef, useState } from 'react';

interface VirtualScrollableGridProps {
  children: React.ReactNode[];
  gridClassName: string;
  /** extra rows rendered above/below viewport */
  overscanRows?: number;
  /** < 640px columns */
  mobileColumns?: number;
  /** >= 640px min card width (px) to derive columns */
  minItemWidth?: number;
  /** >= 640px max content width (px) to derive columns */
  maxContentWidth?: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const DEFAULT_ROW_HEIGHT = 320;
const MAX_MEASURE_ITEMS = 24;
const SAME_ROW_TOLERANCE = 1;

interface LayoutMetrics {
  columns: number;
  rowHeight: number;
  totalRows: number;
}

const getViewportScrollTop = () => {
  if (typeof window === 'undefined') return 0;
  return (
    window.scrollY ||
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
};

const parsePixelValue = (value?: string) => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function VirtualScrollableGrid({
  children,
  gridClassName,
  overscanRows = 3,
  mobileColumns = 3,
  minItemWidth = 176,
  maxContentWidth = 1400,
}: VirtualScrollableGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureGridRef = useRef<HTMLDivElement>(null);
  const childrenRef = useRef(children);
  const rafRef = useRef<number | null>(null);
  const needsMeasureRef = useRef(true);

  childrenRef.current = children;

  const initialLayout: LayoutMetrics = {
    columns: Math.max(1, mobileColumns),
    rowHeight: DEFAULT_ROW_HEIGHT,
    totalRows: Math.ceil(children.length / Math.max(1, mobileColumns)),
  };
  const layoutRef = useRef<LayoutMetrics>(initialLayout);

  const [layout, setLayout] = useState<LayoutMetrics>(() => initialLayout);
  const [range, setRange] = useState({ startRow: 0, endRow: 0 });

  const computeFallbackColumns = () => {
    if (typeof window === 'undefined') return mobileColumns;
    if (window.innerWidth < 640) return mobileColumns;

    const containerWidth = Math.min(
      containerRef.current?.clientWidth ?? window.innerWidth - 32,
      maxContentWidth
    );

    return Math.max(mobileColumns, Math.floor(containerWidth / minItemWidth));
  };

  const readLayout = (): LayoutMetrics => {
    const currentChildren = childrenRef.current;

    if (currentChildren.length === 0) {
      return {
        columns: Math.max(1, mobileColumns),
        rowHeight: DEFAULT_ROW_HEIGHT,
        totalRows: 0,
      };
    }

    const measureGrid = measureGridRef.current;
    const measureItems = measureGrid
      ? Array.from(
          measureGrid.querySelectorAll<HTMLElement>('[data-virtual-measure-item]')
        )
      : [];

    let columns = computeFallbackColumns();
    let rowHeight = DEFAULT_ROW_HEIGHT;

    if (measureItems.length > 0) {
      const firstTop = measureItems[0].offsetTop;
      let detectedColumns = 0;
      let nextRowTop: number | null = null;

      for (const item of measureItems) {
        if (Math.abs(item.offsetTop - firstTop) <= SAME_ROW_TOLERANCE) {
          detectedColumns += 1;
          continue;
        }

        nextRowTop = item.offsetTop;
        break;
      }

      if (detectedColumns > 0) {
        columns = Math.max(1, detectedColumns);
      }

      const firstItemHeight = measureItems[0].getBoundingClientRect().height;
      const rowGap = measureGrid
        ? parsePixelValue(window.getComputedStyle(measureGrid).rowGap)
        : 0;

      if (nextRowTop != null && nextRowTop > firstTop) {
        rowHeight = Math.max(120, Math.round(nextRowTop - firstTop));
      } else if (firstItemHeight > 0) {
        rowHeight = Math.max(120, Math.round(firstItemHeight + rowGap));
      }
    }

    return {
      columns,
      rowHeight,
      totalRows: Math.ceil(currentChildren.length / Math.max(1, columns)),
    };
  };

  const computeRange = (nextLayout: LayoutMetrics) => {
    if (nextLayout.totalRows <= 0 || typeof window === 'undefined') {
      return { startRow: 0, endRow: 0 };
    }

    const el = containerRef.current;
    if (!el || nextLayout.rowHeight <= 0) {
      return {
        startRow: 0,
        endRow: Math.min(nextLayout.totalRows - 1, overscanRows * 2),
      };
    }

    const scrollTop = getViewportScrollTop();
    const viewportBottom = scrollTop + window.innerHeight;
    const containerTop = el.getBoundingClientRect().top + scrollTop;

    const startRow =
      Math.floor((scrollTop - containerTop) / nextLayout.rowHeight) - overscanRows;
    const endRow =
      Math.ceil((viewportBottom - containerTop) / nextLayout.rowHeight) +
      overscanRows;

    const clampedStart = clamp(startRow, 0, Math.max(0, nextLayout.totalRows - 1));
    const clampedEnd = clamp(
      endRow,
      clampedStart,
      Math.max(0, nextLayout.totalRows - 1)
    );

    return { startRow: clampedStart, endRow: clampedEnd };
  };

  const syncRange = (nextLayout: LayoutMetrics) => {
    const nextRange = computeRange(nextLayout);
    setRange((prev) => {
      if (
        prev.startRow === nextRange.startRow &&
        prev.endRow === nextRange.endRow
      ) {
        return prev;
      }

      return nextRange;
    });
  };

  const syncMeasuredLayout = () => {
    const nextLayout = readLayout();
    layoutRef.current = nextLayout;

    setLayout((prev) => {
      if (
        prev.columns === nextLayout.columns &&
        prev.rowHeight === nextLayout.rowHeight &&
        prev.totalRows === nextLayout.totalRows
      ) {
        return prev;
      }

      return nextLayout;
    });

    syncRange(nextLayout);
  };

  const scheduleUpdate = (measure = false) => {
    if (typeof window === 'undefined') return;
    if (measure) {
      needsMeasureRef.current = true;
    }
    if (rafRef.current != null) return;

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;

      if (needsMeasureRef.current) {
        needsMeasureRef.current = false;
        syncMeasuredLayout();
        return;
      }

      syncRange(layoutRef.current);
    });
  };

  useEffect(() => {
    scheduleUpdate(true);

    const handleScroll = () => {
      scheduleUpdate();
    };

    const handleResize = () => {
      scheduleUpdate(true);
    };

    const bodyEl = document.body;
    const documentEl = document.documentElement;

    window.addEventListener('scroll', handleScroll, { passive: true });
    bodyEl.addEventListener('scroll', handleScroll, { passive: true });
    documentEl.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate(true);
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
      if (measureGridRef.current) {
        resizeObserver.observe(measureGridRef.current);
      }
    }

    return () => {
      window.removeEventListener('scroll', handleScroll);
      bodyEl.removeEventListener('scroll', handleScroll);
      documentEl.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      resizeObserver?.disconnect();
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [
    children.length,
    gridClassName,
    overscanRows,
    mobileColumns,
    minItemWidth,
    maxContentWidth,
  ]);

  const columns = layout.columns;
  const totalRows = layout.totalRows;
  const rowHeight = layout.rowHeight;

  const startIndex = range.startRow * columns;
  const endIndexExclusive = Math.min(children.length, (range.endRow + 1) * columns);
  const visibleChildren = children.slice(startIndex, endIndexExclusive);

  const topSpacerHeight = range.startRow * rowHeight;
  const bottomSpacerHeight = Math.max(0, (totalRows - range.endRow - 1) * rowHeight);

  return (
    <div ref={containerRef} className='relative w-full'>
      {/* hidden measuring row (first visible row) */}
      <div
        className='pointer-events-none absolute left-0 top-0 -z-10 w-full opacity-0'
        aria-hidden='true'
      >
        <div ref={measureGridRef} className={gridClassName}>
          {children
            .slice(0, Math.min(children.length, MAX_MEASURE_ITEMS))
            .map((child, idx) => (
              <div key={`measure-${idx}`} data-virtual-measure-item>
                {child}
              </div>
            ))}
        </div>
      </div>

      <div style={{ height: topSpacerHeight }} />
      <div className={gridClassName}>{visibleChildren}</div>
      <div style={{ height: bottomSpacerHeight }} />
    </div>
  );
}
