'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface VirtualScrollableRowProps {
  children: React.ReactNode[];
  maxVisible?: number; // 最大可见数量
  className?: string; // 额外的 CSS 类名
}

export default function VirtualScrollableRow({
  children,
  maxVisible = 30, // 默认最多显示 30 个项目
  className = '',
}: VirtualScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: maxVisible });

  // 检查滚动状态
  const checkScroll = () => {
    if (!containerRef.current) return;

    const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
    const canScrollLeft = scrollLeft > 0;
    const canScrollRight = scrollLeft + clientWidth < scrollWidth - 10;

    setShowLeftScroll(canScrollLeft);
    setShowRightScroll(canScrollRight);

    // 计算可见范围（基于滚动位置）
    const itemWidth = 208; // 每个项目约 200px + 8px gap
    const scrolledItems = Math.floor(scrollLeft / itemWidth);
    const visibleItems = Math.ceil(clientWidth / itemWidth);

    // 扩展渲染范围（当前可见 + 前后缓冲）
    const bufferSize = 5;
    const newStart = Math.max(0, scrolledItems - bufferSize);
    const newEnd = Math.min(children.length, scrolledItems + visibleItems + bufferSize);

    setVisibleRange({ start: newStart, end: newEnd });
  };

  useEffect(() => {
    checkScroll();
    const container = containerRef.current;

    if (container) {
      container.addEventListener('scroll', checkScroll);
      return () => container.removeEventListener('scroll', checkScroll);
    }
  }, [children.length]);

  // 监听窗口大小变化
  useEffect(() => {
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []);

  const scrollLeft = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: -400,
        behavior: 'smooth',
      });
    }
  };

  const scrollRight = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: 400,
        behavior: 'smooth',
      });
    }
  };

  // 渲染可见项目
  const visibleChildren = children.slice(visibleRange.start, visibleRange.end);

  return (
    <div className="relative group">
      {/* 左侧滚动按钮 */}
      {showLeftScroll && (
        <button
          onClick={scrollLeft}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-[600] bg-white/90 dark:bg-gray-800/90 p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white dark:hover:bg-gray-700"
          aria-label="向左滚动"
        >
          <ChevronLeft className="w-6 h-6 text-gray-700 dark:text-gray-200" />
        </button>
      )}

      {/* 滚动容器 */}
      <div
        ref={containerRef}
        className={`flex gap-2 overflow-x-auto scrollbar-hide scroll-smooth ${className}`}
        style={{ scrollBehavior: 'smooth', paddingTop: '20px', paddingBottom: '20px', marginTop: '-20px', marginBottom: '-20px' }}
      >
        {/* 左侧占位符（用于保持滚动位置） */}
        {visibleRange.start > 0 && (
          <div style={{ minWidth: visibleRange.start * 208, flexShrink: 0 }} />
        )}

        {/* 渲染可见项目 */}
        {visibleChildren}

        {/* 右侧占位符 */}
        {visibleRange.end < children.length && (
          <div style={{ minWidth: (children.length - visibleRange.end) * 208, flexShrink: 0 }} />
        )}
      </div>

      {/* 右侧滚动按钮 */}
      {showRightScroll && (
        <button
          onClick={scrollRight}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-[600] bg-white/90 dark:bg-gray-800/90 p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white dark:hover:bg-gray-700"
          aria-label="向右滚动"
        >
          <ChevronRight className="w-6 h-6 text-gray-700 dark:text-gray-200" />
        </button>
      )}
    </div>
  );
}
