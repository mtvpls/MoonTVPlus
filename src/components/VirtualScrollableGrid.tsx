'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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

export default function VirtualScrollableGrid({
  children,
  gridClassName,
  overscanRows = 3,
  mobileColumns = 3,
  minItemWidth = 176,
  maxContentWidth = 1400,
}: VirtualScrollableGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const columnsRef = useRef<number>(mobileColumns);
  const rowHeightRef = useRef<number>(320);
  const totalRowsRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const [range, setRange] = useState({ startRow: 0, endRow: 0 });

  const computeColumns = () => {
    if (typeof window === 'undefined') return mobileColumns;
    const width = window.innerWidth;
    if (width < 640) return mobileColumns;
    const containerWidth = Math.min(width - 32, maxContentWidth);
    return Math.max(mobileColumns, Math.floor(containerWidth / minItemWidth));
  };

  const updateLayout = () => {
    const gapY = window.innerWidth >= 640 ? 80 : 56; // gap-y-14 / sm:gap-y-20
    const columns = computeColumns();
    columnsRef.current = columns;
    totalRowsRef.current = Math.ceil(children.length / Math.max(1, columns));

    // Measure a single item height (wrapper div around VideoCard) and add vertical gap.
    const measureEl = measureRef.current;
    const firstItem = measureEl?.querySelector<HTMLElement>('[data-virtual-measure-item]');
    const itemH = firstItem?.getBoundingClientRect().height;
    if (itemH && Number.isFinite(itemH) && itemH > 0) {
      rowHeightRef.current = Math.max(120, Math.round(itemH + gapY));
    }
  };

  const updateRange = () => {
    const el = containerRef.current;
    if (!el) return;

    const totalRows = totalRowsRef.current;
    if (totalRows <= 0) return;

    const rowHeight = rowHeightRef.current;
    if (!rowHeight || rowHeight <= 0) return;

    // This app uses `document.body` as the actual scroll container (see search page back-to-top logic).
    const scrollTop = document.body.scrollTop || 0;
    const viewportBottom = scrollTop + window.innerHeight;
    const containerTop = el.getBoundingClientRect().top + scrollTop;

    const startRow = Math.floor((scrollTop - containerTop) / rowHeight) - overscanRows;
    const endRow = Math.ceil((viewportBottom - containerTop) / rowHeight) + overscanRows;

    const clampedStart = clamp(startRow, 0, Math.max(0, totalRows - 1));
    const clampedEnd = clamp(endRow, clampedStart, Math.max(0, totalRows - 1));

    setRange((prev) => {
      if (prev.startRow === clampedStart && prev.endRow === clampedEnd) return prev;
      return { startRow: clampedStart, endRow: clampedEnd };
    });
  };

  const scheduleUpdate = () => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateLayout();
      updateRange();
    });
  };

  useEffect(() => {
    updateLayout();
    updateRange();

    let isRunning = true;
    const rafLoop = () => {
      if (!isRunning) return;
      scheduleUpdate();
      window.requestAnimationFrame(rafLoop);
    };
    rafLoop();

    document.body.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      isRunning = false;
      document.body.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children.length, overscanRows, mobileColumns, minItemWidth, maxContentWidth]);

  const columns = columnsRef.current;
  const totalRows = totalRowsRef.current;
  const rowHeight = rowHeightRef.current;

  const startIndex = range.startRow * columns;
  const endIndexExclusive = Math.min(children.length, (range.endRow + 1) * columns);
  const visibleChildren = children.slice(startIndex, endIndexExclusive);

  const topSpacerHeight = range.startRow * rowHeight;
  const bottomSpacerHeight = Math.max(0, (totalRows - range.endRow - 1) * rowHeight);

  return (
    <div ref={containerRef} className='w-full'>
      {/* hidden measuring row (first visible row) */}
      <div
        ref={measureRef}
        className='pointer-events-none absolute left-0 top-0 -z-10 opacity-0'
        aria-hidden='true'
      >
        <div className={gridClassName}>
          {children.slice(0, Math.max(1, columns)).map((child, idx) => (
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
