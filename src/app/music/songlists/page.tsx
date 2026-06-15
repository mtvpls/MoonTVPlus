'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MusicLoadingIndicator from '@/components/music/MusicLoadingIndicator';
import { musicSources, normalizeSource } from '@/lib/music/shared';

interface SongListItem {
  id: string;
  name: string;
  pic?: string;
  source: string;
  author?: string;
  desc?: string;
  play_count?: string | number;
  total?: number;
  updateFrequency?: string;
}

interface SongListTag {
  id: string;
  name: string;
}

interface SongListGroup {
  name: string;
  list: SongListTag[];
}

const sortOptions = [
  { id: 'hot', label: '最热' },
  { id: 'new', label: '最新' },
];

const SONGLIST_CACHE_TTL = 60 * 60 * 1000;

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - Number(cached.timestamp || 0) > SONGLIST_CACHE_TTL) return null;
    return cached.data as T;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // ignore cache write failure
  }
}

export default function MusicSongListsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = normalizeSource(searchParams.get('source'));
  const tagId = searchParams.get('tagId') || '';
  const sortId = searchParams.get('sortId') || 'hot';
  const page = Number(searchParams.get('page') || '1');

  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [groups, setGroups] = useState<SongListGroup[]>([]);
  const [hotTags, setHotTags] = useState<SongListTag[]>([]);
  const [songLists, setSongLists] = useState<SongListItem[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [total, setTotal] = useState(0);
  const [activeTagLabel, setActiveTagLabel] = useState(tagId);
  const [activeSource, setActiveSource] = useState(source);
  const [activeSortId, setActiveSortId] = useState(sortId);

  const currentSourceLabel = musicSources.find((item) => item.key === activeSource)?.label || '音源';

  const updateQuery = (next: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value === undefined || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    if ('source' in next) {
      setGroups([]);
      setHotTags([]);
      setSongLists([]);
      setLoadingTags(true);
      setLoadingList(true);
    } else if ('tagId' in next || 'sortId' in next || 'page' in next) {
      setSongLists([]);
      setLoadingList(true);
    }
    router.push(`/music/songlists?${params.toString()}`);
  };

  useEffect(() => {
    setActiveTagLabel(tagId);
  }, [tagId]);

  useEffect(() => {
    setActiveSource(source);
  }, [source]);

  useEffect(() => {
    setActiveSortId(sortId);
  }, [sortId]);

  useEffect(() => {
    const cacheKey = `music_songlist_tags_${source}`;
    const cached = readCache<{ groups: SongListGroup[]; hotTags: SongListTag[] }>(cacheKey);
    setLoadingTags(true);
    if (cached) {
      setGroups(cached.groups || []);
      setHotTags(cached.hotTags || []);
    }

    fetch(`/api/music/v2/discovery/songlist-tags?source=${source}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const next = {
            groups: data.data?.groups || [],
            hotTags: data.data?.hotTags || [],
          };
          setGroups(next.groups);
          setHotTags(next.hotTags);
          writeCache(cacheKey, next);
        } else if (!cached) {
          setGroups([]);
          setHotTags([]);
        }
      })
      .catch(() => {
        if (!cached) {
          setGroups([]);
          setHotTags([]);
        }
      })
      .finally(() => setLoadingTags(false));
  }, [source]);

  useEffect(() => {
    const cacheKey = `music_songlists_${source}_${tagId}_${sortId}_${page}`;
    const cached = readCache<{ list: SongListItem[]; total: number }>(cacheKey);
    setLoadingList(true);
    if (cached) {
      setSongLists(cached.list || []);
      setTotal(cached.total || 0);
    }

    fetch(`/api/music/v2/discovery/songlists?source=${source}&tagId=${encodeURIComponent(tagId)}&sortId=${encodeURIComponent(sortId)}&page=${page}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const next = {
            list: data.data?.list || [],
            total: data.data?.total || 0,
          };
          setSongLists(next.list);
          setTotal(next.total);
          writeCache(cacheKey, next);
        } else if (!cached) {
          setSongLists([]);
          setTotal(0);
        }
      })
      .catch(() => {
        if (!cached) {
          setSongLists([]);
          setTotal(0);
        }
      })
      .finally(() => setLoadingList(false));
  }, [source, tagId, sortId, page]);

  const openDetail = (item: SongListItem) => {
    router.push(`/music/songlists/${item.source}/${encodeURIComponent(item.id)}?name=${encodeURIComponent(item.name)}`);
  };

  const sortButtonClass = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${active ? 'bg-green-500 text-white' : 'bg-white/10 text-black dark:text-white hover:bg-white/20 dark:hover:bg-white/15'}`;

  const flatTags = hotTags.length > 0 ? hotTags : groups.flatMap((group) => group.list || []);
  const selectedTagLabel = activeTagLabel || '分类';

  return (
    <div>
      <div className="mb-8 flex items-center justify-between gap-3 border-b border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)] pb-4 relative z-[160]">
        <h2 className="text-2xl font-bold text-black dark:text-white tracking-tight">推荐歌单</h2>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSourceMenu((open) => !open)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(0,0,0,0.04)] dark:bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(0,0,0,0.08)] dark:hover:bg-[rgba(255,255,255,0.12)] border border-[rgba(0,0,0,0.04)] dark:border-[rgba(255,255,255,0.04)] shadow-sm transition-all"
            aria-haspopup="listbox"
            aria-expanded={showSourceMenu}
          >
            <span className="text-[13px] text-[rgba(0,0,0,0.5)] dark:text-[rgba(255,255,255,0.5)]">音源</span>
            <span className="text-[13px] font-medium text-black dark:text-white">{currentSourceLabel}</span>
            <svg className="w-3.5 h-3.5 opacity-50 ml-0.5 text-black dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </button>

          {showSourceMenu && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-[150] cursor-default"
                onClick={() => setShowSourceMenu(false)}
                aria-label="关闭菜单"
              />
              <div className="absolute right-0 top-[calc(100%+6px)] z-[160] w-32 p-1.5 overflow-hidden rounded-xl bg-[rgba(255,255,255,0.85)] dark:bg-[rgba(35,35,35,0.85)] backdrop-blur-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.15)] animate-in fade-in zoom-in-95 duration-100 origin-top-right" role="listbox">
                {musicSources.map((item) => {
                  const active = source === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        setActiveSource(item.key);
                        setShowSourceMenu(false);
                        updateQuery({ source: item.key, tagId: '', page: 1 });
                      }}
                      className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-black dark:text-white hover:bg-green-500 hover:text-white transition-none"
                      role="option"
                      aria-selected={active}
                    >
                      <span className="whitespace-nowrap">{item.label}</span>
                      {active && (
                        <svg className="h-3.5 w-3.5 text-black dark:text-white group-hover:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {sortOptions.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveSortId(item.id);
                updateQuery({ sortId: item.id, page: 1 });
              }}
              className={sortButtonClass(activeSortId === item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="relative z-[130]">
          <button
            type="button"
            onClick={() => setShowTagMenu(true)}
            onMouseEnter={() => setShowTagMenu(true)}
            className="flex items-center gap-1.5 px-1 py-2 text-sm text-black dark:text-white transition-colors hover:text-green-500"
          >
            <span>{selectedTagLabel}</span>
            {tagId && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTagLabel('');
                  updateQuery({ tagId: '', page: 1 });
                }}
                className="ml-1 text-zinc-400 hover:text-red-500"
                aria-label="清除分类"
                role="button"
              >
                ✕
              </span>
            )}
            <svg className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showTagMenu && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-[119] cursor-default"
                onClick={() => setShowTagMenu(false)}
                aria-label="关闭分类"
              />
              <div
                className="absolute right-0 top-[calc(100%+6px)] z-[130] w-[min(760px,calc(100vw-2rem))] max-h-[70vh] overflow-auto rounded-2xl border border-[rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.88)] dark:bg-[rgba(35,35,35,0.88)] backdrop-blur-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-4"
                onMouseLeave={() => setShowTagMenu(false)}
              >
                {loadingTags ? (
                  <MusicLoadingIndicator className="py-8" />
                ) : hotTags.length > 0 && (
                  <div className="mb-5">
                    <div className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">热门标签</div>
                    <div className="flex flex-wrap gap-2">
                      {hotTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => {
                            setActiveTagLabel(tag.name);
                            setShowTagMenu(false);
                            updateQuery({ tagId: tag.name, page: 1 });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm transition-all ${tagId === tag.name ? 'bg-green-500 text-white' : 'bg-white text-black hover:bg-zinc-100 dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-700'}`}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {groups.length > 0 && groups.map((group) => (
                  <div key={group.name} className="mb-5 last:mb-0">
                    <div className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">{group.name}</div>
                    <div className="flex flex-wrap gap-2">
                      {group.list.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => {
                    setActiveTagLabel(tag.name);
                    setShowTagMenu(false);
                    updateQuery({ tagId: tag.name, page: 1 });
                  }}
                          className={`px-3 py-1.5 rounded-lg text-sm transition-all ${tagId === tag.name ? 'bg-green-500 text-white' : 'bg-white text-black hover:bg-zinc-100 dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-700'}`}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {loadingList ? (
        <MusicLoadingIndicator className="py-12" />
      ) : songLists.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {songLists.map((item) => (
            <button
              key={item.id}
              onClick={() => openDetail(item)}
              className="group overflow-hidden rounded-2xl border border-white/5 bg-white/5 text-left transition-all hover:-translate-y-0.5 hover:bg-white/10"
            >
              <div className="aspect-square bg-white/5">
                {item.pic ? (
                  <img src={item.pic} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-600">♪</div>
                )}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium text-white">{item.name}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
                  <span>{item.author || '未知作者'}</span>
                  <span>{item.total ? `${item.total} 首` : ''}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 p-12 text-center text-zinc-400">
          <div className="text-lg font-medium text-zinc-300 mb-1">暂无歌单</div>
          <div className="text-sm text-zinc-500">当前音源暂无推荐歌单数据</div>
        </div>
      )}

      {total > 0 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => updateQuery({ page: page - 1 })}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-sm text-zinc-500">第 {page} 页</span>
          <button
            onClick={() => updateQuery({ page: page + 1 })}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
