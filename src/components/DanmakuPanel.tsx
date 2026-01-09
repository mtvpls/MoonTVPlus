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

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      {/* 搜索区域 - 固定在顶部 */}
      <div className='mb-4 flex-shrink-0'>
        <div className='flex gap-2'>
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
            className='flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm
                     transition-colors focus:border-green-500 focus:outline-none
                     focus:ring-2 focus:ring-green-500/20
                     dark:border-gray-600 dark:bg-gray-800 dark:text-white
                     sm:px-4'
            disabled={isSearching}
          />
          <button
            onClick={() => handleSearch(searchKeyword)}
            disabled={isSearching}
            className='flex items-center justify-center gap-2 rounded-lg bg-green-500 px-3 py-2
                     text-sm font-medium text-white transition-colors
                     hover:bg-green-600 disabled:cursor-not-allowed
                     disabled:opacity-50 dark:bg-green-600 dark:hover:bg-green-700
                     sm:px-4 md:gap-2'
          >
            {isSearching ? (
              <div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
            ) : (
              <MagnifyingGlassIcon className='h-4 w-4' />
            )}
            <span className='hidden sm:inline'>
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
              <div className='space-y-2 pb-4'>
                {episodes.map((episode, index) => {
                  const isSelected = isEpisodeSelected(episode.episodeId);
                  return (
                    <button
                      key={episode.episodeId}
                      onClick={() => handleEpisodeSelect(episode)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg text-left
                                transition-all duration-200 group border
                        ${
                          isSelected
                            ? 'bg-green-500 text-white border-green-600 shadow-md'
                            : 'bg-gray-100 hover:bg-gray-200 border-gray-200 ' +
                              'dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 ' +
                              'hover:border-green-500/50 hover:shadow-sm'
                        }`}
                    >
                      {/* 序号徽章 */}
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm
                        ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-green-500 text-white group-hover:bg-green-600'
                        }`}
                      >
                        {index + 1}
                      </div>

                      {/* 标题和信息 */}
                      <div className='flex-1 min-w-0'>
                        <div className='font-semibold text-sm mb-1 truncate'>
                          {episode.episodeTitle}
                        </div>
                        <div className={`flex items-center gap-2 text-xs
                          ${
                            isSelected
                              ? 'text-white/80'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          <span className='flex items-center gap-1'>
                            🆔 ID: {episode.episodeId}
                          </span>
                        </div>
                      </div>

                      {/* 选中标记 */}
                      {isSelected && (
                        <div className='flex-shrink-0'>
                          <svg className='w-6 h-6 text-white' fill='currentColor' viewBox='0 0 20 20'>
                            <path fillRule='evenodd' d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z' clipRule='evenodd' />
                          </svg>
                        </div>
                      )}

                      {/* 未选中时的箭头 */}
                      {!isSelected && (
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
                  <p className='truncate font-semibold text-gray-800 dark:text-white'>
                    {anime.animeTitle}
                  </p>
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
