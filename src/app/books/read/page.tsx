'use client';

import { BookOpen, ChevronRight, ChevronUp, Gauge, Headphones, Loader2, Moon, Pause, Play, SkipBack, SkipForward, Square, Sun, Volume2, Waves, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { saveBookReadRecord } from '@/lib/book.db.client';
import { BookReadManifest, BookReadRecord, BookTtsProgress, BookTtsVoice } from '@/lib/book.types';
import {
  buildBookCacheKey,
  enforceBookCacheLimit,
  getCachedBookFile,
  putCachedBookFile,
  touchCachedBookFile,
} from '@/lib/book-cache.client';
import { cacheBookDetail, getBookRouteCache } from '@/lib/book-route-cache.client';
import {
  buildBookTtsCacheKey,
  enforceBookTtsCacheLimit,
  getCachedBookTtsChunk,
  putCachedBookTtsChunk,
  touchCachedBookTtsChunk,
} from '@/lib/book-tts-cache.client';
import { getBookTtsProgress, saveBookTtsProgress } from '@/lib/book-tts-progress.client';

declare global {
  interface Window {
    ePub?: (input: string | ArrayBuffer) => EpubBookInstance;
    JSZip?: unknown;
  }
}

interface EpubLocation {
  start?: { cfi?: string; href?: string; displayed?: { chapter?: string } };
  end?: { cfi?: string };
}

interface TocItem {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
}

interface EpubNavigation {
  toc?: TocItem[];
}

interface EpubThemes {
  fontSize?: (value: string) => void;
  default?: (styles: Record<string, Record<string, string>>) => void;
  override?: (name: string, value: string) => void;
}

interface EpubBookInstance {
  renderTo: (element: HTMLElement, options: Record<string, string | boolean>) => EpubRendition;
  locations?: {
    percentageFromCfi?: (cfi: string) => number;
    generate?: (chars?: number) => Promise<void>;
  };
  loaded?: {
    navigation?: Promise<EpubNavigation>;
  };
  navigation?: EpubNavigation;
  ready?: Promise<unknown>;
  destroy?: () => void;
}

interface EpubRendition {
  display: (target?: string) => Promise<void>;
  on: (event: 'relocated', callback: (location: EpubLocation) => void) => void;
  prev?: () => void;
  next?: () => void;
  destroy?: () => void;
  themes?: EpubThemes;
}

type ReaderTheme = 'light' | 'sepia' | 'dark';
type ReaderMode = 'paginated' | 'scrolled';
type FileLoadState = 'preparing' | 'checking-cache' | 'downloading' | 'opening' | 'ready';

interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  mode: ReaderMode;
}

interface TtsChunk {
  index: number;
  text: string;
  start: number;
  end: number;
}

interface TtsSettings {
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  autoPlayNext: boolean;
}

interface ScrolledReadingPosition {
  href: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  updatedAt: number;
}

type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

const SETTINGS_STORAGE_KEY = 'books_epub_reader_settings';
const SCROLLED_POSITION_STORAGE_KEY = 'books_epub_scrolled_positions';
const TTS_SETTINGS_STORAGE_KEY = 'books_epub_tts_settings';
const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 100,
  lineHeight: 1.7,
  theme: 'light',
  mode: 'paginated',
};
const DEFAULT_TTS_SETTINGS: TtsSettings = {
  voice: '',
  rate: '+0%',
  pitch: '+0Hz',
  volume: '+0%',
  autoPlayNext: true,
};
const SAVE_INTERVAL_MS = 10000;
const TTS_RATE_STEPS = [-20, -10, 0, 10, 20, 35];
const TTS_PITCH_STEPS = [-10, 0, 10, 20];
const TTS_VOLUME_STEPS = [-10, 0, 10, 20];

const THEME_STYLES: Record<ReaderTheme, { bodyBg: string; bodyColor: string; panelBg: string }> = {
  light: { bodyBg: '#ffffff', bodyColor: '#111827', panelBg: '#ffffff' },
  sepia: { bodyBg: '#f6efe3', bodyColor: '#5b4636', panelBg: '#f7f1e7' },
  dark: { bodyBg: '#111827', bodyColor: '#e5e7eb', panelBg: '#030712' },
};

function loadTtsSettings(): TtsSettings {
  if (typeof window === 'undefined') return DEFAULT_TTS_SETTINGS;
  try {
    const raw = localStorage.getItem(TTS_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_TTS_SETTINGS;
    return { ...DEFAULT_TTS_SETTINGS, ...(JSON.parse(raw) as Partial<TtsSettings>) };
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

function parseSignedNumber(value: string, _suffix: '%' | 'Hz') {
  const match = value.match(/([+-]?\d+)(?:%|Hz)/);
  if (!match) return 0;
  return Number(match[1] || 0);
}

function formatSignedValue(value: number, suffix: '%' | 'Hz') {
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}

function loadScriptOnce(selector: string, src: string, errorMessage: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(selector) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(errorMessage)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    if (selector.includes('jszip')) script.dataset.jszip = 'true';
    if (selector.includes('epubjs')) script.dataset.epubjs = 'true';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(errorMessage));
    document.body.appendChild(script);
  });
}

async function loadEpubScript() {
  if (window.ePub && window.JSZip) return;
  if (!window.JSZip) {
    await loadScriptOnce('script[data-jszip]', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip 加载失败');
  }
  if (!window.ePub) {
    await loadScriptOnce('script[data-epubjs]', 'https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js', 'epub.js 加载失败');
  }
}

function loadReaderSettings(): ReaderSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}


function buildScrolledPositionKey(sourceId: string, bookId: string, href?: string) {
  return `${sourceId}::${bookId}::${normalizeHrefForMatch(href)}`;
}

function loadScrolledPositions(): Record<string, ScrolledReadingPosition> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SCROLLED_POSITION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ScrolledReadingPosition>) : {};
  } catch {
    return {};
  }
}

function saveScrolledPosition(sourceId: string, bookId: string, position: ScrolledReadingPosition) {
  if (typeof window === 'undefined') return;
  const all = loadScrolledPositions();
  all[buildScrolledPositionKey(sourceId, bookId, position.href)] = position;
  localStorage.setItem(SCROLLED_POSITION_STORAGE_KEY, JSON.stringify(all));
}

function getScrolledPosition(sourceId: string, bookId: string, href?: string): ScrolledReadingPosition | null {
  const all = loadScrolledPositions();
  return all[buildScrolledPositionKey(sourceId, bookId, href)] || null;
}

function getIframeScrollMetrics(viewer: HTMLDivElement | null) {
  if (!viewer) return null;

  const iframe = viewer.querySelector('iframe');
  const doc = iframe?.contentDocument;
  const win = iframe?.contentWindow;

  const elementCandidates = [
    viewer,
    ...Array.from(viewer.querySelectorAll('div')),
  ];

  let bestElement: HTMLDivElement | null = null;
  let bestOverflow = 0;
  for (const candidate of elementCandidates) {
    const el = candidate as HTMLDivElement;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow > bestOverflow + 8) {
      bestOverflow = overflow;
      bestElement = el;
    }
  }

  const root = doc ? (doc.scrollingElement || doc.documentElement || doc.body) : null;
  const rootOverflow = root ? Math.max((root.scrollHeight || 0) - (root.clientHeight || win?.innerHeight || 0), 0) : 0;

  if (root && rootOverflow >= bestOverflow) {
    return {
      iframe,
      root,
      scrollTop: Math.max(0, win?.scrollY || root.scrollTop || 0),
      scrollHeight: Math.max(root.scrollHeight || 0, doc?.body?.scrollHeight || 0),
      clientHeight: root.clientHeight || win?.innerHeight || 0,
      setScrollTop: (value: number) => {
        if (typeof root.scrollTo === 'function') {
          root.scrollTo({ top: value, behavior: 'auto' });
        } else {
          root.scrollTop = value;
        }
      },
      addScrollListener: (listener: () => void) => win?.addEventListener('scroll', listener, { passive: true }),
      removeScrollListener: (listener: () => void) => win?.removeEventListener('scroll', listener),
      interactionTarget: root,
    };
  }

  if (bestElement) {
    const scrollElement = bestElement;
    return {
      iframe,
      root: scrollElement,
      scrollTop: Math.max(0, scrollElement.scrollTop || 0),
      scrollHeight: scrollElement.scrollHeight || 0,
      clientHeight: scrollElement.clientHeight || 0,
      setScrollTop: (value: number) => {
        scrollElement.scrollTo({ top: value, behavior: 'auto' });
      },
      addScrollListener: (listener: () => void) => scrollElement.addEventListener('scroll', listener, { passive: true }),
      removeScrollListener: (listener: () => void) => scrollElement.removeEventListener('scroll', listener),
      interactionTarget: scrollElement,
    };
  }

  return null;
}

function computeScrolledTargetScrollTop(position: ScrolledReadingPosition, currentScrollHeight: number, currentClientHeight: number) {
  const maxSaved = Math.max(0, position.scrollHeight - position.clientHeight);
  const maxCurrent = Math.max(0, currentScrollHeight - currentClientHeight);
  if (maxCurrent <= 0) return 0;
  if (maxSaved <= 0) return Math.min(position.scrollTop, maxCurrent);
  const ratio = Math.max(0, Math.min(1, position.scrollTop / maxSaved));
  return ratio * maxCurrent;
}

function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.subitems || [])]);
}

function tocItemIsActive(item: TocItem, currentHref: string): boolean {
  return isSameTocTarget(currentHref, item.href) || (item.subitems || []).some((subitem) => tocItemIsActive(subitem, currentHref));
}

function findTocLabelByHref(items: TocItem[], currentHref: string): string {
  for (const item of items) {
    if (isSameTocTarget(currentHref, item.href)) return item.label;
    const nested = findTocLabelByHref(item.subitems || [], currentHref);
    if (nested) return nested;
  }
  return '';
}

async function downloadBookWithProgress(
  manifest: Pick<BookReadManifest, 'book' | 'format' | 'acquisitionHref'>,
  onProgress: (received: number, total: number | null) => void
): Promise<Blob> {
  const response = await fetch('/api/books/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceId: manifest.book.sourceId,
      bookId: manifest.book.id,
      format: manifest.format,
      href: manifest.acquisitionHref || undefined,
    }),
    cache: 'force-cache',
  });
  if (!response.ok) throw new Error(`下载电子书失败: ${response.status}`);
  const total = Number(response.headers.get('content-length') || '') || null;
  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size, total);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    const value = result.value;
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(received, total);
    }
  }

  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/epub+zip' });
}


function normalizeHrefForMatch(href?: string) {
  if (!href) return '';
  try {
    const normalized = decodeURIComponent(href).replace(/\\/g, '/').trim();
    return normalized.split('#')[0].split('?')[0].replace(/^\.\//, '').replace(/^\//, '');
  } catch {
    return href.split('#')[0].split('?')[0].replace(/^\.\//, '').replace(/^\//, '').trim();
  }
}

function isSameTocTarget(currentHref?: string, tocHref?: string) {
  const current = normalizeHrefForMatch(currentHref);
  const target = normalizeHrefForMatch(tocHref);
  if (!current || !target) return false;
  return current === target || current.endsWith(target) || target.endsWith(current);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDurationTime(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sanitizeTtsText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function chunkTtsText(text: string, maxChars: number): TtsChunk[] {
  const normalized = sanitizeTtsText(text);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: TtsChunk[] = [];
  let buffer = '';
  let start = 0;
  let cursor = 0;

  const flush = () => {
    const value = buffer.trim();
    if (!value) return;
    chunks.push({
      index: chunks.length,
      text: value,
      start,
      end: start + value.length,
    });
    cursor = start + value.length;
    buffer = '';
    start = cursor;
  };

  const appendPiece = (piece: string) => {
    const trimmed = piece.trim();
    if (!trimmed) return;
    const next = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
    if (next.length <= maxChars) {
      if (!buffer) start = cursor;
      buffer = next;
      cursor += trimmed.length;
      return;
    }

    if (buffer) flush();
    if (trimmed.length <= maxChars) {
      buffer = trimmed;
      start = cursor;
      cursor += trimmed.length;
      return;
    }

    const sentences = trimmed.split(/(?<=[。！？!?；;])/).map((item) => item.trim()).filter(Boolean);
    let local = '';
    let localStart = cursor;
    for (const sentence of sentences) {
      const maybe = local ? `${local}${sentence}` : sentence;
      if (maybe.length <= maxChars) {
        if (!local) localStart = cursor;
        local = maybe;
        cursor += sentence.length;
      } else {
        if (local) {
          chunks.push({ index: chunks.length, text: local, start: localStart, end: localStart + local.length });
          local = '';
        }
        if (sentence.length <= maxChars) {
          local = sentence;
          localStart = cursor;
          cursor += sentence.length;
        } else {
          for (let i = 0; i < sentence.length; i += maxChars) {
            const part = sentence.slice(i, i + maxChars);
            chunks.push({ index: chunks.length, text: part, start: cursor, end: cursor + part.length });
            cursor += part.length;
          }
        }
      }
    }
    if (local) {
      chunks.push({ index: chunks.length, text: local, start: localStart, end: localStart + local.length });
    }
  };

  for (const paragraph of paragraphs) {
    appendPiece(paragraph);
  }
  flush();
  return chunks;
}


function getRenditionOptions(mode: ReaderMode) {
  return mode === 'scrolled'
    ? {
        width: '100%',
        height: '100%',
        spread: 'none',
        manager: 'default',
        flow: 'scrolled-doc',
      }
    : {
        width: '100%',
        height: '100%',
        spread: 'none',
        manager: 'default',
        flow: 'paginated',
      };
}

function decodeBase64Audio(base64: string, mimeType: string) {
  const binary = typeof window === 'undefined' ? '' : window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'audio/mpeg' });
}

export default function BookReadPage() {
  const searchParams = useSearchParams();
  const sourceId = searchParams.get('sourceId') || '';
  const bookId = searchParams.get('bookId') || '';
  const cached = useMemo(() => (sourceId && bookId ? getBookRouteCache(sourceId, bookId) : null), [sourceId, bookId]);
  const [manifest, setManifest] = useState<BookReadManifest | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [fileLoadState, setFileLoadState] = useState<FileLoadState>('preparing');
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [ttsSettings, setTtsSettings] = useState<TtsSettings>(DEFAULT_TTS_SETTINGS);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [currentHref, setCurrentHref] = useState('');
  const [currentChapter, setCurrentChapter] = useState('');
  const [, setProgressPercent] = useState(0);
  const [restoredMessage, setRestoredMessage] = useState('');
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [ttsVoices, setTtsVoices] = useState<BookTtsVoice[]>([]);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<TtsStatus>('idle');
  const [ttsError, setTtsError] = useState('');
  const [ttsChunks, setTtsChunks] = useState<TtsChunk[]>([]);
  const [ttsCurrentChunkIndex, setTtsCurrentChunkIndex] = useState(0);
  const [ttsLoadingChunkIndex, setTtsLoadingChunkIndex] = useState<number | null>(null);
  const [ttsCurrentChapterHref, setTtsCurrentChapterHref] = useState('');
  const [ttsCurrentChapterTitle, setTtsCurrentChapterTitle] = useState('');
  const [ttsBarVisible, setTtsBarVisible] = useState(false);
  const [ttsPanelOpen, setTtsPanelOpen] = useState(false);
  const [ttsCurrentTime, setTtsCurrentTime] = useState(0);
  const [ttsDuration, setTtsDuration] = useState(0);
  const [ttsSeekValue, setTtsSeekValue] = useState(0);
  const [ttsSeeking, setTtsSeeking] = useState(false);
  const [scrolledBottomReached, setScrolledBottomReached] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrolledRestoreRef = useRef<ScrolledReadingPosition | null>(null);
  const restoreTargetRef = useRef<string | undefined>(undefined);
  const scrollListenerCleanupRef = useRef<(() => void) | null>(null);
  const scrolledAutoAdvanceLockRef = useRef(false);
  const scrolledTouchStartYRef = useRef<number | null>(null);
  const scrolledBottomReachedRef = useRef(false);
  const nextChapterHrefRef = useRef('');
  const bindScrolledIframeListenerRef = useRef<() => void>(() => undefined);
  const applyPendingScrolledRestoreRef = useRef<() => void>(() => undefined);
  const tocScrollRef = useRef<HTMLDivElement | null>(null);
  const tocItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const bookRef = useRef<EpubBookInstance | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const pendingRecordRef = useRef<BookReadRecord | null>(null);
  const pendingRecordDirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const lastLocationRef = useRef<EpubLocation | null>(null);
  const settingsRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);
  const lastProgressRef = useRef(0);
  const lastChapterRef = useRef('');
  const locationsReadyRef = useRef(false);
  const tocItemsRef = useRef<TocItem[]>([]);
  const currentHrefRef = useRef('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsChunkAudioUrlRef = useRef<Record<number, string>>({});
  const ttsChunkBlobCacheRef = useRef<Record<number, { url: string; text: string }>>({});
  const ttsChunksRef = useRef<TtsChunk[]>([]);
  const ttsSettingsRef = useRef<TtsSettings>(DEFAULT_TTS_SETTINGS);
  const ttsCurrentChunkIndexRef = useRef(0);
  const ttsCurrentChapterHrefRef = useRef('');
  const ttsCurrentChapterTitleRef = useRef('');
  const ttsStatusRef = useRef<TtsStatus>('idle');
  const ttsSeekingRef = useRef(false);
  const ttsPrefetchedFromChunkRef = useRef<number | null>(null);
  const ttsPrefetchFnRef = useRef<(fromIndex: number) => void>(() => undefined);
  const ttsResumeTimeRef = useRef<number>(0);

  useEffect(() => {
    setSettings(loadReaderSettings());
    setTtsSettings(loadTtsSettings());
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TTS_SETTINGS_STORAGE_KEY, JSON.stringify(ttsSettings));
    }
    ttsSettingsRef.current = ttsSettings;
  }, [ttsSettings]);

  useEffect(() => {
    ttsStatusRef.current = ttsStatus;
  }, [ttsStatus]);

  useEffect(() => {
    currentHrefRef.current = currentHref;
  }, [currentHref]);

  useEffect(() => {
    ttsSeekingRef.current = ttsSeeking;
    if (!ttsSeeking) {
      setTtsSeekValue(ttsCurrentTime);
    }
  }, [ttsCurrentTime, ttsSeeking]);

  useEffect(() => {
    scrolledBottomReachedRef.current = scrolledBottomReached;
  }, [scrolledBottomReached]);


  useEffect(() => {
    const handleToggleSettings = () => {
      setSettingsOpen((prev) => !prev);
      setTocOpen(false);
    };

    window.addEventListener('books-read-toggle-settings', handleToggleSettings);
    return () => {
      window.removeEventListener('books-read-toggle-settings', handleToggleSettings);
    };
  }, []);

  useEffect(() => {
    const handleToggleChapters = () => {
      setTocOpen((prev) => !prev);
      setSettingsOpen(false);
    };

    window.addEventListener('books-read-toggle-chapters', handleToggleChapters);
    return () => {
      window.removeEventListener('books-read-toggle-chapters', handleToggleChapters);
    };
  }, []);

  useEffect(() => {
    const handleToggleTts = () => {
      setTtsBarVisible((prev) => {
        const next = !prev;
        if (!next) {
          setTtsPanelOpen(false);
        }
        return next;
      });
      setSettingsOpen(false);
      setTocOpen(false);
    };

    window.addEventListener('books-read-toggle-tts', handleToggleTts);
    return () => {
      window.removeEventListener('books-read-toggle-tts', handleToggleTts);
    };
  }, []);


  useEffect(() => {
    if (!sourceId || !bookId) return;
    fetch('/api/books/read/manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        bookId,
        href: cached?.detailHref,
        acquisitionHref: cached?.acquisitionHref,
        format: cached?.format || null,
        title: cached?.title,
        author: cached?.author,
        cover: cached?.cover,
        summary: cached?.summary,
      }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '获取阅读信息失败');
        setManifest(json);
        cacheBookDetail(json.book);
      })
      .catch((err) => setError(err.message || '获取阅读信息失败'));
  }, [sourceId, bookId, cached]);

  useEffect(() => {
    if (!manifest || manifest.format !== 'epub') return;
    let cancelled = false;
    fetch('/api/books/tts/voices')
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '获取朗读配置失败');
        if (cancelled) return;
        setTtsAvailable(true);
        setTtsVoices(json.voices || []);
        setTtsSettings((prev) => ({
          ...prev,
          voice: prev.voice || json.defaults?.voice || '',
          rate: prev.rate || json.defaults?.rate || '+0%',
          pitch: prev.pitch || json.defaults?.pitch || '+0Hz',
          volume: prev.volume || json.defaults?.volume || '+0%',
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setTtsAvailable(false);
        setTtsVoices([]);
        setTtsError(err.message || '朗读能力不可用');
      });
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  const buildReadRecord = useCallback((location: EpubLocation, nextProgress = 0, chapterTitle?: string): BookReadRecord | null => {
    if (!manifest) return null;
    const locatorValue = location?.start?.cfi || location?.end?.cfi || '';
    if (!locatorValue) return null;
    return {
      sourceId: manifest.book.sourceId,
      sourceName: manifest.book.sourceName,
      bookId: manifest.book.id,
      title: manifest.book.title,
      author: manifest.book.author,
      cover: manifest.book.cover,
      detailHref: manifest.book.detailHref,
      acquisitionHref: manifest.acquisitionHref,
      format: manifest.format,
      locator: {
        type: 'epub-cfi',
        value: locatorValue,
        href: location?.start?.href,
        chapterTitle,
      },
      chapterTitle,
      chapterHref: location?.start?.href,
      progressPercent: nextProgress,
      saveTime: Date.now(),
    };
  }, [manifest]);

  const queueReadRecord = useCallback((location: EpubLocation, nextProgress = 0, chapterTitle?: string) => {
    const record = buildReadRecord(location, nextProgress, chapterTitle);
    if (!record) return;
    pendingRecordRef.current = record;
    pendingRecordDirtyRef.current = true;
  }, [buildReadRecord]);

  const flushPendingReadRecord = useCallback(async () => {
    const record = pendingRecordRef.current;
    if (!record || !pendingRecordDirtyRef.current || saveInFlightRef.current) return;

    saveInFlightRef.current = true;
    try {
      await saveBookReadRecord(record.sourceId, record.bookId, {
        ...record,
        saveTime: Date.now(),
      });
      pendingRecordRef.current = { ...record, saveTime: Date.now() };
      pendingRecordDirtyRef.current = false;
    } catch {
      // ignore
    } finally {
      saveInFlightRef.current = false;
    }
  }, []);


  const persistScrolledPosition = useCallback((fallbackHref?: string) => {
    if (!manifest || settingsRef.current.mode !== 'scrolled') return;
    const metrics = getIframeScrollMetrics(viewerRef.current);
    const href = fallbackHref || currentHrefRef.current || lastLocationRef.current?.start?.href || '';
    if (!metrics || !href) return;
    saveScrolledPosition(manifest.book.sourceId, manifest.book.id, {
      href,
      scrollTop: metrics.scrollTop,
      scrollHeight: metrics.scrollHeight,
      clientHeight: metrics.clientHeight,
      updatedAt: Date.now(),
    });
  }, [manifest]);


  const applyPendingScrolledRestore = useCallback(() => {
    if (settingsRef.current.mode !== 'scrolled') return;
    const pending = pendingScrolledRestoreRef.current;
    if (!pending) return;
    const metrics = getIframeScrollMetrics(viewerRef.current);
    if (!metrics) return;
    const currentHrefValue = lastLocationRef.current?.start?.href || currentHrefRef.current;
    if (!currentHrefValue || !isSameTocTarget(currentHrefValue, pending.href)) return;
    const targetScrollTop = computeScrolledTargetScrollTop(pending, metrics.scrollHeight, metrics.clientHeight);
    metrics.setScrollTop(targetScrollTop);
    pendingScrolledRestoreRef.current = null;
  }, []);






  useEffect(() => {
    applyPendingScrolledRestoreRef.current = applyPendingScrolledRestore;
  }, [applyPendingScrolledRestore]);

  const persistCurrentProgress = useCallback(() => {
    if (lastLocationRef.current) {
      queueReadRecord(lastLocationRef.current, lastProgressRef.current, lastChapterRef.current);
    }
    persistScrolledPosition();
    void flushPendingReadRecord();
  }, [queueReadRecord, persistScrolledPosition, flushPendingReadRecord]);

  const applyReaderTheme = useCallback((nextSettings: ReaderSettings) => {
    const rendition = renditionRef.current;
    if (!rendition?.themes) return;
    const palette = THEME_STYLES[nextSettings.theme];
    rendition.themes.default?.({
      body: {
        'background-color': palette.bodyBg,
        color: palette.bodyColor,
        'font-size': `${nextSettings.fontSize}%`,
        'line-height': String(nextSettings.lineHeight),
        'padding-left': '6px',
        'padding-right': '6px',
      },
      p: { color: palette.bodyColor },
      a: { color: nextSettings.theme === 'dark' ? '#93c5fd' : '#2563eb' },
    });
    rendition.themes.fontSize?.(`${nextSettings.fontSize}%`);
    rendition.themes.override?.('line-height', String(nextSettings.lineHeight));
  }, []);

  useEffect(() => {
    applyReaderTheme(settings);
  }, [settings, applyReaderTheme]);

  const navigateToTarget = useCallback(async (target?: string) => {
    if (!renditionRef.current) return;
    await renditionRef.current.display(target);
  }, []);

  const handleReaderTap = useCallback((zone: 'left' | 'center' | 'right') => {
    if (!ready) return;
    if (settings.mode === 'paginated' && zone === 'left') {
      renditionRef.current?.prev?.();
      return;
    }
    if (settings.mode === 'paginated' && zone === 'right') {
      renditionRef.current?.next?.();
      return;
    }
    setTocOpen(false);
    setSettingsOpen(false);
  }, [ready, settings.mode]);

  const cleanupTtsAudioUrls = useCallback(() => {
    Object.values(ttsChunkBlobCacheRef.current).forEach((item) => URL.revokeObjectURL(item.url));
    ttsChunkBlobCacheRef.current = {};
    ttsChunkAudioUrlRef.current = {};
  }, []);

  const stopTts = useCallback((clearQueue = false) => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setTtsCurrentTime(0);
    setTtsDuration(0);
    setTtsSeekValue(0);
    setTtsSeeking(false);
    ttsPrefetchedFromChunkRef.current = null;
    setTtsLoadingChunkIndex(null);
    setTtsStatus('idle');
    if (clearQueue) {
      setTtsChunks([]);
      ttsChunksRef.current = [];
      setTtsCurrentChunkIndex(0);
      ttsCurrentChunkIndexRef.current = 0;
      setTtsCurrentChapterHref('');
      ttsCurrentChapterHrefRef.current = '';
      setTtsCurrentChapterTitle('');
      ttsCurrentChapterTitleRef.current = '';
      cleanupTtsAudioUrls();
    }
  }, [cleanupTtsAudioUrls]);

  const persistTtsProgress = useCallback((chunkIndex?: number) => {
    if (!manifest) return;
    const chunks = ttsChunksRef.current;
    const currentIndex = chunkIndex ?? ttsCurrentChunkIndexRef.current;
    const chunk = chunks[currentIndex];
    if (!chunk || !ttsCurrentChapterHrefRef.current || !ttsSettingsRef.current.voice) return;
    const progress: BookTtsProgress = {
      sourceId: manifest.book.sourceId,
      bookId: manifest.book.id,
      chapterHref: ttsCurrentChapterHrefRef.current,
      chapterTitle: ttsCurrentChapterTitleRef.current || currentChapter,
      chunkIndex: currentIndex,
      charOffset: chunk.start,
      currentTimeSec: audioRef.current?.currentTime || 0,
      voice: ttsSettingsRef.current.voice,
      rate: ttsSettingsRef.current.rate,
      pitch: ttsSettingsRef.current.pitch,
      volume: ttsSettingsRef.current.volume,
      saveTime: Date.now(),
    };
    saveBookTtsProgress(progress);
  }, [manifest, currentChapter]);

  const getCurrentSpineDocumentText = useCallback(() => {
    const iframe = viewerRef.current?.querySelector('iframe');
    const doc = iframe?.contentDocument;
    const text = doc?.body?.innerText || doc?.documentElement?.textContent || '';
    return sanitizeTtsText(text);
  }, []);

  const fetchTtsChunkAudioUrl = useCallback(async (chunk: TtsChunk, chapterHref: string) => {
    const cached = ttsChunkBlobCacheRef.current[chunk.index];
    if (cached?.text === chunk.text) return cached.url;
    if (!manifest) throw new Error('书籍信息未准备好');
    const { cacheKey, textHash } = await buildBookTtsCacheKey({
      sourceId: manifest.book.sourceId,
      bookId: manifest.book.id,
      chapterHref,
      chunkIndex: chunk.index,
      text: chunk.text,
      voice: ttsSettingsRef.current.voice,
      rate: ttsSettingsRef.current.rate,
      pitch: ttsSettingsRef.current.pitch,
      volume: ttsSettingsRef.current.volume,
    });

    const persisted = await getCachedBookTtsChunk(cacheKey).catch(() => null);
    if (persisted?.audioBlob) {
      const url = URL.createObjectURL(persisted.audioBlob);
      ttsChunkBlobCacheRef.current[chunk.index] = { url, text: chunk.text };
      ttsChunkAudioUrlRef.current[chunk.index] = url;
      void touchCachedBookTtsChunk(cacheKey).catch(() => undefined);
      return url;
    }

    const response = await fetch('/api/books/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId: manifest.book.sourceId,
        bookId: manifest.book.id,
        chapterHref,
        text: chunk.text,
        voice: ttsSettingsRef.current.voice,
        rate: ttsSettingsRef.current.rate,
        pitch: ttsSettingsRef.current.pitch,
        volume: ttsSettingsRef.current.volume,
      }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || '朗读音频生成失败');
    const blob = decodeBase64Audio(json.audioBase64 || '', json.mimeType || 'audio/mpeg');
    const url = URL.createObjectURL(blob);
    if (cached?.url) URL.revokeObjectURL(cached.url);
    ttsChunkBlobCacheRef.current[chunk.index] = { url, text: chunk.text };
    ttsChunkAudioUrlRef.current[chunk.index] = url;
    void putCachedBookTtsChunk({
      cacheKey,
      sourceId: manifest.book.sourceId,
      bookId: manifest.book.id,
      chapterHref,
      chunkIndex: chunk.index,
      textHash,
      voice: ttsSettingsRef.current.voice,
      rate: ttsSettingsRef.current.rate,
      pitch: ttsSettingsRef.current.pitch,
      volume: ttsSettingsRef.current.volume,
      textPreview: chunk.text.slice(0, 80),
      mimeType: json.mimeType || 'audio/mpeg',
      audioBlob: blob,
      size: blob.size,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
    })
      .then(() => enforceBookTtsCacheLimit())
      .catch(() => undefined);
    return url;
  }, [manifest]);

  const prefetchTtsChunks = useCallback((fromIndex: number) => {
    const chunks = ttsChunksRef.current;
    const chapterHref = ttsCurrentChapterHrefRef.current;
    if (!ttsSettingsRef.current.autoPlayNext || !chapterHref) return;
    if (ttsPrefetchedFromChunkRef.current === fromIndex) return;
    const nextIndex = fromIndex + 1;
    if (nextIndex >= chunks.length) return;
    ttsPrefetchedFromChunkRef.current = fromIndex;
    void fetchTtsChunkAudioUrl(chunks[nextIndex], chapterHref).catch(() => undefined);
  }, [fetchTtsChunkAudioUrl]);

  useEffect(() => {
    ttsPrefetchFnRef.current = prefetchTtsChunks;
  }, [prefetchTtsChunks]);

  const playTtsChunk = useCallback(async (index: number) => {
    const chunks = ttsChunksRef.current;
    const chunk = chunks[index];
    const chapterHref = ttsCurrentChapterHrefRef.current;
    if (!chunk || !chapterHref || !manifest) return;
    try {
      setTtsError('');
      setTtsLoadingChunkIndex(index);
      setTtsStatus('loading');
      const url = await fetchTtsChunkAudioUrl(chunk, chapterHref);
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      audioRef.current.src = url;
      ttsResumeTimeRef.current = 0;
      const saved = getBookTtsProgress(manifest.book.sourceId, manifest.book.id);
      if (saved?.chapterHref === chapterHref && saved.chunkIndex === index) {
        ttsResumeTimeRef.current = saved.currentTimeSec || 0;
      }
      await audioRef.current.play();
      ttsCurrentChunkIndexRef.current = index;
      setTtsCurrentChunkIndex(index);
      setTtsStatus('playing');
      setTtsLoadingChunkIndex(null);
      persistTtsProgress(index);
    } catch (error) {
      setTtsStatus('error');
      setTtsLoadingChunkIndex(null);
      setTtsError((error as Error).message || '朗读失败');
    }
  }, [fetchTtsChunkAudioUrl, manifest, persistTtsProgress]);

  const bootstrapTtsForCurrentChapter = useCallback(async (resume = true) => {
    if (!manifest || manifest.format !== 'epub') return;
    const chapterHref = currentHref || manifest.lastRecord?.chapterHref || '';
    const chapterTitle = findTocLabelByHref(tocItemsRef.current, chapterHref) || currentChapter || manifest.book.title;
    if (!chapterHref) {
      setTtsError('当前章节尚未定位，稍后再试');
      setTtsStatus('error');
      return;
    }
    const text = getCurrentSpineDocumentText();
    if (!text) {
      setTtsError('当前章节暂未提取到可朗读文本');
      setTtsStatus('error');
      return;
    }
    cleanupTtsAudioUrls();
    const chunks = chunkTtsText(text, 1200);
    if (chunks.length === 0) {
      setTtsError('当前章节没有可朗读内容');
      setTtsStatus('error');
      return;
    }
    const saved = resume ? getBookTtsProgress(manifest.book.sourceId, manifest.book.id) : null;
    const startIndex = saved?.chapterHref === chapterHref ? Math.min(saved.chunkIndex, chunks.length - 1) : 0;
    setTtsChunks(chunks);
    ttsChunksRef.current = chunks;
    setTtsCurrentChunkIndex(startIndex);
    ttsCurrentChunkIndexRef.current = startIndex;
    setTtsCurrentChapterHref(chapterHref);
    ttsCurrentChapterHrefRef.current = chapterHref;
    setTtsCurrentChapterTitle(chapterTitle);
    ttsCurrentChapterTitleRef.current = chapterTitle;
    await playTtsChunk(startIndex);
  }, [cleanupTtsAudioUrls, currentChapter, currentHref, getCurrentSpineDocumentText, manifest, playTtsChunk]);

  const toggleTtsPlayback = useCallback(async () => {
    if (!ttsAvailable) return;
    if (ttsStatus === 'playing') {
      audioRef.current?.pause();
      setTtsStatus('paused');
      persistTtsProgress();
      return;
    }
    if (ttsStatus === 'paused' && audioRef.current) {
      try {
        await audioRef.current.play();
        setTtsStatus('playing');
      } catch (error) {
        setTtsStatus('error');
        setTtsError((error as Error).message || '恢复播放失败');
      }
      return;
    }
    await bootstrapTtsForCurrentChapter(true);
  }, [bootstrapTtsForCurrentChapter, persistTtsProgress, ttsAvailable, ttsStatus]);






  useEffect(() => {
    if (!manifest || manifest.format !== 'epub' || !viewerRef.current) return;
    let destroyed = false;
    const currentSessionCfi = lastLocationRef.current?.start?.cfi || undefined;
    const currentSessionHref = currentHrefRef.current || lastLocationRef.current?.start?.href || undefined;

    setReady(false);
    setRestoredMessage('');
    locationsReadyRef.current = false;
    lastLocationRef.current = null;
    setProgressPercent(manifest.lastRecord?.progressPercent || 0);
    setCurrentChapter(manifest.lastRecord?.chapterTitle || manifest.lastRecord?.locator?.chapterTitle || '');
    setFileLoadState('checking-cache');
    setDownloadedBytes(0);
    setTotalBytes(null);
    setCacheHit(false);

    const initialScrolledHref = currentSessionHref || manifest.lastRecord?.chapterHref || manifest.lastRecord?.locator?.href || undefined;
    const cachedScrolledPosition = initialScrolledHref ? getScrolledPosition(manifest.book.sourceId, manifest.book.id, initialScrolledHref) : null;
    pendingScrolledRestoreRef.current = settings.mode === 'scrolled' && !currentSessionHref ? cachedScrolledPosition : null;
    restoreTargetRef.current = settings.mode === 'scrolled'
      ? (initialScrolledHref || cachedScrolledPosition?.href || undefined)
      : (currentSessionCfi || manifest.lastRecord?.locator?.value || undefined);

    loadEpubScript()
      .then(async () => {
        if (!window.ePub || destroyed || !viewerRef.current) return;

        const cacheKey = manifest.cacheKey || buildBookCacheKey(
          manifest.book.sourceId,
          manifest.book.id,
          manifest.acquisitionHref || `${manifest.book.sourceId}:${manifest.book.id}:${manifest.format}`
        );

        let fileBuffer: ArrayBuffer;
        const cached = await getCachedBookFile(cacheKey).catch(() => null);
        if (cached) {
          setCacheHit(true);
          setFileLoadState('opening');
          setDownloadedBytes(cached.size);
          setTotalBytes(cached.size);
          await touchCachedBookFile(cacheKey).catch(() => undefined);
          fileBuffer = await cached.blob.arrayBuffer();
        } else {
          setFileLoadState('downloading');
          const blob = await downloadBookWithProgress(manifest, (received, total) => {
            if (!destroyed) {
              setDownloadedBytes(received);
              setTotalBytes(total);
            }
          });
          fileBuffer = await blob.arrayBuffer();
          await putCachedBookFile({
            key: cacheKey,
            sourceId: manifest.book.sourceId,
            bookId: manifest.book.id,
            title: manifest.book.title,
            format: manifest.format,
            acquisitionHref: manifest.acquisitionHref || `${manifest.book.sourceId}:${manifest.book.id}:${manifest.format}`,
            blob,
            size: blob.size,
            mimeType: blob.type || 'application/epub+zip',
            updatedAt: Date.now(),
            lastOpenTime: Date.now(),
          }).catch(() => undefined);
          await enforceBookCacheLimit().catch(() => undefined);
          if (destroyed) return;
          setFileLoadState('opening');
        }

        if (destroyed) return;
        const book = window.ePub(fileBuffer);
        const readyFallbackTimer = window.setTimeout(() => {
          if (!destroyed) {
            setReady(true);
            setFileLoadState('ready');
          }
        }, 4000);

        const rendition = book.renderTo(viewerRef.current, getRenditionOptions(settings.mode));
        bookRef.current = book;
        renditionRef.current = rendition;
        applyReaderTheme(settingsRef.current);

        const restoreTarget = restoreTargetRef.current;
        let restoreMessageShown = false;

        rendition.on('relocated', (location: EpubLocation) => {
          if (!destroyed) {
            window.clearTimeout(readyFallbackTimer);
            setReady(true);
            setFileLoadState('ready');
          }
          if (restoreTarget && !restoreMessageShown) {
            restoreMessageShown = true;
            setRestoredMessage(`已恢复到上次阅读位置（约 ${Math.round(manifest.lastRecord?.progressPercent || 0)}%）`);
            window.setTimeout(() => setRestoredMessage(''), 3000);
          }
          lastLocationRef.current = location;
          scrolledAutoAdvanceLockRef.current = false;
          setScrolledBottomReached(false);
          window.requestAnimationFrame(() => {
            bindScrolledIframeListenerRef.current();
            applyPendingScrolledRestoreRef.current();
          });
          const hrefLabel = location?.start?.href ? findTocLabelByHref(tocItemsRef.current, location.start.href) : '';
          const chapterTitle = hrefLabel || location?.start?.displayed?.chapter || location?.start?.href || manifest.book.title;
          const cfi = location?.start?.cfi || '';
          const computedProgress = locationsReadyRef.current && cfi
            ? Math.max(0, Math.min(100, (book.locations?.percentageFromCfi?.(cfi) || 0) * 100))
            : null;
          const normalizedProgress = computedProgress ?? lastProgressRef.current ?? manifest.lastRecord?.progressPercent ?? 0;
          setProgressPercent(normalizedProgress);
          setCurrentChapter(chapterTitle);
          setCurrentHref(location?.start?.href || '');
          lastProgressRef.current = normalizedProgress;
          lastChapterRef.current = chapterTitle;
          queueReadRecord(location, normalizedProgress, chapterTitle);
        });

        void navigateToTarget(restoreTarget).catch(() => {
          if (!destroyed) {
            setReady(true);
            setFileLoadState('ready');
          }
        });

        void (async () => {
          try {
            const navigation = (await book.loaded?.navigation) || book.navigation;
            if (!destroyed) setTocItems(navigation?.toc || []);
          } catch {
            if (!destroyed) setTocItems(book.navigation?.toc || []);
          }
        })();

        void (async () => {
          try {
            await book.ready;
            await book.locations?.generate?.(480);
            locationsReadyRef.current = true;
            if (lastLocationRef.current?.start?.cfi) {
              const recomputed = book.locations?.percentageFromCfi?.(lastLocationRef.current.start.cfi) || 0;
              const nextProgress = Math.max(0, Math.min(100, recomputed * 100));
              setProgressPercent(nextProgress);
              lastProgressRef.current = nextProgress;
            }
          } catch {
            // ignore
          }
        })();
      })
      .catch((err) => {
        setReady(false);
        setError(err.message || '初始化 EPUB 阅读器失败');
      });

    return () => {
      destroyed = true;
      scrollListenerCleanupRef.current?.();
      scrollListenerCleanupRef.current = null;
      persistCurrentProgress();
      renditionRef.current?.destroy?.();
      bookRef.current?.destroy?.();
    };
  }, [manifest, settings.mode, applyReaderTheme, persistCurrentProgress, queueReadRecord, navigateToTarget]);

  useEffect(() => {
    const flushPendingReadRecordOnLeave = () => {
      if (!pendingRecordDirtyRef.current || saveInFlightRef.current) return;
      persistCurrentProgress();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingReadRecordOnLeave();
      }
    };

    const intervalId = window.setInterval(() => {
      void flushPendingReadRecord();
    }, SAVE_INTERVAL_MS);
    window.addEventListener('pagehide', flushPendingReadRecordOnLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pagehide', flushPendingReadRecordOnLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushPendingReadRecord, persistCurrentProgress]);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;
    const handleEnded = () => {
      setTtsCurrentTime(0);
      setTtsSeekValue(0);
      const nextIndex = ttsCurrentChunkIndexRef.current + 1;
      if (nextIndex < ttsChunksRef.current.length) {
        void playTtsChunk(nextIndex);
        return;
      }
      setTtsStatus('idle');
      persistTtsProgress(ttsCurrentChunkIndexRef.current);
    };
    const handlePause = () => {
      if (!audio.ended && ttsStatusRef.current === 'playing') {
        setTtsStatus('paused');
      }
    };
    const handleTimeUpdate = () => {
      const nextTime = audio.currentTime || 0;
      const nextDuration = audio.duration || 0;
      setTtsCurrentTime(nextTime);
      setTtsDuration(nextDuration);
      if (nextDuration > 0 && nextTime / nextDuration >= 0.6) {
        ttsPrefetchFnRef.current(ttsCurrentChunkIndexRef.current);
      }
      if (!ttsSeekingRef.current) {
        setTtsSeekValue(nextTime);
      }
    };
    const handleLoadedMetadata = () => {
      const nextDuration = audio.duration || 0;
      if (ttsResumeTimeRef.current > 0 && nextDuration > 0) {
        audio.currentTime = Math.min(ttsResumeTimeRef.current, Math.max(0, nextDuration - 0.25));
        ttsResumeTimeRef.current = 0;
      }
      setTtsDuration(nextDuration);
      if (!ttsSeekingRef.current) {
        setTtsSeekValue(audio.currentTime || 0);
      }
    };
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      persistTtsProgress();
      stopTts(true);
    };
  }, [persistTtsProgress, playTtsChunk, stopTts]);

  useEffect(() => {
    ttsChunksRef.current = ttsChunks;
  }, [ttsChunks]);

  useEffect(() => {
    ttsCurrentChunkIndexRef.current = ttsCurrentChunkIndex;
  }, [ttsCurrentChunkIndex]);

  useEffect(() => {
    ttsCurrentChapterHrefRef.current = ttsCurrentChapterHref;
  }, [ttsCurrentChapterHref]);

  useEffect(() => {
    ttsCurrentChapterTitleRef.current = ttsCurrentChapterTitle;
  }, [ttsCurrentChapterTitle]);

  useEffect(() => {
    if (!ttsCurrentChapterHref || !currentHref) return;
    if (!isSameTocTarget(ttsCurrentChapterHref, currentHref)) {
      stopTts(true);
    }
  }, [currentHref, stopTts, ttsCurrentChapterHref]);



  useEffect(() => {
    if (!manifest || manifest.format !== 'pdf') return;
    let revokedUrl = '';
    let cancelled = false;
    setFileLoadState('downloading');
    setDownloadedBytes(0);
    setTotalBytes(null);
    setPdfBlobUrl('');

    downloadBookWithProgress(manifest, (received, total) => {
      if (!cancelled) {
        setDownloadedBytes(received);
        setTotalBytes(total);
      }
    })
      .then(async (blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        revokedUrl = objectUrl;
        setPdfBlobUrl(objectUrl);
        setFileLoadState('ready');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'PDF 加载失败');
      });

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [manifest]);


  useEffect(() => {
    tocItemsRef.current = tocItems;
  }, [tocItems]);

  const flatToc = useMemo(() => flattenToc(tocItems), [tocItems]);
  const activeTocHref = useMemo(
    () => flatToc.find((item) => isSameTocTarget(currentHref, item.href))?.href || '',
    [flatToc, currentHref]
  );

  const currentTocLabel = useMemo(() => findTocLabelByHref(tocItems, currentHref), [tocItems, currentHref]);

  useEffect(() => {
    if (!manifest) return;
    window.dispatchEvent(new CustomEvent('books-read-update-header', {
      detail: {
        title: manifest.book.title,
        subtitle: currentTocLabel || currentChapter || manifest.book.author || (settings.mode === 'scrolled' ? '滚动阅读' : '分页阅读'),
        backHref: `/books/detail?sourceId=${encodeURIComponent(manifest.book.sourceId)}&bookId=${encodeURIComponent(manifest.book.id)}`,
      },
    }));
  }, [manifest, currentChapter, currentTocLabel, settings.mode]);

  useEffect(() => {
    if (!tocOpen || !activeTocHref) return;
    const activeNode = tocItemRefs.current[activeTocHref];
    if (!activeNode) return;
    activeNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [tocOpen, activeTocHref]);
  const nextChapterHref = useMemo(() => {
    const index = flatToc.findIndex((item) => isSameTocTarget(currentHref, item.href));
    if (index < 0) return flatToc[0]?.href || '';
    return flatToc[index + 1]?.href || '';
  }, [flatToc, currentHref]);

  useEffect(() => {
    nextChapterHrefRef.current = nextChapterHref;
  }, [nextChapterHref]);

  const goToNextChapter = useCallback(() => {
    if (!nextChapterHref) return;
    persistScrolledPosition();
    pendingScrolledRestoreRef.current = {
      href: nextChapterHref,
      scrollTop: 0,
      scrollHeight: 1,
      clientHeight: 1,
      updatedAt: Date.now(),
    };
    restoreTargetRef.current = nextChapterHref;
    scrolledAutoAdvanceLockRef.current = true;
    setScrolledBottomReached(false);
    void navigateToTarget(nextChapterHref);
  }, [nextChapterHref, navigateToTarget, persistScrolledPosition]);
  const bindScrolledIframeListener = useCallback(() => {
    scrollListenerCleanupRef.current?.();
    scrollListenerCleanupRef.current = null;
    if (settingsRef.current.mode !== 'scrolled') return;

    let retryTimer = 0;
    let rafId = 0;

    const attach = () => {
      const metrics = getIframeScrollMetrics(viewerRef.current);
      if (!metrics) {
        retryTimer = window.setTimeout(attach, 120);
        return;
      }

      const isAtBottom = () => {
        const latestMetrics = getIframeScrollMetrics(viewerRef.current);
        if (!latestMetrics) return false;
        const distanceToBottom = latestMetrics.scrollHeight - latestMetrics.clientHeight - latestMetrics.scrollTop;
        return distanceToBottom <= 36;
      };

      const setBottomReached = (value: boolean) => {
        if (scrolledBottomReachedRef.current === value) return;
        scrolledBottomReachedRef.current = value;
        setScrolledBottomReached(value);
      };

      const handleAdvanceIntent = () => {
        if (!nextChapterHrefRef.current) return;
        if (!isAtBottom()) return;
        if (!scrolledBottomReachedRef.current) {
          setBottomReached(true);
          return;
        }
        if (scrolledAutoAdvanceLockRef.current) return;
        goToNextChapter();
      };

      const handleScroll = () => {
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(() => {
          const latestMetrics = getIframeScrollMetrics(viewerRef.current);
          if (!latestMetrics) return;
          persistScrolledPosition();
          const distanceToBottom = latestMetrics.scrollHeight - latestMetrics.clientHeight - latestMetrics.scrollTop;
          if (distanceToBottom <= 36) {
            setBottomReached(true);
            scrolledAutoAdvanceLockRef.current = false;
            return;
          }
          setBottomReached(false);
          scrolledAutoAdvanceLockRef.current = false;
        });
      };

      const handleWheel = (event: Event) => {
        const wheel = event as WheelEvent;
        if (wheel.deltaY > 24) handleAdvanceIntent();
      };

      const handleTouchStart = (event: Event) => {
        const touch = (event as TouchEvent).touches[0];
        scrolledTouchStartYRef.current = touch?.clientY ?? null;
      };

      const handleTouchMove = (event: Event) => {
        const touch = (event as TouchEvent).touches[0];
        const startY = scrolledTouchStartYRef.current;
        if (touch && startY !== null && startY - touch.clientY > 28) {
          handleAdvanceIntent();
          scrolledTouchStartYRef.current = touch.clientY;
        }
      };

      const handleTouchEnd = () => {
        scrolledTouchStartYRef.current = null;
      };

      metrics.addScrollListener(handleScroll);
      metrics.interactionTarget?.addEventListener('wheel', handleWheel, { passive: true });
      metrics.interactionTarget?.addEventListener('touchstart', handleTouchStart, { passive: true });
      metrics.interactionTarget?.addEventListener('touchmove', handleTouchMove, { passive: true });
      metrics.interactionTarget?.addEventListener('touchend', handleTouchEnd, { passive: true });
      viewerRef.current?.addEventListener('wheel', handleWheel, { passive: true });
      viewerRef.current?.addEventListener('touchstart', handleTouchStart, { passive: true });
      viewerRef.current?.addEventListener('touchmove', handleTouchMove, { passive: true });
      viewerRef.current?.addEventListener('touchend', handleTouchEnd, { passive: true });
      handleScroll();
      scrollListenerCleanupRef.current = () => {
        if (retryTimer) window.clearTimeout(retryTimer);
        if (rafId) window.cancelAnimationFrame(rafId);
        metrics.removeScrollListener(handleScroll);
        metrics.interactionTarget?.removeEventListener('wheel', handleWheel);
        metrics.interactionTarget?.removeEventListener('touchstart', handleTouchStart);
        metrics.interactionTarget?.removeEventListener('touchmove', handleTouchMove);
        metrics.interactionTarget?.removeEventListener('touchend', handleTouchEnd);
        viewerRef.current?.removeEventListener('wheel', handleWheel);
        viewerRef.current?.removeEventListener('touchstart', handleTouchStart);
        viewerRef.current?.removeEventListener('touchmove', handleTouchMove);
        viewerRef.current?.removeEventListener('touchend', handleTouchEnd);
      };
    };

    attach();
  }, [goToNextChapter, persistScrolledPosition]);


  useEffect(() => {
    bindScrolledIframeListenerRef.current = bindScrolledIframeListener;
  }, [bindScrolledIframeListener]);

  const renderTocItems = useCallback((items: TocItem[], depth = 0) => items.map((item) => {
    const active = tocItemIsActive(item, currentHref);
    const clickable = !!item.href;
    return (
      <div key={`${item.href || item.label}-${depth}`} className='space-y-2'>
        <button
          ref={(node) => {
            if (item.href) tocItemRefs.current[item.href] = node;
          }}
          onClick={() => {
            if (!clickable) return;
            persistScrolledPosition();
            pendingScrolledRestoreRef.current = {
              href: item.href,
              scrollTop: 0,
              scrollHeight: 1,
              clientHeight: 1,
              updatedAt: Date.now(),
            };
            restoreTargetRef.current = item.href;
            void navigateToTarget(item.href);
            setTocOpen(false);
          }}
          disabled={!clickable}
          className={`group relative block w-full rounded-2xl px-4 py-3 text-left text-sm transition ${active ? 'bg-sky-600 text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900'} ${!clickable ? 'cursor-default opacity-80' : ''}`}
          style={{ paddingLeft: `${16 + depth * 14}px` }}
        >
          <span className='block truncate'>{item.label}</span>
          <div className='pointer-events-none absolute bottom-full left-1/2 z-[100] mb-2 -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-white opacity-0 invisible shadow-xl transition-all duration-200 ease-out group-hover:visible group-hover:opacity-100 dark:bg-gray-900 whitespace-nowrap'>
            <div className='text-sm'>{item.label}</div>
          </div>
        </button>
        {item.subitems?.length ? renderTocItems(item.subitems, depth + 1) : null}
      </div>
    );
  }), [currentHref, navigateToTarget, persistScrolledPosition]);



  const showScrolledNextChapter = ready && settings.mode === 'scrolled' && !tocOpen && !settingsOpen && scrolledBottomReached && !!nextChapterHref;

  const progressLabel = totalBytes ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}` : formatBytes(downloadedBytes);
  const ttsChunkPercent = ttsChunks.length > 0 ? ((ttsCurrentChunkIndex + 1) / ttsChunks.length) * 100 : 0;
  const selectedVoice = ttsVoices.find((item) => item.shortName === ttsSettings.voice);
  const currentChunk = ttsChunks[ttsCurrentChunkIndex];
  const ttsRateValue = parseSignedNumber(ttsSettings.rate, '%');
  const ttsPitchValue = parseSignedNumber(ttsSettings.pitch, 'Hz');
  const ttsVolumeValue = parseSignedNumber(ttsSettings.volume, '%');
  const displayedTtsTime = ttsSeeking ? ttsSeekValue : ttsCurrentTime;

  if (error) return <div className='p-4 text-sm text-red-500'>{error}</div>;
  if (!manifest) {
    return (
      <div className='flex h-[calc(100vh-3.5rem)] items-center justify-center bg-white px-4 dark:bg-gray-950'>
        <div className='flex flex-col items-center gap-4 text-center'>
          <div className='reader-book-loader'>
            <BookOpen className='h-10 w-10' strokeWidth={1.75} />
          </div>
          <div className='text-sm text-gray-500 dark:text-gray-400'>准备阅读器中...</div>
        </div>
      </div>
    );
  }

  if (manifest.format === 'pdf') {
    if (!pdfBlobUrl) return <div className='p-4 text-sm text-gray-500'>PDF 加载中... {progressLabel}</div>;
    return <iframe src={pdfBlobUrl} className='h-[calc(100vh-4rem)] w-full bg-white' title={manifest.book.title} />;
  }

  return (
    <div className='flex h-[calc(100vh-3.5rem)] flex-col bg-white dark:bg-gray-950'>
      {restoredMessage ? (
        <div className='absolute left-1/2 top-[4.5rem] z-30 -translate-x-1/2 rounded-full bg-sky-600 px-4 py-2 text-xs text-white shadow-lg'>
          {restoredMessage}
        </div>
      ) : null}

      {!ready ? (
        <div className='absolute inset-x-0 top-[3.5rem] z-10 p-4'>
          <div className='mx-auto max-w-3xl space-y-4'>
            <div className='space-y-2 rounded-3xl border border-gray-200 bg-white/90 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950/90'>
              <div className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                {fileLoadState === 'checking-cache'
                  ? '检查本地缓存'
                  : fileLoadState === 'downloading'
                    ? '下载电子书'
                    : fileLoadState === 'opening'
                      ? '正在打开电子书'
                      : '准备阅读器'}
              </div>
              <div className='h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800'>
                <div
                  className='h-full rounded-full bg-sky-600 transition-all'
                  style={{ width: totalBytes ? `${Math.min(100, (downloadedBytes / totalBytes) * 100)}%` : fileLoadState === 'opening' ? '92%' : fileLoadState === 'checking-cache' ? '20%' : '45%' }}
                />
              </div>
              <div className='flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                <span>{cacheHit ? '已命中本地缓存' : '首次打开将缓存到当前浏览器'}</span>
                <span>{progressLabel}</span>
              </div>
            </div>
            <div className='rounded-3xl bg-gray-50 p-6 dark:bg-gray-900'>
              {fileLoadState === 'opening' ? (
                <div className='flex min-h-32 flex-col items-center justify-center gap-4 text-center'>
                  <div className='reader-book-loader'>
                    <BookOpen className='h-10 w-10' strokeWidth={1.75} />
                  </div>
                  <div className='text-sm text-gray-500 dark:text-gray-400'>正在打开电子书...</div>
                </div>
              ) : (
                <div className='space-y-3 animate-pulse'>
                  <div className='h-4 w-full rounded bg-gray-200 dark:bg-gray-800' />
                  <div className='h-4 w-11/12 rounded bg-gray-200 dark:bg-gray-800' />
                  <div className='h-4 w-10/12 rounded bg-gray-200 dark:bg-gray-800' />
                  <div className='h-4 w-full rounded bg-gray-200 dark:bg-gray-800' />
                  <div className='h-4 w-9/12 rounded bg-gray-200 dark:bg-gray-800' />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tocOpen && typeof document !== 'undefined' ? createPortal(
        <div className='fixed inset-0 z-40 bg-black/30' onClick={() => setTocOpen(false)}>
          <div
            className='absolute right-0 top-0 h-screen w-[22rem] max-w-[88vw] overflow-y-auto border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-950'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='p-4'>
              <div className='space-y-2' ref={tocScrollRef}>
                {tocItems.length === 0 ? (
                  <div className='p-3 text-sm text-gray-500'>当前 EPUB 未提供目录</div>
                ) : (
                  renderTocItems(tocItems)
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {settingsOpen && typeof document !== 'undefined' ? createPortal(
        <div className='fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4' onClick={() => setSettingsOpen(false)}>
          <div
            className='w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-950'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='mb-4'>
              <div className='text-base font-semibold text-gray-900 dark:text-gray-100'>阅读设置</div>
              <div className='mt-1 text-xs text-gray-500'>可切换翻页或滚动阅读，默认翻页模式</div>
            </div>
            <div className='space-y-6 p-1 text-sm'>
              <div>
                <div className='mb-2 font-medium'>阅读模式</div>
                <div className='grid grid-cols-2 gap-2'>
                  {([
                    { key: 'paginated', label: '翻页模式', desc: '左右点击翻页' },
                    { key: 'scrolled', label: '滚动模式', desc: '上下连续滚动' },
                  ] as { key: ReaderMode; label: string; desc: string }[]).map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => setSettings((prev) => ({ ...prev, mode: mode.key }))}
                      className={`rounded-2xl border px-3 py-3 text-left ${settings.mode === mode.key ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' : 'border-gray-200 dark:border-gray-700'}`}
                    >
                      <div className='font-medium'>{mode.label}</div>
                      <div className='mt-1 text-xs opacity-70'>{mode.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className='mb-2 font-medium'>主题</div>
                <div className='grid grid-cols-3 gap-2'>
                  {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => setSettings((prev) => ({ ...prev, theme }))}
                      className={`rounded-2xl border px-3 py-2 ${settings.theme === theme ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' : 'border-gray-200 dark:border-gray-700'}`}
                    >
                      <div className='mb-1 flex justify-center'>{theme === 'dark' ? <Moon className='h-4 w-4' /> : <Sun className='h-4 w-4' />}</div>
                      {theme === 'light' ? '浅色' : theme === 'sepia' ? '护眼' : '深色'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className='mb-2 flex items-center justify-between font-medium'>字号 <span>{settings.fontSize}%</span></div>
                <input type='range' min='85' max='140' step='5' value={settings.fontSize} onChange={(e) => setSettings((prev) => ({ ...prev, fontSize: Number(e.target.value) }))} className='w-full' />
              </div>

              <div>
                <div className='mb-2 flex items-center justify-between font-medium'>行距 <span>{settings.lineHeight.toFixed(1)}</span></div>
                <input type='range' min='1.4' max='2.2' step='0.1' value={settings.lineHeight} onChange={(e) => setSettings((prev) => ({ ...prev, lineHeight: Number(e.target.value) }))} className='w-full' />
              </div>

              <div className='rounded-2xl bg-gray-50 p-4 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400'>
                首次会缓存到当前浏览器，之后再次打开同一本书通常不需要重新整包下载。
当前缓存状态：{cacheHit ? '已命中本地缓存' : '本次为网络加载'}。
              </div>

              <div className='flex justify-end'>
                <button
                  type='button'
                  className='rounded-2xl bg-sky-600 px-4 py-2 text-sm font-medium text-white'
                  onClick={() => setSettingsOpen(false)}
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {manifest.format === 'epub' && ttsBarVisible ? (
        <>
          <div className='absolute inset-x-0 bottom-3 z-20 mx-auto w-[min(94vw,34rem)]'>
            <div className='overflow-hidden rounded-3xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-950/95'>
              <div className='px-2 pt-2'>
                <input
                  type='range'
                  min={0}
                  max={Math.max(ttsDuration, 0)}
                  step={0.1}
                  value={Math.min(ttsSeekValue, Math.max(ttsDuration, 0))}
                  disabled={!ttsAvailable || ttsDuration <= 0}
                  onPointerDown={() => setTtsSeeking(true)}
                  onMouseDown={() => setTtsSeeking(true)}
                  onTouchStart={() => setTtsSeeking(true)}
                  onChange={(e) => setTtsSeekValue(Number(e.target.value))}
                  onPointerUp={(e) => {
                    const nextTime = Number((e.target as HTMLInputElement).value);
                    if (audioRef.current && Number.isFinite(nextTime)) {
                      audioRef.current.currentTime = nextTime;
                    }
                    setTtsCurrentTime(nextTime);
                    setTtsSeekValue(nextTime);
                    setTtsSeeking(false);
                  }}
                  onMouseUp={(e) => {
                    const nextTime = Number((e.target as HTMLInputElement).value);
                    if (audioRef.current && Number.isFinite(nextTime)) {
                      audioRef.current.currentTime = nextTime;
                    }
                    setTtsCurrentTime(nextTime);
                    setTtsSeekValue(nextTime);
                    setTtsSeeking(false);
                  }}
                  onTouchEnd={(e) => {
                    const nextTime = Number((e.target as HTMLInputElement).value);
                    if (audioRef.current && Number.isFinite(nextTime)) {
                      audioRef.current.currentTime = nextTime;
                    }
                    setTtsCurrentTime(nextTime);
                    setTtsSeekValue(nextTime);
                    setTtsSeeking(false);
                  }}
                  className='w-full accent-sky-500'
                />
              </div>
              <div className='px-3 py-2.5'>
                <div className='flex items-center gap-2'>
                  <button
                    type='button'
                    onClick={() => void toggleTtsPlayback()}
                    disabled={!ttsAvailable || ttsLoadingChunkIndex !== null}
                    className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white disabled:opacity-50'
                  >
                    {ttsLoadingChunkIndex !== null ? <Loader2 className='h-4 w-4 animate-spin' /> : ttsStatus === 'playing' ? <Pause className='h-4 w-4' /> : <Play className='h-4 w-4' />}
                  </button>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {ttsCurrentChapterTitle || currentTocLabel || currentChapter || '语音朗读'}
                    </div>
                    <div className='mt-0.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400'>
                      <span className='truncate'>
                        {!ttsAvailable
                          ? '服务异常'
                          : ttsLoadingChunkIndex !== null
                            ? '生成语音中...'
                            : ttsStatus === 'playing'
                              ? '正在播放'
                              : ttsStatus === 'paused'
                                ? '已暂停'
                                : '待播放'}
                      </span>
                      {ttsChunks.length > 0 ? <span>{ttsCurrentChunkIndex + 1}/{ttsChunks.length}</span> : null}
                    </div>
                  </div>
                  <button
                    type='button'
                    onClick={() => setTtsPanelOpen((prev) => !prev)}
                    className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200'
                  >
                    <ChevronUp className={`h-4 w-4 transition-transform ${ttsPanelOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                <div className='mt-2 flex items-center justify-between text-[11px] text-gray-400'>
                  <span>{selectedVoice?.displayName || '默认音色'}</span>
                  <span>{formatDurationTime(displayedTtsTime)} / {formatDurationTime(ttsDuration || 0)}</span>
                </div>
              </div>
            </div>
          </div>

          {ttsPanelOpen ? (
            <div className='absolute inset-x-0 bottom-20 z-30 mx-auto w-[min(94vw,34rem)]'>
              <div className='rounded-[2rem] border border-gray-200 bg-white/98 p-4 shadow-2xl backdrop-blur dark:border-gray-800 dark:bg-gray-950/98'>
                <div className='mb-3 flex items-center justify-between'>
                  <div className='flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                    <Headphones className='h-4 w-4 text-sky-500' />
                    听书控制
                  </div>
                  <button
                    type='button'
                    onClick={() => setTtsPanelOpen(false)}
                    className='flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300'
                  >
                    <X className='h-4 w-4' />
                  </button>
                </div>

                <div className='mb-4 flex items-center justify-between rounded-2xl bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300'>
                  <span className='truncate'>{currentChunk?.text.slice(0, 28) || '当前章节可开始朗读'}</span>
                  <span className='ml-2 shrink-0'>{Math.round(ttsChunkPercent)}%</span>
                </div>

                <div className='mb-4 flex items-center justify-center gap-3'>
                  <button
                    type='button'
                    onClick={() => {
                      const next = Math.max(0, ttsCurrentChunkIndex - 1);
                      if (ttsChunks[next]) void playTtsChunk(next);
                    }}
                    disabled={ttsCurrentChunkIndex <= 0 || ttsChunks.length === 0}
                    className='flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200 disabled:opacity-40'
                  >
                    <SkipBack className='h-5 w-5' />
                  </button>
                  <button
                    type='button'
                    onClick={() => void toggleTtsPlayback()}
                    disabled={!ttsAvailable || ttsLoadingChunkIndex !== null}
                    className='flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg disabled:opacity-50'
                  >
                    {ttsLoadingChunkIndex !== null ? <Loader2 className='h-5 w-5 animate-spin' /> : ttsStatus === 'playing' ? <Pause className='h-5 w-5' /> : <Play className='h-5 w-5' />}
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      const next = ttsCurrentChunkIndex + 1;
                      if (ttsChunks[next]) void playTtsChunk(next);
                    }}
                    disabled={ttsCurrentChunkIndex >= ttsChunks.length - 1 || ttsChunks.length === 0}
                    className='flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200 disabled:opacity-40'
                  >
                    <SkipForward className='h-5 w-5' />
                  </button>
                  <button
                    type='button'
                    onClick={() => stopTts(true)}
                    disabled={ttsStatus === 'idle' && ttsChunks.length === 0}
                    className='flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200 disabled:opacity-40'
                  >
                    <Square className='h-4 w-4' />
                  </button>
                </div>

                <div className='space-y-4'>
                  <div>
                    <div className='mb-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
                      <Waves className='h-3.5 w-3.5' />
                      <span>音色</span>
                    </div>
                    <select
                      value={ttsSettings.voice}
                      onChange={(e) => {
                        stopTts(true);
                        setTtsSettings((prev) => ({ ...prev, voice: e.target.value }));
                      }}
                      className='w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                    >
                      {ttsVoices.map((voice) => (
                        <option key={voice.shortName} value={voice.shortName}>
                          {voice.displayName || voice.shortName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className='block'>
                    <div className='mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <span className='flex items-center gap-2'><Gauge className='h-3.5 w-3.5' />语速</span>
                      <span>{ttsSettings.rate}</span>
                    </div>
                    <input
                      type='range'
                      min={0}
                      max={TTS_RATE_STEPS.length - 1}
                      step={1}
                      value={Math.max(0, TTS_RATE_STEPS.indexOf(ttsRateValue))}
                      onChange={(e) => {
                        stopTts(true);
                        const nextValue = TTS_RATE_STEPS[Number(e.target.value)] ?? 0;
                        setTtsSettings((prev) => ({ ...prev, rate: formatSignedValue(nextValue, '%') }));
                      }}
                      className='w-full'
                    />
                  </label>

                  <label className='block'>
                    <div className='mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <span className='flex items-center gap-2'><Waves className='h-3.5 w-3.5' />音调</span>
                      <span>{ttsSettings.pitch}</span>
                    </div>
                    <input
                      type='range'
                      min={0}
                      max={TTS_PITCH_STEPS.length - 1}
                      step={1}
                      value={Math.max(0, TTS_PITCH_STEPS.indexOf(ttsPitchValue))}
                      onChange={(e) => {
                        stopTts(true);
                        const nextValue = TTS_PITCH_STEPS[Number(e.target.value)] ?? 0;
                        setTtsSettings((prev) => ({ ...prev, pitch: formatSignedValue(nextValue, 'Hz') }));
                      }}
                      className='w-full'
                    />
                  </label>

                  <label className='block'>
                    <div className='mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <span className='flex items-center gap-2'><Volume2 className='h-3.5 w-3.5' />音量</span>
                      <span>{ttsSettings.volume}</span>
                    </div>
                    <input
                      type='range'
                      min={0}
                      max={TTS_VOLUME_STEPS.length - 1}
                      step={1}
                      value={Math.max(0, TTS_VOLUME_STEPS.indexOf(ttsVolumeValue))}
                      onChange={(e) => {
                        stopTts(true);
                        const nextValue = TTS_VOLUME_STEPS[Number(e.target.value)] ?? 0;
                        setTtsSettings((prev) => ({ ...prev, volume: formatSignedValue(nextValue, '%') }));
                      }}
                      className='w-full'
                    />
                  </label>
                </div>

                {ttsError ? <div className='mt-3 text-xs text-red-500'>{ttsError}</div> : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}


      {ready && !tocOpen && !settingsOpen && settings.mode === 'paginated' ? (
        <>
          <button
            aria-label='上一页'
            className='absolute inset-y-0 left-0 z-10 w-[28%] cursor-pointer bg-transparent'
            onClick={() => handleReaderTap('left')}
          />
          <button
            aria-label='下一页'
            className='absolute inset-y-0 right-0 z-10 w-[28%] cursor-pointer bg-transparent'
            onClick={() => handleReaderTap('right')}
          />
        </>
      ) : null}

      <div
        ref={viewerRef}
        className='relative min-h-0 flex-1 w-full'
        style={{ backgroundColor: THEME_STYLES[settings.theme].panelBg }}
        onClick={() => handleReaderTap('center')}
      />

      {showScrolledNextChapter ? (
        <div className='pointer-events-none fixed bottom-5 right-4 z-30'>
          <button
            type='button'
            onClick={goToNextChapter}
            aria-label='下一章'
            className='pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-sky-600/20 text-white shadow-lg'
          >
            <ChevronRight className='h-5 w-5' />
          </button>
        </div>
      ) : null}
    </div>
  );
}
