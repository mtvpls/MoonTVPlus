const DAY_IN_MS = 24 * 60 * 60 * 1000;

const RECOMMENDATION_CACHE_CONFIG = {
  doubanRecommendations: {
    prefix: 'douban_recommendations_',
    ttlMs: 7 * DAY_IN_MS,
  },
  tmdbTitleMapping: {
    prefix: 'tmdb_title_mapping_',
    ttlMs: 30 * DAY_IN_MS,
  },
  tmdbRecommendations: {
    prefix: 'tmdb_recommendations_',
    ttlMs: DAY_IN_MS,
  },
  tmdbDetails: {
    prefix: 'tmdb_details_',
    ttlMs: DAY_IN_MS,
  },
} as const;

type RecommendationCacheType = keyof typeof RECOMMENDATION_CACHE_CONFIG;

interface RecommendationCacheEntry<T> {
  value: T;
  timestamp: number;
}

let recommendationCacheCleanupInitialized = false;

export const recommendationCacheKeys = {
  doubanRecommendations: (doubanId: string | number) =>
    `${RECOMMENDATION_CACHE_CONFIG.doubanRecommendations.prefix}${doubanId}`,
  tmdbTitleMapping: (title: string) =>
    `${RECOMMENDATION_CACHE_CONFIG.tmdbTitleMapping.prefix}${title}`,
  tmdbRecommendations: (tmdbId: string | number) =>
    `${RECOMMENDATION_CACHE_CONFIG.tmdbRecommendations.prefix}${tmdbId}`,
  tmdbDetails: (tmdbId: string | number) =>
    `${RECOMMENDATION_CACHE_CONFIG.tmdbDetails.prefix}${tmdbId}`,
};

function scheduleCleanup(task: () => void): void {
  if (typeof window === 'undefined') return;

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => task());
    return;
  }

  setTimeout(task, 0);
}

function getCacheTypeForKey(key: string): RecommendationCacheType | null {
  for (const [type, config] of Object.entries(RECOMMENDATION_CACHE_CONFIG) as Array<
    [RecommendationCacheType, (typeof RECOMMENDATION_CACHE_CONFIG)[RecommendationCacheType]]
  >) {
    if (key.startsWith(config.prefix)) {
      return type;
    }
  }

  return null;
}

function parseCacheEntry<T>(rawValue: string | null): RecommendationCacheEntry<T> | null {
  if (!rawValue) return null;

  const parsed = JSON.parse(rawValue) as {
    value?: T;
    data?: T;
    tmdbId?: T;
    timestamp?: number;
  };

  if (typeof parsed.timestamp !== 'number' || Number.isNaN(parsed.timestamp)) {
    return null;
  }

  if ('value' in parsed) {
    return {
      value: parsed.value as T,
      timestamp: parsed.timestamp,
    };
  }

  if ('data' in parsed) {
    return {
      value: parsed.data as T,
      timestamp: parsed.timestamp,
    };
  }

  if ('tmdbId' in parsed) {
    return {
      value: parsed.tmdbId as T,
      timestamp: parsed.timestamp,
    };
  }

  return null;
}

function isExpired(type: RecommendationCacheType, timestamp: number): boolean {
  return Date.now() - timestamp >= RECOMMENDATION_CACHE_CONFIG[type].ttlMs;
}

export function getRecommendationCache<T>(
  key: string
): T | null {
  if (typeof window === 'undefined') return null;

  const cacheType = getCacheTypeForKey(key);
  if (!cacheType) return null;

  try {
    const entry = parseCacheEntry<T>(localStorage.getItem(key));

    if (!entry) {
      localStorage.removeItem(key);
      return null;
    }

    if (isExpired(cacheType, entry.timestamp)) {
      localStorage.removeItem(key);
      return null;
    }

    return entry.value;
  } catch (error) {
    console.error('读取推荐缓存失败:', error);
    localStorage.removeItem(key);
    return null;
  }
}

export function setRecommendationCache<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;

  try {
    const entry: RecommendationCacheEntry<T> = {
      value,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    console.error('保存推荐缓存失败:', error);
  }
}

export function clearRecommendationCache(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(key);
}

export async function clearExpiredRecommendationCaches(): Promise<number> {
  if (typeof window === 'undefined') return 0;

  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const cacheType = getCacheTypeForKey(key);
      if (!cacheType) continue;

      try {
        const entry = parseCacheEntry<unknown>(localStorage.getItem(key));
        if (!entry || isExpired(cacheType, entry.timestamp)) {
          keysToRemove.push(key);
        }
      } catch {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    return keysToRemove.length;
  } catch (error) {
    console.error('清理推荐缓存失败:', error);
    return 0;
  }
}

export function initRecommendationCacheModule(): void {
  if (typeof window === 'undefined' || recommendationCacheCleanupInitialized) {
    return;
  }

  recommendationCacheCleanupInitialized = true;

  scheduleCleanup(() => {
    void clearExpiredRecommendationCaches()
      .then((count) => {
        if (count > 0) {
          console.log(`[推荐缓存] 启动清理: 已删除 ${count} 个过期缓存`);
        }
      })
      .catch((error) => {
        console.error('[推荐缓存] 清理失败:', error);
      });
  });
}
