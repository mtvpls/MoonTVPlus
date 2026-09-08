/**
 * OpenList 代理播放链接缓存
 * 缓存播放链接经过重定向后的最终 URL，避免每次播放都请求 OpenList 并跟随重定向。
 * 缓存时长按路径元信息配置（默认 60 分钟），可逐路径配置。
 */

import { DEFAULT_PROXY_CACHE_MINUTES } from '@/lib/openlist-path-meta';

interface OpenListProxyCacheEntry {
  expiresAt: number;
  finalUrl: string;
}

const PROXY_CACHE: Map<string, OpenListProxyCacheEntry> = new Map();

/**
 * 生成缓存键（filePath 已包含 folder + fileName）
 */
function makeCacheKey(filePath: string): string {
  return `openlist-proxy:${filePath}`;
}

/**
 * 获取缓存的最终播放 URL，未命中或已过期返回 null
 */
export function getCachedOpenListProxyUrl(filePath: string): string | null {
  const entry = PROXY_CACHE.get(makeCacheKey(filePath));
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    PROXY_CACHE.delete(makeCacheKey(filePath));
    return null;
  }

  return entry.finalUrl;
}

/**
 * 缓存最终播放 URL
 * @param cacheMinutes 缓存时长（分钟），非法值使用默认 60
 */
export function setCachedOpenListProxyUrl(
  filePath: string,
  finalUrl: string,
  cacheMinutes: number
): void {
  const minutes =
    Number.isFinite(cacheMinutes) && cacheMinutes > 0
      ? cacheMinutes
      : DEFAULT_PROXY_CACHE_MINUTES;
  PROXY_CACHE.set(makeCacheKey(filePath), {
    expiresAt: Date.now() + minutes * 60 * 1000,
    finalUrl,
  });
}

/**
 * 清除单个缓存（用于配置变更或链接失效后的清理）
 */
export function invalidateOpenListProxyUrl(filePath: string): void {
  PROXY_CACHE.delete(makeCacheKey(filePath));
}

/**
 * 清除所有 OpenList 代理缓存
 */
export function clearOpenListProxyCache(): { cleared: number } {
  const size = PROXY_CACHE.size;
  PROXY_CACHE.clear();
  return { cleared: size };
}

/**
 * 获取缓存统计信息
 */
export function getOpenListProxyCacheStats(): {
  size: number;
  keys: string[];
} {
  return {
    size: PROXY_CACHE.size,
    keys: Array.from(PROXY_CACHE.keys()),
  };
}
