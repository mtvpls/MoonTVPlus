'use client';

import { AlertTriangle, Loader2, Play, Radio, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Favorite, getAllFavorites, getAllPlayRecords, PlayRecord } from '@/lib/db.client';

import TVLayout from '@/components/tv/TVLayout';

type LiveSource = { key: string; name: string };
type LiveChannel = { id: string; name: string; group?: string; logo?: string };
type LastLiveChannel = { source: string; sourceName?: string; id: string; title: string; group?: string; logo?: string; updatedAt?: number };

const TV_LIVE_LAST_CHANNEL_KEY = 'tv_live_last_channel';

function getLogoUrl(logo?: string, source?: string) {
  if (!logo) return '';
  if (logo.startsWith('/api/proxy/logo')) return logo;
  const sourceParam = source ? `&source=${encodeURIComponent(source)}` : '';
  return `/api/proxy/logo?url=${encodeURIComponent(logo)}${sourceParam}`;
}

export default function TVLivePage() {
  const router = useRouter();
  const [sources, setSources] = useState<LiveSource[]>([]);
  const [source, setSource] = useState<string>('');
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('全部');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(120);
  const [quickChannels, setQuickChannels] = useState<Array<{ source: string; id: string; title: string; cover?: string; type: '最近' | '收藏' }>>([]);
  const [lastChannel, setLastChannel] = useState<LastLiveChannel | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TV_LIVE_LAST_CHANNEL_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<LastLiveChannel>;
        if (parsed.source && parsed.id && parsed.title) {
          setLastChannel({
            source: parsed.source,
            sourceName: parsed.sourceName || '',
            id: parsed.id,
            title: parsed.title,
            group: parsed.group || '',
            logo: parsed.logo || '',
            updatedAt: parsed.updatedAt,
          });
        }
      }
    } catch {
      setLastChannel(null);
    }

    fetch('/api/live/sources')
      .then((r) => {
        if (!r.ok) throw new Error('获取直播源失败');
        return r.json();
      })
      .then((data) => {
        const list = data.data || [];
        setSources(list);
        if (list[0]?.key) setSource(list[0].key);
      })
      .catch((err) => setError(err instanceof Error ? err.message : '获取直播源失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([
      getAllPlayRecords().catch(() => ({} as Record<string, PlayRecord>)),
      getAllFavorites().catch(() => ({} as Record<string, Favorite>)),
    ]).then(([records, favorites]) => {
      const recents = Object.entries(records)
        .filter(([, record]) => record.origin === 'live')
        .sort((a, b) => (b[1].save_time || 0) - (a[1].save_time || 0))
        .slice(0, 8)
        .map(([key, record]) => {
          const plus = key.indexOf('+');
          return {
            source: key.slice(0, plus).replace(/^live_/, ''),
            id: key.slice(plus + 1).replace(/^live_/, ''),
            title: record.title,
            cover: record.cover,
            type: '最近' as const,
          };
        });
      const favs = Object.entries(favorites)
        .filter(([, favorite]) => favorite.origin === 'live')
        .sort((a, b) => (b[1].save_time || 0) - (a[1].save_time || 0))
        .slice(0, 8)
        .map(([key, favorite]) => {
          const plus = key.indexOf('+');
          return {
            source: key.slice(0, plus).replace(/^live_/, ''),
            id: key.slice(plus + 1).replace(/^live_/, ''),
            title: favorite.title,
            cover: favorite.cover,
            type: '收藏' as const,
          };
        });
      setQuickChannels([...favs, ...recents].slice(0, 12));
    });
  }, []);

  useEffect(() => {
    if (!source) return;
    setLoading(true);
    setError('');
    setSelectedGroup('全部');
    setVisibleCount(120);
    fetch(`/api/live/channels?source=${encodeURIComponent(source)}`)
      .then((r) => {
        if (r.status === 401 || r.status === 403) throw new Error('无权限访问电视直播，请先登录或检查权限');
        if (!r.ok) throw new Error('获取频道列表失败');
        return r.json();
      })
      .then((data) => setChannels(data.data || []))
      .catch((err) => {
        setChannels([]);
        setError(err instanceof Error ? err.message : '获取频道列表失败');
      })
      .finally(() => setLoading(false));
  }, [source]);

  const groups = useMemo(() => ['全部', ...Array.from(new Set(channels.map((c) => c.group || '其他')))], [channels]);
  const filteredChannels = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return channels.filter((channel) => {
      const groupMatched = selectedGroup === '全部' || (channel.group || '其他') === selectedGroup;
      const queryMatched = !keyword || channel.name.toLowerCase().includes(keyword) || (channel.group || '').toLowerCase().includes(keyword);
      return groupMatched && queryMatched;
    });
  }, [channels, query, selectedGroup]);
  const visibleChannels = useMemo(() => filteredChannels.slice(0, visibleCount), [filteredChannels, visibleCount]);

  return (
    <TVLayout>
      {lastChannel && (
        <section className='mb-8 rounded-[34px] border border-rose-400/30 bg-rose-950/30 p-7 shadow-2xl shadow-black/50'>
          <button
            onClick={() => router.push(`/tv/live/play?source=${encodeURIComponent(lastChannel.source)}&id=${encodeURIComponent(lastChannel.id)}`)}
            className='tv-focusable flex w-full cursor-pointer items-center justify-between gap-6 rounded-3xl bg-white/10 p-6 text-left outline-none transition hover:bg-white/14 focus:ring-4 focus:ring-rose-300'
          >
            <div className='flex min-w-0 items-center gap-5'>
              {lastChannel.logo ? <img src={getLogoUrl(lastChannel.logo, lastChannel.source)} alt='' className='h-20 w-20 rounded-2xl object-contain' /> : <Radio className='h-16 w-16 shrink-0 text-rose-400' />}
              <div className='min-w-0'>
                <div className='mb-2 flex items-center gap-3 text-2xl font-black text-rose-100'>
                  <Play className='h-7 w-7 fill-current' />
                  开始观看
                </div>
                <div className='line-clamp-1 text-4xl font-black text-white'>{lastChannel.title}</div>
                <div className='mt-2 text-xl text-slate-300'>{lastChannel.sourceName || lastChannel.source}{lastChannel.group ? ` · ${lastChannel.group}` : ''}</div>
              </div>
            </div>
            <div className='shrink-0 rounded-2xl bg-rose-600 px-7 py-4 text-2xl font-black text-white'>播放</div>
          </button>
        </section>
      )}

      <section className='rounded-[42px] border border-white/10 bg-slate-950/70 p-10 shadow-2xl shadow-black/60'>
        <div className='flex items-center gap-4'>
          <Radio className='h-14 w-14 text-rose-500' />
          <div>
            <h1 className='text-6xl font-black'>直播</h1>
            <p className='mt-2 text-2xl text-slate-300'>选择频道后进入全屏直播播放页，频道列表作为播放层弹出。</p>
          </div>
        </div>
        <div className='mt-8 flex gap-4 overflow-x-auto px-4 py-4 [scrollbar-width:none]'>
          {sources.map((item) => (
            <button key={item.key} onClick={() => setSource(item.key)} className={`cursor-pointer rounded-2xl px-6 py-4 text-2xl font-bold outline-none transition tv-focusable ${source === item.key ? 'bg-rose-600 text-white' : 'bg-white/8 text-slate-200 hover:bg-white/12'}`}>{item.name}</button>
          ))}
        </div>
        <label className='mt-5 flex h-20 items-center gap-4 rounded-3xl border border-white/10 bg-white/10 px-6 focus-within:border-rose-500'>
          <Search className='h-8 w-8 text-slate-300' />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisibleCount(120); }}
            placeholder='搜索频道或分类'
            className='tv-focusable h-16 flex-1 bg-transparent text-2xl font-bold text-white outline-none placeholder:text-slate-500'
          />
        </label>
      </section>

      {quickChannels.length > 0 && (
        <section className='mt-8 rounded-[34px] border border-white/10 bg-white/[0.04] p-6'>
          <h2 className='mb-5 text-3xl font-black'>常用频道</h2>
          <div className='flex gap-4 overflow-x-auto px-2 py-2 [scrollbar-width:none]'>
            {quickChannels.map((item) => (
              <button key={`${item.type}-${item.source}-${item.id}`} onClick={() => router.push(`/tv/live/play?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.id)}`)} className='tv-focusable flex min-w-[220px] cursor-pointer items-center gap-3 rounded-3xl bg-white/10 p-4 text-left outline-none focus:ring-4 focus:ring-rose-300'>
                {item.cover ? <img src={item.cover} alt='' className='h-12 w-12 rounded-xl object-contain' /> : <Radio className='h-10 w-10 text-rose-400' />}
                <div><div className='line-clamp-1 text-xl font-black'>{item.title}</div><div className='text-base text-slate-400'>{item.type}</div></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {error ? (
        <section role='alert' className='mt-10 rounded-[34px] border border-red-500/40 bg-red-950/45 p-8 text-red-100'>
          <div className='flex items-center gap-4 text-3xl font-black'><AlertTriangle className='h-10 w-10' />{error}</div>
          <button onClick={() => window.location.reload()} className='tv-focusable mt-6 cursor-pointer rounded-2xl bg-rose-600 px-7 py-4 text-2xl font-black text-white outline-none focus:ring-4 focus:ring-rose-300'>重试</button>
        </section>
      ) : loading ? <div className='mt-16 flex justify-center gap-4 text-2xl text-slate-300'><Loader2 className='h-8 w-8 animate-spin' />正在加载频道...</div> : (
        <div className='mt-10 grid grid-cols-[280px_1fr] gap-6'>
          <aside className='rounded-[32px] border border-white/10 bg-white/[0.04] p-4'>
            <div className='max-h-[70vh] space-y-2 overflow-y-auto pr-2'>
              {groups.map((group) => <button key={group} onClick={() => { setSelectedGroup(group); setVisibleCount(120); }} className={`tv-focusable w-full cursor-pointer rounded-2xl px-5 py-4 text-left text-2xl font-bold outline-none focus:ring-4 focus:ring-rose-300 ${selectedGroup === group ? 'bg-rose-600 text-white' : 'text-slate-200 hover:bg-white/10'}`}>{group}</button>)}
            </div>
          </aside>
          <section>
            <div className='mb-4 text-2xl font-bold text-slate-300'>{selectedGroup} · {filteredChannels.length} 个频道</div>
            <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
            {visibleChannels.map((channel, index) => (
              <button key={channel.id} onClick={() => router.push(`/tv/live/play?source=${encodeURIComponent(source)}&id=${encodeURIComponent(channel.id)}`)} className='tv-focusable flex min-h-28 cursor-pointer items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.06] p-5 text-left outline-none transition hover:bg-white/12 focus:ring-4 focus:ring-rose-300'>
                {channel.logo ? <img src={getLogoUrl(channel.logo, source)} alt='' className='h-14 w-14 rounded-xl object-contain' /> : <Radio className='h-12 w-12 text-rose-400' />}
                <div><div className='line-clamp-1 text-2xl font-black'>{channel.name}</div><div className='mt-1 text-lg text-slate-400'>#{index + 1} · {channel.group || '直播频道'}</div></div>
              </button>
            ))}
            </div>
            {visibleCount < filteredChannels.length && (
              <button onClick={() => setVisibleCount((v) => v + 120)} className='tv-focusable mx-auto mt-8 block cursor-pointer rounded-3xl bg-white/10 px-10 py-5 text-2xl font-black text-white outline-none focus:ring-4 focus:ring-rose-300'>
                加载更多频道
              </button>
            )}
          </section>
        </div>
      )}
    </TVLayout>
  );
}
