'use client';

import { ArrowLeft, Folder, Loader2, PlayCircle, Server } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { base58Encode } from '@/lib/utils';

import TVCard from '@/components/tv/TVCard';
import TVLayout from '@/components/tv/TVLayout';
import { TVItem } from '@/components/tv/types';

type SourceType = 'openlist' | 'emby' | 'xiaoya';
type Video = {
  id: string;
  title: string;
  poster?: string;
  year?: string;
  rating?: number;
  voteAverage?: number;
};
type PrivateRuntimeConfig = {
  OPENLIST_ENABLED?: boolean;
  EMBY_ENABLED?: boolean;
  XIAOYA_ENABLED?: boolean;
};

type EmbySource = { key: string; name: string };
type XiaoyaItem = { name: string; path: string };

const sourceLabel = { openlist: 'OpenList', emby: 'Emby', xiaoya: '小雅' };

export default function TVPrivatePage() {
  const router = useRouter();
  const runtimeConfig = useMemo(
    () =>
      typeof window !== 'undefined'
        ? (window as Window & { RUNTIME_CONFIG?: PrivateRuntimeConfig })
            .RUNTIME_CONFIG || {}
        : {},
    []
  );
  const enabledSources: SourceType[] = useMemo(
    () =>
      [
        runtimeConfig.OPENLIST_ENABLED ? 'openlist' : null,
        runtimeConfig.EMBY_ENABLED ? 'emby' : null,
        runtimeConfig.XIAOYA_ENABLED ? 'xiaoya' : null,
      ].filter(Boolean) as SourceType[],
    [runtimeConfig]
  );

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
  const [embyLoading, setEmbyLoading] = useState(false);

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
    if (!authed || source !== 'emby' || !enabledSources.includes('emby'))
      return;
    const controller = new AbortController();
    setEmbyLoading(true);
    setError('');
    fetch('/api/emby/sources', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('获取 Emby 影库源失败');
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (data.error) throw new Error(data.error);
        const list: EmbySource[] = data.sources || [];
        setEmbySources(list);
        setEmbyKey((current) =>
          list.some((item) => item.key === current)
            ? current
            : list[0]?.key || ''
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : '获取 Emby 影库源失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setEmbyLoading(false);
      });
    return () => controller.abort();
  }, [source, authed, enabledSources]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!authed || !enabledSources.includes(source)) return;
      setError('');
      setVideos([]);
      setFolders([]);
      setFiles([]);
      if (source === 'emby' && !embyKey) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const endpoint =
          source === 'openlist'
            ? '/api/openlist/list?page=1&pageSize=40'
            : source === 'xiaoya'
            ? `/api/xiaoya/browse?path=${encodeURIComponent(xiaoyaPath)}`
            : `/api/emby/list?page=1&pageSize=40&embyKey=${encodeURIComponent(
                embyKey
              )}&sortBy=DateCreated&sortOrder=Descending`;
        const res = await fetch(endpoint, { signal });
        if (!res.ok) throw new Error('获取私人影库失败');
        const data = await res.json();
        if (signal.aborted) return;
        if (data.error) throw new Error(data.error);
        if (source === 'xiaoya') {
          setFolders(data.folders || []);
          setFiles(data.files || []);
        } else {
          const list: Video[] = data.list || [];
          setVideos(
            list.map((item) => ({
              id: item.id,
              title: item.title,
              poster: item.poster,
              year: item.year,
              rate:
                item.rating || item.voteAverage
                  ? String(item.rating || item.voteAverage)
                  : '私人',
              href: `/tv/play?source=${encodeURIComponent(
                source === 'emby' && embySources.length > 1
                  ? `emby:${embyKey}`
                  : source
              )}&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(
                item.title
              )}`,
            }))
          );
        }
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : '获取私人影库失败');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [authed, enabledSources, source, embyKey, embySources.length, xiaoyaPath]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const busy = loading || (source === 'emby' && embyLoading);

  if (!ready || !authed) {
    return (
      <TVLayout>
        <section
          role='status'
          className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-xl text-[#a1a1a6]'
        >
          正在跳转到扫码登录页
        </section>
      </TVLayout>
    );
  }

  return (
    <TVLayout>
      <section className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
          <div className='min-w-0'>
            <h1 className='text-4xl font-medium leading-tight lg:text-5xl'>
              私人影库
            </h1>
            <p className='mt-3 text-lg leading-7 text-[#a1a1a6] lg:text-xl'>
              {enabledSources.length > 0
                ? `已启用 ${enabledSources
                    .map((item) => sourceLabel[item])
                    .join(' · ')}`
                : '浏览当前账号的私人影片收藏'}
            </p>
          </div>
          {enabledSources.length > 0 && (
            <div className='-mx-2 shrink-0 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              <div
                data-tv-focus-row='horizontal'
                aria-label='私人影库来源'
                className='flex w-max min-w-full gap-3'
              >
                {enabledSources.map((item) => (
                  <button
                    key={item}
                    type='button'
                    aria-pressed={source === item}
                    onClick={() => setSource(item)}
                    className={`tv-focusable h-14 shrink-0 cursor-pointer whitespace-nowrap rounded-lg border px-6 text-xl outline-none ${
                      source === item
                        ? 'border-white/10 bg-[#232325] font-medium text-[#ededed]'
                        : 'border-transparent text-[#a1a1a6] hover:bg-[#232325] hover:text-[#ededed]'
                    }`}
                  >
                    {sourceLabel[item]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {source === 'emby' && embySources.length > 1 && (
          <div className='-mx-2 mt-3 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
            <div
              data-tv-focus-row='horizontal'
              aria-label='Emby 影库'
              className='flex w-max min-w-full gap-3'
            >
              {embySources.map((item) => (
                <button
                  key={item.key}
                  type='button'
                  aria-pressed={embyKey === item.key}
                  style={{ scrollMarginLeft: 8, scrollMarginRight: 8 }}
                  onClick={() => setEmbyKey(item.key)}
                  className={`tv-focusable flex min-h-14 max-w-[calc(100vw-104px)] shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border px-4 py-3 text-lg outline-none lg:max-w-md ${
                    embyKey === item.key
                      ? 'border-white/10 bg-[#232325] font-medium text-[#ededed]'
                      : 'border-transparent text-[#a1a1a6] hover:bg-[#232325] hover:text-[#ededed]'
                  }`}
                >
                  <Server
                    className='h-[18px] w-[18px] shrink-0'
                    strokeWidth={1.5}
                    aria-hidden='true'
                  />
                  <span className='truncate' title={item.name}>
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {busy && (
        <div
          role='status'
          className='mt-12 flex items-center justify-center gap-3 text-xl text-[#a1a1a6]'
        >
          <Loader2
            className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
            strokeWidth={1.5}
            aria-hidden='true'
          />
          正在加载私人影库
        </div>
      )}
      {error && (
        <div
          role='alert'
          className='mt-6 rounded-2xl border border-rose-300/20 bg-[#19191b] p-6 text-xl text-rose-200'
        >
          {error}
        </div>
      )}
      {!busy && !error && enabledSources.length === 0 && (
        <p
          role='status'
          className='mt-6 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-xl text-[#a1a1a6]'
        >
          当前未启用私人影库源
        </p>
      )}

      {!busy && !error && enabledSources.length > 0 && source !== 'xiaoya' && (
        <section className='mt-8'>
          <div className='mb-4 flex flex-wrap items-baseline justify-between gap-3'>
            <h2 className='text-2xl font-medium lg:text-3xl'>
              {sourceLabel[source]} 影片
            </h2>
            {videos.length > 0 && (
              <p className='text-lg tabular-nums text-[#a1a1a6]'>
                当前显示 {videos.length} 部
              </p>
            )}
          </div>
          {videos.length > 0 ? (
            <div className='-mx-2 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 [&>button]:w-full'>
              {videos.map((item) => (
                <TVCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p
              role='status'
              className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-xl text-[#a1a1a6]'
            >
              当前影库暂无影片
            </p>
          )}
        </section>
      )}

      {!busy &&
        !error &&
        enabledSources.includes('xiaoya') &&
        source === 'xiaoya' && (
          <section className='mt-8 space-y-6'>
            <div className='flex flex-col items-start gap-4 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 sm:flex-row sm:items-center sm:justify-between'>
              <div className='min-w-0'>
                <p className='text-lg text-[#a1a1a6]'>当前位置</p>
                <p className='mt-1 break-all text-xl'>{xiaoyaPath}</p>
              </div>
              {xiaoyaPath !== '/' && (
                <button
                  type='button'
                  onClick={() =>
                    setXiaoyaPath(
                      '/' +
                        xiaoyaPath
                          .split('/')
                          .filter(Boolean)
                          .slice(0, -1)
                          .join('/')
                    )
                  }
                  className='tv-focusable flex min-h-14 shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl outline-none hover:bg-[#303033]'
                >
                  <ArrowLeft
                    className='h-[18px] w-[18px]'
                    strokeWidth={1.5}
                    aria-hidden='true'
                  />
                  返回上级
                </button>
              )}
            </div>
            {folders.length > 0 && (
              <div>
                <h2 className='mb-4 text-2xl font-medium lg:text-3xl'>
                  文件夹
                </h2>
                <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                  {folders.map((folder) => (
                    <button
                      key={folder.path}
                      type='button'
                      onClick={() => setXiaoyaPath(folder.path)}
                      className='tv-focusable flex min-h-24 min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-left text-xl outline-none hover:bg-[#232325]'
                    >
                      <Folder
                        className='h-[18px] w-[18px] shrink-0 text-[#a1a1a6]'
                        strokeWidth={1.5}
                        aria-hidden='true'
                      />
                      <span className='min-w-0 break-all'>{folder.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {files.length > 0 && (
              <div>
                <h2 className='mb-4 text-2xl font-medium lg:text-3xl'>
                  视频文件
                </h2>
                <div className='grid gap-4'>
                  {files.map((file) => {
                    const pathParts = xiaoyaPath.split('/').filter(Boolean);
                    const folderName = pathParts[pathParts.length - 1] || '';
                    const title =
                      folderName
                        .replace(/\s*\(\d{4}\)\s*\{tmdb-\d+\}$/i, '')
                        .trim() || file.name;
                    const encodedDirPath = base58Encode(xiaoyaPath);
                    return (
                      <button
                        key={file.path}
                        type='button'
                        onClick={() =>
                          router.push(
                            `/tv/play?source=xiaoya&id=${encodeURIComponent(
                              encodedDirPath
                            )}&fileName=${encodeURIComponent(
                              file.name
                            )}&title=${encodeURIComponent(title)}`
                          )
                        }
                        className='tv-focusable flex min-h-20 min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-left text-xl outline-none hover:bg-[#232325]'
                      >
                        <PlayCircle
                          className='h-[18px] w-[18px] shrink-0 text-[#a1a1a6]'
                          strokeWidth={1.5}
                          aria-hidden='true'
                        />
                        <span className='min-w-0 break-all'>{file.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {folders.length === 0 && files.length === 0 && (
              <p
                role='status'
                className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-xl text-[#a1a1a6]'
              >
                当前目录暂无文件
              </p>
            )}
          </section>
        )}
    </TVLayout>
  );
}
