// 音乐歌曲信息缓存模块 - 基于 platform+id 的全局缓存

// 歌曲信息接口
export interface SongInfo {
  id: string;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
}

// 缓存条目接口
export interface SongCacheEntry {
  expiresAt: number;
  data: SongInfo;
}

// 缓存配置
const SONG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时
const CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1小时清理一次
const MAX_CACHE_SIZE = 5000; // 最大缓存条目数量
const SONG_CACHE: Map<string, SongCacheEntry> = new Map();

// 惰性清理时间戳
let lastCleanupTime = 0;

/**
 * 生成歌曲缓存键：platform+id
 */
function makeSongCacheKey(platform: string, id: string): string {
  return `${platform}+${id}`;
}

/**
 * 获取缓存的歌曲信息
 */
export function getCachedSong(platform: string, id: string): SongInfo | null {
  const key = makeSongCacheKey(platform, id);
  const entry = SONG_CACHE.get(key);
  if (!entry) return null;

  // 检查是否过期
  if (entry.expiresAt <= Date.now()) {
    SONG_CACHE.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * 设置缓存的歌曲信息
 */
export function setCachedSong(platform: string, id: string, songInfo: SongInfo): void {
  // 惰性清理：每次写入时检查是否需要清理
  const now = Date.now();
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }

  const key = makeSongCacheKey(platform, id);
  SONG_CACHE.set(key, {
    expiresAt: now + SONG_CACHE_TTL_MS,
    data: songInfo,
  });
}

/**
 * 批量获取缓存的歌曲信息
 */
export function getCachedSongs(keys: Array<{ platform: string; id: string }>): Map<string, SongInfo> {
  const result = new Map<string, SongInfo>();
  const now = Date.now();

  for (const { platform, id } of keys) {
    const key = makeSongCacheKey(platform, id);
    const entry = SONG_CACHE.get(key);

    if (entry && entry.expiresAt > now) {
      result.set(key, entry.data);
    }
  }

  return result;
}

/**
 * 批量设置缓存的歌曲信息
 */
export function setCachedSongs(songs: Array<{ platform: string; id: string; songInfo: SongInfo }>): void {
  const now = Date.now();

  // 惰性清理
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }

  for (const { platform, id, songInfo } of songs) {
    const key = makeSongCacheKey(platform, id);
    SONG_CACHE.set(key, {
      expiresAt: now + SONG_CACHE_TTL_MS,
      data: songInfo,
    });
  }
}

/**
 * 智能清理过期的缓存条目
 */
function performCacheCleanup(): { expired: number; total: number; sizeLimited: number } {
  const now = Date.now();
  const keysToDelete: string[] = [];
  let sizeLimitedDeleted = 0;

  // 1. 清理过期条目
  SONG_CACHE.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      keysToDelete.push(key);
    }
  });

  const expiredCount = keysToDelete.length;
  keysToDelete.forEach(key => SONG_CACHE.delete(key));

  // 2. 如果缓存大小超限，清理最老的条目（LRU策略）
  if (SONG_CACHE.size > MAX_CACHE_SIZE) {
    const entries = Array.from(SONG_CACHE.entries());
    // 按照过期时间排序，最早过期的在前面
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);

    const toRemove = SONG_CACHE.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      SONG_CACHE.delete(entries[i][0]);
      sizeLimitedDeleted++;
    }
  }

  lastCleanupTime = now;

  return {
    expired: expiredCount,
    total: SONG_CACHE.size,
    sizeLimited: sizeLimitedDeleted
  };
}

/**
 * 清除所有歌曲缓存
 */
export function clearSongCache(): { cleared: number } {
  const size = SONG_CACHE.size;
  SONG_CACHE.clear();
  return { cleared: size };
}

/**
 * 获取缓存统计信息
 */
export function getSongCacheStats(): {
  size: number;
  maxSize: number;
  ttlMs: number;
} {
  return {
    size: SONG_CACHE.size,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: SONG_CACHE_TTL_MS,
  };
}
