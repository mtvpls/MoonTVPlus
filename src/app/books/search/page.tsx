'use client';

import {
  BookMarked,
  Layers3,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BookListItem, BookSearchResult, BookSource } from '@/lib/book.types';
import {
  buildBookDetailPath,
  cacheBookListItem,
} from '@/lib/book-route-cache.client';

import BookCard from '@/components/books/BookCard';

type RuntimeWindow = Window & { RUNTIME_CONFIG?: { FLUID_SEARCH?: boolean } };

function detailHref(item: BookListItem) {
  return buildBookDetailPath(item.sourceId, item.id);
}

function SearchSkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6 animate-pulse'>
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className='overflow-hidden rounded-[1.75rem] border border-emerald-100/70 bg-white/70 p-3 shadow-sm dark:border-emerald-500/10 dark:bg-gray-950/50'
        >
          <div className='aspect-[3/4] rounded-2xl bg-gradient-to-br from-emerald-100 to-amber-100 dark:from-gray-800 dark:to-emerald-950/30' />
          <div className='mt-3 h-4 w-3/4 rounded bg-emerald-100 dark:bg-gray-800' />
          <div className='mt-2 h-3 w-1/2 rounded bg-emerald-100/80 dark:bg-gray-800' />
        </div>
      ))}
    </div>
  );
}

const BOOK_SEARCH_STATE_KEY = 'book_search_state';
const EMPTY_RESULT: BookSearchResult = { results: [], failedSources: [] };
const QUICK_SEARCHES = ['三体', '刘慈欣', '东野圭吾', '哈利波特'];

export default function BooksSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const urlSourceId = searchParams.get('sourceId') || '';

  const [q, setQ] = useState(urlQuery);
  const [sourceId, setSourceId] = useState(urlSourceId);
  const [sources, setSources] = useState<BookSource[]>([]);
  const [result, setResult] = useState<BookSearchResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const [useFluidSearch, setUseFluidSearch] = useState(true);

  const restoredRef = useRef(false);
  const forceNextUrlSearchRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentSearchKeyRef = useRef('');
  const pendingResultsRef = useRef<BookListItem[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  const getCacheKey = useCallback(
    (keyword: string, selectedSourceId: string) =>
      `book_search_cache_${selectedSourceId || 'all'}_${keyword.trim()}`,
    []
  );

  const getCachedResult = useCallback(
    (keyword: string, selectedSourceId: string) => {
      if (typeof window === 'undefined' || !keyword.trim()) return null;
      try {
        const raw = sessionStorage.getItem(
          getCacheKey(keyword, selectedSourceId)
        );
        return raw ? (JSON.parse(raw) as BookSearchResult) : null;
      } catch {
        return null;
      }
    },
    [getCacheKey]
  );

  const setCachedResult = useCallback(
    (
      keyword: string,
      selectedSourceId: string,
      nextResult: BookSearchResult
    ) => {
      if (typeof window === 'undefined' || !keyword.trim()) return;
      try {
        sessionStorage.setItem(
          getCacheKey(keyword, selectedSourceId),
          JSON.stringify(nextResult)
        );
      } catch {
        // Ignore storage/browser cleanup failures.
      }
    },
    [getCacheKey]
  );

  const readFluidSearchSetting = useCallback(() => {
    if (typeof window === 'undefined') return true;
    try {
      const savedFluidSearch = localStorage.getItem('fluidSearch');
      if (savedFluidSearch !== null)
        return JSON.parse(savedFluidSearch) !== false;
    } catch {
      // Ignore storage/browser cleanup failures.
    }
    return (window as RuntimeWindow).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        // Ignore cleanup failures.
      }
      eventSourceRef.current = null;
    }
  }, []);

  const clearPendingResults = useCallback(() => {
    pendingResultsRef.current = [];
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const appendBufferedResults = useCallback((nextResults: BookListItem[]) => {
    if (nextResults.length === 0) return;
    pendingResultsRef.current.push(...nextResults);
    if (!flushTimerRef.current) {
      flushTimerRef.current = window.setTimeout(() => {
        const toAppend = pendingResultsRef.current;
        pendingResultsRef.current = [];
        startTransition(() => {
          setResult((prev) => ({
            ...prev,
            results: prev.results.concat(toAppend),
          }));
        });
        flushTimerRef.current = null;
      }, 80);
    }
  }, []);

  const saveSearchState = useCallback(
    (nextState: { q: string; sourceId: string; result: BookSearchResult }) => {
      if (typeof window === 'undefined') return;
      try {
        sessionStorage.setItem(
          BOOK_SEARCH_STATE_KEY,
          JSON.stringify(nextState)
        );
      } catch {
        // Ignore storage failures.
      }
    },
    []
  );

  const restoreSearchState = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(BOOK_SEARCH_STATE_KEY);
      return raw
        ? (JSON.parse(raw) as {
            q: string;
            sourceId: string;
            result: BookSearchResult;
          })
        : null;
    } catch {
      return null;
    }
  }, []);

  const performSearch = useCallback(
    async (
      keyword: string,
      selectedSourceId: string,
      options?: { forceRefresh?: boolean }
    ) => {
      const trimmed = keyword.trim();
      if (!trimmed) return;
      const normalizedSourceId = selectedSourceId || '';
      const searchKey = `${normalizedSourceId}::${trimmed}`;
      const forceRefresh = options?.forceRefresh === true;

      closeEventSource();
      clearPendingResults();
      currentSearchKeyRef.current = searchKey;
      setLoading(true);
      setError('');
      setHasSearched(true);
      setTotalSources(0);
      setCompletedSources(0);

      const cached = forceRefresh
        ? null
        : getCachedResult(trimmed, normalizedSourceId);
      if (cached) {
        setResult(cached);
        saveSearchState({
          q: trimmed,
          sourceId: normalizedSourceId,
          result: cached,
        });
        setLoading(false);
        setTotalSources(1);
        setCompletedSources(1);
        return;
      }

      setResult(EMPTY_RESULT);

      const currentFluidSearch = readFluidSearchSetting();
      setUseFluidSearch((prev) =>
        prev === currentFluidSearch ? prev : currentFluidSearch
      );

      const params = new URLSearchParams({ q: trimmed });
      if (normalizedSourceId) params.set('sourceId', normalizedSourceId);

      if (currentFluidSearch) {
        const es = new EventSource(`/api/books/search/ws?${params.toString()}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data || currentSearchKeyRef.current !== searchKey) return;
          try {
            const payload = JSON.parse(event.data);
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;
              case 'source_result':
                setCompletedSources((prev) =>
                  Math.max(prev + 1, payload.completedSources || 0)
                );
                if (
                  Array.isArray(payload.results) &&
                  payload.results.length > 0
                ) {
                  appendBufferedResults(payload.results as BookListItem[]);
                }
                break;
              case 'source_error':
                setCompletedSources((prev) =>
                  Math.max(prev + 1, payload.completedSources || 0)
                );
                break;
              case 'error':
                setError(payload.error || '搜索失败');
                setLoading(false);
                closeEventSource();
                break;
              case 'complete': {
                const finalFailedSources: BookSearchResult['failedSources'] =
                  [];
                setCompletedSources(
                  payload.completedSources || payload.totalSources || 0
                );
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    window.clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setResult((prev) => {
                      const nextResult = {
                        results: prev.results.concat(toAppend),
                        failedSources: finalFailedSources,
                      };
                      setCachedResult(trimmed, normalizedSourceId, nextResult);
                      saveSearchState({
                        q: trimmed,
                        sourceId: normalizedSourceId,
                        result: nextResult,
                      });
                      return nextResult;
                    });
                  });
                } else {
                  setResult((prev) => {
                    const nextResult = {
                      results: prev.results,
                      failedSources: finalFailedSources,
                    };
                    setCachedResult(trimmed, normalizedSourceId, nextResult);
                    saveSearchState({
                      q: trimmed,
                      sourceId: normalizedSourceId,
                      result: nextResult,
                    });
                    return nextResult;
                  });
                }
                setLoading(false);
                closeEventSource();
                break;
              }
            }
          } catch {
            // Ignore malformed streaming payloads.
          }
        };

        es.onerror = () => {
          if (currentSearchKeyRef.current !== searchKey) return;
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              window.clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setResult((prev) => ({
                ...prev,
                results: prev.results.concat(toAppend),
              }));
            });
          }
          setLoading(false);
          closeEventSource();
        };
        return;
      }

      try {
        const res = await fetch(`/api/books/search?${params.toString()}`);
        const json = await res.json();
        if (currentSearchKeyRef.current !== searchKey) return;
        if (!res.ok) throw new Error(json.error || '搜索失败');
        const nextResult: BookSearchResult = {
          results: json.results || [],
          failedSources: [],
        };
        setResult(nextResult);
        setTotalSources(1);
        setCompletedSources(1);
        setCachedResult(trimmed, normalizedSourceId, nextResult);
        saveSearchState({
          q: trimmed,
          sourceId: normalizedSourceId,
          result: nextResult,
        });
      } catch (err) {
        if (currentSearchKeyRef.current !== searchKey) return;
        setError((err as Error).message || '搜索失败');
        setResult(EMPTY_RESULT);
      } finally {
        if (currentSearchKeyRef.current === searchKey) {
          setLoading(false);
        }
      }
    },
    [
      appendBufferedResults,
      clearPendingResults,
      closeEventSource,
      getCachedResult,
      readFluidSearchSetting,
      saveSearchState,
      setCachedResult,
    ]
  );

  useEffect(() => {
    setUseFluidSearch(readFluidSearchSetting());
    fetch('/api/books/sources')
      .then((res) => res.json())
      .then((json) => setSources(json.sources || []))
      .catch(() => undefined);
    return () => {
      closeEventSource();
      clearPendingResults();
    };
  }, [clearPendingResults, closeEventSource, readFluidSearchSetting]);

  useEffect(() => {
    const keyword = urlQuery;
    const source = urlSourceId;

    if (!restoredRef.current) {
      restoredRef.current = true;
      if (!keyword) {
        const cachedState = restoreSearchState();
        if (cachedState?.q?.trim()) {
          setQ(cachedState.q);
          setSourceId(cachedState.sourceId || '');
          setResult(cachedState.result || EMPTY_RESULT);
          setHasSearched(true);
        }
        return;
      }
    }

    setQ(keyword);
    setSourceId(source);
    if (!keyword) {
      closeEventSource();
      clearPendingResults();
      setResult(EMPTY_RESULT);
      setLoading(false);
      setHasSearched(false);
      setTotalSources(0);
      setCompletedSources(0);
      setError('');
      return;
    }

    const forceRefresh = forceNextUrlSearchRef.current;
    forceNextUrlSearchRef.current = false;
    void performSearch(keyword, source, { forceRefresh });
  }, [
    clearPendingResults,
    closeEventSource,
    performSearch,
    restoreSearchState,
    urlQuery,
    urlSourceId,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    const params = new URLSearchParams();
    params.set('q', trimmed);
    if (sourceId) params.set('sourceId', sourceId);
    const nextUrl = `/books/search?${params.toString()}`;
    if (urlQuery === trimmed && urlSourceId === sourceId) {
      await performSearch(trimmed, sourceId, { forceRefresh: true });
    } else {
      forceNextUrlSearchRef.current = true;
      router.replace(nextUrl);
    }
  };

  const selectedSourceName = useMemo(() => {
    if (!sourceId) return '全部书源';
    return sources.find((source) => source.id === sourceId)?.name || '当前书源';
  }, [sourceId, sources]);

  const searchProgress =
    totalSources > 0
      ? Math.min(100, Math.round((completedSources / totalSources) * 100))
      : 0;

  const submitSearch = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      if (!trimmed) return;
      const params = new URLSearchParams();
      params.set('q', trimmed);
      if (sourceId) params.set('sourceId', sourceId);
      forceNextUrlSearchRef.current = true;
      router.replace(`/books/search?${params.toString()}`);
    },
    [router, sourceId]
  );

  return (
    <div className='space-y-7'>
      <section className='relative overflow-hidden rounded-[2.25rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-amber-50 p-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-500/10 dark:from-emerald-950/30 dark:via-gray-950 dark:to-amber-950/20 sm:p-7'>
        <div className='absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-300/25 blur-3xl dark:bg-emerald-500/10' />
        <div className='absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-500/10' />
        <div className='relative'>
          <div className='inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/75 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-200'>
            <Sparkles className='h-3.5 w-3.5' />
            Search First · Reduce Friction
          </div>

          <div className='mt-5 grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-end'>
            <div>
              <h1 className='text-4xl font-black tracking-[-0.06em] text-emerald-950 dark:text-emerald-50 sm:text-6xl lg:text-7xl'>
                找到下一本书
              </h1>
              <div className='mt-5 flex flex-wrap gap-2'>
                {QUICK_SEARCHES.map((keyword) => (
                  <button
                    key={keyword}
                    type='button'
                    onClick={() => {
                      setQ(keyword);
                      submitSearch(keyword);
                    }}
                    className='inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-emerald-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-100 dark:hover:bg-emerald-500/10'
                  >
                    <Search className='h-3.5 w-3.5' />
                    {keyword}
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className='rounded-[2rem] border border-white/80 bg-white/85 p-3 shadow-xl shadow-emerald-950/10 backdrop-blur dark:border-white/10 dark:bg-gray-950/70'
            >
              <div className='grid gap-3 lg:grid-cols-[1fr_13rem_auto]'>
                <label className='relative block'>
                  <span className='mb-2 block px-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-200'>
                    关键词
                  </span>
                  <Search className='pointer-events-none absolute bottom-3.5 left-4 h-5 w-5 text-emerald-400' />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder='搜索书名 / 作者'
                    className='h-12 w-full rounded-2xl border border-emerald-100 bg-white pl-11 pr-11 text-base font-medium text-slate-900 outline-none transition-colors duration-200 placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 dark:border-emerald-500/10 dark:bg-gray-900 dark:text-white'
                  />
                  {q ? (
                    <button
                      type='button'
                      onClick={() => setQ('')}
                      className='absolute bottom-2.5 right-2.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors duration-200 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
                      aria-label='清空搜索关键词'
                    >
                      <X className='h-4 w-4' />
                    </button>
                  ) : null}
                </label>

                <label className='block'>
                  <span className='mb-2 block px-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-200'>
                    书源
                  </span>
                  <select
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className='h-12 w-full cursor-pointer rounded-2xl border border-emerald-100 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition-colors duration-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 dark:border-emerald-500/10 dark:bg-gray-900 dark:text-white'
                  >
                    <option value=''>全部书源</option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className='flex items-end'>
                  <button
                    type='submit'
                    disabled={loading}
                    className='inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition-colors duration-200 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:focus:ring-offset-gray-950 lg:w-auto'
                  >
                    {loading ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <Search className='h-4 w-4' />
                    )}
                    {loading ? '搜索中' : '搜索'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className='rounded-[2rem] border border-emerald-100/80 bg-white/75 p-4 shadow-sm shadow-emerald-950/5 backdrop-blur dark:border-emerald-500/10 dark:bg-gray-950/60 sm:p-5'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300'>
              <BookMarked className='h-4 w-4' />
              Results
            </div>
            <h2 className='mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white'>
              {hasSearched
                ? `搜索结果${
                    result.results.length > 0
                      ? `（${result.results.length}）`
                      : ''
                  }`
                : '等待搜索'}
            </h2>
            <p className='mt-1 text-sm text-slate-500 dark:text-slate-400'>
              当前范围：{selectedSourceName}
            </p>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <span className='inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'>
              <Layers3 className='h-3.5 w-3.5' />
              {sources.length || 0} 个书源
            </span>
            {loading && useFluidSearch && totalSources > 0 ? (
              <span className='inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'>
                <Loader2 className='h-3.5 w-3.5 animate-spin' />
                搜索中 {completedSources}/{totalSources}
              </span>
            ) : null}
          </div>
        </div>
        {loading && useFluidSearch && totalSources > 0 ? (
          <div className='mt-4 h-2 overflow-hidden rounded-full bg-emerald-50 dark:bg-gray-900'>
            <div
              className='h-full rounded-full bg-emerald-600 transition-all duration-300'
              style={{ width: `${searchProgress}%` }}
            />
          </div>
        ) : null}
      </section>

      {loading && result.results.length === 0 ? <SearchSkeleton /> : null}
      {error ? (
        <div className='rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-950/20 dark:text-red-300'>
          {error}
        </div>
      ) : null}
      <section className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
        {result.results.map((item) => (
          <BookCard
            key={`${item.sourceId}-${item.id}`}
            item={item}
            href={detailHref(item)}
            onNavigate={() => cacheBookListItem(item)}
          />
        ))}
      </section>
      {!loading && hasSearched && !error && result.results.length === 0 ? (
        <div className='rounded-[2rem] border border-dashed border-emerald-200 bg-white/75 p-8 text-center shadow-sm dark:border-emerald-500/20 dark:bg-gray-950/50'>
          <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-200'>
            <Search className='h-6 w-6' />
          </div>
          <h3 className='mt-4 text-lg font-bold text-slate-950 dark:text-white'>
            没有找到匹配书籍
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400'>
            试试更短的关键词、作者名，或切换到全部书源重新搜索。
          </p>
          <div className='mt-5 flex flex-wrap justify-center gap-2'>
            {QUICK_SEARCHES.map((keyword) => (
              <button
                key={keyword}
                type='button'
                onClick={() => {
                  setQ(keyword);
                  submitSearch(keyword);
                }}
                className='cursor-pointer rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-500/20 dark:bg-gray-950 dark:text-emerald-100 dark:hover:bg-emerald-500/10'
              >
                搜索 {keyword}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
