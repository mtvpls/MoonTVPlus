'use client';

import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
import type { SearchResult } from '@/lib/types';

function PrivateLibrarySearchClient() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // 聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setSearched(true);
    setResults([]);

    try {
      const res = await fetch(`/api/private-library-search?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error('[PrivateSearch] 搜索请求失败:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(query);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      doSearch(query);
    }
  };

  return (
    <PageLayout activePath='/private-library'>
      <div className='container mx-auto px-4 py-6'>
        {/* 返回按钮 */}
        <button
          onClick={() => router.push('/private-library')}
          className='mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
        >
          <X className='h-4 w-4' />
          <span>返回影库</span>
        </button>

        <h1 className='mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100'>
          影库搜索
        </h1>
        <p className='mb-6 text-sm text-gray-500 dark:text-gray-400'>
          搜索 OpenList 私人影库和 Emby 中的资源
        </p>

        {/* 搜索输入框 */}
        <form onSubmit={handleSubmit} className='relative mb-8'>
          <div className='relative'>
            <Search className='absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400' />
            <input
              ref={inputRef}
              type='text'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='输入关键词搜索影库资源...'
              className='w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-12 pr-12 text-base text-gray-900 shadow-sm outline-none transition-colors focus:border-green-400 focus:ring-2 focus:ring-green-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-green-500 dark:focus:ring-green-900/30'
            />
            {query && (
              <button
                type='button'
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className='absolute right-14 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              >
                <X className='h-4 w-4' />
              </button>
            )}
            <button
              type='submit'
              disabled={isLoading || !query.trim()}
              className='absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-green-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isLoading ? '搜索中...' : '搜索'}
            </button>
          </div>
        </form>

        {/* 搜索结果 */}
        {isLoading && (
          <div className='flex h-40 items-center justify-center'>
            <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-green-500'></div>
          </div>
        )}

        {!isLoading && searched && results.length === 0 && (
          <div className='py-12 text-center text-gray-500 dark:text-gray-400'>
            <Search className='mx-auto mb-3 h-12 w-12 opacity-30' />
            <p className='text-lg'>未在私人影库中找到相关资源</p>
            <p className='mt-1 text-sm opacity-70'>试试其他关键词</p>
          </div>
        )}

        {!isLoading && results.length > 0 && (
          <>
            <div className='mb-4 flex items-center gap-2'>
              <span className='inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200'>
                共 {results.length} 个结果
              </span>
            </div>

            <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'>
              {results.map((item) => {
                const type = item.type_name === '电影' || item.episodes?.length <= 1 ? 'movie' : 'tv';
                return (
                  <div key={`${item.source}-${item.id}`} className='w-full'>
                    <VideoCard
                      id={item.id}
                      title={item.title}
                      poster={item.poster}
                      episodes={item.episodes?.length || 0}
                      source={item.source}
                      source_name={item.source_name}
                      douban_id={item.douban_id}
                      year={item.year}
                      from='search'
                      query={query.trim() !== item.title ? query.trim() : ''}
                      type={type}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* 初始状态提示 */}
        {!searched && !isLoading && (
          <div className='py-16 text-center text-gray-400 dark:text-gray-500'>
            <Search className='mx-auto mb-4 h-16 w-16 opacity-20' />
            <p className='text-lg'>输入关键词开始搜索</p>
            <p className='mt-1 text-sm opacity-70'>可搜索 OpenList 和 Emby 中的影视资源</p>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function PrivateLibrarySearchPage() {
  return (
    <Suspense>
      <PrivateLibrarySearchClient />
    </Suspense>
  );
}