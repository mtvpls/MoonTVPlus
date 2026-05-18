'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deleteMangaShelf, getAllMangaShelf, saveMangaShelf } from '@/lib/db.client';
import { MangaSearchItem, MangaShelfItem, MangaSource } from '@/lib/manga.types';

import MangaCard from '@/components/MangaCard';

const MANGA_SEARCH_STATE_KEY = 'manga_search_state';

function MangaCardSkeleton({ withButton = false }: { withButton?: boolean }) {
  return (
    <div className='space-y-2'>
      <div className='overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950'>
        <div className='aspect-[3/4] w-full animate-pulse bg-gray-200 dark:bg-gray-800' />
        <div className='space-y-3 p-3'>
          <div className='h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
      </div>
      {withButton && <div className='h-9 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />}
    </div>
  );
}

export default function MangaSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q')?.trim() || '';
  const urlSourceId = searchParams.get('sourceId') || '';

  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [results, setResults] = useState<MangaSearchItem[]>([]);
  const [shelf, setShelf] = useState<Record<string, MangaShelfItem>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const [lastSearchedSourceId, setLastSearchedSourceId] = useState('');
  const restoredRef = useRef(false);

  const getCacheKey = useCallback((keyword: string, selectedSourceId: string) => {
    return `manga_search_cache_${selectedSourceId || 'all'}_${keyword.trim()}`;
  }, []);

  const getCachedResults = useCallback(
    (keyword: string, selectedSourceId: string) => {
      if (typeof window === 'undefined' || !keyword.trim()) return null;
      try {
        const cached = sessionStorage.getItem(getCacheKey(keyword, selectedSourceId));
        return cached ? (JSON.parse(cached) as MangaSearchItem[]) : null;
      } catch {
        return null;
      }
    },
    [getCacheKey]
  );

  const setCachedResults = useCallback(
    (keyword: string, selectedSourceId: string, nextResults: MangaSearchItem[]) => {
      if (typeof window === 'undefined' || !keyword.trim()) return;
      try {
        sessionStorage.setItem(getCacheKey(keyword, selectedSourceId), JSON.stringify(nextResults));
      } catch {
        // ignore session cache failures
      }
    },
    [getCacheKey]
  );

  const saveSearchState = useCallback((nextState: { query: string; sourceId: string; results: MangaSearchItem[] }) => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(MANGA_SEARCH_STATE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore session cache failures
    }
  }, []);

  const restoreSearchState = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = sessionStorage.getItem(MANGA_SEARCH_STATE_KEY);
      return cached
        ? (JSON.parse(cached) as {
            query: string;
            sourceId: string;
            results: MangaSearchItem[];
          })
        : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetch('/api/manga/sources')
      .then((res) => res.json())
      .then((data) => setSources(data.sources || []))
      .catch(() => undefined);

    getAllMangaShelf().then(setShelf).catch(() => undefined);
  }, []);

  const performSearch = useCallback(
    async (keyword: string, selectedSourceId: string, options?: { forceRefresh?: boolean }) => {
      const trimmedQuery = keyword.trim();
      if (!trimmedQuery) return;
      const forceRefresh = options?.forceRefresh === true;

      setLoading(true);
      setError('');
      setHasSearched(true);
      setLastSearchedQuery(trimmedQuery);
      setLastSearchedSourceId(selectedSourceId);

      const cached = forceRefresh ? null : getCachedResults(trimmedQuery, selectedSourceId);
      if (cached) {
        setResults(cached);
        saveSearchState({ query: trimmedQuery, sourceId: selectedSourceId, results: cached });
        setLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams({ q: trimmedQuery });
        if (selectedSourceId) params.set('sourceId', selectedSourceId);
        const res = await fetch(`/api/manga/search?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '搜索失败');
        const nextResults = data.results || [];
        setResults(nextResults);
        setCachedResults(trimmedQuery, selectedSourceId, nextResults);
        saveSearchState({ query: trimmedQuery, sourceId: selectedSourceId, results: nextResults });
      } catch (err) {
        setError((err as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [getCachedResults, saveSearchState, setCachedResults]
  );

  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;

      if (!urlQuery) {
        const cachedState = restoreSearchState();
        if (cachedState?.query?.trim()) {
          setQuery(cachedState.query);
          setSourceId(cachedState.sourceId || '');
          setResults(cachedState.results || []);
          setHasSearched(true);
          setLastSearchedQuery(cachedState.query);
          setLastSearchedSourceId(cachedState.sourceId || '');
        }
        return;
      }
    }

    setQuery(urlQuery);
    setSourceId(urlSourceId);

    if (!urlQuery) {
      setResults([]);
      setHasSearched(false);
      setLastSearchedQuery('');
      setLastSearchedSourceId('');
      setError('');
      return;
    }

    void performSearch(urlQuery, urlSourceId);
  }, [performSearch, restoreSearchState, urlQuery, urlSourceId]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const params = new URLSearchParams({ q: trimmedQuery });
    if (sourceId) params.set('sourceId', sourceId);
    router.replace(`/manga/search?${params.toString()}`);
    await performSearch(trimmedQuery, sourceId, { forceRefresh: true });
  };

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    if (lastSearchedQuery) params.set('q', lastSearchedQuery);
    if (lastSearchedSourceId) params.set('sourceId', lastSearchedSourceId);
    const queryString = params.toString();
    return queryString ? `/manga/search?${queryString}` : '/manga/search';
  }, [lastSearchedQuery, lastSearchedSourceId]);

  const toggleShelf = async (item: MangaSearchItem) => {
    const key = `${item.sourceId}+${item.id}`;
    if (shelf[key]) {
      await deleteMangaShelf(item.sourceId, item.id);
      setShelf((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const shelfItem: MangaShelfItem = {
      title: item.title,
      cover: item.cover,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      mangaId: item.id,
      saveTime: Date.now(),
      description: item.description,
      author: item.author,
      status: item.status,
    };
    await saveMangaShelf(item.sourceId, item.id, shelfItem);
    setShelf((prev) => ({ ...prev, [key]: shelfItem }));
  };

  return (
    <div className='mx-auto max-w-6xl'>
      <form className='mx-auto mb-8 max-w-4xl' onSubmit={handleSearch}>
        <div className='flex flex-col gap-3 lg:flex-row'>
          <div className='flex-1'>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='搜索漫画标题'
              className='w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-sky-500 dark:border-gray-700 dark:bg-gray-900'
            />
          </div>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className='rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-900 lg:w-56'
          >
            <option value=''>全部来源</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.displayName || source.name}
              </option>
            ))}
          </select>
          <button className='inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-sky-700 lg:w-32'>
            <Search className='h-4 w-4' /> 搜索
          </button>
        </div>
      </form>

      <section>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-semibold'>搜索结果</h2>
        </div>
        {error && <div className='mb-4 text-sm text-red-500'>{error}</div>}
        {loading ? (
          <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
            {Array.from({ length: 12 }).map((_, index) => (
              <MangaCardSkeleton key={index} withButton />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className='rounded-2xl bg-gray-50 p-10 text-center text-sm text-gray-500 dark:bg-gray-900/50'>
            {hasSearched ? '没有找到相关漫画' : '请输入关键词开始搜索漫画'}
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
            {results.map((item) => {
              const key = `${item.sourceId}+${item.id}`;
              return (
                <div key={key} className='space-y-2'>
                  <MangaCard
                    item={item}
                    href={`/manga/detail?mangaId=${item.id}&sourceId=${item.sourceId}&title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}&description=${encodeURIComponent(item.description || '')}&author=${encodeURIComponent(item.author || '')}&status=${encodeURIComponent(item.status || '')}&returnTo=${encodeURIComponent(returnTo)}`}
                    subtitle={item.author || item.status || item.description}
                  />
                  <button
                    onClick={() => toggleShelf(item)}
                    className='w-full rounded-2xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-sky-500 hover:text-sky-600 dark:border-gray-700 dark:text-gray-200'
                  >
                    {shelf[key] ? '移出书架' : '加入书架'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
