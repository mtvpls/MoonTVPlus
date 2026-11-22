'use client';

import { Film, Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { addSearchHistory, getSearchHistory } from '@/lib/db.client';
import {
  getTVSearchGroupKey,
  getTVSearchType,
  getTVSearchYear,
  uniqueTVSearchSources,
} from '@/lib/tv-search';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import { cacheTVSearchResults } from '@/components/tv/player/utils';
import TVLayout from '@/components/tv/TVLayout';

const hot = [
  '庆余年',
  '流浪地球',
  '繁花',
  '甄嬛传',
  '鬼灭之刃',
  '歌手',
  '三体',
  '权力的游戏',
];

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
  stype: 'movie' | 'tv';
  isAggregate: boolean;
};

function getTVDetailUrl(item: TVSearchDisplayItem, query: string) {
  const params = new URLSearchParams({
    title: item.title,
    year: getTVSearchYear(item),
    stype: item.stype,
    q: query,
  });
  if (item.source) params.set('source', item.source);
  if (item.id) params.set('id', item.id);
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
    getSearchHistory()
      .then(setHistory)
      .catch(() => setHistory([]));
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
        cacheTVSearchResults(q, nextResults);
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
      const key = getTVSearchGroupKey(item);
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)?.push(item);
    });

    return order.map((key) => {
      const group = uniqueTVSearchSources(groups.get(key) || []);
      const first = group[0];
      const sourceNames = group
        .map((item) => item.source_name || item.source)
        .filter(Boolean);
      const bestPoster =
        group.find((item) => item.poster)?.poster || first?.poster || '';
      const bestYear =
        group.find((item) => getTVSearchYear(item) !== 'unknown')?.year ||
        first?.year ||
        '';
      const bestRemarks =
        group.find((item) => item.vod_remarks)?.vod_remarks ||
        first?.vod_remarks ||
        '';

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
        stype: getTVSearchType(first),
        isAggregate: group.length > 1,
      };
    });
  }, [results]);

  useEffect(() => {
    if (loading || error || displayResults.length === 0) return;
    window.requestAnimationFrame(() => {
      firstResultRef.current?.focus({ preventScroll: true });
      firstResultRef.current?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      });
    });
  }, [displayResults.length, error, loading]);

  return (
    <TVLayout>
      <div data-tv-focus-scope='active'>
        <section className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'>
          <h1 className='text-4xl font-medium leading-tight lg:text-5xl'>
            搜索
          </h1>
          <p className='mt-3 text-xl leading-8 text-[#a1a1a6]'>
            搜索片名，选择影片查看详情
          </p>
          <form
            onSubmit={submit}
            className='mt-6 flex flex-col gap-3 sm:flex-row'
          >
            <label className='sr-only' htmlFor='tv-search'>
              搜索片名
            </label>
            <input
              id='tv-search'
              autoFocus
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='输入片名'
              className='tv-focusable h-16 w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#232325] px-5 text-xl text-[#ededed] outline-none placeholder:text-[#8d8d93] focus:border-white/20 sm:w-auto sm:flex-1 lg:text-2xl'
            />
            <button
              type='submit'
              className='tv-focusable tv-focusable-light flex h-16 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#ededed] px-6 text-xl font-medium text-[#171717] outline-none hover:bg-white lg:text-2xl'
            >
              <Search
                className='h-[18px] w-[18px]'
                strokeWidth={1.5}
                aria-hidden='true'
              />{' '}
              搜索
            </button>
          </form>
        </section>
        {(loading || searched || error) && (
          <section className='mt-8'>
            <div className='mb-4 flex items-center justify-between gap-4'>
              <h2 className='break-words text-2xl font-medium lg:text-3xl'>
                {searched ? `“${searched}” 的搜索结果` : '搜索结果'}
              </h2>
            </div>
            {error ? (
              <div
                role='alert'
                className='rounded-2xl border border-red-500/20 bg-[#19191b] p-6 text-xl text-red-300'
              >
                {error}
              </div>
            ) : loading ? (
              <div
                role='status'
                className='flex min-h-48 flex-col items-center justify-center gap-5 text-xl text-[#a1a1a6]'
              >
                <Search
                  aria-hidden='true'
                  strokeWidth={1.5}
                  className='h-16 w-16 text-[#8d8d93]'
                />
                <div className='flex items-center gap-3'>
                  <Loader2
                    aria-hidden='true'
                    strokeWidth={1.5}
                    className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
                  />
                  正在搜索
                </div>
              </div>
            ) : displayResults.length === 0 ? (
              <div
                role='status'
                className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-xl text-[#a1a1a6]'
              >
                未找到相关结果
              </div>
            ) : (
              <div className='grid grid-cols-2 items-start gap-4 md:grid-cols-4 2xl:grid-cols-6'>
                {displayResults.map((item, index) => (
                  <button
                    key={item.key}
                    type='button'
                    aria-label={item.title}
                    ref={index === 0 ? firstResultRef : undefined}
                    onClick={() => router.push(getTVDetailUrl(item, searched))}
                    className='tv-focusable cursor-pointer rounded-2xl p-2 text-left outline-none hover:bg-[#232325] focus:bg-[#232325]'
                  >
                    <div className='aspect-[2/3] overflow-hidden rounded-lg bg-[#232325]'>
                      {item.poster ? (
                        <img
                          src={processImageUrl(item.poster)}
                          alt=''
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <div className='flex h-full items-center justify-center'>
                          <Film
                            className='h-12 w-12 text-[#8d8d93]'
                            strokeWidth={1.5}
                            aria-hidden='true'
                          />
                        </div>
                      )}
                    </div>
                    <div className='pt-3'>
                      <div className='line-clamp-1 text-xl font-medium leading-7 text-[#ededed]'>
                        {item.title}
                      </div>
                      <div className='mt-1 line-clamp-1 text-lg text-[#a1a1a6]'>
                        {item.isAggregate
                          ? `${item.sourceNames.length} 个播放源`
                          : item.sourceName}
                      </div>
                      <div className='mt-2 flex flex-wrap gap-2 text-base tabular-nums text-[#8d8d93]'>
                        <span>{item.stype === 'movie' ? '电影' : '剧集'}</span>
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
        {!searched && (
          <>
            {history.length > 0 && (
              <section className='mt-8'>
                <h2 className='text-2xl font-medium lg:text-3xl'>搜索历史</h2>
                <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4'>
                  {history.slice(0, 20).map((item) => (
                    <button
                      key={item}
                      onClick={() => runSearch(item)}
                      className='tv-focusable min-h-16 cursor-pointer break-words rounded-lg border border-white/[0.08] bg-[#19191b] px-4 py-3 text-xl text-[#ededed] outline-none hover:bg-[#232325]'
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section className='mt-8'>
              <h2 className='text-2xl font-medium lg:text-3xl'>热门搜索</h2>
              <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4'>
                {hot.map((item) => (
                  <button
                    key={item}
                    onClick={() => runSearch(item)}
                    className='tv-focusable min-h-16 cursor-pointer break-words rounded-lg border border-white/[0.08] bg-[#19191b] px-4 py-3 text-xl text-[#ededed] outline-none hover:bg-[#232325]'
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </TVLayout>
  );
}
