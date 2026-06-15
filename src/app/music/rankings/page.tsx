'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MusicLoadingIndicator from '@/components/music/MusicLoadingIndicator';
import { musicSources, normalizeSource } from '@/lib/music/shared';
import type { Playlist } from '@/lib/music/types';

export default function MusicRankingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentSource, setCurrentSource] = useState(normalizeSource(searchParams.get('source')));
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const source = normalizeSource(searchParams.get('source'));
    setCurrentSource(source);
    setLoading(true);
    fetch(`/api/music/v2/discovery/boards?source=${source}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setPlaylists((data.data?.list || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            source: normalizeSource(item.source || data.data?.source || source),
            updateFrequency: item.updateFrequency || item.description || '',
          })));
        } else {
          setPlaylists([]);
        }
      })
      .catch(() => setPlaylists([]))
      .finally(() => setLoading(false));
  }, [searchParams]);

  const currentSourceLabel = musicSources.find(s => s.key === currentSource)?.label || '音源';

  return (
    <div>
      <div className="mb-8 flex items-center justify-between border-b border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)] pb-4 relative z-50">
        <h2 className="text-2xl font-bold text-black dark:text-white tracking-tight">热歌榜单</h2>
        
        {/* Pixel-perfect macOS Source Switcher */}
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
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setShowSourceMenu(false)}
                aria-label="关闭菜单"
              />
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-32 p-1.5 overflow-hidden rounded-xl bg-[rgba(255,255,255,0.85)] dark:bg-[rgba(35,35,35,0.85)] backdrop-blur-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.15)] animate-in fade-in zoom-in-95 duration-100 origin-top-right" role="listbox">
                {musicSources.map((item) => {
                  const active = currentSource === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        setShowSourceMenu(false);
                        router.push(`/music/rankings?source=${item.key}`);
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
      {loading ? <MusicLoadingIndicator className="py-12" /> : playlists.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {playlists.map((playlist, index) => (
            <button
              key={playlist.id}
              onClick={() => router.push(`/music/rankings/${playlist.source || currentSource}/${encodeURIComponent(playlist.id)}?name=${encodeURIComponent(playlist.name)}`)}
              className="group relative w-full text-left overflow-hidden rounded-2xl border border-white/5 bg-white/5 hover:bg-white/10 transition-all duration-300 p-4 hover:-translate-y-1 hover:shadow-xl backdrop-blur-sm"
            >
              <div className="absolute top-0 right-0 -mt-2 -mr-2 w-16 h-16 bg-white/5 rounded-full blur-xl group-hover:bg-green-500/20 transition-colors duration-500"></div>
              <div className="flex items-center gap-4 relative z-10">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-lg font-bold text-zinc-400 font-mono shadow-inner group-hover:bg-green-500/20 group-hover:text-green-500 transition-colors">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold text-white/90 truncate group-hover:text-white transition-colors">{playlist.name}</div>
                  {playlist.updateFrequency ? (
                    <div className="text-xs text-zinc-500 mt-1 truncate group-hover:text-zinc-400 transition-colors flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {playlist.updateFrequency}
                    </div>
                  ) : null}
                </div>
                <div className="text-zinc-600 group-hover:text-green-500 group-hover:translate-x-1 transition-all duration-300 shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 p-12 text-center text-zinc-400">
          <svg className="mb-4 h-12 w-12 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <div className="text-lg font-medium text-zinc-300 mb-1">暂无数据</div>
          <div className="text-sm text-zinc-500">当前音源暂无排行榜数据</div>
        </div>
      )}
    </div>
  );
}
