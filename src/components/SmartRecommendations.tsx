'use client';

import { useCallback, useEffect, useState } from 'react';

import { useEnableComments } from '@/hooks/useEnableComments';
import { useRecommendationDataSource } from '@/hooks/useRecommendationDataSource';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

interface Recommendation {
  doubanId?: string;
  tmdbId?: number;
  title: string;
  poster: string;
  rating: string;
  mediaType?: 'movie' | 'tv';
}

interface SmartRecommendationsProps {
  doubanId?: number;
  videoTitle: string;
}

export default function SmartRecommendations({
  doubanId,
  videoTitle,
}: SmartRecommendationsProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enableComments = useEnableComments();
  const recommendationDataSource = useRecommendationDataSource();

  // 决定使用哪个数据源
  const getDataSource = useCallback(() => {
    // 如果没有配置，默认使用混合模式
    const dataSource = recommendationDataSource || 'Mixed';

    switch (dataSource) {
      case 'TMDB':
        return 'tmdb';
      case 'Douban':
        // 豆瓣类型需要检查开关和豆瓣ID
        return enableComments && doubanId ? 'douban' : null;
      case 'Mixed':
        // 混合模式：优先豆瓣，无豆瓣ID或关闭评论开关时使用TMDB
        if (!enableComments || !doubanId) {
          return 'tmdb';
        }
        return 'douban';
      default:
        return doubanId && enableComments ? 'douban' : 'tmdb';
    }
  }, [recommendationDataSource, enableComments, doubanId]);

  const fetchDoubanRecommendations = useCallback(async () => {
    if (!doubanId) return;

    try {
      console.log('正在获取豆瓣推荐');
      setLoading(true);
      setError(null);

      // 检查localStorage缓存
      const cacheKey = `douban_recommendations_${doubanId}`;
      const cached = localStorage.getItem(cacheKey);

      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached);
          const cacheAge = Date.now() - timestamp;
          const cacheMaxAge = 7 * 24 * 60 * 60 * 1000; // 7天

          if (cacheAge < cacheMaxAge) {
            console.log('使用缓存的豆瓣推荐数据');
            setRecommendations(data);
            setLoading(false);
            return;
          }
        } catch (e) {
          console.error('解析缓存失败:', e);
        }
      }

      const response = await fetch(
        `/api/douban-recommendations?id=${doubanId}`,
      );

      if (!response.ok) {
        throw new Error('获取豆瓣推荐失败');
      }

      const result = await response.json();
      const recommendationsData = result.recommendations || [];
      setRecommendations(recommendationsData);

      // 保存到localStorage
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            data: recommendationsData,
            timestamp: Date.now(),
          }),
        );
      } catch (e) {
        console.error('保存缓存失败:', e);
      }
    } catch (err) {
      console.error('获取豆瓣推荐失败:', err);
      setError(err instanceof Error ? err.message : '获取推荐失败');
    } finally {
      setLoading(false);
    }
  }, [doubanId]);

  const fetchTMDBRecommendations = useCallback(async () => {
    if (!videoTitle) return;

    try {
      console.log('正在获取TMDB推荐');
      setLoading(true);
      setError(null);

      // 检查title到tmdbId的映射缓存（1个月）
      const mappingCacheKey = `tmdb_title_mapping_${videoTitle}`;
      const mappingCache = localStorage.getItem(mappingCacheKey);
      let cachedId: string | null = null;

      if (mappingCache) {
        try {
          const { tmdbId, timestamp } = JSON.parse(mappingCache);
          const cacheAge = Date.now() - timestamp;
          const cacheMaxAge = 30 * 24 * 60 * 60 * 1000; // 1个月

          if (cacheAge < cacheMaxAge && tmdbId) {
            console.log('使用缓存的TMDB ID映射');
            cachedId = tmdbId;

            // 检查TMDB推荐数据缓存（1天）
            const recommendationsCacheKey = `tmdb_recommendations_${tmdbId}`;
            const recommendationsCache = localStorage.getItem(
              recommendationsCacheKey,
            );

            if (recommendationsCache) {
              try {
                const { data, timestamp: recTimestamp } =
                  JSON.parse(recommendationsCache);
                const recCacheAge = Date.now() - recTimestamp;
                const recCacheMaxAge = 24 * 60 * 60 * 1000; // 1天

                if (recCacheAge < recCacheMaxAge && data) {
                  console.log('使用缓存的TMDB推荐数据');
                  setRecommendations(data);
                  setLoading(false);
                  return;
                }
              } catch (e) {
                console.error('解析推荐缓存失败:', e);
              }
            }
          }
        } catch (e) {
          console.error('解析映射缓存失败:', e);
        }
      }

      // 构建请求URL
      const url = cachedId
        ? `/api/tmdb-recommendations?cachedId=${encodeURIComponent(cachedId)}`
        : `/api/tmdb-recommendations?title=${encodeURIComponent(videoTitle)}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('获取TMDB推荐失败');
      }

      const result = await response.json();
      const recommendationsData = result.recommendations || [];
      setRecommendations(recommendationsData);

      // 保存title到tmdbId的映射到localStorage（1个月）
      if (result.tmdbId) {
        try {
          localStorage.setItem(
            mappingCacheKey,
            JSON.stringify({
              tmdbId: result.tmdbId,
              timestamp: Date.now(),
            }),
          );

          // 保存TMDB推荐数据到localStorage（1天）
          const recommendationsCacheKey = `tmdb_recommendations_${result.tmdbId}`;
          localStorage.setItem(
            recommendationsCacheKey,
            JSON.stringify({
              data: recommendationsData,
              timestamp: Date.now(),
            }),
          );
        } catch (e) {
          console.error('保存缓存失败:', e);
        }
      }
    } catch (err) {
      console.error('获取TMDB推荐失败:', err);
      setError(err instanceof Error ? err.message : '获取推荐失败');
    } finally {
      setLoading(false);
    }
  }, [videoTitle]);

  useEffect(() => {
    const dataSource = getDataSource();

    if (!dataSource) {
      // 不显示推荐
      setRecommendations([]);
      return;
    }

    if (dataSource === 'douban') {
      fetchDoubanRecommendations();
    } else if (dataSource === 'tmdb') {
      fetchTMDBRecommendations();
    }
  }, [getDataSource, fetchDoubanRecommendations, fetchTMDBRecommendations]);

  // 如果不应该显示推荐，返回null
  const dataSource = getDataSource();
  if (!dataSource) {
    return null;
  }

  if (loading) {
    return (
      <div className='flex justify-center items-center py-8'>
        <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
      </div>
    );
  }

  if (error || recommendations.length === 0) {
    return null;
  }

  return (
    <div className='mt-6 -mx-3 md:mx-0 md:px-4'>
      <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden'>
        {/* 标题 */}
        <div className='px-3 md:px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2'>
            <svg className='w-5 h-5' fill='currentColor' viewBox='0 0 24 24'>
              <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
            </svg>
            更多推荐
          </h3>
        </div>

        {/* 推荐内容 */}
        <div className='px-3 pt-3 md:px-6 md:pt-6'>
          <ScrollableRow scrollDistance={600} bottomPadding='pb-2'>
            {recommendations.map((rec, index) => (
              <div
                key={rec.doubanId || rec.tmdbId || index}
                className='min-w-[96px] w-24 sm:min-w-[140px] sm:w-[140px]'
              >
                <VideoCard
                  title={rec.title}
                  poster={rec.poster}
                  rate={rec.rating}
                  douban_id={rec.doubanId ? parseInt(rec.doubanId) : undefined}
                  tmdb_id={rec.tmdbId}
                  from={rec.doubanId ? 'douban' : 'tmdb'}
                />
              </div>
            ))}
          </ScrollableRow>
        </div>
      </div>
    </div>
  );
}
