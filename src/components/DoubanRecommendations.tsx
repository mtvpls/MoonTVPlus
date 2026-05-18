'use client';

import { useCallback,useEffect, useState } from 'react';

import { useEnableComments } from '@/hooks/useEnableComments';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

import {
  getRecommendationCache,
  recommendationCacheKeys,
  setRecommendationCache,
} from '@/lib/recommendations/cache';

interface DoubanRecommendation {
  doubanId: string;
  title: string;
  poster: string;
  rating: string;
}

interface DoubanRecommendationsProps {
  doubanId: number;
}

export default function DoubanRecommendations({ doubanId }: DoubanRecommendationsProps) {
  const [recommendations, setRecommendations] = useState<DoubanRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enableComments = useEnableComments();

  const fetchRecommendations = useCallback(async () => {
    try {
      console.log('正在获取推荐');
      setLoading(true);
      setError(null);

      const cacheKey = recommendationCacheKeys.doubanRecommendations(doubanId);
      const cached = getRecommendationCache<DoubanRecommendation[]>(cacheKey);

      if (cached) {
        console.log('使用缓存的推荐数据');
        setRecommendations(cached);
        setLoading(false);
        return;
      }

      const response = await fetch(
        `/api/douban-recommendations?id=${doubanId}`
      );

      if (!response.ok) {
        throw new Error('获取推荐失败');
      }

      const result = await response.json();
      console.log('获取到推荐:', result.recommendations);

      const recommendationsData = result.recommendations || [];
      setRecommendations(recommendationsData);

      setRecommendationCache(cacheKey, recommendationsData);
    } catch (err) {
      console.error('获取推荐失败:', err);
      setError(err instanceof Error ? err.message : '获取推荐失败');
    } finally {
      setLoading(false);
    }
  }, [doubanId]);

  useEffect(() => {
    if (enableComments && doubanId) {
      fetchRecommendations();
    }
  }, [enableComments, doubanId, fetchRecommendations]);

  if (!enableComments) {
    return null;
  }

  if (loading) {
    return (
      <div className='flex justify-center items-center py-8'>
        <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='text-center py-8 text-gray-500 dark:text-gray-400'>
        {error}
      </div>
    );
  }

  if (recommendations.length === 0) {
    return null;
  }

  return (
    <ScrollableRow scrollDistance={600} bottomPadding='pb-2'>
      {recommendations.map((rec) => (
        <div
          key={rec.doubanId}
          className='min-w-[96px] w-24 sm:min-w-[140px] sm:w-[140px]'
        >
          <VideoCard
            title={rec.title}
            poster={rec.poster}
            rate={rec.rating}
            douban_id={parseInt(rec.doubanId)}
            from='douban'
          />
        </div>
      ))}
    </ScrollableRow>
  );
}
