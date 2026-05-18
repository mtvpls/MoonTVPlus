'use client';

import { BookReadRecord, BookShelfItem } from './book.types';
import { fetchWithAuth, generateStorageKey } from './db.client';

const BOOK_SHELF_KEY = 'moontv_book_shelf';
const BOOK_HISTORY_KEY = 'moontv_book_history';
const MAX_BOOK_HISTORY = 100;
const MAX_BOOK_HISTORY_THRESHOLD = MAX_BOOK_HISTORY + 10;

function isRemoteStorage() {
  return ((window as Window & { RUNTIME_CONFIG?: { STORAGE_TYPE?: string } }).RUNTIME_CONFIG?.STORAGE_TYPE || process.env.STORAGE_TYPE || 'localstorage') !== 'localstorage';
}

function trimRecords(records: Record<string, BookReadRecord>) {
  const entries = Object.entries(records);
  if (entries.length <= MAX_BOOK_HISTORY_THRESHOLD) return records;
  return Object.fromEntries(entries.sort(([, a], [, b]) => b.saveTime - a.saveTime).slice(0, MAX_BOOK_HISTORY));
}

function readBookHistoryCache(): Record<string, BookReadRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BOOK_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BookReadRecord>) : {};
  } catch {
    return {};
  }
}

function writeBookHistoryCache(records: Record<string, BookReadRecord>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(BOOK_HISTORY_KEY, JSON.stringify(trimRecords(records)));
}

export function getCachedBookReadRecordsSnapshot(): Record<string, BookReadRecord> {
  return readBookHistoryCache();
}

export async function getAllBookShelf(): Promise<Record<string, BookShelfItem>> {
  if (typeof window === 'undefined') return {};
  if (isRemoteStorage()) {
    return (await (await fetchWithAuth('/api/books/shelf')).json()) as Record<string, BookShelfItem>;
  }
  const raw = localStorage.getItem(BOOK_SHELF_KEY);
  return raw ? (JSON.parse(raw) as Record<string, BookShelfItem>) : {};
}

export async function saveBookShelf(sourceId: string, bookId: string, item: BookShelfItem): Promise<void> {
  const key = generateStorageKey(sourceId, bookId);
  if (isRemoteStorage()) {
    await fetchWithAuth('/api/books/shelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, item }),
    });
    return;
  }
  const data = await getAllBookShelf();
  data[key] = item;
  localStorage.setItem(BOOK_SHELF_KEY, JSON.stringify(data));
}

export async function deleteBookShelf(sourceId: string, bookId: string): Promise<void> {
  const key = generateStorageKey(sourceId, bookId);
  if (isRemoteStorage()) {
    await fetchWithAuth(`/api/books/shelf?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    return;
  }
  const data = await getAllBookShelf();
  delete data[key];
  localStorage.setItem(BOOK_SHELF_KEY, JSON.stringify(data));
}

export async function getAllBookReadRecords(): Promise<Record<string, BookReadRecord>> {
  if (typeof window === 'undefined') return {};
  if (isRemoteStorage()) {
    const cachedData = readBookHistoryCache();
    if (Object.keys(cachedData).length > 0) {
      fetchWithAuth('/api/books/history')
        .then((response) => response.json() as Promise<Record<string, BookReadRecord>>)
        .then((freshData) => {
          writeBookHistoryCache(freshData);
          window.dispatchEvent(new CustomEvent('bookHistoryUpdated', { detail: freshData }));
        })
        .catch(() => undefined);
      return cachedData;
    }

    const freshData = (await (await fetchWithAuth('/api/books/history')).json()) as Record<string, BookReadRecord>;
    writeBookHistoryCache(freshData);
    return freshData;
  }
  return readBookHistoryCache();
}

export async function saveBookReadRecord(sourceId: string, bookId: string, record: BookReadRecord): Promise<void> {
  const key = generateStorageKey(sourceId, bookId);
  if (isRemoteStorage()) {
    const cached = readBookHistoryCache();
    cached[key] = record;
    writeBookHistoryCache(cached);
    window.dispatchEvent(new CustomEvent('bookHistoryUpdated', { detail: trimRecords(cached) }));
    await fetchWithAuth('/api/books/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, record }),
    });
    return;
  }
  const data = await getAllBookReadRecords();
  data[key] = record;
  writeBookHistoryCache(data);
}

export async function deleteBookReadRecord(sourceId: string, bookId: string): Promise<void> {
  const key = generateStorageKey(sourceId, bookId);
  if (isRemoteStorage()) {
    const cached = readBookHistoryCache();
    delete cached[key];
    writeBookHistoryCache(cached);
    window.dispatchEvent(new CustomEvent('bookHistoryUpdated', { detail: cached }));
    await fetchWithAuth(`/api/books/history?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    return;
  }
  const data = await getAllBookReadRecords();
  delete data[key];
  writeBookHistoryCache(data);
}
