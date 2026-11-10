'use client';

import {
  AlertTriangle,
  Clock,
  Heart,
  Loader2,
  Maximize,
  Radio,
  RotateCcw,
  Search,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { TVBOX_LIVE_RELAY_PATH } from '@/lib/tvbox-live.shared';
import { useTVFavorite } from '@/hooks/useTVFavorite';

import { scrollTVPlayerControlIntoView } from '@/components/tv/player/focus';
import TVNativeVideo from '@/components/tv/player/TVNativeVideo';
import TVVirtualRemote from '@/components/tv/TVVirtualRemote';

type LiveSource = {
  key: string;
  name: string;
  proxyMode?: 'full' | 'm3u8-only' | 'direct';
};
type LiveChannel = {
  id: string;
  tvgId?: string;
  name: string;
  logo?: string;
  group?: string;
  url: string;
};
type EpgProgram = { start: string; end: string; title: string };
type TVPlayerSourceType = 'm3u8' | 'flv' | 'native';

const TV_LIVE_LAST_CHANNEL_KEY = 'tv_live_last_channel';
const TV_VOLUME_KEY = 'tv_player_volume';
const TV_MUTED_KEY = 'tv_player_muted';
const REMOTE_KEY_DEDUPE_MS = 350;

function loadTVVolumeState() {
  if (typeof window === 'undefined') return { volume: 1, muted: false };

  const savedVolume = localStorage.getItem(TV_VOLUME_KEY);
  const parsedVolume = savedVolume === null ? NaN : Number(savedVolume);
  const volume = Number.isFinite(parsedVolume)
    ? Math.max(0, Math.min(1, parsedVolume))
    : 1;
  const savedMuted = localStorage.getItem(TV_MUTED_KEY);

  return {
    volume,
    muted: savedMuted === null ? volume <= 0 : savedMuted === 'true',
  };
}

function getLogoUrl(logo?: string, source?: string) {
  if (!logo) return '';
  if (logo.startsWith(`${TVBOX_LIVE_RELAY_PATH}?`)) return logo;
  const sourceParam = source ? `&source=${encodeURIComponent(source)}` : '';
  return `/api/proxy/logo?url=${encodeURIComponent(logo)}${sourceParam}`;
}

function getUrlSourceType(rawUrl: string): TVPlayerSourceType | 'unknown' {
  const lower = rawUrl.toLowerCase();
  const path = lower.split('?')[0];
  if (
    path.endsWith('.m3u8') ||
    path.endsWith('.m3u') ||
    lower.includes('.m3u8') ||
    lower.includes('.m3u')
  )
    return 'm3u8';
  if (path.endsWith('.flv') || lower.includes('.flv?')) return 'flv';
  if (/\.(mp4|webm|ogv|ogg|mov)(\?.*)?$/.test(path)) return 'native';
  return 'unknown';
}

async function resolveLiveUrl(
  rawUrl: string,
  source?: LiveSource | null
): Promise<{ url: string; type: TVPlayerSourceType }> {
  const proxyMode = source?.proxyMode || 'full';
  const sourceType = rawUrl.startsWith(`${TVBOX_LIVE_RELAY_PATH}?`)
    ? 'unknown'
    : getUrlSourceType(rawUrl);

  if (sourceType === 'm3u8') {
    return {
      type: 'm3u8',
      url:
        proxyMode === 'direct'
          ? rawUrl
          : `/api/proxy/m3u8?url=${encodeURIComponent(
              rawUrl
            )}&moontv-source=${encodeURIComponent(source?.key || '')}${
              proxyMode === 'm3u8-only' ? '&allowCORS=true' : ''
            }`,
    };
  }
  if (sourceType === 'flv') return { type: 'flv', url: rawUrl };
  if (sourceType === 'native') return { type: 'native', url: rawUrl };

  if (!source?.key) throw new Error('未知直播流格式');

  const precheckRes = await fetch(
    `/api/live/precheck?url=${encodeURIComponent(
      rawUrl
    )}&moontv-source=${encodeURIComponent(source.key)}`,
    { cache: 'no-store' }
  );
  if (!precheckRes.ok) throw new Error('不支持的直播流格式');
  const precheck = await precheckRes.json();

  if (precheck?.type === 'flv') return { type: 'flv', url: rawUrl };
  if (precheck?.type === 'mp4') return { type: 'native', url: rawUrl };
  if (precheck?.type === 'm3u8') {
    return {
      type: 'm3u8',
      url:
        rawUrl.startsWith(`${TVBOX_LIVE_RELAY_PATH}?`) || proxyMode === 'direct'
          ? rawUrl
          : `/api/proxy/m3u8?url=${encodeURIComponent(
              rawUrl
            )}&moontv-source=${encodeURIComponent(source.key)}${
              proxyMode === 'm3u8-only' ? '&allowCORS=true' : ''
            }`,
    };
  }

  throw new Error('不支持的直播流格式');
}

function TVLivePlayClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const needSource = searchParams.get('source');
  const needChannel = searchParams.get('id');

  const [sources, setSources] = useState<LiveSource[]>([]);
  const [source, setSource] = useState<LiveSource | null>(null);
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [channel, setChannel] = useState<LiveChannel | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoType, setVideoType] = useState<TVPlayerSourceType | undefined>();
  const [unsupportedError, setUnsupportedError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [query, setQuery] = useState('');
  const [digitBuffer, setDigitBuffer] = useState('');
  const [playbackError, setPlaybackError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const { favorited, toggleFavorite: updateFavorite } = useTVFavorite(
    source ? `live_${source.key}` : undefined,
    channel ? `live_${channel.id}` : undefined
  );
  const [epgPrograms, setEpgPrograms] = useState<EpgProgram[]>([]);
  const [epgLoading, setEpgLoading] = useState(false);
  const [initialVolumeState] = useState(loadTVVolumeState);
  const [muted, setMuted] = useState(initialVolumeState.muted);
  const [volume, setVolume] = useState(initialVolumeState.volume);
  const [showVolumeHint, setShowVolumeHint] = useState(false);
  const [channelHint, setChannelHint] = useState<{
    number: number;
    name: string;
  } | null>(null);
  const channelButtonRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {}
  );
  const digitTimerRef = useRef<number | null>(null);
  const volumeHintTimerRef = useRef<number | null>(null);
  const channelHintTimerRef = useRef<number | null>(null);
  const menuKeyTimeRef = useRef(0);
  const backKeyTimeRef = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch('/api/live/sources')
      .then((r) => {
        if (r.status === 401 || r.status === 403)
          throw new Error('无权限访问电视直播，请先登录或检查权限');
        if (!r.ok) throw new Error('获取直播源失败');
        return r.json();
      })
      .then((data) => {
        if (!alive) return;
        const list = data.data || [];
        setSources(list);
        const selected =
          list.find((s: LiveSource) => s.key === needSource) || list[0] || null;
        setSource(selected);
        if (!selected) setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '获取直播源失败');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [needSource]);

  useEffect(() => {
    if (!source) return;
    let alive = true;
    setLoading(true);
    setError('');
    fetch(`/api/live/channels?source=${encodeURIComponent(source.key)}`)
      .then((r) => {
        if (r.status === 401 || r.status === 403)
          throw new Error('无权限访问电视直播，请先登录或检查权限');
        if (!r.ok) throw new Error('获取频道列表失败');
        return r.json();
      })
      .then((data) => {
        if (!alive) return;
        const list = (data.data || []).map((item: any) => ({
          id: item.id,
          tvgId: item.tvgId || item.name,
          name: item.name,
          logo: item.logo,
          group: item.group || '其他',
          url: item.url,
        }));
        setChannels(list);
        const selected =
          list.find((c: LiveChannel) => c.id === needChannel) ||
          list[0] ||
          null;
        setChannel(selected);
        setSelectedGroup(selected?.group || list[0]?.group || '');
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : '获取频道列表失败')
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, needChannel]);

  useEffect(() => {
    let alive = true;
    if (!channel) return;
    setVideoUrl('');
    setVideoType(undefined);
    setUnsupportedError('');
    setPlaybackError(false);
    setRetryCount(0);
    resolveLiveUrl(channel.url, source)
      .then(({ url, type }) => {
        if (!alive) return;
        setVideoType(type);
        setVideoUrl(url);
      })
      .catch((err) => {
        if (!alive) return;
        setUnsupportedError(
          err instanceof Error ? err.message : '不支持的直播流格式'
        );
      });
    return () => {
      alive = false;
    };
  }, [channel, source]);

  useEffect(() => {
    if (!source || !channel?.tvgId) {
      setEpgPrograms([]);
      return;
    }
    let alive = true;
    setEpgLoading(true);
    fetch(
      `/api/live/epg?source=${encodeURIComponent(
        source.key
      )}&tvgId=${encodeURIComponent(channel.tvgId)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        setEpgPrograms((data?.data?.programs || []).slice(0, 12));
      })
      .catch(() => alive && setEpgPrograms([]))
      .finally(() => alive && setEpgLoading(false));
    return () => {
      alive = false;
    };
  }, [channel?.tvgId, source]);

  useEffect(() => {
    if (!source || !channel) return;
    try {
      localStorage.setItem(
        TV_LIVE_LAST_CHANNEL_KEY,
        JSON.stringify({
          source: source.key,
          sourceName: source.name,
          id: channel.id,
          title: channel.name,
          group: channel.group || '',
          logo: channel.logo || '',
          updatedAt: Date.now(),
        })
      );
    } catch {
      // ignore storage failures
    }
  }, [channel, source]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TV_VOLUME_KEY, String(volume));
    localStorage.setItem(TV_MUTED_KEY, String(muted));
  }, [muted, volume]);

  useEffect(() => {
    if (!playbackError || !channel || retryCount >= 3) return;
    const timer = window.setTimeout(() => {
      setRetryCount((value) => value + 1);
      setPlaybackError(false);
      setVideoUrl('');
      setVideoType(undefined);
      setUnsupportedError('');
      resolveLiveUrl(channel.url, source)
        .then(({ url, type }) => {
          setVideoType(type);
          setVideoUrl(url);
        })
        .catch((err) =>
          setUnsupportedError(
            err instanceof Error ? err.message : '不支持的直播流格式'
          )
        );
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [channel, playbackError, retryCount, source]);

  const groups = useMemo(
    () => Array.from(new Set(channels.map((item) => item.group || '其他'))),
    [channels]
  );
  const filteredChannels = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return channels.filter((item) => {
      const groupMatched = (item.group || '其他') === selectedGroup;
      const queryMatched =
        !keyword ||
        item.name.toLowerCase().includes(keyword) ||
        (item.group || '').toLowerCase().includes(keyword);
      return groupMatched && queryMatched;
    });
  }, [channels, query, selectedGroup]);

  const precheckChannel = async (next: LiveChannel) => {
    if (!source) return;
    try {
      await fetch(
        `/api/live/precheck?url=${encodeURIComponent(
          next.url
        )}&moontv-source=${encodeURIComponent(source.key)}`,
        { cache: 'no-store' }
      );
    } catch {
      // 预检查失败不阻止切台，播放器错误层会给出重试/换台。
    }
  };

  const switchChannel = (next: LiveChannel, revealControls = true) => {
    precheckChannel(next);
    setChannel(next);
    setSelectedGroup(next.group || '其他');
    if (revealControls) setShowPanel(true);
    const number = channels.findIndex((item) => item.id === next.id) + 1;
    setChannelHint({ number: number > 0 ? number : 1, name: next.name });
    if (channelHintTimerRef.current)
      window.clearTimeout(channelHintTimerRef.current);
    channelHintTimerRef.current = window.setTimeout(
      () => setChannelHint(null),
      5000
    );
  };

  const switchSource = (next: LiveSource) => {
    setSource(next);
    setChannel(null);
    setChannels([]);
    setSelectedGroup('');
    setQuery('');
    setShowPanel(true);
    router.replace(`/tv/live/play?source=${encodeURIComponent(next.key)}`);
  };

  const toggleFavorite = () => {
    if (!source || !channel) return;
    updateFavorite({
      title: channel.name,
      source_name: source.name,
      year: '',
      cover: getLogoUrl(channel.logo, source.key),
      total_episodes: 1,
      save_time: Date.now(),
      search_title: channel.name,
      origin: 'live',
    });
  };

  const setVideoVolume = (next: number) => {
    const safe = Math.max(0, Math.min(1, next));
    const video = document.querySelector<HTMLVideoElement>(
      '[data-tv-player-root] video'
    );
    if (video) {
      video.volume = safe;
      video.muted = safe <= 0;
    }
    setVolume(safe);
    setMuted(safe <= 0);
    setShowVolumeHint(true);
    if (volumeHintTimerRef.current)
      window.clearTimeout(volumeHintTimerRef.current);
    volumeHintTimerRef.current = window.setTimeout(
      () => setShowVolumeHint(false),
      1200
    );
  };

  const toggleMute = () => {
    const video = document.querySelector<HTMLVideoElement>(
      '[data-tv-player-root] video'
    );
    const next = !muted;
    if (video) video.muted = next;
    setMuted(next);
  };

  const toggleFullscreen = () => {
    const root = document.querySelector<HTMLElement>('[data-tv-player-root]');
    if (!root) return;
    if (document.fullscreenElement)
      document.exitFullscreen().catch(() => undefined);
    else root.requestFullscreen?.().catch(() => undefined);
  };

  useEffect(() => {
    if (!videoUrl) return;
    window.requestAnimationFrame(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '[data-tv-player-root] video'
      );
      if (!video) return;
      video.volume = volume;
      video.muted = muted;
    });
  }, [muted, videoUrl, volume]);

  useEffect(() => {
    const togglePanelByRemoteKey = (event: { preventDefault: () => void }) => {
      const now = Date.now();
      if (now - menuKeyTimeRef.current < REMOTE_KEY_DEDUPE_MS) return;
      menuKeyTimeRef.current = now;
      event.preventDefault();
      setShowPanel((value) => !value);
    };

    const onKey = (event: KeyboardEvent) => {
      // 错误提示中的按钮继续接收方向键和确认键。
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-tv-player-alert]') &&
        (event.key.startsWith('Arrow') ||
          event.key === 'Enter' ||
          event.key === 'Tab')
      )
        return;

      const isMenuKey =
        event.key === 'ContextMenu' ||
        event.key === 'Menu' ||
        event.key === 'BrowserContextMenu' ||
        event.code === 'ContextMenu' ||
        event.code === 'Menu' ||
        event.keyCode === 93 ||
        event.keyCode === 82;
      if (isMenuKey) {
        event.stopImmediatePropagation();
        togglePanelByRemoteKey(event);
        return;
      }

      if (event.type === 'keyup') return;
      // 输入频道名时，数字和方向键交给输入框。
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type !== 'range' &&
        event.key !== 'Escape'
      )
        return;

      if (/^[0-9]$/.test(event.key) && channels.length) {
        event.preventDefault();
        const nextBuffer = `${digitBuffer}${event.key}`.slice(-4);
        setDigitBuffer(nextBuffer);
        if (digitTimerRef.current) window.clearTimeout(digitTimerRef.current);
        digitTimerRef.current = window.setTimeout(() => {
          const target = Number(nextBuffer);
          const next = channels[target - 1];
          if (next) switchChannel(next, false);
          setDigitBuffer('');
        }, 850);
      }
      if (event.key === 'Enter') {
        const active = document.activeElement;
        const isControlFocused =
          active instanceof HTMLElement &&
          Boolean(active.closest('[data-tv-live-control]'));
        if (!showPanel) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setShowPanel(true);
          return;
        }
        if (!isControlFocused) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setShowPanel((v) => !v);
          return;
        }
      }
      if (
        !showPanel &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const currentIndex = channels.findIndex(
          (item) => item.id === channel?.id
        );
        if (currentIndex >= 0) {
          const nextIndex =
            event.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
          const next =
            channels[Math.max(0, Math.min(channels.length - 1, nextIndex))];
          if (next && next.id !== channel?.id) switchChannel(next, false);
        }
        return;
      }
      if (
        !showPanel &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setVideoVolume(volume + (event.key === 'ArrowRight' ? 0.05 : -0.05));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const now = Date.now();
        if (showPanel) {
          backKeyTimeRef.current = now;
          setShowPanel(false);
        } else if (now - backKeyTimeRef.current >= 250) {
          router.back();
        }
        return;
      }
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        const currentIndex = channels.findIndex(
          (item) => item.id === channel?.id
        );
        if (currentIndex >= 0) {
          const nextIndex =
            event.key === 'PageUp' ? currentIndex - 1 : currentIndex + 1;
          const next =
            channels[Math.max(0, Math.min(channels.length - 1, nextIndex))];
          if (next) switchChannel(next);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [channel?.id, channels, digitBuffer, router, showPanel, source, volume]);

  useEffect(() => {
    if (!showPanel || !channel?.id) return;
    window.requestAnimationFrame(() => {
      const button = channelButtonRefs.current[channel.id];
      if (!button) return;
      button.focus({ preventScroll: true });
      scrollTVPlayerControlIntoView(button);
    });
  }, [channel?.id, selectedGroup, showPanel]);

  if (loading) {
    return (
      <main
        role='status'
        className='fixed inset-0 flex items-center justify-center gap-3 bg-black px-6 text-xl text-[#a1a1a6]'
      >
        <Loader2
          className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
          strokeWidth={1.5}
          aria-hidden='true'
        />
        正在进入电视直播
      </main>
    );
  }

  if (!channel || error) {
    return (
      <main
        data-tv-player-root
        data-tv-controls-open='true'
        className='fixed inset-0 flex items-center justify-center bg-black p-6 text-center text-[#ededed]'
      >
        <section
          role='alert'
          data-tv-player-alert
          data-tv-focus-scope='active'
          className='max-w-3xl rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'
        >
          <AlertTriangle
            className='mx-auto mb-4 h-[18px] w-[18px] text-rose-200'
            strokeWidth={1.5}
            aria-hidden='true'
          />
          <h1 className='text-2xl font-medium leading-9 lg:text-3xl'>
            {error || '没有可播放频道'}
          </h1>
          <div className='mt-6 flex flex-wrap justify-center gap-4'>
            <button
              type='button'
              autoFocus
              onClick={() => window.location.reload()}
              className='tv-focusable flex min-h-14 cursor-pointer items-center gap-2 rounded-lg bg-[#ededed] px-5 py-3 text-xl font-medium text-[#141415] outline-none hover:bg-white'
            >
              <RotateCcw
                className='h-[18px] w-[18px]'
                strokeWidth={1.5}
                aria-hidden='true'
              />
              重试
            </button>
            <button
              type='button'
              onClick={() => router.back()}
              className='tv-focusable min-h-14 rounded-lg bg-[#232325] px-5 py-3 text-xl outline-none hover:bg-[#303033]'
            >
              返回
            </button>
          </div>
        </section>
        <TVVirtualRemote />
      </main>
    );
  }

  return (
    <main
      data-tv-player-root
      data-tv-controls-open={showPanel ? 'true' : 'false'}
      className='fixed inset-0 overflow-hidden bg-black text-[#ededed]'
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest('[data-tv-live-control]')
        )
          scrollTVPlayerControlIntoView(event.target);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        if (now - menuKeyTimeRef.current < REMOTE_KEY_DEDUPE_MS) return;
        menuKeyTimeRef.current = now;
        setShowPanel((value) => !value);
      }}
    >
      {unsupportedError ? (
        <div
          role='alert'
          data-tv-player-alert
          data-tv-focus-scope={showPanel ? undefined : 'active'}
          className='flex h-full items-center justify-center bg-black p-6 text-center'
        >
          <section className='max-w-3xl rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'>
            <AlertTriangle
              className='mx-auto mb-4 h-[18px] w-[18px] text-rose-200'
              strokeWidth={1.5}
              aria-hidden='true'
            />
            <h2 className='text-2xl font-medium lg:text-3xl'>
              当前直播流格式不支持
            </h2>
            <p className='mt-3 text-xl leading-8 text-[#a1a1a6]'>
              {unsupportedError}
            </p>
            <button
              type='button'
              autoFocus
              onClick={() => setShowPanel(true)}
              className='tv-focusable mt-6 min-h-14 rounded-lg bg-[#232325] px-5 py-3 text-xl outline-none hover:bg-[#303033]'
            >
              频道列表
            </button>
          </section>
        </div>
      ) : videoUrl ? (
        <TVNativeVideo
          key={`${videoType || 'auto'}:${videoUrl}`}
          url={videoUrl}
          sourceType={videoType}
          poster={getLogoUrl(channel.logo, source?.key)}
          live
          title={channel.name}
          onError={() => setPlaybackError(true)}
        />
      ) : (
        <div
          role='status'
          className='flex h-full items-center justify-center gap-3 text-xl text-[#a1a1a6]'
        >
          <Loader2
            className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
            strokeWidth={1.5}
            aria-hidden='true'
          />
          正在解析直播地址
        </div>
      )}

      {playbackError && !unsupportedError && (
        <div
          role='alert'
          data-tv-player-alert
          data-tv-focus-scope='active'
          className='absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6'
        >
          <section className='max-w-3xl rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-center lg:p-8'>
            <AlertTriangle
              className='mx-auto mb-4 h-[18px] w-[18px] text-rose-200'
              strokeWidth={1.5}
              aria-hidden='true'
            />
            <h2 className='text-2xl font-medium lg:text-3xl'>
              当前频道播放失败
            </h2>
            <p className='mt-3 text-xl leading-8 text-[#a1a1a6]'>
              {retryCount < 3
                ? `正在自动重连（${retryCount + 1}/3）`
                : '可以重试当前频道，或打开频道列表切换频道与直播源'}
            </p>
            <div className='mt-6 flex flex-wrap justify-center gap-4'>
              <button
                type='button'
                autoFocus
                onClick={() => {
                  setPlaybackError(false);
                  setUnsupportedError('');
                  setVideoUrl('');
                  setVideoType(undefined);
                  if (channel)
                    resolveLiveUrl(channel.url, source)
                      .then(({ url, type }) => {
                        setVideoType(type);
                        setVideoUrl(url);
                      })
                      .catch((err) =>
                        setUnsupportedError(
                          err instanceof Error
                            ? err.message
                            : '不支持的直播流格式'
                        )
                      );
                }}
                className='tv-focusable flex min-h-14 cursor-pointer items-center gap-2 rounded-lg bg-[#ededed] px-5 py-3 text-xl font-medium text-[#141415] outline-none hover:bg-white'
              >
                <RotateCcw
                  className='h-[18px] w-[18px]'
                  strokeWidth={1.5}
                  aria-hidden='true'
                />
                重试
              </button>
              <button
                type='button'
                onClick={() => {
                  setPlaybackError(false);
                  setShowPanel(true);
                }}
                className='tv-focusable min-h-14 rounded-lg bg-[#232325] px-5 py-3 text-xl outline-none hover:bg-[#303033]'
              >
                频道列表
              </button>
            </div>
          </section>
        </div>
      )}

      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          showPanel ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className='absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/90 to-transparent' />
        <div className='absolute inset-y-0 left-0 w-[min(800px,100vw)] bg-gradient-to-r from-black/80 to-transparent' />
      </div>

      <div
        data-tv-live-control
        className={`absolute left-6 right-6 top-6 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#19191b]/95 p-3 transition-opacity duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          showPanel ? 'opacity-100' : 'invisible pointer-events-none opacity-0'
        }`}
      >
        <div className='flex min-w-0 flex-1 items-center gap-3 px-2'>
          {channel.logo ? (
            <img
              src={getLogoUrl(channel.logo, source?.key)}
              alt=''
              className='h-10 w-10 shrink-0 rounded-lg object-contain'
            />
          ) : (
            <Radio
              className='h-[18px] w-[18px] shrink-0 text-[#a1a1a6]'
              strokeWidth={1.5}
              aria-hidden='true'
            />
          )}
          <div className='min-w-0'>
            <div className='truncate text-xl font-medium lg:text-2xl'>
              {channel.name}
            </div>
            <div className='mt-1 truncate text-lg text-[#a1a1a6]'>
              {source?.name} · {channel.group}
            </div>
          </div>
        </div>
        <div className='-mx-1 flex basis-full items-center gap-3 overflow-x-auto p-2 [scrollbar-width:none] sm:basis-auto [&::-webkit-scrollbar]:hidden'>
          <button
            type='button'
            aria-label={muted ? '取消静音' : '静音'}
            aria-pressed={muted}
            onClick={toggleMute}
            className='tv-focusable flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#232325] outline-none hover:bg-[#303033]'
          >
            {muted ? (
              <VolumeX
                className='h-[18px] w-[18px]'
                strokeWidth={1.5}
                aria-hidden='true'
              />
            ) : (
              <Volume2
                className='h-[18px] w-[18px]'
                strokeWidth={1.5}
                aria-hidden='true'
              />
            )}
          </button>
          <input
            aria-label='直播音量'
            type='range'
            min='0'
            max='1'
            step='0.05'
            value={muted ? 0 : volume}
            onChange={(e) => setVideoVolume(Number(e.target.value))}
            className='tv-focusable h-10 w-24 shrink-0 cursor-pointer accent-[#ededed]'
          />
          <button
            type='button'
            aria-label='全屏'
            onClick={toggleFullscreen}
            className='tv-focusable flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#232325] outline-none hover:bg-[#303033]'
          >
            <Maximize
              className='h-[18px] w-[18px]'
              strokeWidth={1.5}
              aria-hidden='true'
            />
          </button>
          <button
            type='button'
            aria-pressed={favorited}
            onClick={toggleFavorite}
            className={`tv-focusable flex min-h-14 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-xl outline-none ${
              favorited ? 'bg-[#303033]' : 'bg-[#232325]'
            }`}
          >
            <Heart
              className={`h-[18px] w-[18px] ${favorited ? 'fill-current' : ''}`}
              strokeWidth={1.5}
              aria-hidden='true'
            />
            收藏
          </button>
        </div>
      </div>

      {showPanel && (
        <aside
          data-tv-live-control
          aria-label='频道面板'
          className='absolute bottom-6 left-6 top-48 z-10 grid w-[min(760px,calc(100vw-48px))] grid-rows-[160px_minmax(0,1fr)] gap-4 rounded-2xl border border-white/[0.08] bg-[#19191b] p-4 sm:top-32 sm:grid-cols-[200px_minmax(0,1fr)] sm:grid-rows-1 [@media(max-height:600px)]:top-6 [@media(max-height:600px)]:z-20'
        >
          <div className='min-h-0 min-w-0 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]'>
            {sources.length > 1 && (
              <>
                <h2 className='mb-3 text-xl font-medium'>直播源</h2>
                <div className='mb-6 space-y-3'>
                  {sources.map((item) => (
                    <button
                      key={item.key}
                      type='button'
                      aria-pressed={source?.key === item.key}
                      onClick={() => switchSource(item)}
                      className={`tv-focusable min-h-14 w-full cursor-pointer break-words rounded-lg px-4 py-3 text-left text-lg leading-7 outline-none ${
                        source?.key === item.key
                          ? 'bg-[#303033] font-medium'
                          : 'bg-[#232325]'
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <h2 className='mb-3 text-xl font-medium'>分类</h2>
            <div className='space-y-3'>
              {groups.map((group) => (
                <button
                  key={group}
                  type='button'
                  aria-pressed={selectedGroup === group}
                  onClick={() => setSelectedGroup(group)}
                  className={`tv-focusable min-h-14 w-full cursor-pointer break-words rounded-lg px-4 py-3 text-left text-lg outline-none ${
                    selectedGroup === group
                      ? 'bg-[#303033] font-medium'
                      : 'bg-[#232325]'
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>
          </div>
          <div className='min-h-0 min-w-0 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]'>
            <h2 className='mb-4 text-xl font-medium'>频道</h2>
            <section className='mb-4 rounded-lg border border-white/[0.08] bg-[#232325] p-4'>
              <h3 className='mb-3 flex items-center gap-2 text-lg font-medium'>
                <Clock
                  className='h-[18px] w-[18px] text-[#a1a1a6]'
                  strokeWidth={1.5}
                  aria-hidden='true'
                />
                节目单
              </h3>
              {epgLoading ? (
                <div role='status' className='text-lg text-[#a1a1a6]'>
                  正在加载节目单
                </div>
              ) : epgPrograms.length > 0 ? (
                <div className='max-h-32 space-y-3 overflow-y-auto pr-2'>
                  {epgPrograms.map((program, index) => (
                    <div
                      key={`${program.start}-${index}`}
                      className='flex flex-wrap gap-x-3 gap-y-1 text-lg'
                    >
                      <span className='whitespace-nowrap tabular-nums text-[#a1a1a6]'>
                        {program.start?.slice(8, 10)}:
                        {program.start?.slice(10, 12)}–
                        {program.end?.slice(8, 10)}:{program.end?.slice(10, 12)}
                      </span>
                      <span className='min-w-0 break-words'>
                        {program.title}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='text-lg text-[#a1a1a6]'>暂无节目单</div>
              )}
            </section>
            <div className='relative mb-4'>
              <Search
                className='pointer-events-none absolute left-4 top-1/2 z-40 h-[18px] w-[18px] -translate-y-1/2 text-[#a1a1a6]'
                strokeWidth={1.5}
                aria-hidden='true'
              />
              <input
                id='tv-live-channel-search'
                aria-label='搜索频道'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='搜索频道'
                className='tv-focusable h-14 w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#232325] pl-12 pr-4 text-xl outline-none placeholder:text-[#8d8d93] hover:bg-[#303033]'
              />
            </div>
            <div className='grid grid-cols-1 gap-3'>
              {filteredChannels.map((item) => {
                const absoluteIndex =
                  channels.findIndex((candidate) => candidate.id === item.id) +
                  1;
                return (
                  <button
                    key={item.id}
                    type='button'
                    aria-pressed={item.id === channel.id}
                    ref={(el) => {
                      channelButtonRefs.current[item.id] = el;
                    }}
                    onClick={() => switchChannel(item)}
                    className={`tv-focusable flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left text-xl outline-none ${
                      item.id === channel.id
                        ? 'bg-[#303033] font-medium'
                        : 'bg-[#232325]'
                    }`}
                  >
                    {item.logo ? (
                      <img
                        src={getLogoUrl(item.logo, source?.key)}
                        alt=''
                        className='h-8 w-8 shrink-0 rounded object-contain'
                      />
                    ) : (
                      <Radio
                        className='h-[18px] w-[18px] shrink-0 text-[#a1a1a6]'
                        strokeWidth={1.5}
                        aria-hidden='true'
                      />
                    )}
                    <span className='min-w-12 shrink-0 text-lg tabular-nums text-[#a1a1a6]'>
                      #{absoluteIndex}
                    </span>
                    <span className='min-w-0 truncate'>{item.name}</span>
                  </button>
                );
              })}
              {filteredChannels.length === 0 && (
                <p role='status' className='py-4 text-lg text-[#a1a1a6]'>
                  未找到匹配频道
                </p>
              )}
            </div>
          </div>
        </aside>
      )}

      {digitBuffer && (
        <div
          role='status'
          className='absolute right-6 top-24 z-[90] rounded-2xl bg-[#19191b]/95 px-6 py-4 text-3xl font-medium tabular-nums'
        >
          频道 {digitBuffer}
        </div>
      )}
      {channelHint && !showPanel && (
        <div
          role='status'
          className='absolute right-6 top-6 z-[70] max-w-[calc(100vw-48px)] rounded-2xl bg-[#19191b]/95 px-6 py-4 text-right'
        >
          <div className='text-lg tabular-nums text-[#a1a1a6]'>
            #{channelHint.number}
          </div>
          <div className='mt-1 truncate text-2xl font-medium'>
            {channelHint.name}
          </div>
        </div>
      )}
      {showVolumeHint && !showPanel && (
        <div
          role='status'
          aria-label='音量'
          className='absolute right-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 rounded-2xl bg-[#19191b]/95 px-4 py-5 text-2xl tabular-nums'
        >
          {muted || volume <= 0 ? (
            <VolumeX
              className='h-[18px] w-[18px]'
              strokeWidth={1.5}
              aria-hidden='true'
            />
          ) : (
            <Volume2
              className='h-[18px] w-[18px]'
              strokeWidth={1.5}
              aria-hidden='true'
            />
          )}
          <div className='relative h-40 w-2 overflow-hidden rounded-full bg-white/20'>
            <div
              className='absolute bottom-0 left-0 right-0 rounded-full bg-[#ededed]'
              style={{ height: `${Math.round((muted ? 0 : volume) * 100)}%` }}
            />
          </div>
          <div className='min-w-12 text-center'>
            {Math.round((muted ? 0 : volume) * 100)}
          </div>
        </div>
      )}
      <TVVirtualRemote />
    </main>
  );
}

export default function TVLivePlayPage() {
  return (
    <Suspense fallback={null}>
      <TVLivePlayClient />
    </Suspense>
  );
}
