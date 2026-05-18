'use client';

const DB_NAME = 'moontv_book_tts';
const STORE_NAME = 'audio_chunks';
const DB_VERSION = 1;
const DEFAULT_CACHE_LIMIT = 150 * 1024 * 1024;

export interface CachedBookTtsChunk {
  cacheKey: string;
  sourceId: string;
  bookId: string;
  chapterHref: string;
  chunkIndex: number;
  textHash: string;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  textPreview: string;
  mimeType: string;
  audioBlob: Blob;
  size: number;
  duration?: number;
  createdAt: number;
  lastAccessAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('lastAccessAt', 'lastAccessAt', { unique: false });
        store.createIndex('book', ['sourceId', 'bookId'], { unique: false });
        store.createIndex('chapter', ['sourceId', 'bookId', 'chapterHref'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开听书缓存失败'));
  });
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildBookTtsCacheKey(input: {
  sourceId: string;
  bookId: string;
  chapterHref: string;
  chunkIndex: number;
  text: string;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
}): Promise<{ cacheKey: string; textHash: string }> {
  const textHash = await sha256(input.text);
  const raw = JSON.stringify({
    sourceId: input.sourceId,
    bookId: input.bookId,
    chapterHref: input.chapterHref,
    chunkIndex: input.chunkIndex,
    voice: input.voice,
    rate: input.rate,
    pitch: input.pitch,
    volume: input.volume,
    textHash,
  });
  return {
    cacheKey: `bookTts:${await sha256(raw)}`,
    textHash,
  };
}

export async function getCachedBookTtsChunk(cacheKey: string): Promise<CachedBookTtsChunk | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(cacheKey);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as CachedBookTtsChunk | undefined) || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error('读取听书缓存失败'));
    };
  });
}

export async function putCachedBookTtsChunk(record: CachedBookTtsChunk): Promise<void> {
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
      reject(tx.error || new Error('写入听书缓存失败'));
    };
  });
}

export async function touchCachedBookTtsChunk(cacheKey: string): Promise<void> {
  const current = await getCachedBookTtsChunk(cacheKey);
  if (!current) return;
  await putCachedBookTtsChunk({ ...current, lastAccessAt: Date.now() });
}

export async function listCachedBookTtsChunks(): Promise<CachedBookTtsChunk[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as CachedBookTtsChunk[]) || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error('读取听书缓存列表失败'));
    };
  });
}

export async function deleteCachedBookTtsChunk(cacheKey: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(cacheKey);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('删除听书缓存失败'));
    };
  });
}

export async function enforceBookTtsCacheLimit(limit = DEFAULT_CACHE_LIMIT): Promise<void> {
  const items = await listCachedBookTtsChunks();
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (total <= limit) return;
  let current = total;
  const sorted = [...items].sort((a, b) => a.lastAccessAt - b.lastAccessAt);
  for (const item of sorted) {
    if (current <= limit) break;
    await deleteCachedBookTtsChunk(item.cacheKey);
    current -= item.size;
  }
}
