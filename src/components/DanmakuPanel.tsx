'use client';

import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getEpisodes, searchAnime } from '@/lib/danmaku/api';
import type {
  DanmakuAnime,
  DanmakuComment,
  DanmakuEpisode,
  DanmakuSelection,
} from '@/lib/danmaku/types';

interface DanmakuPanelProps {
  videoTitle: string;
  currentEpisodeIndex: number;
  onDanmakuSelect: (selection: DanmakuSelection) => void;
  currentSelection: DanmakuSelection | null;
  onUploadDanmaku?: (comments: DanmakuComment[]) => void;
}

export default function DanmakuPanel({
  videoTitle,
  currentEpisodeIndex,
  onDanmakuSelect,
  currentSelection,
  onUploadDanmaku,
}: DanmakuPanelProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<DanmakuAnime[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<DanmakuAnime | null>(null);
  const [episodes, setEpisodes] = useState<DanmakuEpisode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const initializedRef = useRef(false); // 标记是否已初始化过
  const fileInputRef = useRef<HTMLInputElement>(null);
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const [episodeGroupIndex, setEpisodeGroupIndex] = useState(0);
  const [episodeDescending, setEpisodeDescending] = useState(false);
  const episodesPerGroup = 50;
  const [hoveredEpisodeId, setHoveredEpisodeId] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    vertical: 'top' | 'bottom';
    horizontal: 'left' | 'center' | 'right';
  }>({ vertical: 'top', horizontal: 'center' });
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const suppressClickRef = useRef(false);

  // 搜索弹幕
  const handleSearch = useCallback(async (keyword: string) => {
    if (!keyword.trim()) {
      setSearchError('请输入搜索关键词');
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const response = await searchAnime(keyword.trim());

      if (response.success && response.animes.length > 0) {
        setSearchResults(response.animes);
        setSearchError(null);
      } else {
        setSearchResults([]);
        setSearchError(
          response.errorMessage || '未找到匹配的剧集，请尝试其他关键词'
        );
      }
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchError('搜索失败，请检查弹幕 API 服务是否正常运行');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // 选择动漫，加载剧集列表
  const handleAnimeSelect = useCallback(async (anime: DanmakuAnime) => {
    setSelectedAnime(anime);
    setIsLoadingEpisodes(true);

    try {
      const response = await getEpisodes(anime.animeId);

      if (response.success && response.bangumi.episodes.length > 0) {
        setEpisodes(response.bangumi.episodes);
      } else {
        setEpisodes([]);
        setSearchError('该剧集暂无弹幕信息');
      }
    } catch (error) {
      console.error('获取剧集失败:', error);
      setEpisodes([]);
      setSearchError('获取剧集失败');
    } finally {
      setIsLoadingEpisodes(false);
    }
  }, []);

  // 选择剧集
  const handleEpisodeSelect = useCallback(
    (episode: DanmakuEpisode) => {
      if (!selectedAnime) return;

      const selection: DanmakuSelection = {
        animeId: selectedAnime.animeId,
        episodeId: episode.episodeId,
        animeTitle: selectedAnime.animeTitle,
        episodeTitle: episode.episodeTitle,
        searchKeyword: searchKeyword.trim() || undefined, // 使用当前搜索框的关键词
      };

      onDanmakuSelect(selection);
    },
    [selectedAnime, searchKeyword, onDanmakuSelect]
  );

  // 回到搜索结果
  const handleBackToResults = useCallback(() => {
    setSelectedAnime(null);
    setEpisodes([]);
    setEpisodeGroupIndex(0);
  }, []);

  // 判断当前剧集是否已选中
  const isEpisodeSelected = useCallback(
    (episodeId: number) => {
      return currentSelection?.episodeId === episodeId;
    },
    [currentSelection]
  );

  // 处理文件上传
  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith('.xml')) {
        setSearchError('请上传XML格式的弹幕文件');
        return;
      }

      try {
        const text = await file.text();
        const { parseXmlDanmaku } = await import('@/lib/danmaku/xml-parser');
        const comments = parseXmlDanmaku(text);

        if (comments.length === 0) {
          setSearchError('弹幕文件解析失败或文件为空');
          return;
        }

        onUploadDanmaku?.(comments);
        setSearchError(null);
      } catch (error) {
        console.error('上传弹幕失败:', error);
        setSearchError('弹幕文件解析失败');
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [onUploadDanmaku]
  );

  // 当视频标题首次加载时，初始化搜索关键词（仅执行一次）
  useEffect(() => {
    if (videoTitle && !initializedRef.current) {
      setSearchKeyword(videoTitle);
      initializedRef.current = true; // 标记已初始化，防止后续自动填充
    }
  }, [videoTitle]);

  useEffect(() => {
    if (episodes.length > 0) {
      setEpisodeGroupIndex(Math.floor(currentEpisodeIndex / episodesPerGroup));
    } else {
      setEpisodeGroupIndex(0);
    }
  }, [episodes, currentEpisodeIndex]);

  const episodeGroupCount = Math.ceil(episodes.length / episodesPerGroup);

  const episodeGroups = useMemo(() => {
    return Array.from({ length: episodeGroupCount }, (_, idx) => {
      const start = idx * episodesPerGroup + 1;
      const end = Math.min((idx + 1) * episodesPerGroup, episodes.length);
      return `${start}-${end}`;
    });
  }, [episodeGroupCount, episodes.length]);

  const displayEpisodeGroupIndex = useMemo(() => {
    if (episodeDescending) {
      return episodeGroupCount - 1 - episodeGroupIndex;
    }
    return episodeGroupIndex;
  }, [episodeDescending, episodeGroupCount, episodeGroupIndex]);

  const currentGroupEpisodes = useMemo(() => {
    if (episodes.length === 0) return [];

    const start = episodeGroupIndex * episodesPerGroup;
    const end = Math.min(start + episodesPerGroup, episodes.length);
    const groupEpisodes = episodes.slice(start, end);
    const withEpisodeNumber = groupEpisodes.map((episode, index) => ({
      ...episode,
      episodeNumber: start + index + 1,
    }));

    return episodeDescending
      ? [...withEpisodeNumber].reverse()
      : withEpisodeNumber;
  }, [episodes, episodeDescending, episodeGroupIndex]);

  const getEpisodeDisplayLabel = useCallback(
    (episodeTitle: string, episodeNumber: number) => {
      if (!episodeTitle) {
        return String(episodeNumber);
      }

      if (episodeTitle.match(/^OVA\s+\d+/i)) {
        return episodeTitle;
      }

      const sxxexxMatch = episodeTitle.match(
        /[Ss](\d+)[Ee](\d{1,4}(?:\.\d+)?)/
      );
      if (sxxexxMatch) {
        const season = sxxexxMatch[1].padStart(2, '0');
        const episode = sxxexxMatch[2];
        return `S${season}E${episode}`;
      }

      const match = episodeTitle.match(/(?:第)?(\d+(?:\.\d+)?)(?:集|话)/);
      if (match) {
        return match[1];
      }

      return String(episodeNumber);
    },
    []
  );

  // 计算tooltip位置
  const calculateTooltipPosition = useCallback(
    (
      element: HTMLElement
    ): {
      vertical: 'top' | 'bottom';
      horizontal: 'left' | 'center' | 'right';
    } => {
      const rect = element.getBoundingClientRect();

      // 判断位置：获取剧集网格容器的位置
      const container = element.closest('.flex.flex-wrap');
      if (container) {
        const containerRect = container.getBoundingClientRect();

        // 垂直位置：始终显示在下方
        const vertical: 'top' | 'bottom' = 'bottom';

        // 水平位置：判断左右边缘
        const leftDistance = rect.left - containerRect.left;
        const rightDistance = containerRect.right - rect.right;
        let horizontal: 'left' | 'center' | 'right' = 'center';
        if (leftDistance < 100) {
          horizontal = 'left';
        } else if (rightDistance < 100) {
          horizontal = 'right';
        }

        return { vertical, horizontal };
      }

      // 默认返回下方居中
      return { vertical: 'bottom', horizontal: 'center' as const };
    },
    []
  );

  // 处理鼠标悬停
  const handleMouseEnter = useCallback(
    (episodeId: number, element: HTMLElement) => {
      setHoveredEpisodeId(episodeId);
      setTooltipPosition(calculateTooltipPosition(element));
    },
    [calculateTooltipPosition]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredEpisodeId(null);
  }, []);

  const canScrollCategoryContainer = useCallback((deltaY: number) => {
    const container = categoryContainerRef.current;
    if (!container) return false;

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    if (maxScrollLeft <= 0) return false;

    if (deltaY < 0) {
      return container.scrollLeft > 0;
    }

    if (deltaY > 0) {
      return container.scrollLeft < maxScrollLeft;
    }

    return false;
  }, []);

  // 阻止页面竖向滚动
  const preventPageScroll = useCallback(
    (e: WheelEvent) => {
      if (isCategoryHovered && canScrollCategoryContainer(e.deltaY)) {
        e.preventDefault();
      }
    },
    [isCategoryHovered, canScrollCategoryContainer]
  );

  // 处理滚轮事件，实现横向滚动
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (
        isCategoryHovered &&
        categoryContainerRef.current &&
        canScrollCategoryContainer(e.deltaY)
      ) {
        e.preventDefault(); // 阻止默认的竖向滚动

        const container = categoryContainerRef.current;
        const scrollAmount = e.deltaY * 2; // 调整滚动速度

        // 根据滚轮方向进行横向滚动
        container.scrollBy({
          left: scrollAmount,
          behavior: 'smooth',
        });
      }
    },
    [isCategoryHovered, canScrollCategoryContainer]
  );

  // 添加全局wheel事件监听器
  useEffect(() => {
    if (isCategoryHovered) {
      // 鼠标悬停时阻止页面滚动
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      // 鼠标离开时恢复页面滚动
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    }

    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isCategoryHovered, preventPageScroll, handleWheel]);

  // 鼠标拖动开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!categoryContainerRef.current) return;

    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    suppressClickRef.current = false;
    dragStartXRef.current = e.pageX - categoryContainerRef.current.offsetLeft;
    dragStartScrollLeftRef.current = categoryContainerRef.current.scrollLeft;
    categoryContainerRef.current.style.cursor = 'grabbing';
  }, []);

  // 鼠标拖动中
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current || !categoryContainerRef.current) return;

    const x = e.pageX - categoryContainerRef.current.offsetLeft;
    const distance = x - dragStartXRef.current;

    if (Math.abs(distance) > 5) {
      hasDraggedRef.current = true;
      e.preventDefault();
    }

    categoryContainerRef.current.scrollLeft =
      dragStartScrollLeftRef.current - distance * 1.5;
  }, []);

  // 鼠标拖动结束
  const handleMouseUp = useCallback(() => {
    suppressClickRef.current = hasDraggedRef.current;
    isDraggingRef.current = false;

    if (categoryContainerRef.current) {
      categoryContainerRef.current.style.cursor = 'grab';
    }
  }, []);

  // 鼠标离开容器
  const handleMouseLeaveContainer = useCallback(() => {
    setIsCategoryHovered(false);
    suppressClickRef.current = hasDraggedRef.current;
    isDraggingRef.current = false;

    if (categoryContainerRef.current) {
      categoryContainerRef.current.style.cursor = 'grab';
    }
  }, []);

  const handleEpisodeGroupClick = useCallback(
    (idx: number, e: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        e.preventDefault();
        suppressClickRef.current = false;
        return;
      }

      setEpisodeGroupIndex(
        episodeDescending ? episodeGroupCount - 1 - idx : idx
      );
    },
    [episodeDescending, episodeGroupCount]
  );

  // 获取tooltip样式
  const getTooltipStyle = useCallback(
    (position: {
      vertical: 'top' | 'bottom';
      horizontal: 'left' | 'center' | 'right';
    }) => {
      const baseStyle =
        'absolute px-3 py-1 bg-gray-800 dark:bg-gray-900 text-white text-xs rounded-md shadow-lg whitespace-nowrap pointer-events-none z-[100] max-w-[300px] transition-all duration-200 ease-out delay-100';

      let positionStyle = '';

      // 垂直位置
      if (position.vertical === 'top') {
        positionStyle += ' bottom-full mb-2';
      } else {
        positionStyle += ' top-full mt-2';
      }

      // 水平位置
      if (position.horizontal === 'left') {
        positionStyle += ' left-0';
      } else if (position.horizontal === 'right') {
        positionStyle += ' right-0';
      } else {
        positionStyle += ' left-1/2 -translate-x-1/2';
      }

      return `${baseStyle} ${positionStyle}`;
    },
    []
  );

  // 获取箭头样式
  const getArrowStyle = useCallback(
    (position: {
      vertical: 'top' | 'bottom';
      horizontal: 'left' | 'center' | 'right';
    }) => {
      let arrowStyle =
        'absolute w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent';

      if (position.vertical === 'top') {
        arrowStyle += ' top-full border-t-gray-800 dark:border-t-gray-900';
      } else {
        arrowStyle +=
          ' bottom-full border-b-4 border-b-gray-800 dark:border-b-gray-900 border-t-0';
      }

      if (position.horizontal === 'left') {
        arrowStyle += ' left-4';
      } else if (position.horizontal === 'right') {
        arrowStyle += ' right-4';
      } else {
        arrowStyle += ' left-1/2 -translate-x-1/2';
      }

      return arrowStyle;
    },
    []
  );

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      {/* 搜索区域 - 固定在顶部 */}
      <div className='mb-4 flex-shrink-0'>
        <div className='flex flex-wrap gap-2'>
          <input
            type='text'
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch(searchKeyword);
              }
            }}
            placeholder='输入剧集名称搜索弹幕...'
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
            data-form-type='other'
            data-lpignore='true'
            className='flex-1 min-w-[220px] rounded-lg border border-gray-300 px-3 py-2 text-sm
                     transition-colors focus:border-green-500 focus:outline-none
                     focus:ring-2 focus:ring-green-500/20
                     dark:border-gray-600 dark:bg-gray-800 dark:text-white
                     sm:px-4'
            disabled={isSearching}
          />
          <button
            onClick={() => handleSearch(searchKeyword)}
            disabled={isSearching}
            className='flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-green-500 px-3 py-2
                     text-sm font-medium text-white transition-colors
                     hover:bg-green-600 disabled:cursor-not-allowed
                     disabled:opacity-50 dark:bg-green-600 dark:hover:bg-green-700
                     lg:px-4 min-w-[44px]'
          >
            {isSearching ? (
              <div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
            ) : (
              <MagnifyingGlassIcon className='h-4 w-4' />
            )}
            <span className='hidden lg:inline'>
              {isSearching ? '搜索中...' : '搜索'}
            </span>
          </button>
        </div>

        {/* 错误提示 */}
        {searchError && (
          <div
            className='mt-3 rounded-lg border border-red-500/30 bg-red-500/10
                        px-3 py-2 text-sm text-red-600 dark:text-red-400'
          >
            {searchError}
          </div>
        )}
      </div>

      {/* 可滚动内容区域 */}
      <div className='flex-1 overflow-y-auto min-h-0'>
        {/* 当前选择的弹幕信息 */}
        {currentSelection && (
          <div
            className='mb-4 rounded-lg border border-green-500/30 bg-green-500/10
                        px-3 py-2 text-sm'
          >
            <p className='font-semibold text-green-600 dark:text-green-400'>
              当前弹幕
            </p>
            <p className='mt-1 text-gray-700 dark:text-gray-300'>
              {currentSelection.animeTitle}
            </p>
            <p className='text-xs text-gray-600 dark:text-gray-400'>
              {currentSelection.episodeTitle}
            </p>
            {currentSelection.danmakuCount !== undefined && (
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-500'>
                弹幕数量: {currentSelection.danmakuCount}
                {currentSelection.danmakuOriginalCount &&
                  ` (原始 ${currentSelection.danmakuOriginalCount} 条)`}
              </p>
            )}
          </div>
        )}

        {/* 内容区域 */}
        <div>
          {/* 显示剧集列表 */}
          {selectedAnime && (
            <div className='space-y-2'>
              {/* 返回按钮 */}
              <button
                onClick={handleBackToResults}
                className='mb-2 text-sm text-green-600 hover:underline
                       dark:text-green-400'
              >
                ← 返回搜索结果
              </button>

              {/* 动漫标题 */}
              <h3 className='mb-3 text-base font-semibold text-gray-800 dark:text-white'>
                {selectedAnime.animeTitle}
              </h3>

              {/* 加载中 */}
              {isLoadingEpisodes && (
                <div className='flex items-center justify-center py-8'>
                  <div
                    className='h-8 w-8 animate-spin rounded-full border-4
                              border-gray-300 border-t-green-500'
                  />
                </div>
              )}

              {/* 剧集列表 */}
              {!isLoadingEpisodes && episodes.length > 0 && (
                <div className='pb-4'>
                  {/* 分类标签 */}
                  <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700'>
                    <div
                      ref={categoryContainerRef}
                      className='flex-1 overflow-x-auto cursor-grab select-none'
                      style={{
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                        WebkitOverflowScrolling: 'touch',
                      }}
                      onMouseEnter={() => setIsCategoryHovered(true)}
                      onMouseLeave={handleMouseLeaveContainer}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                    >
                      <div className='flex gap-2 min-w-max'>
                        {episodeGroups.map((label, idx) => {
                          const isActive = idx === displayEpisodeGroupIndex;
                          return (
                            <button
                              key={label}
                              onClick={(e) => handleEpisodeGroupClick(idx, e)}
                              className={`relative w-20 py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center ${
                                isActive
                                  ? 'text-green-500 dark:text-green-400'
                                  : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                              }`}
                            >
                              {label}
                              {isActive && (
                                <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      onClick={() => setEpisodeDescending((prev) => !prev)}
                      className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
                      title={episodeDescending ? '切换正序' : '切换倒序'}
                    >
                      <svg
                        className='h-4 w-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                        />
                      </svg>
                    </button>
                  </div>

                  {/* 剧集网格 */}
                  <div className='flex flex-wrap gap-3 overflow-y-auto flex-1 content-start pb-4'>
                    {currentGroupEpisodes.map((episode) => {
                      const isSelected = isEpisodeSelected(episode.episodeId);
                      const displayLabel = getEpisodeDisplayLabel(
                        episode.episodeTitle,
                        episode.episodeNumber
                      );
                      const isHovered = hoveredEpisodeId === episode.episodeId;
                      return (
                        <div key={episode.episodeId} className='relative'>
                          <button
                            onClick={() => handleEpisodeSelect(episode)}
                            onMouseEnter={(e) =>
                              handleMouseEnter(
                                episode.episodeId,
                                e.currentTarget
                              )
                            }
                            onMouseLeave={handleMouseLeave}
                            className={`h-10 min-w-10 px-3 py-2 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap font-mono
                            ${
                              isSelected
                                ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 dark:bg-green-600'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                            }`.trim()}
                          >
                            {displayLabel}
                          </button>
                          {/* Tooltip */}
                          {isHovered && (
                            <div className={getTooltipStyle(tooltipPosition)}>
                              <div className='relative'>
                                {episode.episodeTitle}
                                {/* 箭头 */}
                                <div
                                  className={getArrowStyle(tooltipPosition)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!isLoadingEpisodes && episodes.length === 0 && (
                <div className='py-8 text-center text-sm text-gray-500'>
                  暂无剧集信息
                </div>
              )}
            </div>
          )}

          {/* 显示搜索结果 */}
          {!selectedAnime && searchResults.length > 0 && (
            <div className='space-y-2 pb-4'>
              {searchResults.map((anime) => (
                <div
                  key={anime.animeId}
                  onClick={() => handleAnimeSelect(anime)}
                  className='flex cursor-pointer items-start gap-3 rounded-lg
                         bg-gray-100 p-3 transition-colors hover:bg-gray-200
                         dark:bg-gray-800 dark:hover:bg-gray-700'
                >
                  {/* 封面 */}
                  {anime.imageUrl && (
                    <div className='h-16 w-12 flex-shrink-0 overflow-hidden rounded'>
                      <img
                        src={anime.imageUrl}
                        alt={anime.animeTitle}
                        className='h-full w-full object-cover'
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  {/* 信息 */}
                  <div className='min-w-0 flex-1'>
                    <div className='relative'>
                      <p className='truncate font-semibold text-gray-800 dark:text-white peer'>
                        {anime.animeTitle}
                      </p>
                      {/* 自定义 tooltip */}
                      <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none z-[100]'>
                        {anime.animeTitle}
                        <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800' />
                      </div>
                    </div>
                    <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400'>
                      <span className='rounded bg-gray-200 px-2 py-0.5 dark:bg-gray-700'>
                        {anime.typeDescription || anime.type}
                      </span>
                      {anime.episodeCount && (
                        <span>{anime.episodeCount} 集</span>
                      )}
                      {anime.startDate && <span>{anime.startDate}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 空状态 */}
          {!selectedAnime && searchResults.length === 0 && !isSearching && (
            <div className='flex flex-col items-center justify-center py-12 text-center'>
              <MagnifyingGlassIcon className='mb-3 h-12 w-12 text-gray-400' />
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                输入剧集名称搜索弹幕
              </p>
            </div>
          )}
        </div>

        {/* 上传弹幕区域 - 移动端：在滚动容器内 */}
        {onUploadDanmaku && (
          <div className='mt-3 border-t border-gray-200 pt-3 dark:border-gray-700 md:hidden'>
            <input
              ref={fileInputRef}
              type='file'
              accept='.xml'
              onChange={handleFileUpload}
              className='hidden'
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
            >
              搜不到想要的弹幕？自行上传
            </button>
          </div>
        )}
      </div>

      {/* 上传弹幕区域 - PC端：固定在底部 */}
      {onUploadDanmaku && (
        <div className='mt-3 flex-shrink-0 border-t border-gray-200 pt-3 dark:border-gray-700 hidden md:block'>
          <button
            onClick={() => fileInputRef.current?.click()}
            className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
          >
            搜不到想要的弹幕？自行上传
          </button>
        </div>
      )}
    </div>
  );
}
