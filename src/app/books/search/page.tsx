'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import BookCard from '@/components/books/BookCard';
import { buildBookDetailPath, cacheBookListItem } from '@/lib/book-route-cache.client';
import { BookListItem, BookSearchResult, BookSource } from '@/lib/book.types';

function detailHref(item: BookListItem) {
  return buildBookDetailPath(item.sourceId, item.id);
}

function SearchSkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6 animate-pulse'>
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className='space-y-3'>
          <div className='aspect-[3/4] rounded-2xl bg-gray-200 dark:bg-gray-800' />
          <div className='h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-800' />
        </div>
      ))}
    </div>
  );
}

const BOOK_SEARCH_STATE_KEY = 'book_search_state';

export default function BooksSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [sourceId, setSourceId] = useState(searchParams.get('sourceId') || '');
  const [sources, setSources] = useState<BookSource[]>([]);
  const [result, setResult] = useState<BookSearchResult>({ results: [], failedSources: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const restoredRef = useRef(false);

  const getCacheKey = useCallback((keyword: string, selectedSourceId: string) => `book_search_cache_${selectedSourceId || 'all'}_${keyword.trim()}`, []);

  const getCachedResult = useCallback((keyword: string, selectedSourceId: string) => {
    if (typeof window === 'undefined' || !keyword.trim()) return null;
    try {
      const raw = sessionStorage.getItem(getCacheKey(keyword, selectedSourceId));
      return raw ? (JSON.parse(raw) as BookSearchResult) : null;
    } catch {
      return null;
    }
  }, [getCacheKey]);

  const setCachedResult = useCallback((keyword: string, selectedSourceId: string, nextResult: BookSearchResult) => {
    if (typeof window === 'undefined' || !keyword.trim()) return;
    try {
      sessionStorage.setItem(getCacheKey(keyword, selectedSourceId), JSON.stringify(nextResult));
    } catch {}
  }, [getCacheKey]);

  const saveSearchState = useCallback((nextState: { q: string; sourceId: string; result: BookSearchResult }) => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(BOOK_SEARCH_STATE_KEY, JSON.stringify(nextState));
    } catch {}
  }, []);

  const restoreSearchState = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(BOOK_SEARCH_STATE_KEY);
      return raw ? (JSON.parse(raw) as { q: string; sourceId: string; result: BookSearchResult }) : null;
    } catch {
      return null;
    }
  }, []);

  const performSearch = useCallback(async (keyword: string, selectedSourceId: string, options?: { forceRefresh?: boolean }) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    const forceRefresh = options?.forceRefresh === true;
    setLoading(true);
    setError('');
    setHasSearched(true);
    setResult({ results: [], failedSources: [] });

    const cached = forceRefresh ? null : getCachedResult(trimmed, selectedSourceId);
    if (cached) {
      setResult(cached);
      saveSearchState({ q: trimmed, sourceId: selectedSourceId, result: cached });
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({ q: trimmed, ...(selectedSourceId ? { sourceId: selectedSourceId } : {}) });
      const res = await fetch(`/api/books/search?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '搜索失败');
      const nextResult: BookSearchResult = { results: json.results || [], failedSources: json.failedSources || [] };
      setResult(nextResult);
      setCachedResult(trimmed, selectedSourceId, nextResult);
      saveSearchState({ q: trimmed, sourceId: selectedSourceId, result: nextResult });
    } catch (err) {
      setError((err as Error).message || '搜索失败');
      setResult({ results: [], failedSources: [] });
    } finally {
      setLoading(false);
    }
  }, [getCachedResult, saveSearchState, setCachedResult]);

  useEffect(() => {
    fetch('/api/books/sources').then((res) => res.json()).then((json) => setSources(json.sources || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    const keyword = searchParams.get('q') || '';
    const source = searchParams.get('sourceId') || '';

    if (!restoredRef.current) {
      restoredRef.current = true;
      if (!keyword) {
        const cachedState = restoreSearchState();
        if (cachedState?.q?.trim()) {
          setQ(cachedState.q);
          setSourceId(cachedState.sourceId || '');
          setResult(cachedState.result || { results: [], failedSources: [] });
          setHasSearched(true);
        }
        return;
      }
    }

    setQ(keyword);
    setSourceId(source);
    if (!keyword) {
      setResult({ results: [], failedSources: [] });
      setHasSearched(false);
      setError('');
      return;
    }
    void performSearch(keyword, source);
  }, [performSearch, restoreSearchState, searchParams]);

  return (
    <div className='space-y-6'>
      <section className='rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950'>
        <form onSubmit={async (e) => { e.preventDefault(); const trimmed = q.trim(); if (!trimmed) return; const params = new URLSearchParams(); params.set('q', trimmed); if (sourceId) params.set('sourceId', sourceId); router.replace(`/books/search?${params.toString()}`); await performSearch(trimmed, sourceId, { forceRefresh: true }); }} className='space-y-3'>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='搜索书名 / 作者' className='w-full rounded-2xl border border-gray-200 px-4 py-3 outline-none dark:border-gray-700 dark:bg-gray-900' />
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className='w-full rounded-2xl border border-gray-200 px-4 py-3 dark:border-gray-700 dark:bg-gray-900'>
            <option value=''>全部书源</option>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
          </select>
          <button className='rounded-2xl bg-sky-600 px-4 py-2 text-sm text-white'>搜索</button>
        </form>
      </section>
      {loading ? <SearchSkeleton /> : null}
      {error ? <div className='rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-300'>{error}</div> : null}
      {result.failedSources.length > 0 ? <div className='rounded-2xl bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-300'>{result.failedSources.map((item) => `${item.sourceName}: ${item.error}`).join('；')}</div> : null}
      <section className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
        {result.results.map((item) => <BookCard key={`${item.sourceId}-${item.id}`} item={item} href={detailHref(item)} onNavigate={() => cacheBookListItem(item)} />)}
      </section>
      {!loading && hasSearched && !error && result.results.length === 0 ? <div className='text-sm text-gray-500'>暂无结果</div> : null}
    </div>
  );
}
