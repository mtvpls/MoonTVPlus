import 'server-only';

import { DbManager } from '@/lib/db';

const MEMORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DATABASE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DATABASE_CACHE_KEY_PREFIX = 'bangumi:schedule:';

export interface BangumiScheduleCacheEntry<T> {
  season: string;
  year: number;
  cachedAt: number;
  data: T;
}

const memoryCache = new Map<string, BangumiScheduleCacheEntry<unknown>>();

function getCacheKey(season: string, year: number): string {
  return DATABASE_CACHE_KEY_PREFIX + year + ':' + season;
}

function isValidEntry<T>(
  entry: BangumiScheduleCacheEntry<T> | null,
  season: string,
  year: number,
  ttlMs: number
): entry is BangumiScheduleCacheEntry<T> {
  return Boolean(
    entry &&
      entry.season === season &&
      entry.year === year &&
      Date.now() - entry.cachedAt < ttlMs
  );
}

export function getBangumiScheduleMemoryCache<T>(season: string, year: number): T | null {
  const key = getCacheKey(season, year);
  const entry = memoryCache.get(key) as BangumiScheduleCacheEntry<T> | undefined;
  if (!entry || !isValidEntry(entry, season, year, MEMORY_CACHE_TTL_MS)) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setBangumiScheduleMemoryCache<T>(
  season: string,
  year: number,
  data: T,
  cachedAt = Date.now()
): void {
  memoryCache.set(getCacheKey(season, year), { season, year, cachedAt, data });
}

export async function getBangumiScheduleDatabaseCache<T>(
  season: string,
  year: number
): Promise<T | null> {
  try {
    const raw = await new DbManager().getGlobalValue(getCacheKey(season, year));
    const entry = raw ? (JSON.parse(raw) as BangumiScheduleCacheEntry<T>) : null;
    if (!isValidEntry(entry, season, year, DATABASE_CACHE_TTL_MS)) return null;
    setBangumiScheduleMemoryCache(season, year, entry.data, entry.cachedAt);
    return entry.data;
  } catch (error) {
    console.warn('读取 Bangumi 时刻表数据库缓存失败:', error);
    return null;
  }
}

export async function setBangumiScheduleDatabaseCache<T>(
  season: string,
  year: number,
  data: T,
  cachedAt = Date.now()
): Promise<void> {
  try {
    await new DbManager().setGlobalValue(
      getCacheKey(season, year),
      JSON.stringify({ season, year, cachedAt, data })
    );
  } catch (error) {
    console.warn('写入 Bangumi 时刻表数据库缓存失败:', error);
  }
}
