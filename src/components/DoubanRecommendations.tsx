'use client';

import { useCallback, useEffect, useState } from 'react';

import { useEnableComments } from '@/hooks/useEnableComments';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

interface DoubanRecommendation {
  doubanId: string;
  title: string;
  poster: string;
  rating: string;
}

interface DoubanRecommendationsProps {
  doubanId: number;
}

export default function DoubanRecommendations({
  doubanId,
}: DoubanRecommendationsProps) {
  const [recommendations, setRecommendations] = useState<
    DoubanRecommendation[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enableComments = useEnableComments();

  const fetchRecommendations = useCallback(async () => {
    try {
      console.log('正在获取推荐');
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
            console.log('使用缓存的推荐数据');
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
        throw new Error('获取推荐失败');
      }

      const result = await response.json();
      console.log('获取到推荐:', result.recommendations);

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
