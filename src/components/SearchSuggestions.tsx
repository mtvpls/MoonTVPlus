'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchSuggestionsProps {
  query: string;
  isVisible: boolean;
  onSelect: (suggestion: string) => void;
  onClose: () => void;
  onEnterKey: () => void; // 新增：处理回车键的回调
}

interface SuggestionItem {
  text: string;
  type: 'related';
  icon?: React.ReactNode;
}

export default function SearchSuggestions({
  query,
  isVisible,
  onSelect,
  onClose,
  onEnterKey,
}: SearchSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // 防抖定时器
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用于中止旧请求
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSuggestionsFromAPI = useCallback(async (searchQuery: string) => {
    // 每次请求前取消上一次的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(
        `/api/search/suggestions?q=${encodeURIComponent(searchQuery)}`,
        {
          signal: controller.signal,
        },
      );
      if (response.ok) {
        const data = await response.json();
        const apiSuggestions = data.suggestions.map(
          (item: { text: string }) => ({
            text: item.text,
            type: 'related' as const,
          }),
        );
        setSuggestions(apiSuggestions);
      }
    } catch (err: unknown) {
      // 类型保护判断 err 是否是 Error 类型
      if (err instanceof Error) {
        if (err.name !== 'AbortError') {
          // 不是取消请求导致的错误才清空
          setSuggestions([]);
        }
      } else {
        // 如果 err 不是 Error 类型，也清空提示
        setSuggestions([]);
      }
    }
  }, []);

  // 防抖触发
  const debouncedFetchSuggestions = useCallback(
    (searchQuery: string) => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        if (searchQuery.trim() && isVisible) {
          fetchSuggestionsFromAPI(searchQuery);
        } else {
          setSuggestions([]);
        }
      }, 300); //300ms
    },
    [isVisible, fetchSuggestionsFromAPI],
  );

  useEffect(() => {
    if (!query.trim() || !isVisible) {
      setSuggestions([]);
      return;
    }
    debouncedFetchSuggestions(query);

    // 清理定时器
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query, isVisible, debouncedFetchSuggestions]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  // 处理键盘事件，特别是回车键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && isVisible) {
        // 阻止默认行为，避免浏览器自动选择建议
        e.preventDefault();
        e.stopPropagation();
        // 关闭搜索建议并触发搜索
        onClose();
        onEnterKey();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown, true);
    }

    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isVisible, onClose, onEnterKey]);

  if (!isVisible || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className='absolute top-full left-0 right-0 z-[600] mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-80 overflow-y-auto'
    >
      {suggestions.map((suggestion) => (
        <button
          key={`related-${suggestion.text}`}
          onClick={() => onSelect(suggestion.text)}
          className='w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 flex items-center gap-3'
        >
          <span className='flex-1 text-sm text-gray-700 dark:text-gray-300 truncate'>
            {suggestion.text}
          </span>
        </button>
      ))}
    </div>
  );
}
