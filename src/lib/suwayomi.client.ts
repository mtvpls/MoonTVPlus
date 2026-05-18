/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from 'crypto';

import { getConfig } from './config';
import {
  MangaChapter,
  MangaDetail,
  MangaRecommendResult,
  MangaSearchFailure,
  MangaRecommendType,
  MangaSearchItem,
  MangaSearchResult,
  MangaSource,
} from './manga.types';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface SuwayomiClientOptions {
  serverUrl?: string;
  authMode?: 'none' | 'basic_auth' | 'simple_login';
  username?: string;
  password?: string;
}

interface ResolvedSuwayomiConfig {
  serverBaseUrl: string;
  serverUrl: string;
  authMode: 'none' | 'basic_auth' | 'simple_login';
  username?: string;
  password?: string;
  defaultLang: string;
  sourceIds: string[];
  maxSources: number;
}

interface SuwayomiSessionCacheEntry {
  cookieHeader: string;
  expiresAt: number;
}

const SUWAYOMI_SESSION_TTL_MS = 25 * 60 * 1000;
const DEFAULT_SUWAYOMI_TIMEOUT_MS = Number(process.env.SUWAYOMI_TIMEOUT_MS || 20000);
const suwayomiSessionCache = new Map<string, SuwayomiSessionCacheEntry>();

function normalizeSuwayomiAuthMode(value?: string | null): 'none' | 'basic_auth' | 'simple_login' {
  if (value === 'basic_auth' || value === 'simple_login') {
    return value;
  }
  return 'none';
}

function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function hashSimpleLoginPassword(password?: string): string {
  return createHash('sha256').update(password || '').digest('hex');
}

function getSimpleLoginCacheKey(config: ResolvedSuwayomiConfig): string {
  return `${config.serverBaseUrl}|${config.username || ''}|${hashSimpleLoginPassword(config.password)}`;
}

function getResponseSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const setCookie = response.headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
}

function extractCookieHeader(response: Response): string | null {
  const cookies = getResponseSetCookieHeaders(response)
    .map((item) => item.split(';', 1)[0]?.trim())
    .filter(Boolean) as string[];

  return cookies.length > 0 ? cookies.join('; ') : null;
}

export async function loginWithSimpleAuth(
  config: ResolvedSuwayomiConfig,
  forceRefresh = false
): Promise<string> {
  if (!config.username || !config.password) {
    throw new Error('Suwayomi simple_login 缺少用户名或密码');
  }

  const cacheKey = getSimpleLoginCacheKey(config);
  const cached = suwayomiSessionCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.cookieHeader;
  }

  const response = await fetch(
    `${config.serverBaseUrl}/login.html?redirect=${encodeURIComponent('/api/graphql')}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        user: config.username,
        pass: config.password,
      }).toString(),
      redirect: 'manual',
      cache: 'no-store',
    }
  );

  const cookieHeader = extractCookieHeader(response);
  if (!cookieHeader) {
    throw new Error(`Suwayomi simple_login 登录失败: ${response.status}`);
  }

  suwayomiSessionCache.set(cacheKey, {
    cookieHeader,
    expiresAt: Date.now() + SUWAYOMI_SESSION_TTL_MS,
  });

  return cookieHeader;
}

async function resolveSuwayomiConfig(options: SuwayomiClientOptions = {}): Promise<ResolvedSuwayomiConfig> {
  let serverUrl = process.env.SUWAYOMI_URL || process.env.NEXT_PUBLIC_SUWAYOMI_URL || '';
  let authMode = normalizeSuwayomiAuthMode(process.env.SUWAYOMI_AUTH_MODE);
  let username = process.env.SUWAYOMI_USERNAME || '';
  let password = process.env.SUWAYOMI_PASSWORD || '';
  let defaultLang = process.env.SUWAYOMI_DEFAULT_LANG || 'zh';
  let sourceIds: string[] = [];
  let maxSources = Number(process.env.SUWAYOMI_MAX_SOURCES || 10);

  try {
    const config = await getConfig();
    if (config.SuwayomiConfig?.Enabled) {
      serverUrl = config.SuwayomiConfig.ServerURL || serverUrl;
      authMode = normalizeSuwayomiAuthMode(config.SuwayomiConfig.AuthMode || authMode);
      username = config.SuwayomiConfig.Username || username;
      password = config.SuwayomiConfig.Password || password;
      defaultLang = config.SuwayomiConfig.DefaultLang || defaultLang;
      sourceIds = config.SuwayomiConfig.SourceIds || sourceIds;
      maxSources = config.SuwayomiConfig.MaxSources || maxSources;
    }
  } catch {
    // 配置读取失败时回退到环境变量
  }

  if (options.serverUrl !== undefined) {
    serverUrl = options.serverUrl;
  }
  if (options.authMode !== undefined) {
    authMode = normalizeSuwayomiAuthMode(options.authMode);
  }
  if (options.username !== undefined) {
    username = options.username;
  }
  if (options.password !== undefined) {
    password = options.password;
  }

  if (!serverUrl) {
    throw new Error('Suwayomi 未配置，请先在管理面板或环境变量中设置服务地址');
  }

  const normalizedBaseUrl = serverUrl.replace(/\/$/, '');

  return {
    serverBaseUrl: normalizedBaseUrl,
    serverUrl: normalizedBaseUrl + '/api/graphql',
    authMode,
    username: username || undefined,
    password: password || undefined,
    defaultLang,
    sourceIds,
    maxSources,
  };
}

export async function getSuwayomiConfig(options: SuwayomiClientOptions = {}): Promise<ResolvedSuwayomiConfig> {
  return resolveSuwayomiConfig(options);
}

export function buildSuwayomiImageProxyUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('/api/manga/image?')) return pathOrUrl;
  return `/api/manga/image?path=${encodeURIComponent(pathOrUrl)}`;
}

async function getSuwayomiRequestHeaders(
  resolved: ResolvedSuwayomiConfig,
  forceSimpleLoginRefresh = false
): Promise<HeadersInit | undefined> {
  if (resolved.authMode === 'basic_auth') {
    if (!resolved.username || !resolved.password) {
      throw new Error('Suwayomi basic_auth 缺少用户名或密码');
    }

    return {
      Authorization: buildBasicAuthHeader(resolved.username, resolved.password),
    };
  }

  if (resolved.authMode === 'simple_login') {
    return {
      Cookie: await loginWithSimpleAuth(resolved, forceSimpleLoginRefresh),
    };
  }

  return undefined;
}

async function suwayomiFetch(
  resolved: ResolvedSuwayomiConfig,
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const timeoutMs = DEFAULT_SUWAYOMI_TIMEOUT_MS;

  const execute = async (forceSimpleLoginRefresh: boolean) => {
    const authHeaders = await getSuwayomiRequestHeaders(resolved, forceSimpleLoginRefresh);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error(`Suwayomi 请求超时(${timeoutMs}ms)`)), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        headers: {
          ...(authHeaders || {}),
          ...(init.headers || {}),
        },
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let response = await execute(false);
  if (response.status === 401 && resolved.authMode === 'simple_login') {
    response = await execute(true);
  }

  return response;
}

function normalizeMangaStatus(status?: string): string | undefined {
  if (!status) return undefined;

  const normalized = status.trim().toUpperCase();
  switch (normalized) {
    case 'ONGOING':
      return '连载中';
    case 'COMPLETED':
      return '已完结';
    case 'LICENSED':
      return '已授权';
    case 'PUBLISHING_FINISHED':
      return '已完结';
    case 'CANCELLED':
      return '已取消';
    case 'ON_HIATUS':
      return '休刊中';
    case 'UNKNOWN':
    case 'UNRECOGNIZED':
      return undefined;
    default:
      return status;
  }
}

export class SuwayomiClient {
  private options: SuwayomiClientOptions;

  constructor(options: SuwayomiClientOptions = {}) {
    this.options = options;
  }

  private async graphqlRequest<T>(query: string, variables?: Record<string, any>, operationName?: string): Promise<T> {
    const resolved = await resolveSuwayomiConfig(this.options);
    const response = await suwayomiFetch(resolved, resolved.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables, operationName }),
    });

    if (!response.ok) {
      throw new Error(`Suwayomi 请求失败: ${response.status}`);
    }

    const data = (await response.json()) as GraphQLResponse<T>;
    if (data.errors?.length) {
      throw new Error(data.errors.map((item) => item.message || 'Unknown error').join('; '));
    }
    if (!data.data) {
      throw new Error('Suwayomi 返回空数据');
    }
    return data.data;
  }

  async getSources(lang?: string): Promise<MangaSource[]> {
    const resolved = await resolveSuwayomiConfig(this.options);
    const query = `
      query GetSources {
        sources {
          nodes {
            id
            name
            lang
            displayName
          }
        }
      }
    `;

    const data = await this.graphqlRequest<{
      sources?: { nodes?: Array<{ id: string; name?: string; lang?: string; displayName?: string }> };
    }>(query);

    const nodes = data.sources?.nodes || [];
    const filtered = nodes.filter((item) => !lang || item.lang === lang);
    const scoped = resolved.sourceIds.length > 0
      ? filtered.filter((item) => resolved.sourceIds.includes(String(item.id)))
      : filtered;

    return scoped.map((item) => ({
      id: String(item.id),
      name: item.name || item.displayName || String(item.id),
      lang: item.lang,
      displayName: item.displayName,
    }));
  }

  async searchManga(keyword: string, sourceId?: string, page = 1): Promise<MangaSearchResult> {
    const resolved = await resolveSuwayomiConfig(this.options);
    let sources: Array<{ id: string; displayName?: string; name?: string }>;
    if (sourceId) {
      sources = [{ id: sourceId, displayName: sourceId, name: sourceId }];
    } else {
      try {
        sources = (await this.getSources(resolved.defaultLang)).slice(0, resolved.maxSources);
      } catch (error) {
        if (resolved.sourceIds.length === 0) {
          throw error;
        }
        sources = resolved.sourceIds.slice(0, resolved.maxSources).map((id) => ({
          id,
          displayName: id,
          name: id,
        }));
      }
    }

    const query = `
      mutation GET_SOURCE_MANGAS_FETCH($input: FetchSourceMangaInput!) {
        fetchSourceManga(input: $input) {
          mangas {
            id
            title
            thumbnailUrl
            sourceId
            description
            author
            artist
            genre
            status
          }
        }
      }
    `;

    const results: MangaSearchItem[] = [];
    const failedSources: MangaSearchFailure[] = [];
    const seen = new Set<string>();

    const perSourceResults = await Promise.all(
      sources.map(async (source) => {
        try {
          const data = await this.graphqlRequest<{
            fetchSourceManga?: {
              mangas?: Array<{
                id: string | number;
                title?: string;
                thumbnailUrl?: string;
                sourceId?: string | number;
                description?: string;
                author?: string;
                artist?: string;
                genre?: string;
                status?: string;
              }>;
            };
          }>(
            query,
            {
              input: {
                type: 'SEARCH',
                source: source.id,
                query: keyword,
                page,
              },
            },
            'GET_SOURCE_MANGAS_FETCH'
          );

          return {
            source,
            mangas: data.fetchSourceManga?.mangas || [],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          console.warn(`[Suwayomi] manga search source failed: ${source.id} - ${message}`);
          failedSources.push({
            sourceId: String(source.id),
            sourceName: source.displayName || source.name || String(source.id),
            error: message,
          });
          return {
            source,
            mangas: [],
          };
        }
      })
    );

    for (const { source, mangas } of perSourceResults) {
      for (const manga of mangas) {
        const key = `${source.id}:${manga.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          id: String(manga.id),
          sourceId: String(manga.sourceId || source.id),
          sourceName: source.displayName || source.name || String(source.id),
          title: manga.title || '未命名漫画',
          cover: buildSuwayomiImageProxyUrl(manga.thumbnailUrl || ''),
          description: manga.description,
          author: manga.author,
          artist: manga.artist,
          genre: manga.genre,
          status: normalizeMangaStatus(manga.status),
        });
      }
    }

    return {
      results,
      failedSources,
    };
  }

  async getRecommendedManga(
    sourceId: string,
    type: MangaRecommendType = 'POPULAR',
    page = 1
  ): Promise<MangaRecommendResult> {
    if (!sourceId) {
      return { mangas: [], hasNextPage: false };
    }

    const query = `
      fragment MANGA_BASE_FIELDS on MangaType {
        id
        title
        thumbnailUrl
        sourceId
        description
        author
        artist
        genre
        status
      }

      mutation GET_SOURCE_MANGAS_FETCH($input: FetchSourceMangaInput!) {
        fetchSourceManga(input: $input) {
          hasNextPage
          mangas {
            ...MANGA_BASE_FIELDS
          }
        }
      }
    `;

    const sources = await this.getSources();
    const matchedSource = sources.find((item) => item.id === sourceId);

    const data = await this.graphqlRequest<{
      fetchSourceManga?: {
        hasNextPage?: boolean;
        mangas?: Array<{
          id: string | number;
          title?: string;
          thumbnailUrl?: string;
          sourceId?: string | number;
          description?: string;
          author?: string;
          artist?: string;
          genre?: string;
          status?: string;
        }>;
      };
    }>(
      query,
      {
        input: {
          type,
          source: sourceId,
          page,
        },
      },
      'GET_SOURCE_MANGAS_FETCH'
    );

    return {
      hasNextPage: Boolean(data.fetchSourceManga?.hasNextPage),
      mangas: (data.fetchSourceManga?.mangas || []).map((manga) => ({
        id: String(manga.id),
        sourceId: String(manga.sourceId || sourceId),
        sourceName: matchedSource?.displayName || matchedSource?.name || sourceId,
        title: manga.title || '未命名漫画',
        cover: buildSuwayomiImageProxyUrl(manga.thumbnailUrl || ''),
        description: manga.description,
        author: manga.author,
        artist: manga.artist,
        genre: manga.genre,
        status: normalizeMangaStatus(manga.status),
      })),
    };
  }

  async getChapters(mangaId: string): Promise<MangaChapter[]> {
    const mutation = `
      mutation GET_MANGA_CHAPTERS_FETCH($input: FetchChaptersInput!) {
        fetchChapters(input: $input) {
          chapters {
            id
            mangaId
            name
            chapterNumber
            scanlator
            isRead
            isDownloaded
            pageCount
            uploadDate
          }
        }
      }
    `;

    const data = await this.graphqlRequest<{
      fetchChapters?: {
        chapters?: Array<{
          id: string | number;
          mangaId?: string | number;
          name?: string;
          chapterNumber?: number;
          scanlator?: string;
          isRead?: boolean;
          isDownloaded?: boolean;
          pageCount?: number;
          uploadDate?: number;
        }>;
      };
    }>(mutation, { input: { mangaId: Number(mangaId) || mangaId } }, 'GET_MANGA_CHAPTERS_FETCH');

    return (data.fetchChapters?.chapters || []).map((chapter) => ({
      id: String(chapter.id),
      mangaId: String(chapter.mangaId || mangaId),
      name: chapter.name || '未命名章节',
      chapterNumber: chapter.chapterNumber,
      scanlator: chapter.scanlator,
      isRead: chapter.isRead,
      isDownloaded: chapter.isDownloaded,
      pageCount: chapter.pageCount,
      uploadDate: chapter.uploadDate,
    }));
  }

  async getMangaDetail(input: {
    mangaId: string;
    sourceId: string;
    title?: string;
    cover?: string;
    sourceName?: string;
    description?: string;
    author?: string;
    status?: string;
  }): Promise<MangaDetail> {
    const chapters = await this.getChapters(input.mangaId);

    let metadata: Partial<MangaSearchItem> = {
      id: input.mangaId,
      sourceId: input.sourceId,
      sourceName: input.sourceName || input.sourceId,
      title: input.title || '漫画详情',
      cover: input.cover || '',
      description: input.description,
      author: input.author,
      status: input.status,
    };

    const detailQuery = `
      query MangaDetail($id: LongString!) {
        manga(id: $id) {
          id
          title
          thumbnailUrl
          sourceId
          description
          author
          artist
          genre
          status
        }
      }
    `;

    try {
      const detailData = await this.graphqlRequest<{
        manga?: {
          id: string | number;
          title?: string;
          thumbnailUrl?: string;
          sourceId?: string | number;
          description?: string;
          author?: string;
          artist?: string;
          genre?: string;
          status?: string;
        };
      }>(detailQuery, { id: input.mangaId }, 'MangaDetail');

      if (detailData.manga) {
        metadata = {
          id: String(detailData.manga.id),
          sourceId: String(detailData.manga.sourceId || input.sourceId),
          sourceName: input.sourceName || input.sourceId,
          title: detailData.manga.title || metadata.title || '漫画详情',
          cover: buildSuwayomiImageProxyUrl(detailData.manga.thumbnailUrl || metadata.cover || ''),
          description: detailData.manga.description || metadata.description,
          author: detailData.manga.author || metadata.author,
          artist: detailData.manga.artist,
          genre: detailData.manga.genre,
          status: normalizeMangaStatus(detailData.manga.status) || normalizeMangaStatus(metadata.status),
        };
      }
    } catch {
      // 某些 Suwayomi 版本不支持直接 manga(id) 查询，降级为外部参数 + 章节信息
    }

    return {
      id: metadata.id || input.mangaId,
      sourceId: metadata.sourceId || input.sourceId,
      sourceName: metadata.sourceName || input.sourceId,
      title: metadata.title || '漫画详情',
      cover: buildSuwayomiImageProxyUrl(metadata.cover || ''),
      description: metadata.description,
      author: metadata.author,
      artist: metadata.artist,
      genre: metadata.genre,
      status: normalizeMangaStatus(metadata.status),
      chapters,
    };
  }

  async getChapterPages(chapterId: string): Promise<string[]> {
    const mutation = `
      mutation GET_CHAPTER_PAGES_FETCH($input: FetchChapterPagesInput!) {
        fetchChapterPages(input: $input) {
          pages
        }
      }
    `;

    const data = await this.graphqlRequest<{
      fetchChapterPages?: { pages?: string[] };
    }>(mutation, { input: { chapterId: Number(chapterId) || chapterId } }, 'GET_CHAPTER_PAGES_FETCH');

    return (data.fetchChapterPages?.pages || []).map((item) => buildSuwayomiImageProxyUrl(item));
  }
}

export const suwayomiClient = new SuwayomiClient();
