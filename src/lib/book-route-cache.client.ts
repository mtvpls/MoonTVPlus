'use client';

import { BookAcquisitionLink, BookDetail, BookListItem, BookReadRecord, BookShelfItem } from './book.types';

const BOOK_ROUTE_CACHE_KEY = 'moontv_books_route_cache_v1';
const MAX_CACHE_ITEMS = 300;

export interface BookRouteCacheItem {
  sourceId: string;
  bookId: string;
  sourceName?: string;
  title?: string;
  author?: string;
  cover?: string;
  summary?: string;
  detailHref?: string;
  acquisitionHref?: string;
  acquisitionLinks?: BookAcquisitionLink[];
  format?: 'epub' | 'pdf';
  updatedAt: number;
}

function buildKey(sourceId: string, bookId: string) {
  return `${sourceId}+${bookId}`;
}

function readCache(): Record<string, BookRouteCacheItem> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BOOK_ROUTE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BookRouteCacheItem>) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, BookRouteCacheItem>) {
  if (typeof window === 'undefined') return;
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_CACHE_ITEMS);
  localStorage.setItem(BOOK_ROUTE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function getBookRouteCache(sourceId: string, bookId: string): BookRouteCacheItem | null {
  const item = readCache()[buildKey(sourceId, bookId)];
  return item || null;
}

export function saveBookRouteCache(item: Omit<BookRouteCacheItem, 'updatedAt'> & { updatedAt?: number }) {
  if (typeof window === 'undefined' || !item.sourceId || !item.bookId) return;
  const cache = readCache();
  const key = buildKey(item.sourceId, item.bookId);
  const prev = cache[key];
  cache[key] = {
    ...prev,
    ...item,
    acquisitionLinks: item.acquisitionLinks || prev?.acquisitionLinks || [],
    updatedAt: item.updatedAt || Date.now(),
  };
  writeCache(cache);
}

export function cacheBookListItem(item: BookListItem) {
  saveBookRouteCache({
    sourceId: item.sourceId,
    bookId: item.id,
    sourceName: item.sourceName,
    title: item.title,
    author: item.author,
    cover: item.cover,
    summary: item.summary,
    detailHref: item.detailHref,
    acquisitionLinks: item.acquisitionLinks,
  });
}

export function cacheBookDetail(detail: BookDetail) {
  const readable = detail.acquisitionLinks.find((item) => item.type.toLowerCase().includes('epub') || item.type.toLowerCase().includes('pdf'));
  saveBookRouteCache({
    sourceId: detail.sourceId,
    bookId: detail.id,
    sourceName: detail.sourceName,
    title: detail.title,
    author: detail.author,
    cover: detail.cover,
    summary: detail.summary,
    detailHref: detail.detailHref,
    acquisitionHref: readable?.href,
    format: readable?.type.toLowerCase().includes('pdf') ? 'pdf' : readable ? 'epub' : undefined,
    acquisitionLinks: detail.acquisitionLinks,
  });
}

export function cacheBookShelfItem(item: BookShelfItem) {
  saveBookRouteCache({
    sourceId: item.sourceId,
    bookId: item.bookId,
    sourceName: item.sourceName,
    title: item.title,
    author: item.author,
    cover: item.cover,
    detailHref: item.detailHref,
    acquisitionHref: item.acquisitionHref,
    format: item.format,
  });
}

export function cacheBookReadRecord(item: BookReadRecord) {
  saveBookRouteCache({
    sourceId: item.sourceId,
    bookId: item.bookId,
    sourceName: item.sourceName,
    title: item.title,
    author: item.author,
    cover: item.cover,
    detailHref: item.detailHref,
    acquisitionHref: item.acquisitionHref,
    format: item.format,
  });
}

export function buildBookDetailPath(sourceId: string, bookId: string) {
  return `/books/detail?sourceId=${encodeURIComponent(sourceId)}&bookId=${encodeURIComponent(bookId)}`;
}

export function buildBookReadPath(sourceId: string, bookId: string) {
  return `/books/read?sourceId=${encodeURIComponent(sourceId)}&bookId=${encodeURIComponent(bookId)}`;
}
