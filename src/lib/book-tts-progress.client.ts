'use client';

import { BookTtsProgress } from './book.types';
import { generateStorageKey } from './db.client';

const BOOK_TTS_PROGRESS_KEY = 'moontv_book_tts_progress';

function readAll(): Record<string, BookTtsProgress> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BOOK_TTS_PROGRESS_KEY);
    return raw ? JSON.parse(raw) as Record<string, BookTtsProgress> : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, BookTtsProgress>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(BOOK_TTS_PROGRESS_KEY, JSON.stringify(data));
}

export function getBookTtsProgress(sourceId: string, bookId: string): BookTtsProgress | null {
  return readAll()[generateStorageKey(sourceId, bookId)] || null;
}

export function saveBookTtsProgress(progress: BookTtsProgress) {
  const data = readAll();
  data[generateStorageKey(progress.sourceId, progress.bookId)] = progress;
  writeAll(data);
}

export function deleteBookTtsProgress(sourceId: string, bookId: string) {
  const data = readAll();
  delete data[generateStorageKey(sourceId, bookId)];
  writeAll(data);
}
