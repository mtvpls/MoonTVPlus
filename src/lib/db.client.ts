/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
'use client';

/**
 * 仅在浏览器端使用的数据库工具，目前基于 localStorage 实现。
 * 之所以单独拆分文件，是为了避免在客户端 bundle 中引入 `fs`, `path` 等 Node.js 内置模块，
 * 从而解决诸如 "Module not found: Can't resolve 'fs'" 的问题。
 *
 * 功能：
 * 1. 获取全部播放记录（getAllPlayRecords）。
 * 2. 保存播放记录（savePlayRecord）。
 * 3. 数据库存储模式下的混合缓存策略，提升用户体验。
 *
 * 如后续需要在客户端读取收藏等其它数据，可按同样方式在此文件中补充实现。
 */

import { getAuthInfoFromBrowserCookie, clearAuthCookie } from './auth';
import { normalizeEpisodeFilterConfig } from './episode-filter';
import { MangaReadRecord, MangaShelfItem } from './manga.types';
import { DanmakuFilterConfig, EpisodeFilterConfig,SkipConfig } from './types';

// 全局错误触发函数
function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message },
      })
    );
  }
}

// ---- 类型 ----
export interface PlayRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title?: string; // 搜索时使用的标题
  origin?: 'vod' | 'live'; // 来源类型
  new_episodes?: number; // 新增的剧集数量（用于显示更新提示）
}

// ---- 收藏类型 ----
export interface Favorite {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
  origin?: 'vod' | 'live';
  is_completed?: boolean; // 是否已完结
  vod_remarks?: string; // 视频备注信息
}

// ---- 音乐播放记录类型 ----
export interface MusicPlayRecord {
  platform: 'netease' | 'qq' | 'kuwo'; // 音乐平台
  id: string; // 歌曲ID
  name: string; // 歌曲名
  artist: string; // 艺术家
  album?: string; // 专辑
  pic?: string; // 封面图
  play_time: number; // 播放进度（秒）
  duration: number; // 总时长（秒）
  save_time: number; // 记录保存时间（时间戳）
}

// ---- 缓存数据结构 ----
interface CacheData<T> {
  data: T;
  timestamp: number;
  version: string;
}

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  mangaShelf?: CacheData<Record<string, MangaShelfItem>>;
  mangaReadRecords?: CacheData<Record<string, MangaReadRecord>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>;
  danmakuFilterConfig?: CacheData<DanmakuFilterConfig>;
  musicPlayRecords?: CacheData<Record<string, MusicPlayRecord>>; // 音乐播放记录
}

// ---- 常量 ----
const PLAY_RECORDS_KEY = 'moontv_play_records';
const FAVORITES_KEY = 'moontv_favorites';
const MANGA_SHELF_KEY = 'moontv_manga_shelf';
const MANGA_HISTORY_KEY = 'moontv_manga_history';
const DEFAULT_MAX_MANGA_HISTORY_RECORDS = 100;
const DEFAULT_MAX_MANGA_HISTORY_THRESHOLD = DEFAULT_MAX_MANGA_HISTORY_RECORDS + 10;
const SEARCH_HISTORY_KEY = 'moontv_search_history';
const MUSIC_PLAY_RECORDS_KEY = 'moontv_music_play_records';

// 缓存相关常量
const CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000; // 一小时缓存过期

// ---- 环境变量 ----
const STORAGE_TYPE = (() => {
  const raw =
    (typeof window !== 'undefined' &&
      (window as any).RUNTIME_CONFIG?.STORAGE_TYPE) ||
    (process.env.STORAGE_TYPE as
      | 'localstorage'
      | 'redis'
      | 'upstash'
      | undefined) ||
    'localstorage';
  return raw;
})();

// ---------------- 搜索历史相关常量 ----------------
// 搜索历史最大保存条数
const SEARCH_HISTORY_LIMIT = 20;

// ---- 缓存管理器 ----
class HybridCacheManager {
  private static instance: HybridCacheManager;

  // 正在进行的请求 Promise 缓存（彻底防止并发重复请求）
  private pendingRequests: Map<string, Promise<any>> = new Map();

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }
    return HybridCacheManager.instance;
  }

  /**
   * 获取或创建请求 Promise（防止并发重复请求）
   */
  getOrCreateRequest<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    // 如果已有正在进行的请求，直接返回
    if (this.pendingRequests.has(key)) {
      console.log(`[${key}] 复用进行中的请求`);
      return this.pendingRequests.get(key)!;
    }

    console.log(`[${key}] 创建新请求`);
    // 创建新请求
    const promise = fetcher()
      .finally(() => {
        // 请求完成后清除缓存
        this.pendingRequests.delete(key);
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * 获取当前用户名
   */
  private getCurrentUsername(): string | null {
    const authInfo = getAuthInfoFromBrowserCookie();
    return authInfo?.username || null;
  }

  /**
   * 生成用户专属的缓存key
   */
  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  /**
   * 获取用户缓存数据
   */
  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') return {};

    try {
      const cacheKey = this.getUserCacheKey(username);
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('获取用户缓存失败:', error);
      return {};
    }
  }

  /**
   * 保存用户缓存数据
   */
  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') return;

    try {
      // 检查缓存大小，超过15MB时清理旧数据
      const cacheSize = JSON.stringify(cache).length;
      if (cacheSize > 15 * 1024 * 1024) {
        console.warn('缓存过大，清理旧数据');
        this.cleanOldCache(cache);
      }

      const cacheKey = this.getUserCacheKey(username);
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.warn('保存用户缓存失败:', error);
      // 存储空间不足时清理缓存后重试
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        this.clearAllCache();
        try {
          const cacheKey = this.getUserCacheKey(username);
          localStorage.setItem(cacheKey, JSON.stringify(cache));
        } catch (retryError) {
          console.error('重试保存缓存仍然失败:', retryError);
        }
      }
    }
  }

  /**
   * 清理过期缓存数据
   */
  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000; // 两个月

    // 清理过期的播放记录缓存
    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) {
      delete cache.playRecords;
    }

    // 清理过期的收藏缓存
    if (cache.favorites && now - cache.favorites.timestamp > maxAge) {
      delete cache.favorites;
    }

    if (cache.mangaShelf && now - cache.mangaShelf.timestamp > maxAge) {
      delete cache.mangaShelf;
    }

    if (cache.mangaReadRecords && now - cache.mangaReadRecords.timestamp > maxAge) {
      delete cache.mangaReadRecords;
    }
  }

  /**
   * 清理所有缓存
   */
  private clearAllCache(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith('moontv_cache_')) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid<T>(cache: CacheData<T>): boolean {
    const now = Date.now();
    return (
      cache.version === CACHE_VERSION &&
      now - cache.timestamp < CACHE_EXPIRE_TIME
    );
  }

  /**
   * 创建缓存数据
   */
  private createCacheData<T>(data: T): CacheData<T> {
    return {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
  }

  /**
   * 获取缓存的播放记录
   */
  getCachedPlayRecords(): Record<string, PlayRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.playRecords;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存播放记录
   */
  cachePlayRecords(data: Record<string, PlayRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.playRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的收藏
   */
  getCachedFavorites(): Record<string, Favorite> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.favorites;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存收藏
   */
  cacheFavorites(data: Record<string, Favorite>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.favorites = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedMangaShelf(): Record<string, MangaShelfItem> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.mangaShelf;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  cacheMangaShelf(data: Record<string, MangaShelfItem>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.mangaShelf = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedMangaReadRecords(): Record<string, MangaReadRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.mangaReadRecords;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  cacheMangaReadRecords(data: Record<string, MangaReadRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.mangaReadRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的搜索历史
   */
  getCachedSearchHistory(): string[] | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.searchHistory;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存搜索历史
   */
  cacheSearchHistory(data: string[]): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.searchHistory = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的跳过片头片尾配置
   */
  getCachedSkipConfigs(): Record<string, SkipConfig> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.skipConfigs;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存跳过片头片尾配置
   */
  cacheSkipConfigs(data: Record<string, SkipConfig>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.skipConfigs = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 弹幕过滤配置缓存方法
   */
  getCachedDanmakuFilterConfig(): DanmakuFilterConfig | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.danmakuFilterConfig;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  cacheDanmakuFilterConfig(data: DanmakuFilterConfig): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.danmakuFilterConfig = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 音乐播放记录缓存方法
   */
  getCachedMusicPlayRecords(): Record<string, MusicPlayRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.musicPlayRecords;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  cacheMusicPlayRecords(data: Record<string, MusicPlayRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.musicPlayRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 清除指定用户的所有缓存
   */
  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) return;

    try {
      const cacheKey = this.getUserCacheKey(targetUsername);
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('清除用户缓存失败:', error);
    }
  }

  /**
   * 清除所有过期缓存
   */
  clearExpiredCaches(): void {
    if (typeof window === 'undefined') return;

    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) {
          try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            // 检查是否有任何缓存数据过期
            let hasValidData = false;
            for (const [, cacheData] of Object.entries(cache)) {
              if (cacheData && this.isCacheValid(cacheData as CacheData<any>)) {
                hasValidData = true;
                break;
              }
            }
            if (!hasValidData) {
              keysToRemove.push(key);
            }
          } catch {
            // 解析失败的缓存也删除
            keysToRemove.push(key);
          }
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('清除过期缓存失败:', error);
    }
  }
}

// 获取缓存管理器实例
const cacheManager = HybridCacheManager.getInstance();

// ---- 错误处理辅助函数 ----
/**
 * 数据库操作失败时的通用错误处理
 * 立即从数据库刷新对应类型的缓存以保持数据一致性
 */
async function handleDatabaseOperationFailure(
  dataType: 'playRecords' | 'favorites' | 'searchHistory' | 'mangaShelf' | 'mangaHistory',
  error: any
): Promise<void> {
  console.error(`数据库操作失败 (${dataType}):`, error);
  triggerGlobalError(`数据库操作失败`);

  try {
    // 使用 Promise 缓存防止并发重复请求
    await cacheManager.getOrCreateRequest(`recovery-${dataType}`, async () => {
      let freshData: any;
      let eventName: string;

      switch (dataType) {
        case 'playRecords':
          freshData = await fetchFromApi<Record<string, PlayRecord>>(
            `/api/playrecords`
          );
          cacheManager.cachePlayRecords(freshData);
          eventName = 'playRecordsUpdated';
          break;
        case 'favorites':
          freshData = await fetchFromApi<Record<string, Favorite>>(
            `/api/favorites`
          );
          cacheManager.cacheFavorites(freshData);
          eventName = 'favoritesUpdated';
          break;
        case 'searchHistory':
          freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
          cacheManager.cacheSearchHistory(freshData);
          eventName = 'searchHistoryUpdated';
          break;
        case 'mangaShelf':
          freshData = await fetchFromApi<Record<string, MangaShelfItem>>(`/api/manga/shelf`);
          cacheManager.cacheMangaShelf(freshData);
          eventName = 'mangaShelfUpdated';
          break;
        case 'mangaHistory':
          freshData = await fetchFromApi<Record<string, MangaReadRecord>>(`/api/manga/history`);
          cacheManager.cacheMangaReadRecords(freshData);
          eventName = 'mangaHistoryUpdated';
          break;
      }

      // 触发更新事件通知组件
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: freshData,
        })
      );
    });
  } catch (refreshErr) {
    console.error(`刷新${dataType}缓存失败:`, refreshErr);
    triggerGlobalError(`刷新${dataType}缓存失败`);
  }
}

// 页面加载时清理过期缓存
if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}

// ---- 工具函数 ----
/**
 * 通用的 fetch 函数，处理 401 状态码自动跳转登录
 */
export async function fetchWithAuth(
  url: string,
  options?: RequestInit
): Promise<Response> {
  let res = await fetch(url, options);

  // 如果是 401 且是 token 过期，尝试刷新并重试
  if (res.status === 401) {
    const text = await res.clone().text();

    // 只有当响应体包含 "Unauthorized" 或 "Refresh token expired" 或 "Access token expired" 时才处理
    if (text.includes('Unauthorized') || text.includes('Refresh token expired') || text.includes('Access token expired')) {
      // 如果在登录页面，跳过刷新逻辑
      if (typeof window !== 'undefined' && window.location.pathname === '/login') {
        console.log('[fetchWithAuth] On login page, skipping refresh logic');
        return res;
      }

      // 检查是否是登录相关的接口，如果是则不刷新
      if (
        url.includes('/api/login') ||
        url.includes('/api/register') ||
        url.includes('/api/auth/oidc') ||
        url.includes('/api/auth/refresh')
      ) {
        throw new Error('用户未授权');
      }

      // 尝试刷新 token
      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (refreshRes.ok) {
        // 刷新成功，重试原请求
        res = await fetch(url, options);
      }
    } else {
      // 不是认证错误的401，直接返回
      console.log('[fetchWithAuth] Received 401 but not an auth error, skipping refresh');
      return res;
    }

    // 如果刷新后仍然是 401，或者是其他 401 错误，跳转登录
    if (res.status === 401) {
      const text2 = await res.clone().text();
      // 再次检查响应体
      if (text2.includes('Unauthorized') || text2.includes('Refresh token expired') || text2.includes('Access token expired')) {
        // 检查当前页面是否已经是登录页，避免重复跳转
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          // 调用 logout 接口
          try {
            await fetch('/api/logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
          } catch (error) {
            console.error('注销请求失败:', error);
            // 登出失败时清除前端cookie
            clearAuthCookie();
          }
          const currentUrl = window.location.pathname + window.location.search;
          const loginUrl = new URL('/login', window.location.origin);
          loginUrl.searchParams.set('redirect', currentUrl);
          window.location.href = loginUrl.toString();
        }
        throw new Error('用户未授权，已跳转到登录页面');
      }
    }
  }

  if (!res.ok) {
    throw new Error(`请求 ${url} 失败: ${res.status}`);
  }

  return res;
}

async function fetchFromApi<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(path);
  return (await res.json()) as T;
}

/**
 * 生成存储key
 */
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// ---- API ----
/**
 * 读取全部播放记录。
 * 非本地存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 * 在服务端渲染阶段 (window === undefined) 时返回空对象，避免报错。
 */
export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  // 服务器端渲染阶段直接返回空，交由客户端 useEffect 再行请求
  if (typeof window === 'undefined') {
    return {};
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedPlayRecords();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cachePlayRecords(freshData);
            // 触发数据更新事件，供组件监听
            window.dispatchEvent(
              new CustomEvent('playRecordsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步播放记录失败:', err);
          triggerGlobalError('后台同步播放记录失败');
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<Record<string, PlayRecord>>(
          `/api/playrecords`
        );
        cacheManager.cachePlayRecords(freshData);
        return freshData;
      } catch (err) {
        console.error('获取播放记录失败:', err);
        triggerGlobalError('获取播放记录失败');
        return {};
      }
    }
  }

  // localstorage 模式
  try {
    const raw = localStorage.getItem(PLAY_RECORDS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PlayRecord>;
  } catch (err) {
    console.error('读取播放记录失败:', err);
    triggerGlobalError('读取播放记录失败');
    return {};
  }
}

export function getCachedPlayRecordsSnapshot(): Record<string, PlayRecord> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (STORAGE_TYPE !== 'localstorage') {
    const cachedRecords = cacheManager.getCachedPlayRecords();
    if (cachedRecords) {
      return cachedRecords;
    }

    try {
      const username = getAuthInfoFromBrowserCookie()?.username;
      if (!username) return {};

      const raw = localStorage.getItem(`${CACHE_PREFIX}${username}`);
      if (!raw) return {};

      const userCache = JSON.parse(raw) as UserCacheStore;
      return userCache.playRecords?.data || {};
    } catch (err) {
      console.error('读取用户播放记录快照失败:', err);
      return {};
    }
  }

  try {
    const raw = localStorage.getItem(PLAY_RECORDS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PlayRecord>;
  } catch (err) {
    console.error('读取本地播放记录快照失败:', err);
    return {};
  }
}

export function getCachedMangaReadRecordsSnapshot(): Record<string, MangaReadRecord> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (STORAGE_TYPE !== 'localstorage') {
    const cachedRecords = cacheManager.getCachedMangaReadRecords();
    if (cachedRecords) {
      return cachedRecords;
    }

    try {
      const username = getAuthInfoFromBrowserCookie()?.username;
      if (!username) return {};

      const raw = localStorage.getItem(`${CACHE_PREFIX}${username}`);
      if (!raw) return {};

      const userCache = JSON.parse(raw) as UserCacheStore;
      return userCache.mangaReadRecords?.data || {};
    } catch (err) {
      console.error('读取用户漫画历史快照失败:', err);
      return {};
    }
  }

  try {
    const raw = localStorage.getItem(MANGA_HISTORY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, MangaReadRecord>;
  } catch (err) {
    console.error('读取本地漫画历史快照失败:', err);
    return {};
  }
}

/**
 * 保存播放记录。
 * 数据库存储模式下使用乐观更新：先更新缓存（立即生效），再异步同步到数据库。
 */
export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    cachedRecords[key] = record;
    cacheManager.cachePlayRecords(cachedRecords);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: cachedRecords,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth('/api/playrecords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, record }),
      });
    } catch (err) {
      // 播放记录以用户体验为优先：保留已经写入的本地缓存，避免切集后记忆进度被回滚。
      console.warn('同步播放记录到数据库失败，保留本地缓存:', err);

      // 后台再尝试补一次，不打断当前播放流程。
      window.setTimeout(() => {
        fetchWithAuth('/api/playrecords', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key, record }),
        }).catch((retryErr) => {
          console.warn('播放记录后台重试失败:', retryErr);
        });
      }, 3000);
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    allRecords[key] = record;
    localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('保存播放记录失败:', err);
    triggerGlobalError('保存播放记录失败');
    throw err;
  }
}

/**
 * 删除播放记录。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deletePlayRecord(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    delete cachedRecords[key];
    cacheManager.cachePlayRecords(cachedRecords);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: cachedRecords,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/playrecords?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      triggerGlobalError('删除播放记录失败');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    delete allRecords[key];
    localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('删除播放记录失败:', err);
    triggerGlobalError('删除播放记录失败');
    throw err;
  }
}

/**
 * 迁移播放记录到新的 source/id。
 * 用于换源时保留单一记忆点语义：当前进度迁移到新源后，再清理旧源记录。
 */
export async function migratePlayRecord(
  fromSource: string,
  fromId: string,
  toSource: string,
  toId: string,
  record: PlayRecord
): Promise<void> {
  const fromKey = generateStorageKey(fromSource, fromId);
  const toKey = generateStorageKey(toSource, toId);

  if (fromKey === toKey) {
    await savePlayRecord(toSource, toId, record);
    return;
  }

  if (STORAGE_TYPE !== 'localstorage') {
    const cachedRecords = {
      ...(cacheManager.getCachedPlayRecords() || {}),
    };

    delete cachedRecords[fromKey];
    cachedRecords[toKey] = record;
    cacheManager.cachePlayRecords(cachedRecords);

    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: cachedRecords,
      })
    );

    const persistMove = async () => {
      await fetchWithAuth('/api/playrecords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: toKey, record }),
      });

      await fetchWithAuth(`/api/playrecords?key=${encodeURIComponent(fromKey)}`, {
        method: 'DELETE',
      });
    };

    persistMove().catch((err) => {
      console.warn('迁移播放记录到数据库失败，稍后重试:', err);

      window.setTimeout(() => {
        persistMove().catch((retryErr) => {
          console.warn('迁移播放记录后台重试失败:', retryErr);
        });
      }, 3000);
    });
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端迁移播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    delete allRecords[fromKey];
    allRecords[toKey] = record;
    localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('迁移播放记录失败:', err);
    triggerGlobalError('迁移播放记录失败');
    throw err;
  }
}

/* ---------------- 搜索历史相关 API ---------------- */

/**
 * 获取搜索历史。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getSearchHistory(): Promise<string[]> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return [];
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedSearchHistory();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<string[]>(`/api/searchhistory`)
        .then((freshData) => {
          // 去重处理
          const uniqueData = Array.from(new Set(freshData));
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(uniqueData)) {
            cacheManager.cacheSearchHistory(uniqueData);
            // 触发数据更新事件
            window.dispatchEvent(
              new CustomEvent('searchHistoryUpdated', {
                detail: uniqueData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步搜索历史失败:', err);
          triggerGlobalError('后台同步搜索历史失败');
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
        // 去重处理
        const uniqueData = Array.from(new Set(freshData));
        cacheManager.cacheSearchHistory(uniqueData);
        return uniqueData;
      } catch (err) {
        console.error('获取搜索历史失败:', err);
        triggerGlobalError('获取搜索历史失败');
        return [];
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    // 仅返回字符串数组，并去重
    const validArray = Array.isArray(arr) ? arr : [];
    return Array.from(new Set(validArray));
  } catch (err) {
    console.error('读取搜索历史失败:', err);
    triggerGlobalError('读取搜索历史失败');
    return [];
  }
}

/**
 * 将关键字添加到搜索历史。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function addSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = [trimmed, ...cachedHistory.filter((k) => k !== trimmed)];
    // 限制长度
    if (newHistory.length > SEARCH_HISTORY_LIMIT) {
      newHistory.length = SEARCH_HISTORY_LIMIT;
    }
    cacheManager.cacheSearchHistory(newHistory);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth('/api/searchhistory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keyword: trimmed }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = await getSearchHistory();
    const newHistory = [trimmed, ...history.filter((k) => k !== trimmed)];
    // 限制长度
    if (newHistory.length > SEARCH_HISTORY_LIMIT) {
      newHistory.length = SEARCH_HISTORY_LIMIT;
    }
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );
  } catch (err) {
    console.error('保存搜索历史失败:', err);
    triggerGlobalError('保存搜索历史失败');
  }
}

/**
 * 清空搜索历史。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function clearSearchHistory(): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    cacheManager.cacheSearchHistory([]);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: [],
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/searchhistory`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  window.dispatchEvent(
    new CustomEvent('searchHistoryUpdated', {
      detail: [],
    })
  );
}

/**
 * 删除单条搜索历史。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = cachedHistory.filter((k) => k !== trimmed);
    cacheManager.cacheSearchHistory(newHistory);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(
        `/api/searchhistory?keyword=${encodeURIComponent(trimmed)}`,
        {
          method: 'DELETE',
        }
      );
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = await getSearchHistory();
    const newHistory = history.filter((k) => k !== trimmed);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );
  } catch (err) {
    console.error('删除搜索历史失败:', err);
    triggerGlobalError('删除搜索历史失败');
  }
}

// ---------------- 收藏相关 API ----------------

// 模块级别的防重复请求机制
let pendingFavoritesBackgroundRequest: Promise<void> | null = null;
let pendingFavoritesFetchRequest: Promise<Record<string, Favorite>> | null = null;
let lastFavoritesBackgroundFetchTime = 0;
const MIN_BACKGROUND_FETCH_INTERVAL = 3000; // 3秒内不重复后台请求

/**
 * 获取全部收藏。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedFavorites();

    if (cachedData) {
      // 有缓存：返回缓存，后台异步刷新（带防抖和防重复）
      const now = Date.now();
      if (now - lastFavoritesBackgroundFetchTime > MIN_BACKGROUND_FETCH_INTERVAL && !pendingFavoritesBackgroundRequest) {
        lastFavoritesBackgroundFetchTime = now;

        pendingFavoritesBackgroundRequest = (async () => {
          try {
            const freshData = await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
            // 只有数据真正不同时才更新缓存
            if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
              cacheManager.cacheFavorites(freshData);
              // 触发数据更新事件
              window.dispatchEvent(
                new CustomEvent('favoritesUpdated', {
                  detail: freshData,
                })
              );
            }
          } catch (err) {
            console.warn('后台同步收藏失败:', err);
            triggerGlobalError('后台同步收藏失败');
          } finally {
            pendingFavoritesBackgroundRequest = null;
          }
        })();
      }

      return cachedData;
    } else {
      // 无缓存：直接获取（防重复请求）
      if (pendingFavoritesFetchRequest) {
        return pendingFavoritesFetchRequest;
      }

      pendingFavoritesFetchRequest = (async () => {
        try {
          const freshData = await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
          cacheManager.cacheFavorites(freshData);
          return freshData;
        } catch (err) {
          console.error('获取收藏失败:', err);
          triggerGlobalError('获取收藏失败');
          return {};
        } finally {
          pendingFavoritesFetchRequest = null;
        }
      })();

      return pendingFavoritesFetchRequest;
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Favorite>;
  } catch (err) {
    console.error('读取收藏失败:', err);
    triggerGlobalError('读取收藏失败');
    return {};
  }
}

/**
 * 保存收藏。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    cachedFavorites[key] = favorite;
    cacheManager.cacheFavorites(cachedFavorites);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: cachedFavorites,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, favorite }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('保存收藏失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    allFavorites[key] = favorite;
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: allFavorites,
      })
    );
  } catch (err) {
    console.error('保存收藏失败:', err);
    triggerGlobalError('保存收藏失败');
    throw err;
  }
}

/**
 * 删除收藏。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteFavorite(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    delete cachedFavorites[key];
    cacheManager.cacheFavorites(cachedFavorites);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: cachedFavorites,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/favorites?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('删除收藏失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    delete allFavorites[key];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: allFavorites,
      })
    );
  } catch (err) {
    console.error('删除收藏失败:', err);
    triggerGlobalError('删除收藏失败');
    throw err;
  }
}

/**
 * 判断是否已收藏。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function isFavorited(
  source: string,
  id: string
): Promise<boolean> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：直接从缓存读取，不触发后台刷新
  // 后台刷新由 getAllFavorites() 统一管理，避免重复请求
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedFavorites = cacheManager.getCachedFavorites();

    if (cachedFavorites) {
      // 直接返回缓存结果，不触发后台刷新
      return !!cachedFavorites[key];
    } else {
      // 缓存为空时，调用 getAllFavorites() 来获取并缓存数据
      // 这样可以复用 getAllFavorites() 中的防重复请求机制
      const allFavorites = await getAllFavorites();
      return !!allFavorites[key];
    }
  }

  // localStorage 模式
  const allFavorites = await getAllFavorites();
  return !!allFavorites[key];
}

/**
 * 清空全部播放记录
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function clearAllPlayRecords(): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    cacheManager.cachePlayRecords({});

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: {},
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/playrecords`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      triggerGlobalError('清空播放记录失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PLAY_RECORDS_KEY);
  window.dispatchEvent(
    new CustomEvent('playRecordsUpdated', {
      detail: {},
    })
  );
}

/**
 * 清空全部收藏
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function clearAllFavorites(): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    cacheManager.cacheFavorites({});

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: {},
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/favorites`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('清空收藏失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(FAVORITES_KEY);
  window.dispatchEvent(
    new CustomEvent('favoritesUpdated', {
      detail: {},
    })
  );
}


// ---------------- 漫画书架 / 历史 API ----------------

export async function getAllMangaShelf(): Promise<Record<string, MangaShelfItem>> {
  if (typeof window === 'undefined') return {};

  if (STORAGE_TYPE !== 'localstorage') {
    const cachedData = cacheManager.getCachedMangaShelf();
    if (cachedData) {
      fetchFromApi<Record<string, MangaShelfItem>>('/api/manga/shelf')
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheMangaShelf(freshData);
            window.dispatchEvent(new CustomEvent('mangaShelfUpdated', { detail: freshData }));
          }
        })
        .catch((err) => {
          console.warn('后台同步漫画书架失败:', err);
        });
      return cachedData;
    }

    try {
      const freshData = await fetchFromApi<Record<string, MangaShelfItem>>('/api/manga/shelf');
      cacheManager.cacheMangaShelf(freshData);
      return freshData;
    } catch (err) {
      console.error('获取漫画书架失败:', err);
      triggerGlobalError('获取漫画书架失败');
      return {};
    }
  }

  try {
    const raw = localStorage.getItem(MANGA_SHELF_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, MangaShelfItem>;
  } catch (err) {
    console.error('读取漫画书架失败:', err);
    triggerGlobalError('读取漫画书架失败');
    return {};
  }
}

export async function saveMangaShelf(sourceId: string, mangaId: string, item: MangaShelfItem): Promise<void> {
  const key = generateStorageKey(sourceId, mangaId);

  if (STORAGE_TYPE !== 'localstorage') {
    const cached = cacheManager.getCachedMangaShelf() || {};
    cached[key] = item;
    cacheManager.cacheMangaShelf(cached);
    window.dispatchEvent(new CustomEvent('mangaShelfUpdated', { detail: cached }));

    try {
      await fetchWithAuth('/api/manga/shelf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, item }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('mangaShelf', err);
      throw err;
    }
    return;
  }

  const allItems = await getAllMangaShelf();
  allItems[key] = item;
  localStorage.setItem(MANGA_SHELF_KEY, JSON.stringify(allItems));
  window.dispatchEvent(new CustomEvent('mangaShelfUpdated', { detail: allItems }));
}

export async function deleteMangaShelf(sourceId: string, mangaId: string): Promise<void> {
  const key = generateStorageKey(sourceId, mangaId);

  if (STORAGE_TYPE !== 'localstorage') {
    const cached = cacheManager.getCachedMangaShelf() || {};
    delete cached[key];
    cacheManager.cacheMangaShelf(cached);
    window.dispatchEvent(new CustomEvent('mangaShelfUpdated', { detail: cached }));

    try {
      await fetchWithAuth(`/api/manga/shelf?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    } catch (err) {
      await handleDatabaseOperationFailure('mangaShelf', err);
      throw err;
    }
    return;
  }

  const allItems = await getAllMangaShelf();
  delete allItems[key];
  localStorage.setItem(MANGA_SHELF_KEY, JSON.stringify(allItems));
  window.dispatchEvent(new CustomEvent('mangaShelfUpdated', { detail: allItems }));
}

export async function clearAllMangaShelf(): Promise<void> {
  if (STORAGE_TYPE !== 'localstorage') {
    cacheManager.cacheMangaShelf({});
    window.dispatchEvent(new CustomEvent('mangaShelfUpdated', { detail: {} }));
    try {
      await fetchWithAuth('/api/manga/shelf', { method: 'DELETE' });
    } catch (err) {
      await handleDatabaseOperationFailure('mangaShelf', err);
      throw err;
    }
    return;
  }

  localStorage.removeItem(MANGA_SHELF_KEY);
  window.dispatchEvent(new CustomEvent('mangaShelfUpdated', { detail: {} }));
}

function trimMangaReadRecords(records: Record<string, MangaReadRecord>): Record<string, MangaReadRecord> {
  const entries = Object.entries(records);
  if (entries.length <= DEFAULT_MAX_MANGA_HISTORY_THRESHOLD) return records;

  return Object.fromEntries(
    entries
      .sort(([, a], [, b]) => b.saveTime - a.saveTime)
      .slice(0, DEFAULT_MAX_MANGA_HISTORY_RECORDS)
  );
}

export async function getAllMangaReadRecords(): Promise<Record<string, MangaReadRecord>> {
  if (typeof window === 'undefined') return {};

  if (STORAGE_TYPE !== 'localstorage') {
    const cachedData = cacheManager.getCachedMangaReadRecords();
    if (cachedData) {
      fetchFromApi<Record<string, MangaReadRecord>>('/api/manga/history')
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheMangaReadRecords(freshData);
            window.dispatchEvent(new CustomEvent('mangaHistoryUpdated', { detail: freshData }));
          }
        })
        .catch((err) => {
          console.warn('后台同步漫画历史失败:', err);
        });
      return cachedData;
    }

    try {
      const freshData = await fetchFromApi<Record<string, MangaReadRecord>>('/api/manga/history');
      cacheManager.cacheMangaReadRecords(freshData);
      return freshData;
    } catch (err) {
      console.error('获取漫画历史失败:', err);
      triggerGlobalError('获取漫画历史失败');
      return {};
    }
  }

  try {
    const raw = localStorage.getItem(MANGA_HISTORY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, MangaReadRecord>;
  } catch (err) {
    console.error('读取漫画历史失败:', err);
    triggerGlobalError('读取漫画历史失败');
    return {};
  }
}

export async function saveMangaReadRecord(sourceId: string, mangaId: string, record: MangaReadRecord): Promise<void> {
  const key = generateStorageKey(sourceId, mangaId);

  if (STORAGE_TYPE !== 'localstorage') {
    const cached = cacheManager.getCachedMangaReadRecords() || {};
    cached[key] = record;
    const trimmedRecords = trimMangaReadRecords(cached);
    cacheManager.cacheMangaReadRecords(trimmedRecords);
    window.dispatchEvent(new CustomEvent('mangaHistoryUpdated', { detail: trimmedRecords }));

    try {
      await fetchWithAuth('/api/manga/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, record }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('mangaHistory', err);
      throw err;
    }
    return;
  }

  const allRecords = await getAllMangaReadRecords();
  allRecords[key] = record;
  const trimmedRecords = trimMangaReadRecords(allRecords);
  localStorage.setItem(MANGA_HISTORY_KEY, JSON.stringify(trimmedRecords));
  window.dispatchEvent(new CustomEvent('mangaHistoryUpdated', { detail: trimmedRecords }));
}

export async function deleteMangaReadRecord(sourceId: string, mangaId: string): Promise<void> {
  const key = generateStorageKey(sourceId, mangaId);

  if (STORAGE_TYPE !== 'localstorage') {
    const cached = cacheManager.getCachedMangaReadRecords() || {};
    delete cached[key];
    cacheManager.cacheMangaReadRecords(cached);
    window.dispatchEvent(new CustomEvent('mangaHistoryUpdated', { detail: cached }));

    try {
      await fetchWithAuth(`/api/manga/history?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    } catch (err) {
      await handleDatabaseOperationFailure('mangaHistory', err);
      throw err;
    }
    return;
  }

  const allRecords = await getAllMangaReadRecords();
  delete allRecords[key];
  localStorage.setItem(MANGA_HISTORY_KEY, JSON.stringify(allRecords));
  window.dispatchEvent(new CustomEvent('mangaHistoryUpdated', { detail: allRecords }));
}

export async function clearAllMangaReadRecords(): Promise<void> {
  if (STORAGE_TYPE !== 'localstorage') {
    cacheManager.cacheMangaReadRecords({});
    window.dispatchEvent(new CustomEvent('mangaHistoryUpdated', { detail: {} }));
    try {
      await fetchWithAuth('/api/manga/history', { method: 'DELETE' });
    } catch (err) {
      await handleDatabaseOperationFailure('mangaHistory', err);
      throw err;
    }
    return;
  }

  localStorage.removeItem(MANGA_HISTORY_KEY);
  window.dispatchEvent(new CustomEvent('mangaHistoryUpdated', { detail: {} }));
}

// ---------------- 混合缓存辅助函数 ----------------

/**
 * 清除当前用户的所有缓存数据
 * 用于用户登出时清理缓存
 */
export function clearUserCache(): void {
  if (STORAGE_TYPE !== 'localstorage') {
    cacheManager.clearUserCache();
  }
}

/**
 * 手动刷新所有缓存数据
 * 强制从服务器重新获取数据并更新缓存
 */
export async function refreshAllCache(): Promise<void> {
  if (STORAGE_TYPE === 'localstorage') return;

  try {
    // 使用 Promise 缓存防止并发重复刷新
    await cacheManager.getOrCreateRequest('refresh-all-cache', async () => {
      // 并行刷新所有数据
      const [playRecords, favorites, mangaShelf, mangaHistory, searchHistory, skipConfigs] =
        await Promise.allSettled([
          fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`),
          fetchFromApi<Record<string, Favorite>>(`/api/favorites`),
          fetchFromApi<Record<string, MangaShelfItem>>(`/api/manga/shelf`),
          fetchFromApi<Record<string, MangaReadRecord>>(`/api/manga/history`),
          fetchFromApi<string[]>(`/api/searchhistory`),
          fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`),
        ]);

      if (playRecords.status === 'fulfilled') {
        cacheManager.cachePlayRecords(playRecords.value);
        window.dispatchEvent(
          new CustomEvent('playRecordsUpdated', {
            detail: playRecords.value,
          })
        );
      }

      if (favorites.status === 'fulfilled') {
        cacheManager.cacheFavorites(favorites.value);
        window.dispatchEvent(
          new CustomEvent('favoritesUpdated', {
            detail: favorites.value,
          })
        );
      }

      if (mangaShelf.status === 'fulfilled') {
        cacheManager.cacheMangaShelf(mangaShelf.value);
        window.dispatchEvent(
          new CustomEvent('mangaShelfUpdated', {
            detail: mangaShelf.value,
          })
        );
      }

      if (mangaHistory.status === 'fulfilled') {
        cacheManager.cacheMangaReadRecords(mangaHistory.value);
        window.dispatchEvent(
          new CustomEvent('mangaHistoryUpdated', {
            detail: mangaHistory.value,
          })
        );
      }

      if (searchHistory.status === 'fulfilled') {
        cacheManager.cacheSearchHistory(searchHistory.value);
        window.dispatchEvent(
          new CustomEvent('searchHistoryUpdated', {
            detail: searchHistory.value,
          })
        );
      }

      if (skipConfigs.status === 'fulfilled') {
        cacheManager.cacheSkipConfigs(skipConfigs.value);
        window.dispatchEvent(
          new CustomEvent('skipConfigsUpdated', {
            detail: skipConfigs.value,
          })
        );
      }
    });
  } catch (err) {
    console.error('刷新缓存失败:', err);
    triggerGlobalError('刷新缓存失败');
  }
}

/**
 * 获取缓存状态信息
 * 用于调试和监控缓存健康状态
 */
export function getCacheStatus(): {
  hasPlayRecords: boolean;
  hasFavorites: boolean;
  hasSearchHistory: boolean;
  hasSkipConfigs: boolean;
  hasMangaShelf: boolean;
  hasMangaHistory: boolean;
  username: string | null;
} {
  if (STORAGE_TYPE === 'localstorage') {
    return {
      hasPlayRecords: false,
      hasFavorites: false,
      hasSearchHistory: false,
      hasSkipConfigs: false,
      hasMangaShelf: false,
      hasMangaHistory: false,
      username: null,
    };
  }

  const authInfo = getAuthInfoFromBrowserCookie();
  return {
    hasPlayRecords: !!cacheManager.getCachedPlayRecords(),
    hasFavorites: !!cacheManager.getCachedFavorites(),
    hasSearchHistory: !!cacheManager.getCachedSearchHistory(),
    hasSkipConfigs: !!cacheManager.getCachedSkipConfigs(),
    hasMangaShelf: !!cacheManager.getCachedMangaShelf(),
    hasMangaHistory: !!cacheManager.getCachedMangaReadRecords(),
    username: authInfo?.username || null,
  };
}

// ---------------- React Hook 辅助类型 ----------------

export type CacheUpdateEvent =
  | 'playRecordsUpdated'
  | 'favoritesUpdated'
  | 'searchHistoryUpdated'
  | 'skipConfigsUpdated'
  | 'mangaShelfUpdated'
  | 'mangaHistoryUpdated'
  | 'bookHistoryUpdated';

/**
 * 用于 React 组件监听数据更新的事件监听器
 * 使用方法：
 *
 * useEffect(() => {
 *   const unsubscribe = subscribeToDataUpdates('playRecordsUpdated', (data) => {
 *     setPlayRecords(data);
 *   });
 *   return unsubscribe;
 * }, []);
 */
export function subscribeToDataUpdates<T>(
  eventType: CacheUpdateEvent,
  callback: (data: T) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => { };
  }

  const handleUpdate = (event: CustomEvent) => {
    callback(event.detail);
  };

  window.addEventListener(eventType, handleUpdate as EventListener);

  return () => {
    window.removeEventListener(eventType, handleUpdate as EventListener);
  };
}

/**
 * 预加载所有用户数据到缓存
 * 适合在应用启动时调用，提升后续访问速度
 */
export async function preloadUserData(): Promise<void> {
  if (STORAGE_TYPE === 'localstorage') return;

  // 检查是否已有有效缓存，避免重复请求
  const status = getCacheStatus();
  if (
    status.hasPlayRecords &&
    status.hasFavorites &&
    status.hasSearchHistory &&
    status.hasSkipConfigs
  ) {
    return;
  }

  // 后台静默预加载，不阻塞界面
  refreshAllCache().catch((err) => {
    console.warn('预加载用户数据失败:', err);
    triggerGlobalError('预加载用户数据失败');
  });
}

// ---------------- 跳过片头片尾配置相关 API ----------------

/**
 * 获取跳过片头片尾配置。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getSkipConfig(
  source: string,
  id: string
): Promise<SkipConfig | null> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return null;
  }

  const key = generateStorageKey(source, id);

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 触发数据更新事件
            window.dispatchEvent(
              new CustomEvent('skipConfigsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步跳过片头片尾配置失败:', err);
        });

      return cachedData[key] || null;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<Record<string, SkipConfig>>(
          `/api/skipconfigs`
        );
        cacheManager.cacheSkipConfigs(freshData);
        return freshData[key] || null;
      } catch (err) {
        console.error('获取跳过片头片尾配置失败:', err);
        triggerGlobalError('获取跳过片头片尾配置失败');
        return null;
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (!raw) return null;
    const configs = JSON.parse(raw) as Record<string, SkipConfig>;
    return configs[key] || null;
  } catch (err) {
    console.error('读取跳过片头片尾配置失败:', err);
    triggerGlobalError('读取跳过片头片尾配置失败');
    return null;
  }
}

/**
 * 保存跳过片头片尾配置。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    cachedConfigs[key] = config;
    cacheManager.cacheSkipConfigs(cachedConfigs);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: cachedConfigs,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth('/api/skipconfigs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, config }),
      });
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
      triggerGlobalError('保存跳过片头片尾配置失败');
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存跳过片头片尾配置到 localStorage');
    return;
  }

  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    const configs = raw ? (JSON.parse(raw) as Record<string, SkipConfig>) : {};
    configs[key] = config;
    localStorage.setItem('moontv_skip_configs', JSON.stringify(configs));
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: configs,
      })
    );
  } catch (err) {
    console.error('保存跳过片头片尾配置失败:', err);
    triggerGlobalError('保存跳过片头片尾配置失败');
    throw err;
  }
}

/**
 * 获取所有跳过片头片尾配置。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 触发数据更新事件
            window.dispatchEvent(
              new CustomEvent('skipConfigsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步跳过片头片尾配置失败:', err);
          triggerGlobalError('后台同步跳过片头片尾配置失败');
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<Record<string, SkipConfig>>(
          `/api/skipconfigs`
        );
        cacheManager.cacheSkipConfigs(freshData);
        return freshData;
      } catch (err) {
        console.error('获取跳过片头片尾配置失败:', err);
        triggerGlobalError('获取跳过片头片尾配置失败');
        return {};
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SkipConfig>;
  } catch (err) {
    console.error('读取跳过片头片尾配置失败:', err);
    triggerGlobalError('读取跳过片头片尾配置失败');
    return {};
  }
}

/**
 * 删除跳过片头片尾配置。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteSkipConfig(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    delete cachedConfigs[key];
    cacheManager.cacheSkipConfigs(cachedConfigs);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: cachedConfigs,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/skipconfigs?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('删除跳过片头片尾配置失败:', err);
      triggerGlobalError('删除跳过片头片尾配置失败');
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除跳过片头片尾配置到 localStorage');
    return;
  }

  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (raw) {
      const configs = JSON.parse(raw) as Record<string, SkipConfig>;
      delete configs[key];
      localStorage.setItem('moontv_skip_configs', JSON.stringify(configs));
      window.dispatchEvent(
        new CustomEvent('skipConfigsUpdated', {
          detail: configs,
        })
      );
    }
  } catch (err) {
    console.error('删除跳过片头片尾配置失败:', err);
    triggerGlobalError('删除跳过片头片尾配置失败');
    throw err;
  }
}

// ---------------- 弹幕过滤配置相关 API ----------------

/**
 * 获取弹幕过滤配置。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getDanmakuFilterConfig(): Promise<DanmakuFilterConfig | null> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return null;
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedDanmakuFilterConfig();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<DanmakuFilterConfig>(`/api/danmaku-filter`)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheDanmakuFilterConfig(freshData);
            // 触发数据更新事件
            window.dispatchEvent(
              new CustomEvent('danmakuFilterConfigUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步弹幕过滤配置失败:', err);
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<DanmakuFilterConfig>(
          `/api/danmaku-filter`
        );
        cacheManager.cacheDanmakuFilterConfig(freshData);
        return freshData;
      } catch (err) {
        console.error('获取弹幕过滤配置失败:', err);
        return null;
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem('moontv_danmaku_filter_config');
    if (!raw) return null;
    return JSON.parse(raw) as DanmakuFilterConfig;
  } catch (err) {
    console.error('读取弹幕过滤配置失败:', err);
    triggerGlobalError('读取弹幕过滤配置失败');
    return null;
  }
}

/**
 * 保存弹幕过滤配置。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function saveDanmakuFilterConfig(
  config: DanmakuFilterConfig
): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    cacheManager.cacheDanmakuFilterConfig(config);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('danmakuFilterConfigUpdated', {
        detail: config,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth('/api/danmaku-filter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
    } catch (err) {
      console.error('保存弹幕过滤配置失败:', err);
      triggerGlobalError('保存弹幕过滤配置失败');
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存弹幕过滤配置到 localStorage');
    return;
  }

  try {
    localStorage.setItem('moontv_danmaku_filter_config', JSON.stringify(config));
    window.dispatchEvent(
      new CustomEvent('danmakuFilterConfigUpdated', {
        detail: config,
      })
    );
  } catch (err) {
    console.error('保存弹幕过滤配置失败:', err);
    triggerGlobalError('保存弹幕过滤配置失败');
    throw err;
  }
}

// ---------------- 音乐播放记录相关 API ----------------

/**
 * 获取全部音乐播放记录。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getAllMusicPlayRecords(): Promise<Record<string, MusicPlayRecord>> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedMusicPlayRecords();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, MusicPlayRecord>>(`/api/music/playrecords`)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheMusicPlayRecords(freshData);
            // 触发数据更新事件
            window.dispatchEvent(
              new CustomEvent('musicPlayRecordsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步音乐播放记录失败:', err);
          triggerGlobalError('后台同步音乐播放记录失败');
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<Record<string, MusicPlayRecord>>(
          `/api/music/playrecords`
        );
        cacheManager.cacheMusicPlayRecords(freshData);
        return freshData;
      } catch (err) {
        console.error('获取音乐播放记录失败:', err);
        triggerGlobalError('获取音乐播放记录失败');
        return {};
      }
    }
  }

  // localstorage 模式
  try {
    const raw = localStorage.getItem(MUSIC_PLAY_RECORDS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, MusicPlayRecord>;
  } catch (err) {
    console.error('读取音乐播放记录失败:', err);
    triggerGlobalError('读取音乐播放记录失败');
    return {};
  }
}

/**
 * 保存音乐播放记录。
 * 数据库存储模式下使用乐观更新：先更新缓存（立即生效），再异步同步到数据库。
 */
export async function saveMusicPlayRecord(
  platform: string,
  id: string,
  record: MusicPlayRecord
): Promise<void> {
  const key = generateStorageKey(platform, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedRecords = cacheManager.getCachedMusicPlayRecords() || {};
    cachedRecords[key] = record;
    cacheManager.cacheMusicPlayRecords(cachedRecords);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('musicPlayRecordsUpdated', {
        detail: cachedRecords,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth('/api/music/playrecords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, record }),
      });
    } catch (err) {
      console.error('保存音乐播放记录失败:', err);
      triggerGlobalError('保存音乐播放记录失败');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存音乐播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllMusicPlayRecords();
    allRecords[key] = record;
    localStorage.setItem(MUSIC_PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('musicPlayRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('保存音乐播放记录失败:', err);
    triggerGlobalError('保存音乐播放记录失败');
    throw err;
  }
}

/**
 * 删除音乐播放记录。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteMusicPlayRecord(
  platform: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(platform, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    const cachedRecords = cacheManager.getCachedMusicPlayRecords() || {};
    delete cachedRecords[key];
    cacheManager.cacheMusicPlayRecords(cachedRecords);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('musicPlayRecordsUpdated', {
        detail: cachedRecords,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/music/playrecords?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('删除音乐播放记录失败:', err);
      triggerGlobalError('删除音乐播放记录失败');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除音乐播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllMusicPlayRecords();
    delete allRecords[key];
    localStorage.setItem(MUSIC_PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('musicPlayRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('删除音乐播放记录失败:', err);
    triggerGlobalError('删除音乐播放记录失败');
    throw err;
  }
}

/**
 * 清空全部音乐播放记录
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function clearAllMusicPlayRecords(): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    cacheManager.cacheMusicPlayRecords({});

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('musicPlayRecordsUpdated', {
        detail: {},
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth(`/api/music/playrecords`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('清空音乐播放记录失败:', err);
      triggerGlobalError('清空音乐播放记录失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(MUSIC_PLAY_RECORDS_KEY);
  window.dispatchEvent(
    new CustomEvent('musicPlayRecordsUpdated', {
      detail: {},
    })
  );
}

// ---------------- 集数过滤配置相关 API ----------------

/**
 * 获取集数过滤配置（纯 localStorage 存储）
 */
export async function getEpisodeFilterConfig(): Promise<EpisodeFilterConfig | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem('moontv_episode_filter_config');
    if (!raw) return null;
    return normalizeEpisodeFilterConfig(JSON.parse(raw) as EpisodeFilterConfig);
  } catch (err) {
    console.error('读取集数过滤配置失败:', err);
    return null;
  }
}

/**
 * 保存集数过滤配置（纯 localStorage 存储）
 */
export async function saveEpisodeFilterConfig(
  config: EpisodeFilterConfig
): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存集数过滤配置');
    return;
  }

  try {
    const normalizedConfig = normalizeEpisodeFilterConfig(config);
    localStorage.setItem('moontv_episode_filter_config', JSON.stringify(normalizedConfig));
    window.dispatchEvent(
      new CustomEvent('episodeFilterConfigUpdated', {
        detail: normalizedConfig,
      })
    );
  } catch (err) {
    console.error('保存集数过滤配置失败:', err);
    throw err;
  }
}
