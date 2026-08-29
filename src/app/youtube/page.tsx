'use client';

import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import type { YouTubeChannelFeed, YouTubeVideo } from '@/lib/youtube';

import PageLayout from '@/components/PageLayout';

const STORAGE_KEY = 'moontv-youtube-channels';

interface SavedChannel {
  id: string;
  title: string;
  url: string;
}

async function requestChannel(input: string): Promise<YouTubeChannelFeed> {
  const response = await fetch(
    `/api/youtube/channel?input=${encodeURIComponent(input)}`
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '读取频道失败');
  return result;
}

export default function YouTubePage() {
  const [input, setInput] = useState('');
  const [channels, setChannels] = useState<SavedChannel[]>([]);
  const [activeId, setActiveId] = useState('');
  const [feed, setFeed] = useState<YouTubeChannelFeed | null>(null);
  const [playing, setPlaying] = useState<YouTubeVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        setChannels(saved);
        setActiveId(saved[0]?.id || '');
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const saveChannels = (next: SavedChannel[]) => {
    setChannels(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const loadChannel = useCallback(async (id: string) => {
    if (!id) {
      setFeed(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setFeed(await requestChannel(id));
    } catch (err) {
      setFeed(null);
      setError(err instanceof Error ? err.message : '读取频道失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannel(activeId);
  }, [activeId, loadChannel]);

  const addChannel = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await requestChannel(input);
      const nextChannel = {
        id: result.channelId,
        title: result.title,
        url: result.channelUrl,
      };
      const next = [
        nextChannel,
        ...channels.filter((item) => item.id !== nextChannel.id),
      ];
      saveChannels(next);
      setFeed(result);
      setActiveId(result.channelId);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加频道失败');
    } finally {
      setLoading(false);
    }
  };

  const removeChannel = (id: string) => {
    const next = channels.filter((channel) => channel.id !== id);
    saveChannels(next);
    if (activeId === id) setActiveId(next[0]?.id || '');
  };

  return (
    <PageLayout activePath='/youtube'>
      <div className='mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-10'>
        <div className='mb-6 flex items-center gap-3'>
          <Youtube className='h-8 w-8 text-red-600' />
          <div>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-white'>
              YouTube 频道
            </h1>
            <p className='text-sm text-gray-500 dark:text-gray-400'>
              关注频道并查看最新公开视频，无需 API 密钥
            </p>
          </div>
        </div>

        <form
          onSubmit={addChannel}
          className='mb-6 flex flex-col gap-2 sm:flex-row'
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder='粘贴频道网址、@账号或频道 ID'
            className='min-w-0 flex-1 rounded-xl border border-gray-200 bg-white/80 px-4 py-3 text-gray-900 shadow-sm outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-900/80 dark:text-white'
          />
          <button
            type='submit'
            disabled={loading || !input.trim()}
            className='flex items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading ? (
              <Loader2 className='h-5 w-5 animate-spin' />
            ) : (
              <Plus className='h-5 w-5' />
            )}
            添加频道
          </button>
        </form>

        {error && (
          <div className='mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'>
            {error}
          </div>
        )}

        {channels.length > 0 && (
          <div className='mb-8 flex gap-2 overflow-x-auto pb-2'>
            {channels.map((channel) => (
              <div
                key={channel.id}
                className={`flex flex-none items-center rounded-full border transition ${
                  activeId === channel.id
                    ? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-300'
                    : 'border-gray-200 bg-white/70 text-gray-700 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300'
                }`}
              >
                <button
                  onClick={() => setActiveId(channel.id)}
                  className='max-w-52 truncate py-2 pl-4 pr-2 text-sm font-medium'
                >
                  {channel.title}
                </button>
                <button
                  onClick={() => removeChannel(channel.id)}
                  title='移除频道'
                  className='mr-1 rounded-full p-1.5 opacity-60 hover:bg-red-500/10 hover:text-red-600 hover:opacity-100'
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </button>
              </div>
            ))}
          </div>
        )}

        {loading && !feed ? (
          <div className='flex min-h-64 items-center justify-center text-gray-500'>
            <Loader2 className='mr-2 h-6 w-6 animate-spin' />
            正在读取频道…
          </div>
        ) : feed ? (
          <>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <div>
                <h2 className='text-xl font-semibold text-gray-900 dark:text-white'>
                  {feed.title}
                </h2>
                <p className='text-sm text-gray-500'>
                  {feed.videos.length} 个最近上传的视频
                </p>
              </div>
              <button
                onClick={() => void loadChannel(feed.channelId)}
                disabled={loading}
                title='刷新'
                className='rounded-lg border border-gray-200 bg-white/70 p-2.5 text-gray-600 hover:text-green-600 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300'
              >
                <RefreshCw
                  className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
            <div className='grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {feed.videos.map((video) => (
                <button
                  key={video.id}
                  onClick={() => setPlaying(video)}
                  className='group overflow-hidden rounded-xl border border-gray-200/70 bg-white/70 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-gray-700/70 dark:bg-gray-900/70'
                >
                  <div className='relative aspect-video overflow-hidden bg-gray-200 dark:bg-gray-800'>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={video.thumbnail}
                      alt=''
                      loading='lazy'
                      className='h-full w-full object-cover transition duration-300 group-hover:scale-105'
                    />
                    <span className='absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20'>
                      <span className='flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white opacity-0 shadow-lg transition group-hover:opacity-100'>
                        <Youtube className='h-6 w-6' />
                      </span>
                    </span>
                  </div>
                  <div className='p-3'>
                    <h3 className='line-clamp-2 min-h-10 font-medium text-gray-900 dark:text-white'>
                      {video.title}
                    </h3>
                    <p className='mt-2 text-xs text-gray-500'>
                      {video.publishedAt
                        ? new Date(video.publishedAt).toLocaleDateString()
                        : ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className='flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/30 px-6 text-center dark:border-gray-700 dark:bg-gray-900/30'>
            <Youtube className='mb-3 h-12 w-12 text-gray-400' />
            <h2 className='font-semibold text-gray-800 dark:text-gray-200'>
              还没有关注频道
            </h2>
            <p className='mt-1 max-w-md text-sm text-gray-500'>
              在上方粘贴 YouTube 频道网址，例如 https://www.youtube.com/@handle
            </p>
          </div>
        )}
      </div>

      {playing && (
        <div
          className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm md:p-8'
          onClick={() => setPlaying(null)}
        >
          <div
            className='w-full max-w-5xl overflow-hidden rounded-2xl bg-gray-950 shadow-2xl'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='flex items-center justify-between gap-3 px-4 py-3 text-white'>
              <h2 className='truncate font-medium'>{playing.title}</h2>
              <div className='flex flex-none items-center gap-1'>
                <a
                  href={`https://www.youtube.com/watch?v=${playing.id}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  title='在 YouTube 打开'
                  className='rounded-lg p-2 hover:bg-white/10'
                >
                  <ExternalLink className='h-5 w-5' />
                </a>
                <button onClick={() => setPlaying(null)} title='关闭'>
                  <X className='h-6 w-6' />
                </button>
              </div>
            </div>
            <div className='aspect-video w-full bg-black'>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${playing.id}?autoplay=1&playsinline=1`}
                title={playing.title}
                allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                referrerPolicy='strict-origin-when-cross-origin'
                allowFullScreen
                className='h-full w-full'
              />
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
