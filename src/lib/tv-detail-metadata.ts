import {
  getRecommendationCache,
  recommendationCacheKeys,
  setRecommendationCache,
} from '@/lib/recommendations/cache';

export type TVDetailMetadata = {
  tmdbId: string;
  backdrop?: string | null;
  poster?: string | null;
  overview?: string;
  rating?: string;
  releaseDate?: string;
  genres?: { id: number; name: string }[];
};

const pendingRequests = new Map<string, Promise<TVDetailMetadata | null>>();

/** 与 /play 共用 TMDB 缓存；测速更新源详情时不重复搜索影片。 */
export async function fetchTVDetailMetadata(
  title: string
): Promise<TVDetailMetadata | null> {
  const name = title.trim();
  if (!name) return null;
  const mappingKey = recommendationCacheKeys.tmdbTitleMapping(name);
  const cachedId = getRecommendationCache<string>(mappingKey);
  if (cachedId) {
    const cached = getRecommendationCache<TVDetailMetadata>(
      recommendationCacheKeys.tmdbDetails(cachedId)
    );
    if (cached) return cached;
  }

  const pending = pendingRequests.get(name);
  if (pending) return pending;
  const request = (async () => {
    try {
      const params = new URLSearchParams(
        cachedId ? { cachedId } : { title: name }
      );
      const response = await fetch(`/api/tmdb-details?${params}`);
      if (!response.ok) return null;
      const result = (await response.json()) as TVDetailMetadata;
      if (!result?.tmdbId) return null;
      setRecommendationCache(mappingKey, result.tmdbId);
      setRecommendationCache(
        recommendationCacheKeys.tmdbDetails(result.tmdbId),
        result
      );
      return result;
    } catch {
      // TMDB 未配置或暂不可用时，详情仍可使用采集源的海报与简介。
      return null;
    }
  })().finally(() => pendingRequests.delete(name));
  pendingRequests.set(name, request);
  return request;
}
