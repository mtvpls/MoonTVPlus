'use client';

import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SearchFilterKey = 'source' | 'title' | 'year' | 'yearOrder';

export interface SearchFilterOption {
  label: string;
  value: string;
}

export interface SearchFilterCategory {
  key: SearchFilterKey;
  label: string;
  options: SearchFilterOption[];
}

interface SearchResultFilterProps {
  categories: SearchFilterCategory[];
  values: Partial<Record<SearchFilterKey, string>>;
  onChange: (values: Record<SearchFilterKey, string>) => void;
}

const DEFAULTS: Record<SearchFilterKey, string> = {
  source: 'all',
  title: 'all',
  year: 'all',
  yearOrder: 'none',
};

const SearchResultFilter: React.FC<SearchResultFilterProps> = ({
  categories,
  values,
  onChange,
}) => {
  const [activeCategory, setActiveCategory] = useState<SearchFilterKey | null>(
    null,
  );
  const [dropdownPosition, setDropdownPosition] = useState<{
    x: number;
    y: number;
    width: number;
  }>({ x: 0, y: 0, width: 0 });
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  const mergedValues = useMemo(() => {
    return {
      ...DEFAULTS,
      ...values,
    } as Record<SearchFilterKey, string>;
  }, [values]);

  const calculateDropdownPosition = (categoryKey: SearchFilterKey) => {
    const element = categoryRefs.current[categoryKey];
    if (element) {
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const isMobile = viewportWidth < 768;

      let x = rect.left;
      // 为标题筛选设置更大的最小宽度，其他保持原来的最小宽度
      const minWidth = categoryKey === 'title' ? 400 : 240;
      let dropdownWidth = Math.max(rect.width, minWidth);
      let useFixedWidth = false;

      if (isMobile) {
        const padding = 16;
        const maxWidth = viewportWidth - padding * 2;
        dropdownWidth = Math.min(dropdownWidth, maxWidth);
        useFixedWidth = true;

        if (x + dropdownWidth > viewportWidth - padding) {
          x = viewportWidth - dropdownWidth - padding;
        }
        if (x < padding) {
          x = padding;
        }
      }

      setDropdownPosition({
        x,
        y: rect.bottom,
        width: useFixedWidth ? dropdownWidth : rect.width,
      });
    }
  };

  const handleCategoryClick = (categoryKey: SearchFilterKey) => {
    if (activeCategory === categoryKey) {
      setActiveCategory(null);
    } else {
      setActiveCategory(categoryKey);
      calculateDropdownPosition(categoryKey);
    }
  };

  const handleOptionSelect = (
    categoryKey: SearchFilterKey,
    optionValue: string,
  ) => {
    const newValues = {
      ...mergedValues,
      [categoryKey]: optionValue,
    } as Record<SearchFilterKey, string>;
    onChange(newValues);
    setActiveCategory(null);
  };

  const getDisplayText = (categoryKey: SearchFilterKey) => {
    const category = categories.find((cat) => cat.key === categoryKey);
    if (!category) return '';
    const value = mergedValues[categoryKey];
    if (!value || value === DEFAULTS[categoryKey]) return category.label;
    const option = category.options.find((opt) => opt.value === value);
    return option?.label || category.label;
  };

  const isDefaultValue = (categoryKey: SearchFilterKey) => {
    const value = mergedValues[categoryKey];
    return !value || value === DEFAULTS[categoryKey];
  };

  const isOptionSelected = (
    categoryKey: SearchFilterKey,
    optionValue: string,
  ) => {
    const value = mergedValues[categoryKey] ?? DEFAULTS[categoryKey];
    return value === optionValue;
  };

  useEffect(() => {
    const handleScroll = () => {
      // 滚动时直接关闭面板，而不是重新计算位置
      if (activeCategory) {
        setActiveCategory(null);
      }
    };
    const handleResize = () => {
      if (activeCategory) calculateDropdownPosition(activeCategory);
    };
    // 监听 body 滚动事件，因为该项目的滚动容器是 document.body
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    return () => {
      document.body.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeCategory]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !Object.values(categoryRefs.current).some(
          (ref) => ref && ref.contains(event.target as Node),
        )
      ) {
        setActiveCategory(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <div className='relative inline-flex rounded-full p-0.5 sm:p-1 bg-transparent gap-1 sm:gap-2'>
        {categories.map((category) => (
          <div
            key={category.key}
            ref={(el) => {
              categoryRefs.current[category.key] = el;
            }}
            className='relative'
          >
            <button
              onClick={() => handleCategoryClick(category.key)}
              className={`relative z-10 px-1.5 py-0.5 sm:px-2 sm:py-1 md:px-4 md:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                activeCategory === category.key
                  ? isDefaultValue(category.key)
                    ? 'text-gray-900 dark:text-gray-100 cursor-default'
                    : 'text-green-600 dark:text-green-400 cursor-default'
                  : isDefaultValue(category.key)
                    ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                    : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
              }`}
            >
              <span>{getDisplayText(category.key)}</span>
              <svg
                className={`inline-block w-2.5 h-2.5 sm:w-3 sm:h-3 ml-0.5 sm:ml-1 transition-transform duration-200 ${activeCategory === category.key ? 'rotate-180' : ''}`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M19 9l-7 7-7-7'
                />
              </svg>
            </button>
          </div>
        ))}
        {/* 通用年份排序切换按钮 */}
        <div className='relative'>
          <button
            onClick={() => {
              let next;
              switch (mergedValues.yearOrder) {
                case 'none':
                  next = 'desc';
                  break;
                case 'desc':
                  next = 'asc';
                  break;
                case 'asc':
                  next = 'none';
                  break;
                default:
                  next = 'desc';
              }
              onChange({ ...mergedValues, yearOrder: next });
            }}
            className={`relative z-10 px-1.5 py-0.5 sm:px-2 sm:py-1 md:px-4 md:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
              mergedValues.yearOrder === 'none'
                ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
            }`}
            aria-label={`按年份${mergedValues.yearOrder === 'none' ? '排序' : mergedValues.yearOrder === 'desc' ? '降序' : '升序'}排序`}
          >
            <span>年份</span>
            {mergedValues.yearOrder === 'none' ? (
              <ArrowUpDown className='inline-block ml-1 w-4 h-4 sm:w-4 sm:h-4' />
            ) : mergedValues.yearOrder === 'desc' ? (
              <ArrowDownWideNarrow className='inline-block ml-1 w-4 h-4 sm:w-4 sm:h-4' />
            ) : (
              <ArrowUpNarrowWide className='inline-block ml-1 w-4 h-4 sm:w-4 sm:h-4' />
            )}
          </button>
        </div>
      </div>

      {activeCategory &&
        createPortal(
          <div
            ref={dropdownRef}
            className='fixed z-[9999] bg-white/95 dark:bg-gray-800/95 rounded-xl border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm max-h-[50vh] flex flex-col'
            style={{
              left: `${dropdownPosition.x}px`,
              top: `${dropdownPosition.y}px`,
              ...(typeof window !== 'undefined' && window.innerWidth < 768
                ? { width: `${dropdownPosition.width}px` }
                : {
                    minWidth: `${Math.max(dropdownPosition.width, activeCategory === 'title' ? 400 : 240)}px`,
                  }),
              maxWidth: '600px',
              position: 'fixed',
            }}
          >
            <div className='p-2 sm:p-4 overflow-y-auto flex-1 min-h-0'>
              <div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 sm:gap-2'>
                {categories
                  .find((cat) => cat.key === activeCategory)
                  ?.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        handleOptionSelect(activeCategory, option.value)
                      }
                      className={`px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-lg transition-all duration-200 text-left ${
                        isOptionSelected(activeCategory, option.value)
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default SearchResultFilter;
