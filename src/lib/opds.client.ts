/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseStringPromise } from 'xml2js';

import { getConfig } from './config';
import {
  BookAcquisitionLink,
  BookCatalogResult,
  BookDetail,
  BookListItem,
  BookSearchFailure,
  BookSearchResult,
  BookSource,
  BookSourceCapabilities,
} from './book.types';

interface ResolvedOPDSConfig {
  enabled: boolean;
  sources: BookSource[];
  cacheTTL: number;
}

interface ParsedFeedLink {
  href: string;
  rel?: string;
  type?: string;
  title?: string;
}

interface ParsedFeedEntry {
  id: string;
  title: string;
  author?: string;
  summary?: string;
  content?: string;
  language?: string;
  published?: string;
  updated?: string;
  categories: string[];
  links: ParsedFeedLink[];
}

interface ParsedFeed {
  title: string;
  subtitle?: string;
  id?: string;
  links: ParsedFeedLink[];
  entries: ParsedFeedEntry[];
}

const DEFAULT_TIMEOUT_MS = Number(process.env.OPDS_TIMEOUT_MS || 20000);
const feedCache = new Map<string, { expiresAt: number; data: ParsedFeed }>();
const sourceCapabilityCache = new Map<string, { expiresAt: number; data: BookSourceCapabilities }>();
const SOURCE_CAPABILITY_SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE_CAPABILITY_FAILURE_TTL_MS = 30 * 1000;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: any): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value && typeof value._ === 'string') return value._.trim();
  return '';
}

function sanitizeXmlForParsing(xml: string): string {
  return xml
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/&(?!(?:#\d+|#x[a-fA-F0-9]+|amp|lt|gt|quot|apos);)/g, '&amp;');
}

async function parseXmlWithFallback(xml: string) {
  try {
    return await parseStringPromise(xml, { explicitArray: true, trim: true });
  } catch (error) {
    const sanitizedXml = sanitizeXmlForParsing(xml);
    if (sanitizedXml === xml) throw error;
    return await parseStringPromise(sanitizedXml, { explicitArray: true, trim: true });
  }
}

function normalizeUrl(base: string, href?: string): string {
  if (!href) return base;
  return new URL(href, base).toString();
}

function buildProxyUrl(sourceId: string, href: string): string {
  return `/api/books/file?sourceId=${encodeURIComponent(sourceId)}&href=${encodeURIComponent(href)}`;
}

function mapFormat(type: string): 'epub' | 'pdf' | null {
  const lower = type.toLowerCase();
  if (lower.includes('epub')) return 'epub';
  if (lower.includes('pdf')) return 'pdf';
  return null;
}

function isAcquisitionRel(rel?: string): boolean {
  return !!rel && rel.includes('opds-spec.org/acquisition');
}

function isNavigationRel(rel?: string): boolean {
  return rel === 'subsection' || rel === 'collection' || rel === 'start';
}

function isNavigationLink(link: ParsedFeedLink): boolean {
  const type = (link.type || '').toLowerCase();
  return isNavigationRel(link.rel) || type.includes('kind=navigation') || (type.includes('opds-catalog') && !isAcquisitionRel(link.rel));
}

function isCoverRel(rel?: string): boolean {
  if (!rel) return false;
  const normalized = rel.toLowerCase();
  return normalized.includes('opds-spec.org/cover')
    || normalized.includes('opds-spec.org/image')
    || normalized.includes('image/thumbnail')
    || normalized === 'thumbnail'
    || normalized === 'cover';
}

function isImageType(type?: string): boolean {
  return !!type && type.toLowerCase().startsWith('image/');
}

function pickCoverLink(links: ParsedFeedLink[]): string | undefined {
  const thumbnail = links.find((link) => {
    const rel = (link.rel || '').toLowerCase();
    return rel.includes('thumbnail') && (isCoverRel(link.rel) || isImageType(link.type));
  });
  const cover = thumbnail
    || links.find((link) => isCoverRel(link.rel))
    || links.find((link) => isImageType(link.type) && !isAcquisitionRel(link.rel));
  return cover?.href;
}

function pickDetailHref(links: ParsedFeedLink[]): string | undefined {
  const preferred = links.find((link) => link.rel === 'alternate' && (link.type || '').includes('atom+xml'))
    || links.find((link) => link.rel === 'self' && (link.type || '').includes('atom+xml'))
    || links.find((link) => isNavigationLink(link));
  return preferred?.href;
}

function extractAcquisitionLinks(entry: ParsedFeedEntry): BookAcquisitionLink[] {
  return entry.links
    .filter((link) => isAcquisitionRel(link.rel) || mapFormat(link.type || '') !== null)
    .map((link) => ({
      rel: link.rel || 'http://opds-spec.org/acquisition',
      type: link.type || 'application/octet-stream',
      href: link.href,
      title: link.title,
      isIndirect: !!link.rel?.includes('indirect'),
    }));
}

function isLikelyNavigationEntry(entry: ParsedFeedEntry): boolean {
  const hasAcquisition = extractAcquisitionLinks(entry).length > 0;
  const hasNavigationLink = entry.links.some((link) => isNavigationLink(link));
  return hasNavigationLink && !hasAcquisition;
}

function mapEntryToItem(source: BookSource, entry: ParsedFeedEntry): BookListItem {
  const acquisitionLinks = extractAcquisitionLinks(entry);

  return {
    id: entry.id || pickDetailHref(entry.links) || acquisitionLinks[0]?.href || entry.title,
    sourceId: source.id,
    sourceName: source.name,
    title: entry.title || '未命名电子书',
    author: entry.author,
    cover: (() => { const coverHref = pickCoverLink(entry.links); return coverHref ? buildProxyUrl(source.id, coverHref) : undefined; })(),
    summary: entry.summary || entry.content || undefined,
    language: entry.language,
    published: entry.published,
    updated: entry.updated,
    tags: entry.categories,
    detailHref: pickDetailHref(entry.links),
    acquisitionLinks,
  };
}

function mapEntryToDetail(source: BookSource, entry: ParsedFeedEntry): BookDetail {
  const item = mapEntryToItem(source, entry);
  return {
    ...item,
    categories: entry.categories,
    navigation: entry.links
      .filter((link) => isNavigationRel(link.rel))
      .map((link) => ({ title: link.title || entry.title, href: link.href, rel: link.rel, type: link.type })),
  };
}

async function resolveOPDSConfig(): Promise<ResolvedOPDSConfig> {
  let enabled = process.env.OPDS_ENABLED === 'true';
  let sources: BookSource[] = [];
  const cacheTTL = Number(process.env.OPDS_CACHE_TTL_MS || 10 * 60 * 1000);

  const envJson = process.env.OPDS_SOURCES_JSON;
  if (envJson) {
    try {
      sources = JSON.parse(envJson) as BookSource[];
    } catch {
      // ignore invalid json
    }
  } else if (process.env.OPDS_URL || process.env.NEXT_PUBLIC_OPDS_URL) {
    sources = [{
      id: 'default',
      name: process.env.OPDS_NAME || '默认书源',
      url: process.env.OPDS_URL || process.env.NEXT_PUBLIC_OPDS_URL || '',
      authMode: (process.env.OPDS_AUTH_MODE as BookSource['authMode']) || 'none',
      username: process.env.OPDS_USERNAME || '',
      password: process.env.OPDS_PASSWORD || '',
      headerName: process.env.OPDS_HEADER_NAME || '',
      headerValue: process.env.OPDS_HEADER_VALUE || '',
      searchTemplate: process.env.OPDS_SEARCH_TEMPLATE || '',
      enabled: true,
    }];
  }

  try {
    const config = await getConfig();
    if (config.OPDSConfig) {
      enabled = config.OPDSConfig.Enabled ?? enabled;
      if (Array.isArray(config.OPDSConfig.Sources) && config.OPDSConfig.Sources.length > 0) {
        sources = config.OPDSConfig.Sources as BookSource[];
      }
    }
  } catch {
    // ignore and fallback to env
  }

  return {
    enabled,
    cacheTTL,
    sources: (sources || []).filter((source) => !!source?.url && source.enabled !== false),
  };
}

function buildHeaders(source: BookSource): HeadersInit {
  if (source.authMode === 'basic' && source.username) {
    return {
      Authorization: `Basic ${Buffer.from(`${source.username}:${source.password || ''}`).toString('base64')}`,
    };
  }
  if (source.authMode === 'header' && source.headerName && source.headerValue) {
    return {
      [source.headerName]: source.headerValue,
    };
  }
  return {};
}

async function fetchText(url: string, headers: HeadersInit): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`请求失败: ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseLinks(value: any[], baseUrl: string): ParsedFeedLink[] {
  return value.map((item) => ({
    href: normalizeUrl(baseUrl, item?.$?.href),
    rel: item?.$?.rel,
    type: item?.$?.type,
    title: item?.$?.title,
  })).filter((item) => !!item.href);
}

function parseEntries(value: any[], baseUrl: string): ParsedFeedEntry[] {
  return value.map((entry) => ({
    id: textValue(entry.id?.[0] || entry.id),
    title: textValue(entry.title?.[0] || entry.title),
    author: textValue(entry.author?.[0]?.name?.[0] || entry.author?.[0]?.name || entry.author?.name),
    summary: textValue(entry.summary?.[0] || entry.summary),
    content: textValue(entry.content?.[0] || entry.content),
    language: textValue(entry.language?.[0] || entry['dc:language']?.[0]),
    published: textValue(entry.published?.[0] || entry['dc:issued']?.[0]),
    updated: textValue(entry.updated?.[0]),
    categories: asArray(entry.category).map((item) => item?.$?.label || item?.$?.term).filter(Boolean),
    links: parseLinks(asArray(entry.link), baseUrl),
  }));
}

async function parseFeed(xml: string, baseUrl: string): Promise<ParsedFeed> {
  const parsed = await parseXmlWithFallback(xml);
  const feed = parsed.feed || parsed.entry;
  if (!feed) throw new Error('无法解析 OPDS feed');

  const feedNode = parsed.feed ? feed : { entry: [feed] };
  return {
    title: textValue(feedNode.title?.[0] || '电子书目录'),
    subtitle: textValue(feedNode.subtitle?.[0] || ''),
    id: textValue(feedNode.id?.[0] || ''),
    links: parseLinks(asArray(feedNode.link), baseUrl),
    entries: parseEntries(asArray(feedNode.entry), baseUrl),
  };
}


function fillSearchTermsTemplate(template: string, keyword: string) {
  const encoded = encodeURIComponent(keyword);
  const replaced = template
    .replace(/\{searchTerms[^}]*\}/g, encoded)
    .replace(/\{count[^}]*\}/g, '20')
    .replace(/\{startIndex[^}]*\}/g, '0')
    .replace(/\{startPage[^}]*\}/g, '1')
    .replace(/\{language[^}]*\}/g, '')
    .replace(/\{inputEncoding[^}]*\}/g, 'UTF-8')
    .replace(/\{outputEncoding[^}]*\}/g, 'UTF-8')
    .replace(/\{source[^}]*\}/g, '')
    .replace(/\{[^}]+\}/g, '');

  try {
    const url = new URL(replaced);
    const toDelete: string[] = [];
    url.searchParams.forEach((value, key) => {
      if (!value || value === 'undefined' || value === 'null') toDelete.push(key);
    });
    toDelete.forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return replaced
      .replace(/[?&](?:[^=]+)=(&|$)/g, '$1')
      .replace(/[?&]$/, '');
  }
}

async function resolveSearchTargetUrl(source: BookSource, q: string): Promise<string> {
  if (source.searchTemplate) {
    return fillSearchTermsTemplate(source.searchTemplate, q);
  }

  const rootFeed = await getFeed(source);
  const searchLink = rootFeed.links.find((link) => link.rel === 'search');
  if (!searchLink?.href) throw new Error('该书源不支持搜索');

  if ((searchLink.type || '').toLowerCase().includes('opensearchdescription+xml')) {
    const xml = await fetchText(searchLink.href, buildHeaders(source));
    const parsed = await parseXmlWithFallback(xml);
    const description = parsed.OpenSearchDescription || parsed['os:OpenSearchDescription'] || parsed['OpenSearchDescription'];
    const urlNodes = asArray(description?.Url || description?.url);
    const preferred = urlNodes.find((item) => (item?.$?.type || '').toLowerCase().includes('atom+xml')) || urlNodes[0];
    const template = preferred?.$?.template;
    if (!template) throw new Error('未找到搜索模板');
    return fillSearchTermsTemplate(normalizeUrl(searchLink.href, template), q);
  }

  return searchLink.href.includes('{searchTerms}')
    ? searchLink.href.replace('{searchTerms}', encodeURIComponent(q))
    : `${searchLink.href}${searchLink.href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;
}

async function getFeed(source: BookSource, href?: string): Promise<ParsedFeed> {
  const target = normalizeUrl(source.url, href || source.url);
  const cacheKey = `${source.id}|${target}`;
  const cached = feedCache.get(cacheKey);
  const { cacheTTL } = await resolveOPDSConfig();
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const xml = await fetchText(target, buildHeaders(source));
  const data = await parseFeed(xml, target);
  feedCache.set(cacheKey, { data, expiresAt: Date.now() + cacheTTL });
  return data;
}

async function getSourceById(sourceId: string): Promise<BookSource> {
  const config = await resolveOPDSConfig();
  const source = config.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error('未找到对应的 OPDS 书源');
  return source;
}

async function detectCapabilities(source: BookSource): Promise<BookSourceCapabilities> {
  const cached = sourceCapabilityCache.get(source.id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const feed = await getFeed(source);
    const searchLink = feed.links.find((link) => link.rel === 'search');
    const navigationEntries = feed.entries.filter((entry) => isLikelyNavigationEntry(entry));
    const bookEntries = feed.entries.filter((entry) => !isLikelyNavigationEntry(entry));
    const acquisitionTypes = Array.from(new Set(bookEntries.flatMap((entry) => entry.links
      .map((link) => mapFormat(link.type || ''))
      .filter(Boolean) as string[])));
    const navigationCount = feed.links.filter((link) => isNavigationRel(link.rel)).length + navigationEntries.length;
    const entryCount = bookEntries.length;

    const data: BookSourceCapabilities = {
      searchSupported: !!searchLink || !!source.searchTemplate,
      catalogSupported: navigationCount > 0 || entryCount > 0,
      searchMode: searchLink ? 'opds' : source.searchTemplate ? 'template' : 'disabled',
      catalogMode: navigationCount > 0 ? 'navigation' : entryCount > 0 ? 'flat' : 'disabled',
      acquisitionTypes,
      lastCheckedAt: now,
    };

    sourceCapabilityCache.set(source.id, { data, expiresAt: now + SOURCE_CAPABILITY_SUCCESS_TTL_MS });
    return data;
  } catch (error) {
    const failureData: BookSourceCapabilities = {
      searchSupported: !!source.searchTemplate,
      catalogSupported: false,
      searchMode: source.searchTemplate ? 'template' : 'disabled',
      catalogMode: 'disabled',
      acquisitionTypes: [],
      lastCheckedAt: now,
      lastError: (error as Error).message,
    };

    if (cached?.data && !cached.data.lastError) {
      sourceCapabilityCache.set(source.id, { data: cached.data, expiresAt: now + SOURCE_CAPABILITY_FAILURE_TTL_MS });
      return cached.data;
    }

    sourceCapabilityCache.set(source.id, { data: failureData, expiresAt: now + SOURCE_CAPABILITY_FAILURE_TTL_MS });
    return failureData;
  }
}

export async function getOPDSConfig() {
  return resolveOPDSConfig();
}

export class OPDSClient {
  async getSources(): Promise<BookSource[]> {
    const config = await resolveOPDSConfig();
    if (!config.enabled) return [];
    const withCapabilities = await Promise.all(config.sources.map(async (source) => ({
      ...source,
      capabilities: await detectCapabilities(source),
    })));
    return withCapabilities;
  }

  async getCatalog(sourceId: string, href?: string): Promise<BookCatalogResult> {
    const source = await getSourceById(sourceId);
    return this.getCatalogFromSource(source, href);
  }

  async getCatalogFromSource(source: BookSource, href?: string): Promise<BookCatalogResult & { searchHref?: string }> {
    const feed = await getFeed(source, href);
    const navigationEntries = feed.entries.filter((entry) => isLikelyNavigationEntry(entry));
    const bookEntries = feed.entries.filter((entry) => !isLikelyNavigationEntry(entry));
    return {
      sourceId: source.id,
      sourceName: source.name,
      title: feed.title,
      subtitle: feed.subtitle,
      href: normalizeUrl(source.url, href || source.url),
      entries: bookEntries.map((entry) => mapEntryToItem(source, entry)),
      navigation: [
        ...feed.links
          .filter((link) => isNavigationLink(link) && link.rel !== 'next' && link.rel !== 'previous' && !!(link.title || '').trim())
          .map((link) => ({
            title: (link.title || '').trim(),
            href: link.href,
            rel: link.rel,
            type: link.type,
          })),
        ...navigationEntries
          .map((entry) => ({
            title: (entry.title || '').trim(),
            href: pickDetailHref(entry.links) || entry.links.find((link) => isNavigationLink(link))?.href || '',
            rel: entry.links.find((link) => isNavigationLink(link))?.rel,
            type: entry.links.find((link) => isNavigationLink(link))?.type,
          }))
          .filter((item) => !!item.href && !!item.title && item.title !== '目录'),
      ],
      nextHref: feed.links.find((link) => link.rel === 'next')?.href,
      previousHref: feed.links.find((link) => link.rel === 'previous')?.href,
      searchHref: feed.links.find((link) => link.rel === 'search')?.href,
    };
  }

  async searchBooks(q: string, sourceId?: string): Promise<BookSearchResult> {
    const sources = sourceId ? [await getSourceById(sourceId)] : (await resolveOPDSConfig()).sources;
    const results: BookListItem[] = [];
    const failedSources: BookSearchFailure[] = [];

    await Promise.all(sources.map(async (source) => {
      try {
        const targetUrl = await resolveSearchTargetUrl(source, q);
        if (!targetUrl) throw new Error('未配置可用的搜索地址');
        const feed = await getFeed(source, targetUrl);
        results.push(...feed.entries.map((entry) => mapEntryToItem(source, entry)));
      } catch (error) {
        failedSources.push({ sourceId: source.id, sourceName: source.name, error: (error as Error).message });
      }
    }));

    return { results, failedSources };
  }

  async getBookDetail(sourceId: string, href: string, fallback?: Partial<BookDetail>): Promise<BookDetail> {
    const source = await getSourceById(sourceId);
    if (!href) {
      if (!fallback?.title) throw new Error('缺少详情链接');
      return {
        id: fallback.id || `${sourceId}:${fallback.title}`,
        sourceId,
        sourceName: source.name,
        title: fallback.title,
        author: fallback.author,
        cover: fallback.cover,
        summary: fallback.summary,
        acquisitionLinks: fallback.acquisitionLinks || [],
        detailHref: fallback.detailHref,
        tags: fallback.tags,
        categories: fallback.categories,
        navigation: fallback.navigation || [],
      } as BookDetail;
    }

    const feed = await getFeed(source, href);
    const entry = feed.entries[0];
    if (!entry) {
      if (fallback?.title) {
        return {
          id: fallback.id || href,
          sourceId,
          sourceName: source.name,
          title: fallback.title,
          author: fallback.author,
          cover: fallback.cover,
          summary: fallback.summary,
          acquisitionLinks: fallback.acquisitionLinks || [],
          detailHref: href,
          tags: fallback.tags,
          categories: fallback.categories,
          navigation: fallback.navigation || [],
        } as BookDetail;
      }
      throw new Error('详情页没有可用书籍条目');
    }

    const detail = mapEntryToDetail(source, entry);
    return {
      ...detail,
      detailHref: href,
      summary: detail.summary || feed.subtitle || fallback?.summary,
      acquisitionLinks: detail.acquisitionLinks.length > 0 ? detail.acquisitionLinks : fallback?.acquisitionLinks || [],
      cover: detail.cover || fallback?.cover,
    };
  }

  async getPreferredAcquisition(sourceId: string, href: string): Promise<{ format: 'epub' | 'pdf'; href: string }> {
    const detail = await this.getBookDetail(sourceId, href);
    const preferred = detail.acquisitionLinks
      .map((item) => ({ ...item, format: mapFormat(item.type || '') }))
      .find((item) => item.format === 'epub' || item.format === 'pdf');
    if (!preferred?.format) {
      throw new Error('当前书籍没有可在线阅读的 EPUB/PDF 资源');
    }
    return { format: preferred.format, href: preferred.href };
  }

  async getSourceById(sourceId: string): Promise<BookSource> {
    return getSourceById(sourceId);
  }
}

export const opdsClient = new OPDSClient();
export { buildProxyUrl };
