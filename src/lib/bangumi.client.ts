'use client';

export type AnimeDataSource = 'direct' | 'server-proxy' | 'custom-baseurl';

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
  if (
    saved === 'direct' ||
    saved === 'server-proxy' ||
    saved === 'custom-baseurl'
  ) {
    return saved;
  }

  const runtimeValue = getRuntimeConfig().BANGUMI_DATA_SOURCE as
    | AnimeDataSource
    | undefined;
  if (
    runtimeValue === 'direct' ||
    runtimeValue === 'server-proxy' ||
    runtimeValue === 'custom-baseurl'
  ) {
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
  const backup =
    saved === 'direct' || saved === 'server-proxy' || saved === 'custom-baseurl'
      ? saved
      : 'server-proxy';

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
    case 'direct':
    default:
      return `${BANGUMI_OFFICIAL_BASE_URL}${normalizedPath}`;
  }
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

export async function GetBangumiCalendarData(): Promise<BangumiCalendarData[]> {
  return requestWithFallback<BangumiCalendarData[]>('/calendar');
}

export async function getBangumiSubject(
  id: number | string
): Promise<BangumiSubjectData> {
  return requestWithFallback<BangumiSubjectData>(
    `/v0/subjects/${encodeURIComponent(String(id))}`
  );
}
