'use client';

import { Film, Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { addSearchHistory, getSearchHistory } from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import TVLayout from '@/components/tv/TVLayout';

const hot = ['庆余年', '流浪地球', '繁花', '甄嬛传', '鬼灭之刃', '歌手', '三体', '权力的游戏'];

function getSearchCacheKey(query: string) {
  return `search_cache_${query.trim()}`;
}

function setCachedSearchResults(query: string, nextResults: SearchResult[]) {
  try {
    sessionStorage.setItem(
      getSearchCacheKey(query),
      JSON.stringify({
        status: 'complete',
        results: nextResults,
        query: query.trim(),
        updatedAt: Date.now(),
      })
    );
  } catch {
    // ignore storage failures
  }
}

type TVSearchDisplayItem = {
  key: string;
  title: string;
  poster?: string;
  year?: string;
  vodRemarks?: string;
  sourceName?: string;
  sourceNames: string[];
  source?: string;
  id?: string;
  isAggregate: boolean;
};

function normalizeTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[第\s._\-:：]+/g, '')
    .replace(/[（(].*?[）)]/g, '');
}

function getResultType(item: SearchResult) {
  const text = `${item.type_name || ''} ${item.class || ''}`.toLowerCase();
  if (text.includes('电影') || text.includes('movie')) return 'movie';
  return 'tv';
}

function getValidYear(item: SearchResult) {
  return item.year && /^\d{4}$/.test(item.year) ? item.year : 'unknown';
}

function getTVDetailUrl(item: TVSearchDisplayItem) {
  const params = new URLSearchParams({
    title: item.title,
  });
  if (!item.isAggregate && item.source) params.set('source', item.source);
  if (!item.isAggregate && item.id) params.set('id', item.id);
  return `/tv/detail?${params.toString()}`;
}

export default function TVSearchPage() {
  const [keyword, setKeyword] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState('');
  const firstResultRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    getSearchHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  const runSearch = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setKeyword(q);
    setSearched(q);
    setLoading(true);
    setError('');
    setResults([]);
    addSearchHistory(q).catch(() => undefined);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((response) => {
        if (!response.ok) throw new Error('搜索失败');
        return response.json();
      })
      .then((data) => {
        const nextResults = Array.isArray(data.results) ? data.results : [];
        setResults(nextResults);
        setCachedSearchResults(q, nextResults);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '搜索失败');
      })
      .finally(() => setLoading(false));
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    runSearch(keyword);
  };

  const displayResults = useMemo<TVSearchDisplayItem[]>(() => {
    const groups = new Map<string, SearchResult[]>();
    const order: string[] = [];

    results.forEach((item) => {
      const key = `${normalizeTitle(item.title)}-${getResultType(item)}-${getValidYear(item)}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)?.push(item);
    });

    return order.map((key) => {
      const group = groups.get(key) || [];
      const first = group[0];
      const sourceNames = Array.from(new Set(group.map((item) => item.source_name || item.source).filter(Boolean)));
      const bestPoster = group.find((item) => item.poster)?.poster || first?.poster || '';
      const bestYear = group.find((item) => getValidYear(item) !== 'unknown')?.year || first?.year || '';
      const bestRemarks = group.find((item) => item.vod_remarks)?.vod_remarks || first?.vod_remarks || '';

      return {
        key,
        title: first?.title || '',
        poster: bestPoster,
        year: bestYear,
        vodRemarks: bestRemarks,
        sourceName: first?.source_name || first?.source || '',
        sourceNames,
        source: first?.source,
        id: first?.id,
        isAggregate: group.length > 1,
      };
    });
  }, [results]);

  useEffect(() => {
    if (loading || error || displayResults.length === 0) return;
    window.requestAnimationFrame(() => {
      firstResultRef.current?.focus({ preventScroll: true });
      firstResultRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  }, [displayResults.length, error, loading]);

  return (
    <TVLayout>
      <div data-tv-focus-scope='active'>
      <section className='mx-auto max-w-6xl rounded-[42px] border border-white/10 bg-slate-950/70 p-10 shadow-2xl shadow-black/60'>
        <h1 className='text-6xl font-black'>搜索</h1>
        <p className='mt-4 text-2xl text-slate-300'>输入片名后查看搜索结果，选择影片进入详情页后播放。</p>
        <form onSubmit={submit} className='mt-10 flex gap-4'>
          <label className='sr-only' htmlFor='tv-search'>搜索片名</label>
          <input
            id='tv-search'
            autoFocus
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder='输入电影、剧集、动漫、综艺名称'
            className='h-20 flex-1 rounded-3xl border border-white/10 bg-white/10 px-8 text-3xl text-white outline-none placeholder:text-slate-500 focus:border-rose-500 tv-focusable'
          />
          <button type='submit' className='flex h-20 cursor-pointer items-center gap-3 rounded-3xl bg-rose-600 px-10 text-3xl font-black text-white outline-none transition hover:bg-rose-500 tv-focusable'>
            <Search className='h-9 w-9' /> 搜索
          </button>
        </form>
      </section>
      {(loading || searched || error) && (
        <section className='mx-auto mt-12 max-w-6xl'>
          <div className='mb-6 flex items-center justify-between gap-4'>
            <h2 className='text-4xl font-black'>{searched ? `“${searched}” 的搜索结果` : '搜索结果'}</h2>
            {loading && <div className='flex items-center gap-3 text-2xl font-bold text-slate-300'><Loader2 className='h-7 w-7 animate-spin text-rose-500' />搜索中...</div>}
          </div>
          {error ? (
            <div className='rounded-3xl border border-red-500/40 bg-red-950/40 p-8 text-2xl font-bold text-red-100'>{error}</div>
          ) : loading ? null : displayResults.length === 0 ? (
            <div className='rounded-3xl border border-white/10 bg-white/[0.06] p-8 text-2xl font-bold text-slate-300'>未找到相关结果</div>
          ) : (
            <div className='grid grid-cols-2 gap-5 lg:grid-cols-4'>
              {displayResults.map((item, index) => (
                <button
                  key={item.key}
                  ref={index === 0 ? firstResultRef : undefined}
                  onClick={() => router.push(getTVDetailUrl(item))}
                  className='tv-focusable cursor-pointer overflow-hidden rounded-3xl border border-white/10 bg-white/[0.06] text-left outline-none transition hover:bg-white/12 focus:ring-4 focus:ring-rose-300'
                >
                  <div className='aspect-[2/3] bg-slate-900'>
                    {item.poster ? (
                      <img src={processImageUrl(item.poster)} alt='' className='h-full w-full object-cover' />
                    ) : (
                      <div className='flex h-full items-center justify-center'><Film className='h-16 w-16 text-slate-600' /></div>
                    )}
                  </div>
                  <div className='p-5'>
                    <div className='line-clamp-1 text-2xl font-black text-white'>{item.title}</div>
                    <div className='mt-2 line-clamp-1 text-lg font-bold text-slate-300'>{item.isAggregate ? `${item.sourceNames.length} 个播放源` : item.sourceName}</div>
                    <div className='mt-2 flex flex-wrap gap-2 text-base font-bold text-slate-400'>
                      {item.year && <span>{item.year}</span>}
                      {item.vodRemarks && <span>{item.vodRemarks}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {history.length > 0 && (
        <section className='mx-auto mt-12 max-w-6xl'>
          <h2 className='text-4xl font-black'>搜索历史</h2>
          <div className='mt-6 grid grid-cols-2 gap-4 md:grid-cols-4'>
            {history.slice(0, 20).map((item) => (
              <button key={item} onClick={() => runSearch(item)} className='cursor-pointer rounded-3xl border border-white/10 bg-white/[0.06] px-6 py-5 text-2xl font-bold text-white outline-none transition hover:bg-white/12 tv-focusable'>
                {item}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className='mx-auto mt-12 max-w-6xl'>
        <h2 className='text-4xl font-black'>热门搜索</h2>
        <div className='mt-6 grid grid-cols-2 gap-4 md:grid-cols-4'>
          {hot.map((item) => (
            <button key={item} onClick={() => runSearch(item)} className='cursor-pointer rounded-3xl border border-white/10 bg-white/[0.06] px-6 py-5 text-2xl font-bold text-white outline-none transition hover:bg-white/12 tv-focusable'>
              {item}
            </button>
          ))}
        </div>
      </section>
      </div>
    </TVLayout>
  );
}
