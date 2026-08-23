'use client';

export type AnimeDataSource =
  | 'direct'
  | 'server-proxy'
  | 'custom-baseurl'
  | 'sakura';

/** 桜色镜像站：全域名镜像 bgm.tv → bangumi.lol */
export const BANGUMI_SAKURA_API_BASE_URL = 'https://api.bangumi.lol';
export const BANGUMI_SAKURA_SITE_URL = 'https://bangumi.lol';
export const BANGUMI_OFFICIAL_SITE_URL = 'https://bgm.tv';

export function isValidAnimeDataSource(
  value: string | null | undefined
): value is AnimeDataSource {
  return (
    value === 'direct' ||
    value === 'server-proxy' ||
    value === 'custom-baseurl' ||
    value === 'sakura'
  );
}

export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

export interface BangumiSubjectData {
  id?: number;
  name: string;
  name_cn?: string;
  date?: string;
  images?: {
    large?: string;
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
  };
  rating?: {
    score: number;
    total: number;
  };
  summary?: string;
  tags?: { name: string }[];
  eps?: number;
}

// 时刻表（每日放送）数据结构 —— 对应 /api/bangumi/schedule
export interface BangumiScheduleItem {
  id: string;
  name: string;
  name_cn: string;
  /** BGM 星期约定：0=周一 .. 6=周日。未知放送时间的条目也带星期 */
  weekday: number;
  /** 北京时间 HH:MM，仅匹配到精确放送时刻的条目有 */
  time?: string;
  /** 评分文本（一位小数），如 "8.1" */
  rating?: string;
  air_date?: string;
  images?: {
    large?: string;
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
  };
}

export interface BangumiScheduleSlot {
  time: string;
  items: BangumiScheduleItem[];
}

export interface BangumiScheduleDay {
  en: string;
  cn: string;
  slots: BangumiScheduleSlot[];
  /** 该日未知放送时间（BGM 有星期但匹配不到精确时刻）的条目 */
  unknown: BangumiScheduleItem[];
}

export interface BangumiScheduleData {
  generatedAt: number;
  season: string;
  year: number;
  days: BangumiScheduleDay[];
  /** 未知放送时间（匹配不到 LiveChart 的条目），展示在最底部 */
  unknown: BangumiScheduleItem[];
}

const BANGUMI_OFFICIAL_BASE_URL = 'https://api.bgm.tv';
const SERVER_PROXY_BASE_URL = '/api/bangumi';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function getRuntimeConfig() {
  if (typeof window === 'undefined') return {} as any;
  return (window as any).RUNTIME_CONFIG || {};
}

function getPrimaryAnimeDataSource(): AnimeDataSource {
  if (typeof window === 'undefined') return 'direct';

  const saved = localStorage.getItem(
    'animeDataSource'
  ) as AnimeDataSource | null;
  if (isValidAnimeDataSource(saved)) {
    return saved;
  }

  const runtimeValue = getRuntimeConfig().BANGUMI_DATA_SOURCE as
    | AnimeDataSource
    | undefined;
  if (isValidAnimeDataSource(runtimeValue)) {
    return runtimeValue;
  }

  return 'direct';
}

function getBackupAnimeDataSource(
  primary: AnimeDataSource
): AnimeDataSource | null {
  if (typeof window === 'undefined')
    return primary === 'server-proxy' ? null : 'server-proxy';

  const saved = localStorage.getItem(
    'animeDataSourceBackup'
  ) as AnimeDataSource | null;
  const backup = isValidAnimeDataSource(saved) ? saved : 'server-proxy';

  return backup === primary ? null : backup;
}

function getCustomAnimeBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('animeCustomBaseUrl') || '';
}

function buildBangumiUrl(source: AnimeDataSource, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  switch (source) {
    case 'server-proxy':
      return `${SERVER_PROXY_BASE_URL}${normalizedPath}`;
    case 'custom-baseurl': {
      const customBaseUrl = normalizeBaseUrl(getCustomAnimeBaseUrl());
      if (!customBaseUrl) {
        return `${BANGUMI_OFFICIAL_BASE_URL}${normalizedPath}`;
      }
      return `${customBaseUrl}${normalizedPath}`;
    }
    case 'sakura':
      return `${BANGUMI_SAKURA_API_BASE_URL}${normalizedPath}`;
    case 'direct':
    default:
      return `${BANGUMI_OFFICIAL_BASE_URL}${normalizedPath}`;
  }
}

/** 按当前动漫数据源生成 Bangumi 条目外链（桜色镜像站 → bangumi.lol） */
export function getBangumiSubjectUrl(id: string | number): string {
  const origin =
    getPrimaryAnimeDataSource() === 'sakura'
      ? BANGUMI_SAKURA_SITE_URL
      : BANGUMI_OFFICIAL_SITE_URL;
  return `${origin}/subject/${encodeURIComponent(String(id))}`;
}

async function fetchBangumiJson<T>(
  source: AnimeDataSource,
  path: string
): Promise<T> {
  const response = await fetch(buildBangumiUrl(source, path), {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Bangumi 请求失败: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function requestWithFallback<T>(path: string): Promise<T> {
  const primary = getPrimaryAnimeDataSource();
  const backup = getBackupAnimeDataSource(primary);

  try {
    return await fetchBangumiJson<T>(primary, path);
  } catch (primaryError) {
    if (!backup) throw primaryError;

    try {
      return await fetchBangumiJson<T>(backup, path);
    } catch (backupError) {
      console.error('Bangumi 主源与备用源均请求失败:', {
        primary,
        backup,
        primaryError,
        backupError,
      });
      throw backupError;
    }
  }
}

// 日历缓存：复用首页「新番放送」的 localStorage 缓存（homepage_bangumi），
// 首页 / tv 动漫更新时间表 / 豆瓣每日放送 共用同一份数据，避免重复请求 Bangumi。
const BANGUMI_CALENDAR_CACHE_KEY = 'homepage_bangumi';
const BANGUMI_CALENDAR_CACHE_TTL = 60 * 60 * 1000; // 1 小时，与首页保持一致

function readBangumiCalendarCache(): BangumiCalendarData[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BANGUMI_CALENDAR_CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return null;
    if (Date.now() - timestamp > BANGUMI_CALENDAR_CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function writeBangumiCalendarCache(data: BangumiCalendarData[]): void {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(data) || data.length === 0) return;
  try {
    localStorage.setItem(
      BANGUMI_CALENDAR_CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 获取 BGM 日历（首页新番放送 / tv 每日放送 / 豆瓣每日放送共用），带 1 小时 localStorage 缓存 */
export async function GetBangumiCalendarData(): Promise<BangumiCalendarData[]> {
  const cached = readBangumiCalendarCache();
  if (cached) return cached;

  const data = await requestWithFallback<BangumiCalendarData[]>('/calendar');
  writeBangumiCalendarCache(data);
  return data;
}

/**
 * 获取「每日放送」时刻表数据（周一到周日 + 未知放送时间）。
 * 走自建 /api/bangumi/schedule 路由（服务端聚合 BGM 日历 + LiveChart）。
 */
export async function GetBangumiScheduleData(): Promise<BangumiScheduleData> {
  const response = await fetch('/api/bangumi/schedule', {
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Bangumi 时刻表请求失败: ${response.status}`);
  }

  return response.json() as Promise<BangumiScheduleData>;
}

export async function getBangumiSubject(
  id: number | string
): Promise<BangumiSubjectData> {
  return requestWithFallback<BangumiSubjectData>(
    `/v0/subjects/${encodeURIComponent(String(id))}`
  );
}
