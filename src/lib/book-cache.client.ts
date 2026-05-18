'use client';

const DB_NAME = 'moontv_books_cache';
const STORE_NAME = 'epub_files';
const DB_VERSION = 1;
const DEFAULT_CACHE_LIMIT = 500 * 1024 * 1024;

export interface CachedBookFile {
  key: string;
  sourceId: string;
  bookId: string;
  title: string;
  format: 'epub' | 'pdf';
  acquisitionHref: string;
  blob: Blob;
  size: number;
  mimeType: string;
  updatedAt: number;
  lastOpenTime: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('lastOpenTime', 'lastOpenTime', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开 IndexedDB 失败'));
  });
}

export function buildBookCacheKey(sourceId: string, bookId: string, acquisitionHref: string) {
  return `${sourceId}::${bookId}::${acquisitionHref}`;
}

export async function getCachedBookFile(key: string): Promise<CachedBookFile | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as CachedBookFile | undefined) || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error('读取缓存失败'));
    };
  });
}

export async function putCachedBookFile(record: CachedBookFile): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('写入缓存失败'));
    };
  });
}

export async function touchCachedBookFile(key: string): Promise<void> {
  const current = await getCachedBookFile(key);
  if (!current) return;
  await putCachedBookFile({ ...current, lastOpenTime: Date.now() });
}

export async function deleteCachedBookFile(key: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('删除缓存失败'));
    };
  });
}

export async function listCachedBookFiles(): Promise<CachedBookFile[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as CachedBookFile[]) || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error('读取缓存列表失败'));
    };
  });
}

export async function enforceBookCacheLimit(limit = DEFAULT_CACHE_LIMIT): Promise<void> {
  const items = await listCachedBookFiles();
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (total <= limit) return;
  let current = total;
  const sorted = [...items].sort((a, b) => a.lastOpenTime - b.lastOpenTime);
  for (const item of sorted) {
    if (current <= limit) break;
    await deleteCachedBookFile(item.key);
    current -= item.size;
  }
}
