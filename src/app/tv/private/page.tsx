'use client';

import { Folder, HardDrive, Loader2, Lock, PlayCircle, Server } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { base58Encode } from '@/lib/utils';

import TVLayout from '@/components/tv/TVLayout';
import TVCard from '@/components/tv/TVCard';
import { TVItem } from '@/components/tv/types';

type SourceType = 'openlist' | 'emby' | 'xiaoya';
type Video = { id: string; title: string; poster?: string; year?: string; rating?: number; voteAverage?: number };
type EmbySource = { key: string; name: string };
type XiaoyaItem = { name: string; path: string };

export default function TVPrivatePage() {
  const router = useRouter();
  const runtimeConfig = useMemo(() => (typeof window !== 'undefined' ? (window as any).RUNTIME_CONFIG || {} : {}), []);
  const enabledSources: SourceType[] = useMemo(() => [
    runtimeConfig.OPENLIST_ENABLED ? 'openlist' : null,
    runtimeConfig.EMBY_ENABLED ? 'emby' : null,
    runtimeConfig.XIAOYA_ENABLED ? 'xiaoya' : null,
  ].filter(Boolean) as SourceType[], [runtimeConfig]);

  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [source, setSource] = useState<SourceType>('openlist');
  const [embyKey, setEmbyKey] = useState('');
  const [embySources, setEmbySources] = useState<EmbySource[]>([]);
  const [videos, setVideos] = useState<TVItem[]>([]);
  const [folders, setFolders] = useState<XiaoyaItem[]>([]);
  const [files, setFiles] = useState<XiaoyaItem[]>([]);
  const [xiaoyaPath, setXiaoyaPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const ok = Boolean(getAuthInfoFromBrowserCookie());
    setAuthed(ok);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && !authed) router.replace('/tv/login?redirect=/tv/private');
  }, [ready, authed, router]);

  useEffect(() => {
    if (enabledSources.length > 0 && !enabledSources.includes(source)) {
      setSource(enabledSources[0]);
    }
  }, [enabledSources, source]);

  useEffect(() => {
    if (source !== 'emby') return;
    fetch('/api/emby/sources').then((r) => r.json()).then((data) => {
      const list = data.sources || [];
      setEmbySources(list);
      if (!embyKey && list[0]?.key) setEmbyKey(list[0].key);
    }).catch(() => undefined);
  }, [source, embyKey]);

  const load = useCallback(async () => {
    if (!authed || enabledSources.length === 0) return;
    if (source === 'emby' && !embyKey) return;
    setLoading(true);
    setError('');
    setVideos([]);
    setFolders([]);
    setFiles([]);
    try {
      const endpoint = source === 'openlist'
        ? '/api/openlist/list?page=1&pageSize=40'
        : source === 'xiaoya'
        ? `/api/xiaoya/browse?path=${encodeURIComponent(xiaoyaPath)}`
        : `/api/emby/list?page=1&pageSize=40&embyKey=${encodeURIComponent(embyKey)}&sortBy=DateCreated&sortOrder=Descending`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('获取私人影库失败');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (source === 'xiaoya') {
        setFolders(data.folders || []);
        setFiles(data.files || []);
      } else {
        const list: Video[] = data.list || [];
        setVideos(list.map((item) => ({
          id: item.id,
          title: item.title,
          poster: item.poster,
          year: item.year,
          rate: item.rating || item.voteAverage ? String(item.rating || item.voteAverage) : '私人',
          href: `/tv/play?source=${encodeURIComponent(source === 'emby' && embySources.length > 1 ? `emby:${embyKey}` : source)}&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}`,
        })));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取私人影库失败');
    } finally {
      setLoading(false);
    }
  }, [authed, enabledSources.length, source, embyKey, embySources.length, xiaoyaPath]);

  useEffect(() => { load(); }, [load]);

  const sourceLabel = { openlist: 'OpenList', emby: 'Emby', xiaoya: '小雅' };

  if (!ready || !authed) {
    return <TVLayout><section className='mx-auto max-w-5xl rounded-[42px] border border-white/10 bg-slate-950/70 p-12 text-center shadow-2xl shadow-black/60'><Lock className='mx-auto h-20 w-20 text-rose-500' /><h1 className='mt-6 text-6xl font-black'>需要扫码登录</h1><p className='mt-5 text-2xl text-slate-300'>正在跳转到电视扫码登录页...</p></section></TVLayout>;
  }

  return (
    <TVLayout>
      <section className='rounded-[42px] border border-white/10 bg-slate-950/70 p-8 shadow-2xl shadow-black/60'>
        <div className='flex items-center justify-between gap-6'>
          <div className='flex items-center gap-4'><HardDrive className='h-14 w-14 text-rose-500' /><div><h1 className='text-6xl font-black'>私人影库</h1><p className='mt-2 text-2xl text-slate-300'>已接入真实 OpenList / Emby / 小雅数据。</p></div></div>
          <div className='flex gap-3'>
            {enabledSources.map((item) => <button key={item} onClick={() => setSource(item)} className={`cursor-pointer rounded-2xl px-6 py-4 text-2xl font-bold outline-none transition tv-focusable ${source === item ? 'bg-rose-600 text-white' : 'bg-white/8 text-slate-200 hover:bg-white/12'}`}>{sourceLabel[item]}</button>)}
          </div>
        </div>
        {source === 'emby' && embySources.length > 1 && <div className='mt-6 flex gap-3 overflow-x-auto px-3 py-3 [scrollbar-width:none]'>{embySources.map((item) => <button key={item.key} onClick={() => setEmbyKey(item.key)} className={`cursor-pointer rounded-2xl px-5 py-3 text-xl font-bold ${embyKey === item.key ? 'bg-white text-black' : 'bg-white/10 text-white'}`}><Server className='mr-2 inline h-5 w-5' />{item.name}</button>)}</div>}
      </section>

      {loading && <div className='mt-16 flex justify-center gap-4 text-2xl text-slate-300'><Loader2 className='h-8 w-8 animate-spin' />正在加载私人影库...</div>}
      {error && <div className='mt-8 rounded-3xl border border-red-500/40 bg-red-950/40 p-6 text-2xl text-red-100'>{error}</div>}
      {!loading && enabledSources.length === 0 && <div className='mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-2xl text-slate-300'>未启用私人影库源。</div>}

      {!loading && source !== 'xiaoya' && videos.length > 0 && <section className='mt-10 grid grid-cols-2 gap-5 md:grid-cols-4 lg:grid-cols-6'>{videos.map((item) => <TVCard key={item.id} item={item} />)}</section>}

      {!loading && source === 'xiaoya' && <section className='mt-10 space-y-8'>
        <div className='rounded-3xl bg-white/[0.04] p-5 text-xl text-slate-300'>当前位置：{xiaoyaPath}</div>
        {xiaoyaPath !== '/' && <button onClick={() => setXiaoyaPath('/' + xiaoyaPath.split('/').filter(Boolean).slice(0, -1).join('/'))} className='cursor-pointer rounded-2xl bg-white/10 px-6 py-4 text-2xl font-bold outline-none tv-focusable'>返回上级</button>}
        {folders.length > 0 && <div><h2 className='mb-5 text-4xl font-black'>文件夹</h2><div className='grid grid-cols-2 gap-4 md:grid-cols-4'>{folders.map((folder) => <button key={folder.path} onClick={() => setXiaoyaPath(folder.path)} className='flex min-h-24 cursor-pointer items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.06] p-5 text-left text-2xl font-bold outline-none tv-focusable'><Folder className='h-9 w-9 text-rose-400' />{folder.name}</button>)}</div></div>}
        {files.length > 0 && <div><h2 className='mb-5 text-4xl font-black'>视频文件</h2><div className='grid gap-4'>{files.map((file) => {
          const pathParts = xiaoyaPath.split('/').filter(Boolean);
          const folderName = pathParts[pathParts.length - 1] || '';
          const title = folderName.replace(/\s*\(\d{4}\)\s*\{tmdb-\d+\}$/i, '').trim() || file.name;
          const encodedDirPath = base58Encode(xiaoyaPath);
          return <button key={file.path} onClick={() => router.push(`/tv/play?source=xiaoya&id=${encodeURIComponent(encodedDirPath)}&fileName=${encodeURIComponent(file.name)}&title=${encodeURIComponent(title)}`)} className='flex cursor-pointer items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.06] p-5 text-left text-2xl font-bold outline-none tv-focusable'><PlayCircle className='h-9 w-9 text-rose-400' />{file.name}</button>;
        })}</div></div>}
      </section>}
    </TVLayout>
  );
}
