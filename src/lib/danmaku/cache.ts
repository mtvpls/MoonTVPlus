// 弹幕缓存工具（IndexedDB）

import type { DanmakuComment } from './types';

// IndexedDB 数据库名称和版本
const DB_NAME = 'moontvplus_danmaku_cache_v2';
const DB_VERSION = 1;
const STORE_NAME = 'danmaku';

// 缓存数据结构
export interface DanmakuCacheData {
  cacheKey: string; // title + episodeIndex 组合键
  comments: DanmakuComment[];
  timestamp: number; // 缓存时间戳
  title?: string; // 可选：视频标题
  episodeIndex?: number; // 可选：集数索引
  // 弹幕元信息
  animeId?: number; // 动漫ID
  episodeId?: number; // 剧集ID
  animeTitle?: string; // 动漫标题
  episodeTitle?: string; // 剧集标题
  searchKeyword?: string; // 搜索关键词
  danmakuCount?: number; // 弹幕数量
}

// 生成缓存键（title + episodeIndex）
export function generateCacheKey(title: string, episodeIndex: number): string {
  // 使用 | 分隔符连接 title 和 episodeIndex
  return `${title}|${episodeIndex}`;
}

// 获取弹幕缓存失效时间（毫秒）
// 从环境变量读取，默认 3 天（4320 分钟）
// 设置为 0 表示不缓存
export function getDanmakuCacheExpireTime(): number {
  if (typeof window === 'undefined') return 4320 * 60 * 1000; // 3天 = 4320分钟

  const envValue = process.env.NEXT_PUBLIC_DANMAKU_CACHE_EXPIRE_MINUTES;
  if (envValue) {
    const minutes = parseInt(envValue, 10);
    if (!isNaN(minutes)) {
      // 0 表示不缓存
      if (minutes === 0) return 0;
      // 正数表示缓存时间（分钟）
      if (minutes > 0) return minutes * 60 * 1000;
    }
  }

  // 默认 3 天（4320 分钟）
  return 4320 * 60 * 1000;
}

// 打开数据库
async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('无法打开 IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 创建对象存储（如果不存在）
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('IndexedDB 对象存储已创建:', STORE_NAME);
      }
    };
  });
}

// 保存弹幕到缓存
export async function saveDanmakuToCache(
  title: string,
  episodeIndex: number,
  comments: DanmakuComment[],
  metadata?: {
    animeId?: number;
    episodeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
    searchKeyword?: string;
    danmakuCount?: number;
  }
): Promise<void> {
  // 验证参数
  if (!title || title.trim() === '') {
    console.warn('弹幕缓存: title 为空，跳过保存');
    return;
  }
  if (episodeIndex === undefined || episodeIndex === null || episodeIndex < 0) {
    console.warn('弹幕缓存: episodeIndex 无效，跳过保存');
    return;
  }

  // 如果缓存时间设置为 0，不保存缓存
  const expireTime = getDanmakuCacheExpireTime();
  if (expireTime === 0) {
    console.log('弹幕缓存已禁用，跳过保存');
    return;
  }

  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);

    const cacheKey = generateCacheKey(title, episodeIndex);
    const cacheData: DanmakuCacheData = {
      cacheKey,
      comments,
      timestamp: Date.now(),
      title,
      episodeIndex,
      // 保存弹幕元信息
      animeId: metadata?.animeId,
      episodeId: metadata?.episodeId,
      animeTitle: metadata?.animeTitle,
      episodeTitle: metadata?.episodeTitle,
      searchKeyword: metadata?.searchKeyword,
      danmakuCount: metadata?.danmakuCount ?? comments.length, // 使用提供的数量或comments长度
    };

    // 添加调试日志
    console.log(`[弹幕缓存] 准备保存: cacheKey="${cacheKey}", title="${title}", episodeIndex=${episodeIndex}`);

    return new Promise((resolve, reject) => {
      const request = objectStore.put(cacheData);

      request.onsuccess = () => {
        console.log(`弹幕已缓存: title=${title}, episodeIndex=${episodeIndex}, 数量=${comments.length}`);
        resolve();
      };

      request.onerror = (event) => {
        console.error('保存弹幕缓存失败，详细信息:', {
          error: (event.target as IDBRequest).error,
          cacheKey,
          title,
          episodeIndex,
        });
        reject(new Error('保存弹幕缓存失败'));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('保存弹幕缓存失败:', error);
    throw error;
  }
}

// 从缓存获取弹幕
export async function getDanmakuFromCache(
  title: string,
  episodeIndex: number
): Promise<{
  comments: DanmakuComment[];
  metadata?: {
    animeId?: number;
    episodeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
    searchKeyword?: string;
    danmakuCount?: number;
  };
} | null> {
  // 如果缓存时间设置为 0，不使用缓存
  const expireTime = getDanmakuCacheExpireTime();
  if (expireTime === 0) {
    console.log('弹幕缓存已禁用，跳过读取');
    return null;
  }

  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);

    const cacheKey = generateCacheKey(title, episodeIndex);

    return new Promise((resolve, reject) => {
      const request = objectStore.get(cacheKey);

      request.onsuccess = () => {
        const result = request.result as DanmakuCacheData | undefined;

        if (!result) {
          console.log(`弹幕缓存未找到: title=${title}, episodeIndex=${episodeIndex}`);
          resolve(null);
          return;
        }

        // 检查缓存是否过期
        const expireTime = getDanmakuCacheExpireTime();
        const now = Date.now();
        const age = now - result.timestamp;

        if (age > expireTime) {
          const ageMinutes = Math.floor(age / 1000 / 60);
          console.log(
            `弹幕缓存已过期: title=${title}, episodeIndex=${episodeIndex}, 年龄=${ageMinutes}分钟`
          );
          resolve(null);
          return;
        }

        const ageMinutes = Math.floor(age / 1000 / 60);
        console.log(
          `从缓存获取弹幕: title=${title}, episodeIndex=${episodeIndex}, 数量=${result.comments.length}, 年龄=${ageMinutes}分钟`
        );
        resolve({
          comments: result.comments,
          metadata: {
            animeId: result.animeId,
            episodeId: result.episodeId,
            animeTitle: result.animeTitle,
            episodeTitle: result.episodeTitle,
            searchKeyword: result.searchKeyword,
            danmakuCount: result.danmakuCount ?? result.comments.length,
          },
        });
      };

      request.onerror = () => {
        reject(new Error('获取弹幕缓存失败'));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('获取弹幕缓存失败:', error);
    return null;
  }
}

// 清除指定弹幕缓存
export async function clearDanmakuCache(title: string, episodeIndex: number): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);

    const cacheKey = generateCacheKey(title, episodeIndex);

    return new Promise((resolve, reject) => {
      const request = objectStore.delete(cacheKey);

      request.onsuccess = () => {
        console.log(`弹幕缓存已清除: title=${title}, episodeIndex=${episodeIndex}`);
        resolve();
      };

      request.onerror = () => {
        reject(new Error('清除弹幕缓存失败'));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('清除弹幕缓存失败:', error);
    throw error;
  }
}

// 清除所有过期缓存
export async function clearExpiredDanmakuCache(): Promise<number> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const index = objectStore.index('timestamp');

    const expireTime = getDanmakuCacheExpireTime();
    const now = Date.now();
    const expireThreshold = now - expireTime;

    return new Promise((resolve, reject) => {
      const request = index.openCursor();
      let deletedCount = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const data = cursor.value as DanmakuCacheData;

          if (data.timestamp < expireThreshold) {
            cursor.delete();
            deletedCount++;
          }

          cursor.continue();
        } else {
          if (deletedCount > 0) {
            console.log(`已清除 ${deletedCount} 个过期弹幕缓存`);
          }
          resolve(deletedCount);
        }
      };

      request.onerror = () => {
        reject(new Error('清除过期弹幕缓存失败'));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('清除过期弹幕缓存失败:', error);
    return 0;
  }
}

// 清除所有弹幕缓存
export async function clearAllDanmakuCache(): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = objectStore.clear();

      request.onsuccess = () => {
        console.log('所有弹幕缓存已清除');
        resolve();
      };

      request.onerror = () => {
        reject(new Error('清除所有弹幕缓存失败'));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('清除所有弹幕缓存失败:', error);
    throw error;
  }
}

// 获取缓存统计信息
export async function getDanmakuCacheStats(): Promise<{
  total: number;
  expired: number;
  totalSize: number;
}> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = objectStore.openCursor();

      let total = 0;
      let expired = 0;
      let totalSize = 0;

      const expireTime = getDanmakuCacheExpireTime();
      const now = Date.now();
      const expireThreshold = now - expireTime;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const data = cursor.value as DanmakuCacheData;
          total++;
          totalSize += data.comments.length;

          if (data.timestamp < expireThreshold) {
            expired++;
          }

          cursor.continue();
        } else {
          resolve({ total, expired, totalSize });
        }
      };

      request.onerror = () => {
        reject(new Error('获取缓存统计信息失败'));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('获取缓存统计信息失败:', error);
    return { total: 0, expired: 0, totalSize: 0 };
  }
}
