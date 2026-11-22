'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/cn';
import {
  deleteMangaShelf,
  getAllMangaReadRecords,
  getAllMangaShelf,
  saveMangaShelf,
} from '@/lib/db.client';
import {
  MangaDetail,
  MangaReadRecord,
  MangaSearchItem,
  MangaShelfItem,
  MangaSource,
} from '@/lib/manga.types';
import {
  getMangaSearchSourceFilters,
  getSelectedMangaSearchItem,
  groupMangaSearchResults,
  mangaSearchItemKey,
  sortMangaChapters,
  sortMangaSearchGroups,
} from '@/lib/manga-search';

import MangaSearchCard, {
  MangaSearchCardSkeleton,
} from '@/components/manga/MangaSearchCard';
import MangaSearchScope from '@/components/manga/MangaSearchScope';
import EmptyState from '@/components/media/EmptyState';
import {
  LIBRARY_BUTTON,
  LIBRARY_FIELD,
  LIBRARY_MUTED,
  LIBRARY_TEXT,
  LIBRARY_TEXT_TAB,
  LIBRARY_TEXT_TAB_ACTIVE,
  LIBRARY_TEXT_TAB_IDLE,
} from '@/components/media/library';

const MANGA_SEARCH_STATE_KEY = 'manga_search_state';
const MANGA_SEARCH_VIEW_KEY = 'manga_search_view';

interface MangaSearchViewState {
  searchKey: string;
  filterSourceId: string;
  selectedKeys: Record<string, string>;
}

const emptySearchView = (searchKey: string): MangaSearchViewState => ({
  searchKey,
  filterSourceId: '',
  selectedKeys: {},
});

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
  const [history, setHistory] = useState<Record<string, MangaReadRecord>>({});
  const [searchView, setSearchView] = useState<MangaSearchViewState>(() =>
    emptySearchView('')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const [lastSearchedSourceId, setLastSearchedSourceId] = useState('');
  const restoredRef = useRef(false);
  const forceNextUrlSearchRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentSearchKeyRef = useRef('');
  const pendingResultsRef = useRef<MangaSearchItem[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const [useFluidSearch, setUseFluidSearch] = useState(true);

  const getCacheKey = useCallback(
    (keyword: string, selectedSourceId: string) => {
      return `manga_search_cache_${
        selectedSourceId || 'all'
      }_${keyword.trim()}`;
    },
    []
  );

  const getCachedResults = useCallback(
    (keyword: string, selectedSourceId: string) => {
      if (typeof window === 'undefined' || !keyword.trim()) return null;
      try {
        const cached = sessionStorage.getItem(
          getCacheKey(keyword, selectedSourceId)
        );
        return cached ? (JSON.parse(cached) as MangaSearchItem[]) : null;
      } catch {
        return null;
      }
    },
    [getCacheKey]
  );

  const setCachedResults = useCallback(
    (
      keyword: string,
      selectedSourceId: string,
      nextResults: MangaSearchItem[]
    ) => {
      if (typeof window === 'undefined' || !keyword.trim()) return;
      try {
        sessionStorage.setItem(
          getCacheKey(keyword, selectedSourceId),
          JSON.stringify(nextResults)
        );
      } catch {
        // ignore session cache failures
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
      // ignore invalid localStorage values
    }
    return (
      (window as Window & { RUNTIME_CONFIG?: { FLUID_SEARCH?: boolean } })
        .RUNTIME_CONFIG?.FLUID_SEARCH !== false
    );
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        // ignore close failures
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

  const appendBufferedResults = useCallback(
    (nextResults: MangaSearchItem[]) => {
      if (nextResults.length === 0) return;
      pendingResultsRef.current.push(...nextResults);
      if (!flushTimerRef.current) {
        flushTimerRef.current = window.setTimeout(() => {
          const toAppend = pendingResultsRef.current;
          pendingResultsRef.current = [];
          startTransition(() => {
            setResults((prev) => prev.concat(toAppend));
          });
          flushTimerRef.current = null;
        }, 80);
      }
    },
    []
  );

  const saveSearchState = useCallback(
    (nextState: {
      query: string;
      sourceId: string;
      results: MangaSearchItem[];
    }) => {
      if (typeof window === 'undefined') return;
      try {
        sessionStorage.setItem(
          MANGA_SEARCH_STATE_KEY,
          JSON.stringify(nextState)
        );
      } catch {
        // ignore session cache failures
      }
    },
    []
  );

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
    setUseFluidSearch(readFluidSearchSetting());

    fetch('/api/manga/sources')
      .then((res) => res.json())
      .then((data) => setSources(data.sources || []))
      .catch(() => undefined);

    getAllMangaShelf()
      .then(setShelf)
      .catch(() => undefined);
    getAllMangaReadRecords()
      .then(setHistory)
      .catch(() => undefined);

    const onShelfUpdated = (event: Event) =>
      setShelf((event as CustomEvent<Record<string, MangaShelfItem>>).detail);
    const onHistoryUpdated = (event: Event) =>
      setHistory(
        (event as CustomEvent<Record<string, MangaReadRecord>>).detail
      );
    window.addEventListener('mangaShelfUpdated', onShelfUpdated);
    window.addEventListener('mangaHistoryUpdated', onHistoryUpdated);

    return () => {
      closeEventSource();
      clearPendingResults();
      window.removeEventListener('mangaShelfUpdated', onShelfUpdated);
      window.removeEventListener('mangaHistoryUpdated', onHistoryUpdated);
    };
  }, [clearPendingResults, closeEventSource, readFluidSearchSetting]);

  const performSearch = useCallback(
    async (
      keyword: string,
      selectedSourceId: string,
      options?: { forceRefresh?: boolean }
    ) => {
      const trimmedQuery = keyword.trim();
      if (!trimmedQuery) return;
      const normalizedSourceId = selectedSourceId || '';
      const searchKey = `${normalizedSourceId}::${trimmedQuery}`;
      const forceRefresh = options?.forceRefresh === true;

      closeEventSource();
      clearPendingResults();
      currentSearchKeyRef.current = searchKey;

      setLoading(true);
      setError('');
      setHasSearched(true);
      setLastSearchedQuery(trimmedQuery);
      setLastSearchedSourceId(normalizedSourceId);
      setTotalSources(0);
      setCompletedSources(0);

      const cached = forceRefresh
        ? null
        : getCachedResults(trimmedQuery, normalizedSourceId);
      if (cached) {
        setResults(cached);
        saveSearchState({
          query: trimmedQuery,
          sourceId: normalizedSourceId,
          results: cached,
        });
        setLoading(false);
        setTotalSources(1);
        setCompletedSources(1);
        return;
      }

      setResults([]);

      const currentFluidSearch = readFluidSearchSetting();
      setUseFluidSearch((prev) =>
        prev === currentFluidSearch ? prev : currentFluidSearch
      );

      const params = new URLSearchParams({ q: trimmedQuery });
      if (normalizedSourceId) params.set('sourceId', normalizedSourceId);

      if (currentFluidSearch) {
        const es = new EventSource(`/api/manga/search/ws?${params.toString()}`);
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
                  appendBufferedResults(payload.results as MangaSearchItem[]);
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
                    setResults((prev) => {
                      const nextResults = prev.concat(toAppend);
                      setCachedResults(
                        trimmedQuery,
                        normalizedSourceId,
                        nextResults
                      );
                      saveSearchState({
                        query: trimmedQuery,
                        sourceId: normalizedSourceId,
                        results: nextResults,
                      });
                      return nextResults;
                    });
                  });
                } else {
                  setResults((prev) => {
                    setCachedResults(trimmedQuery, normalizedSourceId, prev);
                    saveSearchState({
                      query: trimmedQuery,
                      sourceId: normalizedSourceId,
                      results: prev,
                    });
                    return prev;
                  });
                }
                setLoading(false);
                closeEventSource();
                break;
              }
            }
          } catch {
            // ignore malformed SSE payloads
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
              setResults((prev) => prev.concat(toAppend));
            });
          }
          setLoading(false);
          closeEventSource();
        };
        return;
      }

      try {
        const res = await fetch(`/api/manga/search?${params.toString()}`);
        const data = await res.json();
        if (currentSearchKeyRef.current !== searchKey) return;
        if (!res.ok) throw new Error(data.error || '搜索失败');
        const nextResults = data.results || [];
        setResults(nextResults);
        setTotalSources(1);
        setCompletedSources(1);
        setCachedResults(trimmedQuery, normalizedSourceId, nextResults);
        saveSearchState({
          query: trimmedQuery,
          sourceId: normalizedSourceId,
          results: nextResults,
        });
      } catch (err) {
        if (currentSearchKeyRef.current !== searchKey) return;
        setError((err as Error).message);
        setResults([]);
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
      getCachedResults,
      readFluidSearchSetting,
      saveSearchState,
      setCachedResults,
    ]
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
      closeEventSource();
      clearPendingResults();
      setResults([]);
      setLoading(false);
      setHasSearched(false);
      setLastSearchedQuery('');
      setLastSearchedSourceId('');
      setTotalSources(0);
      setCompletedSources(0);
      setError('');
      return;
    }

    const forceRefresh = forceNextUrlSearchRef.current;
    forceNextUrlSearchRef.current = false;
    void performSearch(urlQuery, urlSourceId, { forceRefresh });
  }, [
    clearPendingResults,
    closeEventSource,
    performSearch,
    restoreSearchState,
    urlQuery,
    urlSourceId,
  ]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const params = new URLSearchParams({ q: trimmedQuery });
    if (sourceId) params.set('sourceId', sourceId);
    const nextUrl = `/manga/search?${params.toString()}`;
    if (urlQuery === trimmedQuery && urlSourceId === sourceId) {
      await performSearch(trimmedQuery, sourceId, { forceRefresh: true });
    } else {
      forceNextUrlSearchRef.current = true;
      router.replace(nextUrl);
    }
  };

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    if (lastSearchedQuery) params.set('q', lastSearchedQuery);
    if (lastSearchedSourceId) params.set('sourceId', lastSearchedSourceId);
    const queryString = params.toString();
    return queryString ? `/manga/search?${queryString}` : '/manga/search';
  }, [lastSearchedQuery, lastSearchedSourceId]);

  const viewSearchKey = `${lastSearchedSourceId}::${lastSearchedQuery}`;
  const currentView =
    searchView.searchKey === viewSearchKey
      ? searchView
      : emptySearchView(viewSearchKey);

  useEffect(() => {
    let nextView = emptySearchView(viewSearchKey);
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(MANGA_SEARCH_VIEW_KEY) || 'null'
      ) as MangaSearchViewState | null;
      if (saved?.searchKey === viewSearchKey) {
        nextView = {
          ...nextView,
          filterSourceId:
            typeof saved.filterSourceId === 'string'
              ? saved.filterSourceId
              : '',
          selectedKeys: saved.selectedKeys || {},
        };
      }
    } catch {
      // ignore invalid session state
    }
    setSearchView(nextView);
  }, [viewSearchKey]);

  useEffect(() => {
    if (!lastSearchedQuery || searchView.searchKey !== viewSearchKey) return;
    try {
      sessionStorage.setItem(MANGA_SEARCH_VIEW_KEY, JSON.stringify(searchView));
    } catch {
      // ignore session cache failures
    }
  }, [lastSearchedQuery, searchView, viewSearchKey]);

  const groupedResults = useMemo(
    () => groupMangaSearchResults(results),
    [results]
  );
  const sourceFilters = useMemo(
    () => getMangaSearchSourceFilters(groupedResults),
    [groupedResults]
  );
  const visibleGroups = useMemo(
    () =>
      sortMangaSearchGroups(
        groupedResults.filter(
          (group) =>
            !currentView.filterSourceId ||
            group.items.some(
              (item) => item.sourceId === currentView.filterSourceId
            )
        ),
        lastSearchedQuery
      ),
    [currentView.filterSourceId, groupedResults, lastSearchedQuery]
  );

  useEffect(() => {
    setSearchView((prev) => {
      const view =
        prev.searchKey === viewSearchKey
          ? prev
          : emptySearchView(viewSearchKey);
      let selectedKeys = view.selectedKeys;
      for (const group of visibleGroups) {
        const item = getSelectedMangaSearchItem(
          group,
          view.selectedKeys[group.key],
          view.filterSourceId
        );
        const itemKey = mangaSearchItemKey(item);
        if (selectedKeys[group.key] === itemKey) continue;
        if (selectedKeys === view.selectedKeys) {
          selectedKeys = { ...selectedKeys };
        }
        // 固定已显示的来源；保存的来源尚未返回时，也不在后续结果中自动切换。
        selectedKeys[group.key] = itemKey;
      }
      return selectedKeys === view.selectedKeys
        ? prev
        : { ...view, selectedKeys };
    });
  }, [viewSearchKey, visibleGroups]);

  const selectSource = (groupKey: string, itemKey: string) => {
    setSearchView((prev) => {
      const view =
        prev.searchKey === viewSearchKey
          ? prev
          : emptySearchView(viewSearchKey);
      if (view.selectedKeys[groupKey] === itemKey) return prev;
      return {
        ...view,
        selectedKeys: { ...view.selectedKeys, [groupKey]: itemKey },
      };
    });
  };

  const filterBySource = (filterSourceId: string) => {
    setSearchView((prev) => {
      const view =
        prev.searchKey === viewSearchKey
          ? prev
          : emptySearchView(viewSearchKey);
      const selectedKeys = { ...view.selectedKeys };
      if (filterSourceId) {
        for (const group of groupedResults) {
          const item = group.items.find(
            (candidate) => candidate.sourceId === filterSourceId
          );
          if (item) selectedKeys[group.key] = mangaSearchItemKey(item);
        }
      }
      return { ...view, filterSourceId, selectedKeys };
    });
  };

  const toggleShelf = async (item: MangaSearchItem, detail?: MangaDetail) => {
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

    const chronologicalChapters = sortMangaChapters(detail?.chapters || []);
    const latestChapter =
      chronologicalChapters[chronologicalChapters.length - 1];
    const currentRecord = history[key];
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
      lastChapterId: currentRecord?.chapterId,
      lastChapterName: currentRecord?.chapterName,
      latestChapterId: latestChapter?.id,
      latestChapterName: latestChapter?.name,
      latestChapterCount: detail ? chronologicalChapters.length : undefined,
      unreadChapterCount: 0,
    };
    await saveMangaShelf(item.sourceId, item.id, shelfItem);
    setShelf((prev) => ({ ...prev, [key]: shelfItem }));
  };

  return (
    <div className={cn(LIBRARY_TEXT, 'mx-auto max-w-5xl space-y-6 font-sans')}>
      <form onSubmit={handleSearch}>
        <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-3'>
          <div
            className={cn(
              LIBRARY_FIELD,
              'flex h-12 min-w-0 items-center bg-library-card p-0 focus-within:border-library-ochre dark:bg-library-night-card dark:focus-within:border-library-night-ochre'
            )}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='搜索漫画标题'
              aria-label='搜索漫画标题'
              className='h-full min-w-0 flex-1 rounded-l-md border-0 bg-transparent pl-4 pr-2 text-base outline-none placeholder:text-library-muted dark:placeholder:text-library-night-muted sm:text-sm'
            />
            <MangaSearchScope
              sources={sources}
              value={sourceId}
              onChange={setSourceId}
            />
          </div>
          <button
            type='submit'
            aria-label='搜索'
            className={cn(
              LIBRARY_BUTTON,
              'min-h-12 w-12 cursor-pointer px-0 py-3 text-library-chip dark:text-library-night md:w-auto md:px-4 lg:w-24'
            )}
          >
            <Search className='h-4 w-4' strokeWidth={1.5} aria-hidden />
            <span className='hidden md:inline'>搜索</span>
          </button>
        </div>
      </form>

      <section className='space-y-4'>
        <div>
          <div className='flex min-h-11 flex-wrap items-center justify-between gap-x-4'>
            <div className='flex min-w-0 items-center gap-3'>
              <h2 className='text-sm font-medium'>搜索结果</h2>
              {groupedResults.length > 0 && (
                <span className={cn(LIBRARY_MUTED, 'text-sm tabular-nums')}>
                  {visibleGroups.length} 部
                </span>
              )}
              {loading && useFluidSearch && totalSources > 0 && (
                <span
                  role='status'
                  className={cn(LIBRARY_MUTED, 'text-xs tabular-nums')}
                >
                  搜索中 {completedSources}/{totalSources}
                </span>
              )}
            </div>
          </div>
          {groupedResults.length > 0 && (
            <div
              role='group'
              aria-label='筛选搜索来源'
              className='flex min-w-0 gap-3 overflow-x-auto border-b border-library-edge dark:border-library-night-edge [scrollbar-width:thin]'
            >
              <button
                type='button'
                onClick={() => filterBySource('')}
                aria-pressed={!currentView.filterSourceId}
                className={cn(
                  LIBRARY_TEXT_TAB,
                  !currentView.filterSourceId
                    ? LIBRARY_TEXT_TAB_ACTIVE
                    : LIBRARY_TEXT_TAB_IDLE
                )}
              >
                全部
              </button>
              {sourceFilters.map((source) => (
                <button
                  key={source.sourceId}
                  type='button'
                  onClick={() => filterBySource(source.sourceId)}
                  aria-pressed={currentView.filterSourceId === source.sourceId}
                  className={cn(
                    LIBRARY_TEXT_TAB,
                    currentView.filterSourceId === source.sourceId
                      ? LIBRARY_TEXT_TAB_ACTIVE
                      : LIBRARY_TEXT_TAB_IDLE
                  )}
                >
                  {source.sourceName}
                  <span className={cn(LIBRARY_MUTED, 'text-xs tabular-nums')}>
                    {source.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {error && <EmptyState tone='error' description={error} />}
        {loading && results.length === 0 ? (
          <div className='space-y-4' role='status' aria-label='正在搜索漫画'>
            {Array.from({ length: 3 }, (_, index) => (
              <MangaSearchCardSkeleton key={index} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Search className='h-7 w-7' strokeWidth={1.5} />}
            title={hasSearched ? '没有找到相关漫画' : '还没有开始搜索'}
            description={
              hasSearched
                ? '试试更短的关键词，或把来源切到「全部来源」。'
                : '输入漫画标题，回车即可搜索'
            }
          />
        ) : visibleGroups.length === 0 ? (
          <EmptyState
            title='该来源暂无匹配结果'
            description='切换到「全部」查看其他来源的漫画。'
          />
        ) : (
          <div className='space-y-4'>
            {visibleGroups.map((group) => (
              <MangaSearchCard
                key={group.key}
                group={group}
                selectedKey={currentView.selectedKeys[group.key]}
                preferredSourceId={currentView.filterSourceId}
                onSelectSource={(itemKey) => selectSource(group.key, itemKey)}
                shelf={shelf}
                history={history}
                returnTo={returnTo}
                onToggleShelf={toggleShelf}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
