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
  const episodeGroupContainerRef = useRef<HTMLDivElement>(null);
  const episodeGroupButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [episodeGroupIndex, setEpisodeGroupIndex] = useState(0);
  const [episodeDescending, setEpisodeDescending] = useState(false);
  const [episodeViewMode, setEpisodeViewMode] = useState<'list' | 'grid'>('list');
  const [isEpisodeGroupHovered, setIsEpisodeGroupHovered] = useState(false);
  const episodesPerGroup = 50;

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
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [onUploadDanmaku]);

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

    return episodeDescending ? [...withEpisodeNumber].reverse() : withEpisodeNumber;
  }, [episodes, episodeDescending, episodeGroupIndex]);

  const getEpisodeDisplayLabel = useCallback((episodeTitle: string, episodeNumber: number) => {
    if (!episodeTitle) {
      return String(episodeNumber);
    }

    if (episodeTitle.match(/^OVA\s+\d+/i)) {
      return episodeTitle;
    }

    const sxxexxMatch = episodeTitle.match(/[Ss](\d+)[Ee](\d{1,4}(?:\.\d+)?)/);
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
  }, []);

  const preventPageScroll = useCallback((e: WheelEvent) => {
    if (isEpisodeGroupHovered) {
      e.preventDefault();
    }
  }, [isEpisodeGroupHovered]);

  const handleEpisodeGroupWheel = useCallback((e: WheelEvent) => {
    if (!isEpisodeGroupHovered || !episodeGroupContainerRef.current) {
      return;
    }

    const container = episodeGroupContainerRef.current;
    if (container.scrollWidth <= container.clientWidth) {
      return;
    }

    e.preventDefault();
    container.scrollBy({
      left: e.deltaY * 2,
      behavior: 'smooth',
    });
  }, [isEpisodeGroupHovered]);

  useEffect(() => {
    if (isEpisodeGroupHovered) {
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleEpisodeGroupWheel, { passive: false });
    } else {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleEpisodeGroupWheel);
    }

    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleEpisodeGroupWheel);
    };
  }, [handleEpisodeGroupWheel, isEpisodeGroupHovered, preventPageScroll]);

  useEffect(() => {
    const btn = episodeGroupButtonRefs.current[displayEpisodeGroupIndex];
    const container = episodeGroupContainerRef.current;
    if (!btn || !container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const btnLeft = btnRect.left - containerRect.left + container.scrollLeft;
    const targetScrollLeft = btnLeft - (containerRect.width - btnRect.width) / 2;

    container.scrollTo({
      left: targetScrollLeft,
      behavior: 'smooth',
    });
  }, [displayEpisodeGroupIndex]);

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
                {currentSelection.danmakuOriginalCount && ` (原始 ${currentSelection.danmakuOriginalCount} 条)`}
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
                <div className='mb-4 border-b border-gray-300 dark:border-gray-700'>
                  <div
                    ref={episodeGroupContainerRef}
                    className='flex items-center gap-4 overflow-x-auto pb-3'
                    onMouseEnter={() => setIsEpisodeGroupHovered(true)}
                    onMouseLeave={() => setIsEpisodeGroupHovered(false)}
                  >
                    {episodeGroups.map((label, idx) => {
                      const isActive = idx === displayEpisodeGroupIndex;
                      return (
                        <button
                          key={label}
                          ref={(el) => {
                            episodeGroupButtonRefs.current[idx] = el;
                          }}
                          onClick={() =>
                            setEpisodeGroupIndex(
                              episodeDescending ? episodeGroupCount - 1 - idx : idx
                            )
                          }
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
                    <button
                      onClick={() => setEpisodeDescending((prev) => !prev)}
                      className='flex-shrink-0 rounded-md p-2 text-gray-700 hover:bg-gray-100 hover:text-green-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-green-400'
                      title={episodeDescending ? '切换正序' : '切换倒序'}
                    >
                      <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4' />
                      </svg>
                    </button>
                    <div className='ml-auto flex items-center gap-1 rounded-md bg-gray-100 p-1 dark:bg-gray-800'>
                      <button
                        onClick={() => setEpisodeViewMode('list')}
                        title='列表视图'
                        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                          episodeViewMode === 'list'
                            ? 'bg-white text-green-600 shadow-sm dark:bg-gray-700 dark:text-green-400'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' />
                        </svg>
                      </button>
                      <button
                        onClick={() => setEpisodeViewMode('grid')}
                        title='格子视图'
                        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                          episodeViewMode === 'grid'
                            ? 'bg-white text-green-600 shadow-sm dark:bg-gray-700 dark:text-green-400'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z' />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {episodeViewMode === 'grid' ? (
                  <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
                    {currentGroupEpisodes.map((episode) => {
                      const isSelected = isEpisodeSelected(episode.episodeId);
                      return (
                        <button
                          key={episode.episodeId}
                          onClick={() => handleEpisodeSelect(episode)}
                          className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                            isSelected
                              ? 'bg-green-500 text-white shadow-md'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                          }`}
                          title={episode.episodeTitle}
                        >
                          <div className='truncate'>
                            {getEpisodeDisplayLabel(episode.episodeTitle, episode.episodeNumber)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className='space-y-2'>
                    {currentGroupEpisodes.map((episode) => {
                      const isSelected = isEpisodeSelected(episode.episodeId);
                      return (
                        <button
                          key={episode.episodeId}
                          onClick={() => handleEpisodeSelect(episode)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all duration-200 group border ${
                            isSelected
                              ? 'bg-green-500 text-white border-green-600 shadow-md'
                              : 'bg-gray-100 hover:bg-gray-200 border-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 hover:border-green-500/50 hover:shadow-sm'
                          }`}
                        >
                          <div
                            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-green-500 text-white group-hover:bg-green-600'
                            }`}
                          >
                            {episode.episodeNumber}
                          </div>

                          <div className='flex-1 min-w-0'>
                            <div className='font-semibold text-sm mb-1 truncate'>
                              {episode.episodeTitle}
                            </div>
                            <div
                              className={`flex items-center gap-2 text-xs ${
                                isSelected ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              <span className='flex items-center gap-1'>
                                🆔 ID: {episode.episodeId}
                              </span>
                            </div>
                          </div>

                          {isSelected ? (
                            <div className='flex-shrink-0'>
                              <svg className='w-6 h-6 text-white' fill='currentColor' viewBox='0 0 20 20'>
                                <path fillRule='evenodd' d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z' clipRule='evenodd' />
                              </svg>
                            </div>
                          ) : (
                            <div className='flex-shrink-0'>
                              <svg className='w-5 h-5 text-gray-400 group-hover:text-green-500 transition-colors' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M9 5l7 7-7 7' />
                              </svg>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
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
                    <div
                      className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none z-[100]'
                    >
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
