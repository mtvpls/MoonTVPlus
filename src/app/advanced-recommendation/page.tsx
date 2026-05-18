'use client';

import { Blend, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface ScriptSourceOption {
  key: string;
  name: string;
  description?: string;
}

export default function AdvancedRecommendationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const initialUrlSourceRef = useRef(searchParams.get('source') || '');

  const [sources, setSources] = useState<ScriptSourceOption[]>([]);
  const [selectedSource, setSelectedSource] = useState('');
  const [videos, setVideos] = useState<SearchResult[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const initializedRef = useRef(false);
  const hasSyncedUrlRef = useRef(false);

  useEffect(() => {
    const fetchSources = async () => {
      setIsLoadingSources(true);
      try {
        const response = await fetch('/api/advanced-recommendation/sources');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || '获取脚本源失败');
        }

        const nextSources: ScriptSourceOption[] = Array.isArray(data.sources)
          ? data.sources
          : [];
        setSources(nextSources);

        const initialSource =
          nextSources.find((item) => item.key === initialUrlSourceRef.current)
            ?.key ||
          nextSources[0]?.key ||
          '';

        setSelectedSource(initialSource);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取脚本源失败');
      } finally {
        setIsLoadingSources(false);
        initializedRef.current = true;
      }
    };

    fetchSources();
  }, []);

  useEffect(() => {
    if (!initializedRef.current || !selectedSource) return;
    if (!hasSyncedUrlRef.current) {
      hasSyncedUrlRef.current = true;
      if (initialUrlSourceRef.current === selectedSource) return;
    }

    const params = new URLSearchParams();
    params.set('source', selectedSource);
    router.replace(`/advanced-recommendation?${params.toString()}`, {
      scroll: false,
    });
  }, [selectedSource, router]);

  useEffect(() => {
    if (!selectedSource) return;

    setVideos([]);
    setPage(1);
    setHasMore(true);
    setError('');
  }, [selectedSource]);

  useEffect(() => {
    if (!selectedSource) return;

    const fetchVideos = async () => {
      setIsLoadingVideos(true);
      try {
        const response = await fetch(
          `/api/advanced-recommendation/videos?source=${encodeURIComponent(selectedSource)}&page=${page}`
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || '获取推荐失败');
        }

        const nextResults = Array.isArray(data.results) ? data.results : [];
        setVideos((prev) => (page === 1 ? nextResults : [...prev, ...nextResults]));
        setHasMore(Number(data.page || page) < Number(data.pageCount || 1));
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取推荐失败');
        setHasMore(false);
      } finally {
        setIsLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [selectedSource, page]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isLoadingVideos || !!error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [error, hasMore, isLoadingVideos]);

  return (
    <PageLayout activePath='/advanced-recommendation'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 mb-10'>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2'>
            <Blend className='w-6 h-6 text-green-500' />
            高级推荐
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
            浏览视频源脚本提供的推荐内容
          </p>
        </div>

        <div className='max-w-6xl mx-auto space-y-6'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
              选择脚本源
            </label>
            {isLoadingSources ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <Loader2 className='h-5 w-5 animate-spin text-gray-400' />
                <span className='ml-2 text-sm text-gray-500 dark:text-gray-400'>
                  加载脚本源中...
                </span>
              </div>
            ) : sources.length === 0 ? (
              <div className='flex items-center justify-center h-24 rounded-xl border border-dashed border-gray-300 bg-gray-50/70 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400'>
                暂无可用的视频源脚本
              </div>
            ) : (
              <div className='flex justify-center'>
                <CapsuleSwitch
                  options={sources.map((item) => ({
                    label: item.name,
                    value: item.key,
                  }))}
                  active={selectedSource}
                  onChange={setSelectedSource}
                />
              </div>
            )}
          </div>

          {!!error && (
            <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300'>
              {error}
            </div>
          )}

          {!isLoadingSources && sources.length > 0 && (
            <>
              {videos.length > 0 ? (
                <div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4'>
                  {videos.map((video, index) => (
                    <VideoCard
                      key={`${video.source}-${video.id}-${index}`}
                      id={video.id}
                      source={video.source}
                      source_name={video.source_name}
                      title={video.title}
                      poster={video.poster}
                      year={video.year}
                      rate={
                        typeof video.rating === 'number'
                          ? String(video.rating)
                          : undefined
                      }
                      douban_id={video.douban_id}
                      tmdb_id={video.tmdb_id}
                      from='source-search'
                    />
                  ))}
                </div>
              ) : !isLoadingVideos && !error ? (
                <div className='flex items-center justify-center h-32 rounded-xl border border-dashed border-gray-300 bg-gray-50/70 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400'>
                  当前脚本暂无推荐内容
                </div>
              ) : null}

              {isLoadingVideos && (
                <div className='flex justify-center py-6'>
                  <Loader2 className='h-6 w-6 animate-spin text-gray-400' />
                </div>
              )}

              <div ref={loadMoreRef} className='h-10' />
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
