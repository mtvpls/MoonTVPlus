/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AddToPlaylistModal from '@/components/AddToPlaylistModal';
import Toast, { ToastProps } from '@/components/Toast';
import LyricsPiPWindow from '@/components/LyricsPiPWindow';
import MusicSidebarDrawer from '@/components/music/MusicSidebarDrawer';
import { useWatchRoomContextSafe } from '@/components/WatchRoomProvider';
import { getSourceDisplayLabel, normalizeSource, SourcePill } from '@/lib/music/shared';
import type { MusicQuality, MusicSource, Song } from '@/lib/music/types';
import type { MusicQueueItem, MusicSyncState } from '@/types/watch-room';

const SPECTRUM_BIN_COUNT = 96;
const SPECTRUM_IDLE_LEVEL = 0.02;
const SPECTRUM_EDGE_TRIM = 8;
const SPECTRUM_REFERENCE_VOLUME = 10;
const SPECTRUM_MIN_VOLUME = 5;
const SPECTRUM_MAX_REFERENCE_VOLUME = 15;

interface PlayRecord {
  platform: MusicSource;
  id: string;
  playTime: number; // 播放时间（秒）
  duration: number; // 总时长（秒）
  timestamp: number; // 添加时间戳
}

interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

interface DbRecord {
  source: MusicSource;
  songId: string;
  id: string;
  playProgressSec: number;
  durationSec: number;
  createdAt: number;
  lastPlayedAt: number;
  name: string;
  artist: string;
  album?: string;
  cover?: string;
  durationText?: string;
  songmid?: string;
}

function getMusicQueueItemKey(song: { id: string; platform?: string }, fallbackPlatform = '') {
  return `${song.platform || fallbackPlatform}:${song.id}`;
}

function AudioSpectrumCanvas({
  bars,
  compact = false,
}: {
  bars: number[];
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);

      const targetPitch = compact ? 4.2 : 4.6;
      const gap = Math.max(1, Math.round(dpr));
      const count = Math.max(1, Math.floor(rect.width / targetPitch));
      const barWidth = Math.max(2 * dpr, (width - gap * (count - 1)) / count);
      const cubeHeight = compact ? Math.max(2, Math.round(2 * dpr)) : Math.max(2, Math.round(2.5 * dpr));
      const cubeGap = 1;
      const scaleBase = compact ? height * 1.55 : height * 1.42;
      const themeColor = '#10b981';

      const sampleBar = (index: number) => {
        const usableLength = Math.max(1, bars.length - SPECTRUM_EDGE_TRIM * 2);
        const mappedStart = SPECTRUM_EDGE_TRIM + Math.floor((index / count) * usableLength);
        const start = Math.min(bars.length - 1, mappedStart);
        const mappedEnd = SPECTRUM_EDGE_TRIM + Math.max(mappedStart + 1, Math.floor(((index + 1) / count) * usableLength));
        const end = Math.min(bars.length, Math.max(start + 1, mappedEnd));
        let total = 0;
        for (let i = start; i < end; i++) total += bars[i] ?? 0;
        return total / Math.max(1, end - start);
      };

      ctx.fillStyle = themeColor;
      ctx.strokeStyle = themeColor;

      for (let i = 0; i < count; i++) {
        const q = Math.max(SPECTRUM_IDLE_LEVEL, sampleBar(i)) * scaleBase;
        const cubeCount = Math.max(1, Math.ceil(q / Math.max(1, barWidth * 0.9)));
        const x = i === count - 1 ? width - barWidth : i * (barWidth + gap);

        for (let segment = 0; segment < cubeCount; segment++) {
          const y = height - segment * (cubeHeight + cubeGap);
          ctx.beginPath();
          ctx.roundRect(x, y - cubeHeight, barWidth, cubeHeight, Math.min(2 * dpr, cubeHeight / 2));
          ctx.fill();
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [bars, compact]);

  return (
    <div
      className={`relative w-full overflow-hidden ${compact ? 'h-6' : 'h-8'}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-50" />
    </div>
  );
}


const VINYL_NEEDLE_SVG = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><path d="M21,21 C21,65 86,70 86,100" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="6" stroke-linecap="round"/><path d="M20,20 C20,65 85,70 85,100" fill="none" stroke="%23e0e0e0" stroke-width="4.5" stroke-linecap="round"/><path d="M19,20 C19,65 84,70 84,100" fill="none" stroke="%23fff" stroke-width="1.5" stroke-linecap="round"/><g transform="translate(85, 100) rotate(25)"><rect x="-6" y="0" width="12" height="18" rx="2" fill="%23ccc"/><rect x="-4" y="5" width="8" height="14" rx="1" fill="%23333"/><rect x="-2" y="16" width="4" height="5" rx="1" fill="%23d43c33"/></g><circle cx="20" cy="20" r="10" fill="%23f0f0f0" stroke="%23ccc" stroke-width="1"/><circle cx="20" cy="20" r="4" fill="%23fff"/><circle cx="20" cy="20" r="1.5" fill="%23999"/></svg>')`;

function VinylTurntable({
  cover,
  title,
  isPlaying,
  className = '',
}: {
  cover?: string;
  title: string;
  isPlaying: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative mx-auto mt-12 mb-5 flex h-[280px] w-[280px] items-center justify-center md:mt-16 md:mb-8 md:h-[340px] md:w-[340px] ${className}`}
      aria-label="黑胶唱片机封面"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-[-54px] z-20 h-[140px] w-[108px] drop-shadow-xl transition-transform duration-500"
        style={{
          marginLeft: '-20px',
          backgroundImage: VINYL_NEEDLE_SVG,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          transformOrigin: '20px 20px',
          transform: isPlaying ? 'rotate(0deg)' : 'rotate(-30deg)',
        }}
      />
      <div
        className="relative flex h-[246px] w-[246px] items-center justify-center overflow-hidden rounded-full md:h-[300px] md:w-[300px]"
        style={{
          background: 'conic-gradient(from 45deg, #070707 0%, #2b2b2b 10%, #101010 20%, #080808 32%, #242424 42%, #0b0b0b 55%, #1e1e1e 68%, #050505 80%, #2c2c2c 90%, #070707 100%)',
          boxShadow: '0 0 0 8px rgba(255,255,255,0.055), 0 20px 42px rgba(0,0,0,0.65), inset 0 0 28px rgba(255,255,255,0.045)',
          animation: 'vinyl-spin 20s linear infinite',
          animationPlayState: isPlaying ? 'running' : 'paused',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: 'repeating-radial-gradient(circle, transparent 0, transparent 3px, rgba(255,255,255,0.055) 3px, rgba(255,255,255,0.055) 4px)',
          }}
        />
        <div className="pointer-events-none absolute left-[18%] top-[10%] h-[42%] w-[22%] rotate-[-28deg] rounded-full bg-white/10 blur-md" />
        <div className="relative z-10 flex h-[158px] w-[158px] items-center justify-center overflow-hidden rounded-full border-[5px] border-black bg-zinc-800 md:h-[192px] md:w-[192px]">
          {cover ? (
            <img
              src={cover}
              alt={title}
              className="h-full w-full rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <svg className="h-14 w-14 text-zinc-500 md:h-16 md:w-16" fill="currentColor" viewBox="0 0 20 20">
              <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
            </svg>
          )}
        </div>
        <div className="pointer-events-none absolute z-20 h-3 w-3 rounded-full border border-white/30 bg-zinc-950" />
      </div>
    </div>
  );
}

// 扩展 Window 接口以支持 Document PiP API
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options: { width: number; height: number }) => Promise<Window>;
      window: Window | null;
    };
  }
}

export default function MusicClient({ children: _children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const watchRoom = useWatchRoomContextSafe();
  const [currentSource, setCurrentSource] = useState<MusicSource>('wy');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [quality, setQuality] = useState<MusicQuality>('320k');
  const [playMode, setPlayMode] = useState<'loop' | 'single' | 'random'>('loop');
  const [currentSongIndex, setCurrentSongIndex] = useState(-1);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [mobileLyricsView, setMobileLyricsView] = useState<'lyrics' | 'vinyl'>('lyrics');
  const [musicProxyEnabled, setMusicProxyEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return (window as any).RUNTIME_CONFIG?.MUSIC_PROXY_ENABLED !== false;
  });
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [currentSongUrl, setCurrentSongUrl] = useState('');
  const [playRecords, setPlayRecords] = useState<PlayRecord[]>([]); // 播放记录（只存平台和ID）
  const [playlist, setPlaylist] = useState<Song[]>([]); // 完整歌曲信息（用于显示）
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [playlistIndex, setPlaylistIndex] = useState(-1); // 当前在播放列表中的索引
  const [showQualityMenu, setShowQualityMenu] = useState(false); // 音质选择菜单
  const [showSleepTimerMenu, setShowSleepTimerMenu] = useState(false); // 睡眠定时菜单
  const [sleepTimerEndAt, setSleepTimerEndAt] = useState<number | null>(null); // 睡眠定时结束时间
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState(0); // 睡眠定时剩余秒数
  const [customSleepHours, setCustomSleepHours] = useState(0); // 自定义睡眠定时小时
  const [customSleepMinutes, setCustomSleepMinutes] = useState(30); // 自定义睡眠定时分钟
  const [showSidebarDrawer, setShowSidebarDrawer] = useState(false); // 左侧抽屉菜单
  const [showVolumeSlider, setShowVolumeSlider] = useState(false); // 音量滑块显示状态
  const [pendingSongToPlay, setPendingSongToPlay] = useState<{ platform: string; id: string } | null>(null); // 待播放的歌曲信息
  const [resolvingCount, setResolvingCount] = useState(0); // 当前解析中的歌曲数量
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false); // 添加到歌单弹窗
  const [songToAddToPlaylist, setSongToAddToPlaylist] = useState<Song | null>(null); // 要添加到歌单的歌曲

  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as any).RUNTIME_CONFIG?.MUSIC_ENABLED) {
      router.replace('/');
    }
  }, [router]);

  // Toast 和 Confirm Modal 状态
  const [toast, setToast] = useState<ToastProps | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
  });

  // PiP 相关状态
  const [showPiPLyrics, setShowPiPLyrics] = useState(false);
  const [pipOpacity, setPipOpacity] = useState(0.9);
  const [pipMinimized, setPipMinimized] = useState(false);
  const [showSpectrum, setShowSpectrum] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('musicShowSpectrum') !== '0';
  });
  const [spectrumBars, setSpectrumBars] = useState<number[]>(
    () => Array.from({ length: SPECTRUM_BIN_COUNT }, () => SPECTRUM_IDLE_LEVEL)
  );

  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const sleepHoursPickerRef = useRef<HTMLDivElement>(null);
  const sleepMinutesPickerRef = useRef<HTMLDivElement>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const restoredTimeRef = useRef<number>(0);
  const songStartTimeRef = useRef<number>(0); // 歌曲开始播放的时间戳
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const spectrumDataRef = useRef<Uint8Array | null>(null);
  const spectrumFrameRef = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const volumeRef = useRef(volume);
  const spectrumSeedRef = useRef(Math.random() * Math.PI * 2);
  const qualitySwitchRequestRef = useRef(0);
  const currentSongRef = useRef<Song | null>(null);
  const currentSourceRef = useRef(currentSource);
  const plannedNextSongRef = useRef<Song | null>(null);
  const plannedNextSongKeyRef = useRef('');

  const isMusicRoomOwner = Boolean(
    watchRoom?.isOwner &&
    watchRoom.currentRoom?.roomType === 'music'
  );

  const toMusicQueueItem = (song: Song): MusicQueueItem => ({
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    pic: song.pic,
    platform: song.platform || currentSourceRef.current,
    songmid: song.songmid,
    duration: song.duration,
    durationText: song.durationText,
  });

  const buildMusicRoomState = (
    song: Song,
    options: {
      currentTime?: number;
      isPlaying?: boolean;
      nextSong?: Song | null;
    } = {}
  ): MusicSyncState => {
    const songPlatform = song.platform || currentSourceRef.current;
    const currentSong = { ...song, platform: songPlatform };
    const playlistSnapshot = playlist
      .map((item) => ({ ...item, platform: item.platform || songPlatform }))
      .filter((item) => item.id);
    const currentKey = getMusicQueueItemKey(currentSong, songPlatform);
    const playlistKey = playlistSnapshot.map((item) => getMusicQueueItemKey(item)).join('|');
    const cacheKey = `${currentKey}|${playMode}|${playlistKey}`;

    const resolveNextSong = (): Song | null => {
      if (typeof options.nextSong !== 'undefined') return options.nextSong || null;
      if (plannedNextSongKeyRef.current === cacheKey) {
        return plannedNextSongRef.current;
      }

      let currentIndex = playlistSnapshot.findIndex((item) => getMusicQueueItemKey(item) === currentKey);
      if (currentIndex < 0) {
        playlistSnapshot.push(currentSong);
        currentIndex = playlistSnapshot.length - 1;
      }

      let nextSong: Song | null = null;
      if (playMode === 'single') {
        nextSong = playlistSnapshot[currentIndex] || null;
      } else if (playMode === 'random') {
        if (playlistSnapshot.length === 1) {
          nextSong = playlistSnapshot[0] || null;
        } else {
          const candidates = playlistSnapshot.filter((_, index) => index !== currentIndex);
          nextSong = candidates[Math.floor(Math.random() * candidates.length)] || null;
        }
      } else {
        const nextIndex = currentIndex < playlistSnapshot.length - 1 ? currentIndex + 1 : 0;
        nextSong = playlistSnapshot[nextIndex] || null;
      }

      plannedNextSongKeyRef.current = cacheKey;
      plannedNextSongRef.current = nextSong;
      return nextSong;
    };

    const nextSong = resolveNextSong();
    return {
      type: 'music',
      song: toMusicQueueItem(currentSong),
      nextSong: nextSong ? toMusicQueueItem(nextSong) : null,
      currentTime: options.currentTime ?? audioRef.current?.currentTime ?? currentTimeRef.current ?? 0,
      isPlaying: options.isPlaying ?? isPlaying,
      quality,
      playMode,
      updatedAt: Date.now(),
    };
  };

  const emitMusicChange = (state: MusicSyncState | null) => {
    if (!isMusicRoomOwner || !watchRoom || !state) return;
    watchRoom.changeMusic(state);
  };

  const buildStreamUrl = (song: Song, source: MusicSource, songQuality: MusicQuality) => {
    const params = new URLSearchParams({
      songId: song.id,
      source,
      quality: songQuality,
      songmid: song.songmid || song.id.split('_').slice(1).join('_'),
      name: song.name,
      artist: song.artist,
    });

    if (song.durationText) params.set('durationText', song.durationText);

    return `/api/music/v2/stream?${params.toString()}`;
  };

  const getMusicProxyEnabled = () => {
    if (typeof window === 'undefined') return true;
    return (window as any).RUNTIME_CONFIG?.MUSIC_PROXY_ENABLED !== false;
  };

  const fetchPlayData = async (
    song: Song,
    source: MusicSource,
    songQuality: MusicQuality,
    includeUrl = false
  ) => {
    const response = await fetch('/api/music/v2/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        includeUrl,
        song: {
          songId: song.id,
          source,
          songmid: song.songmid,
          name: song.name,
          artist: song.artist,
          album: song.album,
          cover: song.pic,
          durationSec: song.duration,
          durationText: song.durationText,
        },
        quality: songQuality,
      }),
    });

    return response.json();
  };

  const beginResolving = () => {
    setResolvingCount((prev) => prev + 1);
  };

  const endResolving = () => {
    setResolvingCount((prev) => Math.max(0, prev - 1));
  };

  const saveHistoryRecord = async (
    record: PlayRecord,
    song: Song,
    playTime: number,
    totalDuration: number,
    lastPlayedAt = Date.now(),
    recordQuality: MusicQuality = quality
  ) => {
    await fetch('/api/music/v2/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        song: {
          songId: record.id,
          source: record.platform,
          songmid: song.songmid,
          name: song.name,
          artist: song.artist,
          album: song.album,
          cover: song.pic,
          durationSec: totalDuration || song.duration || 0,
          durationText: song.durationText,
        },
        playProgressSec: playTime,
        lastPlayedAt,
        lastQuality: recordQuality,
        createdAt: record.timestamp,
      }),
    });
  };

  const saveHistoryRecordSafely = (
    record: PlayRecord,
    song: Song,
    playTime = 0,
    totalDuration = 0,
    lastPlayedAt?: number,
    recordQuality?: MusicQuality
  ) => {
    saveHistoryRecord(record, song, playTime, totalDuration, lastPlayedAt, recordQuality).catch(err => {
      console.error('保存播放记录到数据库失败:', err);
    });
  };

  // 保存播放状态到 localStorage
  const savePlayState = () => {
    if (!currentSong) return;

    const playState = {
      currentSong,
      currentSongIndex,
      currentSource,
      quality,
      playMode,
      volume,
      currentTime: audioRef.current?.currentTime || 0,
      currentSongUrl,
      lyrics,
      playRecords, // 只保存播放记录（平台+ID+播放信息）
      playlist, // 保存完整歌曲信息（用于显示）
      playlistIndex,
    };

    localStorage.setItem('musicPlayState', JSON.stringify(playState));
  };

  // 清空当前播放状态，并在需要时停止正在播放的音频
  const clearCurrentPlaybackState = () => {
    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    setIsPlaying(false);
    setCurrentSong(null);
    setCurrentSongIndex(-1);
    setCurrentSongUrl('');
    setCurrentTime(0);
    setDuration(0);
    setLyrics([]);
    setCurrentLyricIndex(-1);
    setShowPlayer(false);
    setShowLyrics(false);
    setShowPiPLyrics(false);
    setPendingSongToPlay(null);
    restoredTimeRef.current = 0;
    lastSaveTimeRef.current = 0;
    currentTimeRef.current = 0;

    localStorage.removeItem('musicPlayState');
  };

  // 从 localStorage 恢复播放状态（已废弃，现在统一使用数据库）
  const restorePlayState = async () => {
    // 此函数已不再使用，所有状态恢复都在 initializePlayState 中完成
  };

  useEffect(() => {
    setMusicProxyEnabled(getMusicProxyEnabled());
  }, []);

  // 页面加载时恢复播放状态和数据库记录
  useEffect(() => {
    const initializePlayState = async () => {
      try {
        const response = await fetch('/api/music/v2/history');
        const history = await response.json();
        const dbRecords = (history.data?.records || []) as DbRecord[];

        const queueRecords = dbRecords;

        const sortedRecords: PlayRecord[] = queueRecords.map((record) => ({
          platform: record.source,
          id: record.songId,
          playTime: record.playProgressSec,
          duration: record.durationSec || 0,
          timestamp: record.createdAt || record.lastPlayedAt || 0,
        }));

        const sortedSongs: Song[] = queueRecords.map((record) => ({
          id: record.songId,
          name: record.name,
          artist: record.artist,
          album: record.album,
          pic: record.cover,
          platform: record.source,
          duration: record.durationSec,
          durationText: record.durationText,
          songmid: record.songmid,
        }));

        // 2. 更新播放列表
        if (sortedRecords.length > 0) {
          setPlayRecords(sortedRecords);
          setPlaylist(sortedSongs);
        }

        // 3. 获取 localStorage 配置（只获取配置，不获取歌曲信息）
        const savedPlayState = localStorage.getItem('musicPlayState');
        const playState = savedPlayState ? JSON.parse(savedPlayState) : {};

        // 恢复配置状态（不包括歌曲）
        setCurrentSource(normalizeSource(playState.currentSource));
        setQuality(playState.quality || '320k');
        setPlayMode(playState.playMode || 'loop');
        setVolume(playState.volume || 100);

        // 4. 使用数据库的最新记录（歌曲和进度都从数据库获取）
        if (sortedRecords.length > 0) {
          const proxyEnabled = getMusicProxyEnabled();
          setMusicProxyEnabled(proxyEnabled);
          const latestIndex = queueRecords.reduce((bestIndex, record, index) => {
            if (bestIndex < 0) return index;
            return (record.lastPlayedAt || 0) > (queueRecords[bestIndex].lastPlayedAt || 0) ? index : bestIndex;
          }, -1);
          const activeIndex = latestIndex >= 0 ? latestIndex : 0;
          const latestDbRecord = sortedRecords[activeIndex];
          const latestDbSong = sortedSongs[activeIndex];

          // 使用数据库的歌曲信息
          setCurrentSong(latestDbSong);
          setPlaylistIndex(activeIndex);
          setShowPlayer(true);

          // 从数据库恢复播放进度
          const dbPlayTime = latestDbRecord.playTime || 0;
          songStartTimeRef.current = Date.now();

          const platform = latestDbSong.platform || 'kw';
          const selectedQuality = playState.quality || '320k';

          const restoreTime = () => {
            if (audioRef.current && dbPlayTime > 0) {
              audioRef.current.currentTime = dbPlayTime;
            }
          };

          if (proxyEnabled) {
            const streamUrl = buildStreamUrl(latestDbSong, platform, selectedQuality);
            setCurrentSongUrl(streamUrl);

            if (audioRef.current) {
              setIsBuffering(true);
              audioRef.current.src = streamUrl;
              audioRef.current.addEventListener('loadedmetadata', restoreTime, { once: true });
              audioRef.current.load();
            }

            fetchPlayData(latestDbSong, platform, selectedQuality, false)
              .then((data) => {
                if (data.success && data.data?.lyric?.lyric) {
                  const parsedLyrics = parseLyric(data.data.lyric.lyric, data.data.lyric.tlyric);
                  setLyrics(parsedLyrics);
                }
              })
              .catch((error) => {
                console.error('加载歌词失败:', error);
              });
          } else {
            const data = await fetchPlayData(latestDbSong, platform, selectedQuality, true);
            if (data.success && data.data?.play?.directUrl && audioRef.current) {
              setCurrentSongUrl(data.data.play.directUrl);
              setIsBuffering(true);
              audioRef.current.src = data.data.play.directUrl;
              audioRef.current.addEventListener('loadedmetadata', restoreTime, { once: true });
              audioRef.current.load();

              if (data.data.lyric?.lyric) {
                const parsedLyrics = parseLyric(data.data.lyric.lyric, data.data.lyric.tlyric);
                setLyrics(parsedLyrics);
              }
            }
          }
        }
      } catch (error) {
        console.error('加载播放记录失败:', error);
      }
    };

    initializePlayState();
  }, []);

  // 恢复 PiP 偏好设置
  useEffect(() => {
    const savedOpacity = localStorage.getItem('lyricsPiPOpacity');
    const savedMinimized = localStorage.getItem('lyricsPiPMinimized');
    if (savedOpacity) setPipOpacity(parseFloat(savedOpacity));
    if (savedMinimized) setPipMinimized(savedMinimized === 'true');
  }, []);

  // 监听来自 PiP 窗口的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      switch (event.data.type) {
        case 'PIP_OPACITY_CHANGE':
          setPipOpacity(event.data.opacity);
          localStorage.setItem('lyricsPiPOpacity', event.data.opacity.toString());
          break;
        case 'PIP_MINIMIZED_CHANGE':
          setPipMinimized(event.data.minimized);
          localStorage.setItem('lyricsPiPMinimized', event.data.minimized.toString());
          break;
        case 'PIP_CLOSE':
          setShowPiPLyrics(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 监听播放状态变化，自动保存
  useEffect(() => {
    if (currentSong) {
      savePlayState();
    }
  }, [currentSong, currentSongIndex, currentSource, quality, playMode, volume, currentSongUrl, lyrics, playRecords, playlistIndex]);

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    currentSourceRef.current = currentSource;
  }, [currentSource]);

  useEffect(() => {
    if (!isMusicRoomOwner || !watchRoom || !currentSong) return;

    watchRoom.updateMusicState(buildMusicRoomState(currentSong));
  }, [isMusicRoomOwner, watchRoom, currentSong, playlist, playlistIndex, playMode, quality]);

  useEffect(() => {
    if (!isMusicRoomOwner || !watchRoom || !currentSong || !isPlaying) return;

    const interval = window.setInterval(() => {
      watchRoom.updateMusicState(buildMusicRoomState(currentSong, {
        currentTime: audioRef.current?.currentTime || currentTimeRef.current || 0,
        isPlaying: true,
      }));
    }, 5000);

    return () => window.clearInterval(interval);
  }, [isMusicRoomOwner, watchRoom, currentSong, isPlaying, playlist, playlistIndex, playMode, quality]);

  // 监听 playRecords 变化，更新 playlistIndex
  useEffect(() => {
    if (pendingSongToPlay) {
      const index = playRecords.findIndex(
        r => r.platform === pendingSongToPlay.platform && r.id === pendingSongToPlay.id
      );
      setPlaylistIndex(index);
      setPendingSongToPlay(null);
    }
  }, [playRecords, pendingSongToPlay]);

  // 同步音量状态到 audio 元素
  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  const handlePlayAllCurrentSongsWith = async (targetSongs: Song[], title: string) => {
    try {
      if (targetSongs.length === 0) {
        setToast({ message: '当前列表为空', type: 'error', onClose: () => setToast(null) });
        return;
      }

      await fetch('/api/music/v2/history', { method: 'DELETE' });
      const baseTime = Date.now();
      const recordsToAdd = targetSongs.map((song, i) => ({
        song: {
          songId: song.id,
          source: song.platform,
          songmid: song.songmid,
          name: song.name,
          artist: song.artist,
          album: song.album,
          cover: song.pic,
          durationSec: song.duration || 0,
          durationText: song.durationText,
        },
        playProgressSec: 0,
        lastPlayedAt: baseTime + i,
        playCount: 1,
        lastQuality: quality,
        createdAt: baseTime + i,
      }));
      await fetch('/api/music/v2/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: recordsToAdd }),
      });
      const newRecords: PlayRecord[] = targetSongs.map((song, i) => ({
        platform: song.platform,
        id: song.id,
        playTime: 0,
        duration: song.duration || 0,
        timestamp: baseTime + i,
      }));
      setPlayRecords(newRecords);
      setPlaylist(targetSongs);
      setPlaylistIndex(0);
      await playSong(targetSongs[0], 0);
      setToast({ message: `已开始播放 ${title}`, type: 'success', onClose: () => setToast(null) });
    } catch (error) {
      console.error('播放全部失败:', error);
      setToast({ message: '播放全部失败', type: 'error', onClose: () => setToast(null) });
    }
  };

  const addSongToQueue = async (song: Song) => {
    if (!currentSong && playlist.length === 0 && playRecords.length === 0) {
      await playSong(song, -1);
      return;
    }
    const platform = song.platform || currentSource;
    const exists = playlist.some((item) => item.id === song.id && item.platform === platform);
    if (exists) {
      setToast({ message: '歌曲已在播放列表中', type: 'info', onClose: () => setToast(null) });
      return;
    }
    const record: PlayRecord = { platform, id: song.id, playTime: 0, duration: song.duration || 0, timestamp: Date.now() };
    setPlayRecords((prev) => [...prev, record]);
    setPlaylist((prev) => [...prev, { ...song, platform }]);
    saveHistoryRecordSafely(record, { ...song, platform }, 0, song.duration || 0);
    setToast({ message: '已添加到稍后播放', type: 'success', onClose: () => setToast(null) });
  };

  // 播放歌曲
  const playSong = async (song: Song, index: number) => {
    beginResolving();
    try {
      // 使用歌曲自己的平台信息，如果没有则使用当前选择的平台
          const platform = song.platform || currentSource;
          const proxyEnabled = getMusicProxyEnabled();
          setMusicProxyEnabled(proxyEnabled);
          const syncSong = { ...song, platform };

      // 记录歌曲开始播放的时间
      songStartTimeRef.current = Date.now();

      // 先设置当前歌曲和显示播放器
      setCurrentSong(song);
      setCurrentSongIndex(index);
      setShowPlayer(true);
      setLyrics([]); // 清空旧歌词

      // 添加到播放记录和播放列表。timestamp 表示入队时间，不能在再次播放时刷新，
      // 否则会破坏按 createdAt/timestamp 维护的播放队列顺序。
      const existingRecord = playRecords.find(r => r.platform === platform && r.id === song.id);
      const record: PlayRecord = existingRecord || {
        platform: platform,
        id: song.id,
        playTime: 0, // 初始播放时间
        duration: song.duration || 0, // 将在音频加载后更新
        timestamp: Date.now(),
      };

      // 设置待播放歌曲信息，用于在 playRecords 更新后找到索引
      setPendingSongToPlay({ platform, id: song.id });

      setPlayRecords(prev => {
        const existingIndex = prev.findIndex(r => r.platform === record.platform && r.id === record.id);
        if (existingIndex >= 0) {
          // 记录已存在：保持原位置和原 timestamp，只补齐可能变化的时长信息。
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            duration: updated[existingIndex].duration || song.duration || 0,
          };
          return updated;
        } else {
          // 新记录，添加到列表末尾
          return [...prev, record];
        }
      });

      setPlaylist(prev => {
        const existingIndex = prev.findIndex(s => s.id === song.id && s.platform === platform);
        if (existingIndex >= 0) {
          return prev;
        } else {
          return [...prev, { ...song, platform }];
        }
      });

      saveHistoryRecordSafely(record, { ...song, platform }, 0, song.duration || 0);
      emitMusicChange(buildMusicRoomState(syncSong, {
        currentTime: 0,
        isPlaying: true,
      }));

      if (proxyEnabled) {
        const streamUrl = buildStreamUrl(song, platform, quality);
        setCurrentSongUrl(streamUrl);

        if (audioRef.current) {
          setIsBuffering(true);
          audioRef.current.src = streamUrl;
          audioRef.current.load();
          audioRef.current.play().catch(err => {
            console.error('播放失败:', err);
            setIsBuffering(false);
          });
          setIsPlaying(true);
        }

        fetchPlayData(song, platform, quality, false)
          .then((data) => {
            if (data.success) {
              if (data.data.song?.cover) {
                setCurrentSong({
                  ...song,
                  pic: data.data.song.cover,
                  platform,
                });
              }

              if (data.data.lyric?.lyric) {
                const parsedLyrics = parseLyric(data.data.lyric.lyric, data.data.lyric.tlyric);
                setLyrics(parsedLyrics);
              }
            } else {
              console.error('播放信息获取失败:', data);
            }
          })
          .catch((error) => {
            console.error('加载歌词失败:', error);
          });
      } else {
        const data = await fetchPlayData(song, platform, quality, true);
        if (data.success && data.data?.play?.directUrl) {
          if (data.data.song?.cover) {
            setCurrentSong({
              ...song,
              pic: data.data.song.cover,
              platform,
            });
          }

          if (data.data.lyric?.lyric) {
            const parsedLyrics = parseLyric(data.data.lyric.lyric, data.data.lyric.tlyric);
            setLyrics(parsedLyrics);
          }

          setCurrentSongUrl(data.data.play.directUrl);

          if (audioRef.current) {
            setIsBuffering(true);
            audioRef.current.src = data.data.play.directUrl;
            audioRef.current.load();
            audioRef.current.play().catch(err => {
              console.error('播放失败:', err);
              setIsBuffering(false);
            });
            setIsPlaying(true);
          }
        } else {
          console.error('播放信息获取失败:', data);
        }
      }
    } catch (error) {
      console.error('播放失败:', error);
      setIsBuffering(false);
    } finally {
      endResolving();
    }
  };

  // 解析歌词文本
  const parseLyric = (lyricText: string, tlyricText?: string): LyricLine[] => {
    if (!lyricText && !tlyricText) return [];

    // 匹配 [mm:ss.xx] 或 [mm:ss] 格式
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
    const parseLyricText = (text: string) => {
      const parsed = new Map<number, string>();
      const lines = text.split('\n');

      lines.forEach(line => {
        const matches = Array.from(line.matchAll(timeRegex));
        if (matches.length > 0) {
          const content = line.replace(timeRegex, '').trim();
          if (content) {
            matches.forEach(match => {
              const minutes = parseInt(match[1]);
              const seconds = parseInt(match[2]);
              const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
              const time = minutes * 60 + seconds + milliseconds / 1000;
              parsed.set(time, content);
            });
          }
        }
      });

      return parsed;
    };

    const mainMap = parseLyricText(lyricText || '');
    const transMap = parseLyricText(tlyricText || '');
    const times = Array.from(new Set([
      ...Array.from(mainMap.keys()),
      ...Array.from(transMap.keys()),
    ])).sort((a, b) => a - b);

    return times
      .map(time => ({
        time,
        text: mainMap.get(time) || '',
        translation: transMap.get(time) || undefined,
      }))
      .filter(line => line.text || line.translation);
  };

  // 切换播放/暂停
  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
        if (isMusicRoomOwner) {
          if (currentSong) {
            watchRoom?.pauseMusic(buildMusicRoomState(currentSong, {
              currentTime: audioRef.current.currentTime || currentTimeRef.current || 0,
              isPlaying: false,
            }));
          }
        }
        // 暂停时保存状态到 localStorage 和数据库
        savePlayState();

        // 前5秒不保存（避免加载时的跳转触发保存）
        if (Date.now() - songStartTimeRef.current < 5000) {
          return;
        }

        // 保存到数据库
        if (currentSong && playlistIndex >= 0 && playRecords[playlistIndex]) {
          const record = playRecords[playlistIndex];
          saveHistoryRecord(record, currentSong, audioRef.current.currentTime, audioRef.current.duration || 0).catch(err => {
            console.error('暂停时保存播放记录失败:', err);
          });
        }
      } else {
        setIsBuffering(true);
        audioRef.current.play().catch(err => {
          console.error('播放失败:', err);
          setIsBuffering(false);
        });
        setIsPlaying(true);
        if (isMusicRoomOwner) {
          if (currentSong) {
            watchRoom?.playMusic(buildMusicRoomState(currentSong, {
              currentTime: audioRef.current.currentTime || currentTimeRef.current || 0,
              isPlaying: true,
            }));
          }
        }
      }
    }
  };

  // 上一曲
  const playPrev = () => {
    if (playlist.length > 0) {
      const prevIndex = playlistIndex > 0 ? playlistIndex - 1 : playlist.length - 1;
      setPlaylistIndex(prevIndex);
      playSong(playlist[prevIndex], -1);
    }
  };

  // 下一曲
  const playNext = () => {
    if (playlist.length > 0) {
      const nextIndex = playlistIndex < playlist.length - 1 ? playlistIndex + 1 : 0;
      setPlaylistIndex(nextIndex);
      playSong(playlist[nextIndex], -1);
    }
  };

  // 切换音质
  const handleQualityChange = async (nextQuality: MusicQuality) => {
    setShowQualityMenu(false);

    if (nextQuality === quality) return;

    const targetSong = currentSong;
    const audio = audioRef.current;
    const targetPlatform = targetSong?.platform || currentSource;

    currentSongRef.current = targetSong;
    currentSourceRef.current = currentSource;

    setQuality(nextQuality);

    // 没有正在播放的歌曲时，仅保存偏好；下次播放会使用新音质。
    if (!targetSong || !audio) return;

    const requestId = ++qualitySwitchRequestRef.current;
    const targetSongKey = `${targetPlatform}:${targetSong.id}`;
    const resumeTime = Number.isFinite(audio.currentTime) ? audio.currentTime : currentTimeRef.current;
    const shouldResume = isPlaying || (!audio.paused && !audio.ended);

    const isStillTargetSong = () => {
      const activeSong = currentSongRef.current;
      if (!activeSong) return false;

      const activePlatform = activeSong.platform || currentSourceRef.current;
      return (
        requestId === qualitySwitchRequestRef.current &&
        `${activePlatform}:${activeSong.id}` === targetSongKey
      );
    };

    beginResolving();
    try {
      const proxyEnabled = getMusicProxyEnabled();
      setMusicProxyEnabled(proxyEnabled);

      let nextSongUrl = '';

      if (proxyEnabled) {
        nextSongUrl = buildStreamUrl(targetSong, targetPlatform, nextQuality);
      } else {
        const data = await fetchPlayData(targetSong, targetPlatform, nextQuality, true);
        if (!isStillTargetSong()) return;

        if (!data.success || !data.data?.play?.directUrl) {
          throw new Error(data.error?.message || '获取播放地址失败');
        }

        nextSongUrl = data.data.play.directUrl;

        if (data.data.song?.cover) {
          setCurrentSong({
            ...targetSong,
            pic: data.data.song.cover,
            platform: targetPlatform,
          });
        }

        if (data.data.lyric?.lyric) {
          const parsedLyrics = parseLyric(data.data.lyric.lyric, data.data.lyric.tlyric);
          setLyrics(parsedLyrics);
        }
      }

      if (!isStillTargetSong()) return;

      const activeRecord =
        playRecords[playlistIndex]?.platform === targetPlatform && playRecords[playlistIndex]?.id === targetSong.id
          ? playRecords[playlistIndex]
          : playRecords.find((record) => record.platform === targetPlatform && record.id === targetSong.id);
      const totalDuration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : duration || targetSong.duration || 0;

      if (activeRecord) {
        saveHistoryRecordSafely(
          activeRecord,
          { ...targetSong, platform: targetPlatform },
          resumeTime,
          totalDuration,
          Date.now(),
          nextQuality
        );
      }

      setCurrentSongUrl(nextSongUrl);
      setCurrentTime(resumeTime);
      songStartTimeRef.current = Date.now();
      restoredTimeRef.current = resumeTime;

      const resumeAfterMetadata = () => {
        if (!isStillTargetSong()) return;

        if (resumeTime > 0) {
          try {
            const maxSeekTime =
              Number.isFinite(audio.duration) && audio.duration > 0
                ? Math.max(0, audio.duration - 0.25)
                : resumeTime;
            const seekTime = Math.min(resumeTime, maxSeekTime);

            if (Math.abs(audio.currentTime - seekTime) > 1) {
              audio.currentTime = seekTime;
            }
          } catch (error) {
            console.warn('切换音质后恢复播放进度失败:', error);
          }
        }

        setCurrentTime(audio.currentTime || resumeTime);

        if (shouldResume) {
          audio.play()
            .then(() => setIsPlaying(true))
            .catch((error) => {
              console.error('切换音质后播放失败:', error);
              setIsPlaying(false);
              setIsBuffering(false);
            });
        } else {
          setIsPlaying(false);
        }
      };

      audio.pause();
      setIsBuffering(true);
      audio.src = nextSongUrl;
      audio.addEventListener('loadedmetadata', resumeAfterMetadata, { once: true });
      audio.load();
      setIsPlaying(shouldResume);
    } catch (error) {
      console.error('切换音质失败:', error);
      setIsBuffering(false);
      setToast({
        message: (error as Error).message || '切换音质失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    } finally {
      endResolving();
    }
  };

  const cycleQuality = () => {
    const qualities: MusicQuality[] = ['128k', '320k', 'flac', 'flac24bit'];
    const currentIndex = qualities.indexOf(quality);
    const nextIndex = (currentIndex + 1) % qualities.length;
    void handleQualityChange(qualities[nextIndex]);
  };

  // 清空播放记录
  const handleClearPlayRecords = () => {
    setConfirmModal({
      isOpen: true,
      title: '确认清空',
      message: '确定要清空全部播放记录吗？',
      onConfirm: async () => {
        try {
          await fetch('/api/music/v2/history', { method: 'DELETE' });
          clearCurrentPlaybackState();
          setPlaylist([]);
          setPlayRecords([]);
          setPlaylistIndex(-1);
          setToast({
            message: '播放记录已清空',
            type: 'success',
            onClose: () => setToast(null),
          });
        } catch (error) {
          console.error('清空播放记录失败:', error);
          setToast({
            message: '清空播放记录失败',
            type: 'error',
            onClose: () => setToast(null),
          });
        } finally {
          setConfirmModal({
            isOpen: false,
            title: '',
            message: '',
            onConfirm: () => {},
            onCancel: () => {},
          });
        }
      },
      onCancel: () => {
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
    });
  };

  // 切换播放模式
  const toggleMode = () => {
    const modes: Array<'loop' | 'single' | 'random'> = ['loop', 'single', 'random'];
    const currentIndex = modes.indexOf(playMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setPlayMode(modes[nextIndex]);
  };

  // 下载歌曲
  const downloadSong = () => {
    if (!currentSongUrl || !currentSong) return;

    // 创建一个临时的 a 标签来触发下载
    const link = document.createElement('a');
    link.href = currentSongUrl;
    link.download = `${currentSong.name} - ${currentSong.artist}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 音频事件监听
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      // 更新当前歌词索引
      if (lyrics.length > 0) {
        let index = -1;
        for (let i = 0; i < lyrics.length; i++) {
          if (lyrics[i].time <= audio.currentTime) {
            index = i;
          } else {
            break;
          }
        }
        setCurrentLyricIndex(index);
      }

      // 每20秒保存一次播放进度和播放时间
      const now = Date.now();
      if (now - lastSaveTimeRef.current > 20000) {
        lastSaveTimeRef.current = now;

        // 前5秒不保存（避免加载时的跳转触发保存）
        if (Date.now() - songStartTimeRef.current < 5000) {
          return;
        }

        // 更新当前播放记录的播放时间
        if (currentSong && playlistIndex >= 0) {
          setPlayRecords(prev => {
            const updated = [...prev];
            if (updated[playlistIndex]) {
              updated[playlistIndex] = {
                ...updated[playlistIndex],
                playTime: audio.currentTime,
              };

              // 保存到数据库
              const record = updated[playlistIndex];
              saveHistoryRecord(record, currentSong, audio.currentTime, audio.duration || 0).catch(err => {
                console.error('保存播放记录到数据库失败:', err);
              });
            }
            return updated;
          });
        }

        savePlayState();
      }
    };

    const handleLoadedMetadata = () => {
      // 恢复播放进度
      if (restoredTimeRef.current > 0) {
        audio.currentTime = restoredTimeRef.current;
        restoredTimeRef.current = 0; // 清除标记
      }
    };

    const handleBufferingStart = () => {
      if (audio.src && !audio.ended) {
        setIsBuffering(true);
      }
    };

    const handleBufferingEnd = () => {
      setIsBuffering(false);
    };

    const handleDurationChange = () => {
      setDuration(audio.duration);

      // 前5秒不保存（避免加载时的跳转触发保存）
      if (Date.now() - songStartTimeRef.current < 5000) {
        return;
      }

      // 更新当前播放记录的总时长
      if (currentSong && playlistIndex >= 0) {
        setPlayRecords(prev => {
          const updated = [...prev];
          if (updated[playlistIndex]) {
            updated[playlistIndex] = {
              ...updated[playlistIndex],
              duration: audio.duration,
            };

            // 保存到数据库（包含时长信息）
            const record = updated[playlistIndex];
            saveHistoryRecord(record, currentSong, record.playTime, audio.duration).catch(err => {
              console.error('保存播放记录到数据库失败:', err);
            });
          }
          return updated;
        });
      }
    };
    const handleEnded = () => {
      setIsBuffering(false);
      if (playMode === 'single') {
        audio.currentTime = 0;
        audio.play();
      } else if (playMode === 'random') {
        if (playlist.length > 0) {
          const randomIndex = Math.floor(Math.random() * playlist.length);
          setPlaylistIndex(randomIndex);
          playSong(playlist[randomIndex], -1);
        }
      } else {
        playNext();
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadstart', handleBufferingStart);
    audio.addEventListener('waiting', handleBufferingStart);
    audio.addEventListener('stalled', handleBufferingStart);
    audio.addEventListener('canplay', handleBufferingEnd);
    audio.addEventListener('canplaythrough', handleBufferingEnd);
    audio.addEventListener('playing', handleBufferingEnd);
    audio.addEventListener('pause', handleBufferingEnd);
    audio.addEventListener('error', handleBufferingEnd);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadstart', handleBufferingStart);
      audio.removeEventListener('waiting', handleBufferingStart);
      audio.removeEventListener('stalled', handleBufferingStart);
      audio.removeEventListener('canplay', handleBufferingEnd);
      audio.removeEventListener('canplaythrough', handleBufferingEnd);
      audio.removeEventListener('playing', handleBufferingEnd);
      audio.removeEventListener('pause', handleBufferingEnd);
      audio.removeEventListener('error', handleBufferingEnd);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [playMode, currentSongIndex, lyrics, currentSong, playlistIndex, playRecords, quality]);

  // 歌词自动滚动
  useEffect(() => {
    if (lyricsContainerRef.current && currentLyricIndex >= 0) {
      const container = lyricsContainerRef.current;
      const activeLine = container.querySelector(`[data-index="${currentLyricIndex}"]`);
      if (activeLine) {
        activeLine.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [currentLyricIndex]);

  // 进度条拖动
  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = (parseFloat(e.target.value) / 100) * duration;
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    if (isMusicRoomOwner) {
      const syncSong = currentSongRef.current || currentSong;
      if (syncSong) {
        watchRoom?.seekMusic(buildMusicRoomState(syncSong, {
          currentTime: newTime,
          isPlaying,
        }));
      }
    }
  };

  const seekToLyric = (line: LyricLine, index: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(line.time)) return;

    const maxSeekTime =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.max(0, audio.duration - 0.25)
        : line.time;
    const nextTime = Math.max(0, Math.min(line.time, maxSeekTime));

    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    setCurrentLyricIndex(index);
    if (isMusicRoomOwner) {
      const syncSong = currentSongRef.current || currentSong;
      if (syncSong) {
        watchRoom?.seekMusic(buildMusicRoomState(syncSong, {
          currentTime: nextTime,
          isPlaying,
        }));
      }
    }
  };

  // 音量调节
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100;
    }
  };

  // 触摸/鼠标滑动音量调节（移动端兼容）
  const handleVolumeSliderInteraction = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const slider = e.currentTarget;
    const rect = slider.getBoundingClientRect();

    const updateVolume = (clientY: number) => {
      // 计算相对于滑块顶部的位置
      const y = clientY - rect.top;
      // 限制在滑块范围内
      const clampedY = Math.max(0, Math.min(rect.height, y));
      // 从上到下：0% -> 100%，从下到上：100% -> 0%
      const percentage = 100 - (clampedY / rect.height) * 100;
      const newVolume = Math.round(percentage);

      setVolume(newVolume);
      if (audioRef.current) {
        audioRef.current.volume = newVolume / 100;
      }
    };

    // 获取初始触摸/点击位置
    const clientY = 'touches' in e ? e.touches[0]?.clientY || 0 : e.clientY;
    updateVolume(clientY);

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      moveEvent.preventDefault();
      const moveClientY = 'touches' in moveEvent ? moveEvent.touches[0]?.clientY || 0 : moveEvent.clientY;
      updateVolume(moveClientY);
    };

    const handleEnd = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
  };

  // PiP 窗口管理
  const togglePiPLyrics = () => {
    if (!('documentPictureInPicture' in window)) {
      setToast({
        message: '您的浏览器不支持画中画功能，请使用 Chrome 116+ 版本',
        type: 'error',
      });
      // 降级方案：打开全屏歌词
      setShowLyrics(true);
      return;
    }

    if (!currentSong) {
      setToast({
        message: '请先播放歌曲',
        type: 'info',
      });
      return;
    }

    setShowPiPLyrics(!showPiPLyrics);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const showStreamBuffering = Boolean(currentSong && isBuffering);

  const toggleSpectrum = () => {
    setShowSpectrum(prev => !prev);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('musicShowSpectrum', showSpectrum ? '1' : '0');
  }, [showSpectrum]);

  const getQualityLabel = () => {
    switch (quality) {
      case '128k': return '标准';
      case '320k': return 'HQ';
      case 'flac': return 'SQ';
      case 'flac24bit': return 'HR';
    }
  };

  const getSourceLabel = () => {
    return getSourceDisplayLabel(currentSource, false);
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const sleepPickerItemHeight = 40;
  const sleepPickerVisibleCount = 5;
  const sleepPickerHeight = sleepPickerItemHeight * sleepPickerVisibleCount;
  const clampSleepPickerValue = (value: number, max: number) => Math.max(0, Math.min(max, value));

  const formatSleepTimer = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '已关闭';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const restMins = mins % 60;
      return `${hours}:${restMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const setSleepTimer = (minutes: number) => {
    const endAt = Date.now() + minutes * 60 * 1000;
    setSleepTimerEndAt(endAt);
    setSleepTimerRemaining(minutes * 60);
    setShowSleepTimerMenu(false);
    setToast({
      message: `已设置 ${minutes} 分钟后暂停播放`,
      type: 'success',
      onClose: () => setToast(null),
    });
  };

  const setCustomSleepTimer = () => {
    const totalMinutes = customSleepHours * 60 + customSleepMinutes;
    if (totalMinutes <= 0) {
      setToast({
        message: '请选择大于 0 的定时时长',
        type: 'info',
        onClose: () => setToast(null),
      });
      return;
    }
    setSleepTimer(totalMinutes);
  };

  const cancelSleepTimer = () => {
    setSleepTimerEndAt(null);
    setSleepTimerRemaining(0);
    setShowSleepTimerMenu(false);
    setToast({
      message: '已关闭睡眠定时',
      type: 'info',
      onClose: () => setToast(null),
    });
  };

  const handleSleepHourScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const nextValue = clampSleepPickerValue(Math.round(e.currentTarget.scrollTop / sleepPickerItemHeight), 12);
    if (nextValue !== customSleepHours) setCustomSleepHours(nextValue);
  };

  const handleSleepMinuteScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const nextValue = clampSleepPickerValue(Math.round(e.currentTarget.scrollTop / sleepPickerItemHeight), 59);
    if (nextValue !== customSleepMinutes) setCustomSleepMinutes(nextValue);
  };

  useEffect(() => {
    if (!sleepTimerEndAt) return;

    const updateSleepTimer = () => {
      const remaining = Math.max(0, Math.ceil((sleepTimerEndAt - Date.now()) / 1000));
      setSleepTimerRemaining(remaining);

      if (remaining > 0) return;

      setSleepTimerEndAt(null);
      setShowSleepTimerMenu(false);

      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setIsPlaying(false);
        savePlayState();
      }

      setToast({
        message: '睡眠定时结束，已暂停播放',
        type: 'info',
        onClose: () => setToast(null),
      });
    };

    updateSleepTimer();
    const timerId = window.setInterval(updateSleepTimer, 1000);
    return () => window.clearInterval(timerId);
  }, [sleepTimerEndAt]);

  useEffect(() => {
    if (!showSleepTimerMenu) return;

    const scrollToSelected = (el: HTMLDivElement | null, value: number) => {
      if (!el) return;
      window.requestAnimationFrame(() => {
        el.scrollTop = value * sleepPickerItemHeight;
      });
    };

    // 只在弹窗打开时定位一次。不要把 customSleepHours/customSleepMinutes
    // 放进依赖，否则滚动触发 setState 后又反向改 scrollTop，会造成频闪。
    scrollToSelected(sleepHoursPickerRef.current, customSleepHours);
    scrollToSelected(sleepMinutesPickerRef.current, customSleepMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSleepTimerMenu]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || typeof window === 'undefined') return;

    let cancelled = false;

    const ensureAnalyser = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

        if (!AudioContextClass) return;

        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContextClass();
        }

        if (!mediaSourceRef.current) {
          mediaSourceRef.current = audioContextRef.current.createMediaElementSource(audio);
        }

        if (!analyserRef.current) {
          const analyser = audioContextRef.current.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.8;
          mediaSourceRef.current.connect(analyser);
          analyser.connect(audioContextRef.current.destination);
          analyserRef.current = analyser;
          spectrumDataRef.current = new Uint8Array(analyser.frequencyBinCount);
        }

        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }
      } catch (error) {
        console.warn('初始化频谱分析器失败，将使用模拟动画:', error);
      }
    };

    const tick = () => {
      if (cancelled) return;

      const analyser = analyserRef.current;
      const data = spectrumDataRef.current;
      const isActive = !audio.paused && !audio.ended;
      let nextBars = Array.from({ length: SPECTRUM_BIN_COUNT }, () => SPECTRUM_IDLE_LEVEL);

      if (isActive && analyser && data) {
        analyser.getByteFrequencyData(data);
        const usableBins = Math.max(1, Math.floor(data.length * 0.88));
        const visualVolume = Math.max(SPECTRUM_MIN_VOLUME, volumeRef.current || SPECTRUM_REFERENCE_VOLUME);
        const visualVolumeScale =
          visualVolume > SPECTRUM_MAX_REFERENCE_VOLUME
            ? Math.sqrt(SPECTRUM_MAX_REFERENCE_VOLUME / visualVolume)
            : SPECTRUM_REFERENCE_VOLUME / visualVolume;

        nextBars = Array.from({ length: SPECTRUM_BIN_COUNT }, (_, index) => {
          const start = Math.floor((index / SPECTRUM_BIN_COUNT) * usableBins);
          const end = Math.max(start + 1, Math.floor(((index + 1) / SPECTRUM_BIN_COUNT) * usableBins));
          let total = 0;

          for (let i = start; i < end; i++) {
            total += data[i] ?? 0;
          }

          const average = (total / Math.max(1, end - start)) * visualVolumeScale;
          const rightBias = index / Math.max(1, SPECTRUM_BIN_COUNT - 1);
          const highFreqCompensation = 1 + rightBias * 0.85;
          const floorLift = rightBias * 0.035;
          return Math.max(
            SPECTRUM_IDLE_LEVEL,
            Math.min(1, (average / 255) * highFreqCompensation + floorLift)
          );
        });
      } else if (isActive) {
        nextBars = Array.from({ length: SPECTRUM_BIN_COUNT }, (_, index) => {
          const wave =
            Math.sin(currentTimeRef.current * 5.2 + index * 0.28 + spectrumSeedRef.current) * 0.12 +
            Math.sin(currentTimeRef.current * 2.6 + index * 0.16) * 0.08 +
            0.22;
          return Math.max(SPECTRUM_IDLE_LEVEL, Math.min(0.65, wave));
        });
      }

      setSpectrumBars(prev =>
        nextBars.map((value, index) => {
          const previous = prev[index] ?? SPECTRUM_IDLE_LEVEL;
          return previous + (value - previous) * (isActive ? 0.34 : 0.12);
        })
      );

      spectrumFrameRef.current = window.requestAnimationFrame(tick);
    };

    void ensureAnalyser();
    spectrumFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (spectrumFrameRef.current) {
        window.cancelAnimationFrame(spectrumFrameRef.current);
        spectrumFrameRef.current = null;
      }
    };
  }, [currentSong]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && spectrumFrameRef.current) {
        window.cancelAnimationFrame(spectrumFrameRef.current);
      }
      analyserRef.current?.disconnect();
      mediaSourceRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, []);


  useEffect(() => {
    const handlePlaySongEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ song: Song; index?: number }>).detail;
      if (detail?.song) void playSong(detail.song, detail.index ?? -1);
    };

    const handlePlayAllEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ songs: Song[]; title?: string }>).detail;
      if (!detail?.songs?.length) return;
      void handlePlayAllCurrentSongsWith(detail.songs, detail.title || '当前列表');
    };

    const handleAddToPlaylistEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ song: Song }>).detail;
      if (detail?.song) {
        setSongToAddToPlaylist(detail.song);
        setShowAddToPlaylistModal(true);
      }
    };

    const handlePlayLaterEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ song: Song }>).detail;
      if (!detail?.song) return;
      void addSongToQueue(detail.song);
    };

    window.addEventListener('music:play-song', handlePlaySongEvent);
    window.addEventListener('music:play-all', handlePlayAllEvent);
    window.addEventListener('music:add-to-playlist', handleAddToPlaylistEvent);
    window.addEventListener('music:play-later', handlePlayLaterEvent);
    return () => {
      window.removeEventListener('music:play-song', handlePlaySongEvent);
      window.removeEventListener('music:play-all', handlePlayAllEvent);
      window.removeEventListener('music:add-to-playlist', handleAddToPlaylistEvent);
      window.removeEventListener('music:play-later', handlePlayLaterEvent);
    };
  }, [playlist, playRecords, currentSong, quality, currentSource]);

  return (
    <div className="music-theme min-h-screen bg-zinc-950 text-white">
      <>
      <style jsx global>{`
        @keyframes vinyl-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .vinyl-player {
          position: relative;
          width: min(72vw, 300px);
          height: min(72vw, 300px);
          margin: 42px auto 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        @media (min-width: 768px) {
          .vinyl-player {
            width: clamp(260px, 30vw, 360px);
            height: clamp(260px, 30vw, 360px);
            margin: 54px auto 28px;
          }
        }
        .vinyl-needle {
          position: absolute;
          top: -50px;
          left: 50%;
          margin-left: -20px;
          width: 108px;
          height: 140px;
          background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><path d="M21,21 C21,65 86,70 86,100" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="6" stroke-linecap="round"/><path d="M20,20 C20,65 85,70 85,100" fill="none" stroke="%23e0e0e0" stroke-width="4.5" stroke-linecap="round"/><path d="M19,20 C19,65 84,70 84,100" fill="none" stroke="%23fff" stroke-width="1.5" stroke-linecap="round"/><g transform="translate(85, 100) rotate(25)"><rect x="-6" y="0" width="12" height="18" rx="2" fill="%23ccc"/><rect x="-4" y="5" width="8" height="14" rx="1" fill="%23333"/><rect x="-2" y="16" width="4" height="5" rx="1" fill="%23d43c33"/></g><circle cx="20" cy="20" r="10" fill="%23f0f0f0" stroke="%23ccc" stroke-width="1"/><circle cx="20" cy="20" r="4" fill="%23fff"/><circle cx="20" cy="20" r="1.5" fill="%23999"/></svg>');
          background-repeat: no-repeat;
          background-size: contain;
          transform-origin: 20px 20px;
          transform: rotate(-30deg);
          transition: transform 0.5s cubic-bezier(0.3, 0, 0.1, 1);
          z-index: 5;
          pointer-events: none;
          filter: drop-shadow(0 8px 8px rgba(0,0,0,0.35));
        }
        .vinyl-player.playing .vinyl-needle {
          transform: rotate(0deg);
        }
        .vinyl-disc {
          position: relative;
          width: 88%;
          height: 88%;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: conic-gradient(from 45deg, #080808 0%, #2a2a2a 10%, #0f0f0f 20%, #111 40%, #303030 50%, #111 60%, #090909 80%, #2a2a2a 90%, #080808 100%);
          box-shadow: 0 0 0 8px rgba(255,255,255,0.045), 0 18px 36px rgba(0,0,0,0.55), inset 0 0 24px rgba(255,255,255,0.04);
          animation: vinyl-spin 20s linear infinite;
          animation-play-state: paused;
        }
        .vinyl-player.playing .vinyl-disc {
          animation-play-state: running;
        }
        .vinyl-disc::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: repeating-radial-gradient(transparent 0, transparent 3px, rgba(255,255,255,0.045) 3px, rgba(255,255,255,0.045) 4px), radial-gradient(circle at 35% 25%, rgba(255,255,255,0.14), transparent 28%);
          pointer-events: none;
        }
        .vinyl-disc::after {
          content: '';
          position: absolute;
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #111;
          border: 2px solid rgba(255,255,255,0.25);
          z-index: 3;
          pointer-events: none;
        }
        .vinyl-cover {
          position: relative;
          z-index: 2;
          width: 64%;
          height: 64%;
          border-radius: 9999px;
          object-fit: cover;
          border: 5px solid #0a0a0a;
          user-select: none;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
        }
        .vinyl-cover-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          background: #27272a;
        }
        @keyframes music-note-bounce {
          0%,
          100% {
            transform: translateY(0);
            opacity: 0.55;
          }
          50% {
            transform: translateY(-8px);
            opacity: 1;
          }
        }
        @keyframes music-buffer-scan {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }
        @keyframes music-buffer-stripes {
          0% {
            background-position: 0 0;
          }
          100% {
            background-position: 24px 0;
          }
        }
        .music-buffer-track {
          background-image: repeating-linear-gradient(
            115deg,
            rgba(16, 185, 129, 0.08) 0,
            rgba(16, 185, 129, 0.08) 6px,
            rgba(110, 231, 183, 0.28) 6px,
            rgba(110, 231, 183, 0.28) 12px
          );
          background-size: 24px 100%;
          animation: music-buffer-stripes 0.65s linear infinite;
        }
        .music-buffer-track::before {
          content: '';
          position: absolute;
          inset: 0;
          width: 42%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(167, 243, 208, 0.95),
            transparent
          );
          filter: drop-shadow(0 0 8px rgba(52, 211, 153, 0.7));
          animation: music-buffer-scan 0.95s ease-in-out infinite;
        }
      `}</style>
      <style jsx global>{`
        @keyframes music-buffer-scan-global {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(260%);
          }
        }
        @keyframes music-buffer-stripes-global {
          0% {
            background-position: 0 0;
          }
          100% {
            background-position: 28px 0;
          }
        }
        .music-buffer-track-global {
          background-image: repeating-linear-gradient(
            115deg,
            rgba(16, 185, 129, 0.1) 0,
            rgba(16, 185, 129, 0.1) 7px,
            rgba(110, 231, 183, 0.34) 7px,
            rgba(110, 231, 183, 0.34) 14px
          );
          background-size: 28px 100%;
          animation: music-buffer-stripes-global 0.55s linear infinite;
        }
        .music-buffer-track-global::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 45%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(236, 253, 245, 0.95),
            transparent
          );
          box-shadow: 0 0 12px rgba(52, 211, 153, 0.9);
          animation: music-buffer-scan-global 0.85s ease-in-out infinite;
        }
      `}</style>
      {resolvingCount > 0 && (
        <div className="fixed top-4 right-4 z-[80] pointer-events-none">
          <div className="relative w-16 h-16 md:w-20 md:h-20">
            <div className="absolute inset-0 rounded-full border-4 border-white/10" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-green-500 border-r-emerald-400 animate-spin shadow-[0_0_20px_rgba(34,197,94,0.35)]" />
            <div className="absolute inset-1 rounded-full bg-zinc-950/90 backdrop-blur-md border border-white/10 flex flex-col items-center justify-center">
              <div className="text-[10px] md:text-xs text-zinc-400 leading-none mb-1">解析中</div>
              <div className="text-lg md:text-xl font-bold text-white leading-none">{resolvingCount}</div>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-b border-white/10 px-4 md:px-6">
        <div className="w-full mx-auto flex items-center justify-between gap-3 md:gap-4 py-3">
          <div className="flex items-center justify-between md:justify-start md:gap-6 w-full md:w-auto">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSidebarDrawer(true)}
                className="p-0 text-white transition-colors hover:text-green-400"
                title="打开菜单"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="flex items-center justify-center text-green-500">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                </svg>
              </div>
              <span className="font-bold text-lg text-white">音乐</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-[80px] md:pt-[76px] pb-32 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          {_children}
        </div>
      </main>

      {/* Player */}
      {showPlayer && currentSong && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[95%] max-w-3xl z-50">
          {showSpectrum && (
            <div className="pointer-events-none px-4">
              <AudioSpectrumCanvas bars={spectrumBars} compact />
            </div>
          )}

          <div className="relative bg-zinc-900/95 backdrop-blur-md rounded-xl p-4 pt-5 border border-white/10 shadow-2xl">
            {/* Progress Bar */}
            <div className="absolute left-0 right-0 top-0 h-1 bg-white/10 rounded-t-xl overflow-hidden">
              <div
                className="relative z-10 h-full bg-green-500 transition-all pointer-events-none"
                style={{ width: `${progress}%` }}
              />
              {showStreamBuffering && (
                <div className="music-buffer-track-global absolute inset-0 z-0" />
              )}
              <input
                type="range"
                min="0"
                max="100"
                value={progress}
                onChange={handleProgressChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-4 mt-1">
              {/* Song Info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setShowLyrics(true)}
                >
                  {currentSong.pic ? (
                    <img
                      src={currentSong.pic}
                      alt={currentSong.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // 图片加载失败时显示默认图标
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <svg className="w-6 h-6 text-zinc-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 truncate text-sm font-bold text-white">{currentSong.name}</div>
                    <SourcePill source={currentSong.platform} variant="accent" className="hidden sm:inline-flex" />
                  </div>
                  <div className="text-xs text-zinc-500 truncate">{currentSong.artist}</div>
                </div>
              </div>

              {/* Controls */}
              <div className="relative flex items-center gap-4">
                <button onClick={playPrev} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>
                <button
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors"
                >
                  {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button onClick={playNext} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                </button>
                {showStreamBuffering && (
                  <span className="absolute left-[calc(50%+4rem)] top-1/2 inline-flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-300">
                    <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                    缓冲中
                  </span>
                )}
              </div>

              {/* Right Controls */}
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2">
                  <input
                    type="range"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-16 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentSong) {
                      setSongToAddToPlaylist(currentSong);
                      setShowAddToPlaylistModal(true);
                    }
                  }}
                  className="text-zinc-500 hover:text-red-500 transition-colors"
                  title="添加到歌单"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
                <button
                  onClick={downloadSong}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="下载歌曲"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button
                  onClick={toggleMode}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title={playMode === 'loop' ? '列表循环' : playMode === 'single' ? '单曲循环' : '随机播放'}
                >
                  {playMode === 'loop' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {playMode === 'single' && (
                    <div className="relative w-4 h-4">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold">1</span>
                    </div>
                  )}
                  {playMode === 'random' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audio Element */}
      <audio ref={audioRef} className="hidden" />

      {/* Lyrics Modal */}
      {showLyrics && currentSong && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={(e) => {
            // 点击背景关闭音量条
            if (e.target === e.currentTarget) {
              setShowVolumeSlider(false);
            }
          }}
        >
          <div
            className="relative w-full max-w-6xl h-[90vh] bg-zinc-900/95 rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex flex-col"
            onClick={() => setShowVolumeSlider(false)}
          >
            <button
              onClick={() => setShowLyrics(false)}
              className="absolute top-2 right-2 md:top-4 md:right-4 z-10 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex flex-1 min-h-0 flex-col md:flex-row">
              {/* Cover / Meta */}
              <div className="relative h-32 md:h-auto md:w-[380px] lg:w-[430px] xl:w-[480px] bg-gradient-to-b from-zinc-800 to-zinc-900 shrink-0 overflow-hidden">
                {currentSong.pic && (
                  <div className="absolute inset-0">
                    <img
                      src={currentSong.pic}
                      alt={currentSong.name}
                      className="w-full h-full object-cover opacity-30 blur-xl"
                    />
                  </div>
                )}
                <div className="relative h-full flex flex-col items-center justify-center p-4 md:p-6 lg:p-8">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setMobileLyricsView((view) => (view === 'lyrics' ? 'vinyl' : 'lyrics'));
                    }}
                    className="w-16 h-16 md:hidden rounded-xl overflow-hidden shadow-2xl mb-2"
                  >
                    {currentSong.pic ? (
                      <img
                        src={currentSong.pic}
                        alt={currentSong.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                        <svg className="w-8 h-8 text-zinc-600" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="hidden md:block w-full">
                    <VinylTurntable cover={currentSong.pic} title={currentSong.name} isPlaying={isPlaying} />
                  </div>
                  <div className="mb-1 flex min-w-0 items-center justify-center gap-1.5">
                    <h2 className="min-w-0 truncate text-center text-base md:text-xl lg:text-2xl font-bold text-white">{currentSong.name}</h2>
                    <SourcePill source={currentSong.platform} variant="accent" />
                  </div>
                  <p className="pb-px text-center text-xs leading-5 text-zinc-400 line-clamp-1 md:text-sm md:leading-6 lg:text-base lg:leading-7">{currentSong.artist}</p>
                </div>
              </div>

              {mobileLyricsView === 'vinyl' && (
                <div className="relative md:hidden flex-1 min-h-0 overflow-hidden bg-gradient-to-b from-zinc-800 to-zinc-900">
                  {currentSong.pic && (
                    <div className="absolute inset-0">
                      <img
                        src={currentSong.pic}
                        alt={currentSong.name}
                        className="w-full h-full object-cover opacity-30 blur-xl"
                      />
                    </div>
                  )}
                  <div className="relative h-full flex items-center justify-center p-4">
                    <VinylTurntable cover={currentSong.pic} title={currentSong.name} isPlaying={isPlaying} />
                  </div>
                </div>
              )}

              {/* Lyrics Content */}
              <div ref={lyricsContainerRef} className={`${mobileLyricsView === 'vinyl' ? 'hidden md:block' : 'block'} flex-1 overflow-y-auto p-4 md:p-6 lg:p-8`}>
                {lyrics.length > 0 ? (
                  <div className="space-y-4 md:space-y-5">
                    {lyrics.map((line, index) => (
                      <button
                        key={index}
                        type="button"
                        data-index={index}
                        onClick={() => seekToLyric(line, index)}
                        className={`block w-full appearance-none border-0 bg-transparent p-0 text-center transition-all duration-300 outline-none ring-0 focus:outline-none focus:ring-0 active:outline-none active:ring-0 ${
                          index === currentLyricIndex
                            ? 'text-white text-lg md:text-xl lg:text-2xl font-bold scale-110'
                            : index === currentLyricIndex - 1 || index === currentLyricIndex + 1
                            ? 'text-zinc-400 text-base md:text-lg'
                            : 'text-zinc-600 text-sm md:text-base'
                        }`}
                      >
                        <div>{line.text}</div>
                        {line.translation && (
                          <div
                            className={`mt-1 ${
                              index === currentLyricIndex
                                ? 'text-zinc-300 text-sm md:text-base lg:text-lg font-normal'
                                : 'text-zinc-500 text-xs md:text-sm lg:text-base font-normal'
                            }`}
                          >
                            {line.translation}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center space-y-4 pt-10 md:pt-16 lg:pt-20">
                    <p className="text-zinc-500 text-sm md:text-base">暂无歌词</p>
                    <p className="text-zinc-600 text-xs md:text-sm">纯音乐或歌词获取失败</p>
                  </div>
                )}
              </div>
            </div>

            {/* Mini Player Controls */}
            <div className="border-t border-white/5 p-3 md:p-4 shrink-0">
              {/* 上排：播放控制按钮 */}
              <div className="relative flex items-center justify-center gap-4 md:gap-6 mb-2 md:mb-3">
                <button onClick={playPrev} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>
                <button
                  onClick={togglePlay}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors"
                >
                  {isPlaying ? (
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 md:w-5 md:h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button onClick={playNext} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                </button>
                {showStreamBuffering && (
                  <span className="absolute left-[calc(50%+4rem)] top-1/2 inline-flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-300 md:left-[calc(50%+5rem)]">
                    <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                    缓冲中
                  </span>
                )}
              </div>

              {/* 下排：其他按钮（小一号） */}
              <div className="flex items-center justify-center gap-3 md:gap-4 mb-2 md:mb-3">
                <button
                  onClick={() => setShowPlaylist(true)}
                  className="text-zinc-500 hover:text-white transition-colors relative"
                  title="播放列表"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  {playlist.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                      {playlist.length > 9 ? '9+' : playlist.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={downloadSong}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="下载歌曲"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowQualityMenu(true)}
                  className="px-2 py-0.5 rounded border text-amber-400 border-amber-500/50 bg-amber-900/20 text-[9px] md:text-[10px] font-mono min-w-[32px] text-center hover:bg-amber-900/30 transition-colors"
                  title="音质选择"
                >
                  {getQualityLabel()}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSleepTimerMenu(true);
                  }}
                  className={`relative transition-colors ${
                    sleepTimerEndAt ? 'text-green-500 hover:text-green-400' : 'text-zinc-500 hover:text-white'
                  }`}
                  title={sleepTimerEndAt ? `睡眠定时：${formatSleepTimer(sleepTimerRemaining)}` : '睡眠定时'}
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                  </svg>
                  {sleepTimerEndAt && (
                    <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[8px] font-semibold leading-none text-green-400">
                      {Math.max(1, Math.ceil(sleepTimerRemaining / 60))}
                    </span>
                  )}
                </button>
                <button
                  onClick={toggleMode}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title={playMode === 'loop' ? '列表循环' : playMode === 'single' ? '单曲循环' : '随机播放'}
                >
                  {playMode === 'loop' && (
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {playMode === 'single' && (
                    <div className="relative w-4 h-4 md:w-5 md:h-5">
                      <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[7px] md:text-[8px] font-bold">1</span>
                    </div>
                  )}
                  {playMode === 'random' && (
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                    </svg>
                  )}
                </button>
                {/* 音量控制 */}
                <div
                  className="relative"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowVolumeSlider(!showVolumeSlider);
                    }}
                    className="text-zinc-500 hover:text-white transition-colors"
                    title="音量"
                  >
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {/* 垂直音量条 - 桌面悬浮/移动端点击 */}
                  <div
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 pb-2 transition-opacity ${showVolumeSlider ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="bg-zinc-800/95 backdrop-blur-sm rounded-lg p-3 shadow-xl border border-white/10">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-zinc-400 font-mono">{volume}</span>
                        <div
                          className="h-24 w-6 bg-white/10 rounded-full relative cursor-pointer select-none"
                          onMouseDown={handleVolumeSliderInteraction}
                          onTouchStart={handleVolumeSliderInteraction}
                        >
                          <div
                            className="absolute bottom-0 left-0 right-0 bg-green-500 rounded-full transition-all pointer-events-none"
                            style={{ height: `${volume}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {/* PiP 歌词按钮 */}
                <button
                  onClick={toggleSpectrum}
                  className={`transition-colors ${
                    showSpectrum ? 'text-green-500 hover:text-green-400' : 'text-zinc-500 hover:text-white'
                  }`}
                  title={showSpectrum ? '隐藏音谱图' : '显示音谱图'}
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {showSpectrum ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 18V9m4 9V6m4 12v-4m4 4V8m4 10V4" />
                    ) : (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 18V9m4 9V6m4 12v-4m4 4V8m4 10V4" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3l18 18" />
                      </>
                    )}
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePiPLyrics();
                  }}
                  className={`transition-colors ${
                    showPiPLyrics
                      ? 'text-green-500 hover:text-green-400'
                      : 'text-zinc-500 hover:text-white'
                  }`}
                  title={showPiPLyrics ? '关闭画中画歌词' : '画中画歌词'}
                  disabled={!currentSong}
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/>
                  </svg>
                </button>
                {/* 添加到歌单按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentSong) {
                      setSongToAddToPlaylist(currentSong);
                      setShowAddToPlaylistModal(true);
                    }
                  }}
                  className="text-zinc-500 hover:text-red-500 transition-colors"
                  title="添加到歌单"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
              </div>

              {/* 进度条 */}
              <div className="relative">
                {showSpectrum && (
                  <div className="relative mb-3 flex items-center gap-2 text-xs">
                    <span className="invisible">{formatTime(currentTime)}</span>
                    <div className="flex-1">
                      <AudioSpectrumCanvas bars={spectrumBars} />
                    </div>
                    <span className="invisible">{formatTime(duration)}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>{formatTime(currentTime)}</span>
                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden relative">
                    <div
                      className="relative z-10 h-full bg-green-500 transition-all pointer-events-none"
                      style={{ width: `${progress}%` }}
                    />
                    {showStreamBuffering && (
                      <div className="music-buffer-track-global absolute inset-0 z-0" />
                    )}
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={progress}
                      onChange={handleProgressChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Playlist Modal */}
      {showPlaylist && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl h-[90vh] md:h-auto max-h-[90vh] bg-zinc-900/95 rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex flex-col">
            {/* Header */}
            <div className="relative h-16 bg-gradient-to-b from-zinc-800 to-zinc-900 shrink-0 flex items-center justify-between px-6">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-white">播放列表</h2>
                <span className="text-xs text-zinc-500">({playlist.length})</span>
              </div>
              <div className="flex items-center gap-2">
                {playlist.length > 0 && (
                  <button
                    onClick={handleClearPlayRecords}
                    className="px-3 py-1 text-xs rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors border border-red-500/50"
                    title="清空全部"
                  >
                    清空
                  </button>
                )}
                <button
                  onClick={() => setShowPlaylist(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Playlist */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              {playlist.length > 0 ? (
                <div className="space-y-2">
                  {playlist.map((song, index) => (
                    <div
                      key={`${song.id}-${index}`}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors group ${
                        index === playlistIndex
                          ? 'bg-green-500/20 border border-green-500/50'
                          : 'bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div
                        onClick={() => {
                          setPlaylistIndex(index);
                          playSong(song, -1);
                          setShowPlaylist(false);
                        }}
                        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                      >
                        <div className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
                          {song.pic ? (
                            <img
                              src={song.pic}
                              alt={song.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-6 h-6 text-zinc-600" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`text-sm font-medium truncate transition-colors ${
                              index === playlistIndex ? 'text-green-400' : 'text-white group-hover:text-green-400'
                            }`}>
                              {song.name}
                            </div>
                            <SourcePill source={song.platform} variant="accent" />
                          </div>
                          <div className="text-xs text-zinc-500 truncate">{song.artist}</div>
                        </div>
                        {index === playlistIndex ? (
                          <svg className="w-5 h-5 text-green-400 shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-zinc-600 group-hover:text-white transition-colors shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                          </svg>
                        )}
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await fetch(`/api/music/v2/history?songId=${encodeURIComponent(song.id)}`, { method: 'DELETE' });

                            // 更新本地状态
                            const newPlaylist = playlist.filter((_, i) => i !== index);
                            const newRecords = playRecords.filter((_, i) => i !== index);
                            setPlaylist(newPlaylist);
                            setPlayRecords(newRecords);

                            // 如果删除的是当前播放的歌曲，调整索引
                            if (index === playlistIndex) {
                              setPlaylistIndex(-1);
                            } else if (index < playlistIndex) {
                              setPlaylistIndex(playlistIndex - 1);
                            }
                          } catch (error) {
                            console.error('删除播放记录失败:', error);
                          }
                        }}
                        className="w-8 h-8 rounded-lg border border-red-500/30 bg-red-500/15 hover:bg-red-500/30 flex items-center justify-center transition-colors opacity-100 shrink-0"
                        title="删除"
                      >
                        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <svg className="w-16 h-16 text-zinc-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  <p className="text-zinc-500 text-sm">播放列表为空</p>
                  <p className="text-zinc-600 text-xs mt-2">播放歌曲后会自动添加到列表</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sleep Timer Menu */}
      {showSleepTimerMenu && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-end justify-center"
          onClick={() => setShowSleepTimerMenu(false)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 rounded-t-2xl border-t border-white/10 shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative p-4 border-b border-white/10">
              <h3 className="text-lg font-bold text-white text-center">睡眠定时</h3>
              <button
                type="button"
                onClick={() => setShowSleepTimerMenu(false)}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-zinc-300 transition-colors hover:bg-white/20 hover:text-white"
                title="关闭"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <p className="mt-1 text-center text-xs text-zinc-500">
                {sleepTimerEndAt ? `剩余 ${formatSleepTimer(sleepTimerRemaining)} 后暂停播放` : '选择倒计时时长，到点后自动暂停'}
              </p>
            </div>

            <div className="p-4 grid grid-cols-2 gap-2">
              {[15, 30, 45, 60, 90, 120].map((minutes) => (
                <button
                  key={minutes}
                  onClick={() => setSleepTimer(minutes)}
                  className="rounded-lg bg-white/5 p-4 text-center text-sm font-medium text-white transition-colors hover:bg-green-500/20 hover:text-green-300"
                >
                  {minutes} 分钟
                </button>
              ))}
            </div>

            <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 text-center text-sm font-medium text-white">自定义时间</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: '小时',
                    value: customSleepHours,
                    ref: sleepHoursPickerRef,
                    onScroll: handleSleepHourScroll,
                    items: Array.from({ length: 13 }, (_, hour) => hour),
                  },
                  {
                    label: '分钟',
                    value: customSleepMinutes,
                    ref: sleepMinutesPickerRef,
                    onScroll: handleSleepMinuteScroll,
                    items: Array.from({ length: 60 }, (_, minute) => minute),
                  },
                ].map((picker) => (
                  <div key={picker.label} className="block">
                    <span className="mb-2 block text-center text-xs text-zinc-500">{picker.label}</span>
                    <div className="relative">
                      <div
                        ref={picker.ref}
                        onScroll={picker.onScroll}
                        className="scrollbar-hide overflow-y-auto rounded-xl border border-white/10 bg-zinc-800/80 py-[80px] text-white"
                        style={{
                          height: `${sleepPickerHeight}px`,
                          scrollbarWidth: 'none',
                          msOverflowStyle: 'none',
                          scrollSnapType: 'y mandatory',
                        }}
                      >
                        {picker.items.map((item) => {
                          const isActive = item === picker.value;
                          return (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                if (picker.label === '小时') {
                                  setCustomSleepHours(item);
                                  if (sleepHoursPickerRef.current) {
                                    sleepHoursPickerRef.current.scrollTo({
                                      top: item * sleepPickerItemHeight,
                                      behavior: 'smooth',
                                    });
                                  }
                                } else {
                                  setCustomSleepMinutes(item);
                                  if (sleepMinutesPickerRef.current) {
                                    sleepMinutesPickerRef.current.scrollTo({
                                      top: item * sleepPickerItemHeight,
                                      behavior: 'smooth',
                                    });
                                  }
                                }
                              }}
                              className={`flex w-full items-center justify-center text-sm transition-colors ${
                                isActive ? 'text-green-400' : 'text-zinc-400'
                              }`}
                              style={{ height: `${sleepPickerItemHeight}px`, scrollSnapAlign: 'center' }}
                            >
                              {item.toString().padStart(2, '0')}
                            </button>
                          );
                        })}
                      </div>
                      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-y border-green-500/40 bg-green-500/10" style={{ height: `${sleepPickerItemHeight}px` }} />
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-zinc-900/95 to-transparent" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-zinc-900/95 to-transparent" />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={setCustomSleepTimer}
                className="mt-4 w-full rounded-lg bg-green-500 p-3 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-white"
                disabled={customSleepHours === 0 && customSleepMinutes === 0}
              >
                {customSleepHours === 0 && customSleepMinutes === 0
                  ? '请选择定时时长'
                  : `设置 ${customSleepHours > 0 ? `${customSleepHours} 小时` : ''}${
                      customSleepMinutes > 0 ? `${customSleepMinutes} 分钟` : ''
                    }后暂停`}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              <button
                onClick={() => setShowSleepTimerMenu(false)}
                className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                返回
              </button>
              <button
                onClick={cancelSleepTimer}
                className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!sleepTimerEndAt}
              >
                关闭定时
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quality Selection Menu */}
      {showQualityMenu && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end justify-center"
          onClick={() => setShowQualityMenu(false)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 rounded-t-2xl border-t border-white/10 shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-white/10">
              <h3 className="text-lg font-bold text-white text-center">选择音质</h3>
            </div>

            {/* Quality Options */}
            <div className="p-4 space-y-2">
              <button
                onClick={() => {
                  void handleQualityChange('128k');
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === '128k'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === '128k' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">标准音质</div>
                    <div className="text-xs text-zinc-500">128kbps</div>
                  </div>
                </div>
                {quality === '128k' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => {
                  void handleQualityChange('320k');
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === '320k'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === '320k' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">高品质 HQ</div>
                    <div className="text-xs text-zinc-500">320kbps</div>
                  </div>
                </div>
                {quality === '320k' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => {
                  void handleQualityChange('flac');
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === 'flac'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === 'flac' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">无损音质 SQ</div>
                    <div className="text-xs text-zinc-500">FLAC</div>
                  </div>
                </div>
                {quality === 'flac' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => {
                  void handleQualityChange('flac24bit');
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === 'flac24bit'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === 'flac24bit' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">Hi-Res音质 HR</div>
                    <div className="text-xs text-zinc-500">FLAC 24bit</div>
                  </div>
                </div>
                {quality === 'flac24bit' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>

            {/* Cancel Button */}
            <div className="p-4 pt-0">
              <button
                onClick={() => setShowQualityMenu(false)}
                className="w-full p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}


      <MusicSidebarDrawer
        currentSource={currentSource}
        isOpen={showSidebarDrawer}
        pathname={pathname}
        onClose={() => setShowSidebarDrawer(false)}
        onNavigate={(href) => router.push(href)}
      />

      {/* Add to Playlist Modal */}
      <AddToPlaylistModal
        song={songToAddToPlaylist}
        isOpen={showAddToPlaylistModal}
        onClose={() => {
          setShowAddToPlaylistModal(false);
          setSongToAddToPlaylist(null);
        }}
        onSuccess={() => {
          setToast({
            message: '已添加到歌单',
            type: 'success',
            onClose: () => setToast(null),
          });
        }}
        onError={(message) => {
          setToast({
            message,
            type: 'error',
            onClose: () => setToast(null),
          });
        }}
      />

      {/* Toast */}
      {toast && <Toast {...toast} />}

      {/* Confirm Modal */}
      {confirmModal.isOpen &&
        createPortal(
          <div
            className="music-theme-portal fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            style={{ zIndex: 99999 }}
            onClick={confirmModal.onCancel}
          >
            <div
              className="bg-zinc-900 rounded-xl max-w-md w-full border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">
                    {confirmModal.title}
                  </h3>
                  <button
                    onClick={confirmModal.onCancel}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="mb-6">
                  <p className="text-sm text-zinc-400">
                    {confirmModal.message}
                  </p>
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={confirmModal.onCancel}
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmModal.onConfirm}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    确定
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* PiP Lyrics Window */}
      {showPiPLyrics && (
        <LyricsPiPWindow
          currentSong={currentSong}
          lyrics={lyrics}
          currentLyricIndex={currentLyricIndex}
          isPlaying={isPlaying}
          currentTime={currentTime}
          opacity={pipOpacity}
          minimized={pipMinimized}
          onOpacityChange={(opacity) => {
            setPipOpacity(opacity);
            localStorage.setItem('lyricsPiPOpacity', opacity.toString());
          }}
          onMinimizedChange={(minimized) => {
            setPipMinimized(minimized);
            localStorage.setItem('lyricsPiPMinimized', minimized.toString());
          }}
          onLyricSeek={seekToLyric}
          onClose={() => setShowPiPLyrics(false)}
        />
      )}
      <style jsx global>{`
        :root {
          --music-bg: #f4f7fb;
          --music-bg-strong: rgba(255, 255, 255, 0.96);
          --music-surface: rgba(255, 255, 255, 0.88);
          --music-surface-soft: rgba(241, 245, 249, 0.92);
          --music-overlay: rgba(15, 23, 42, 0.45);
          --music-glass: rgba(15, 23, 42, 0.06);
          --music-glass-strong: rgba(15, 23, 42, 0.1);
          --music-border: rgba(148, 163, 184, 0.28);
          --music-text: #0f172a;
          --music-text-soft: #475569;
          --music-text-muted: #64748b;
        }

        .dark {
          --music-bg: #09090b;
          --music-bg-strong: rgba(9, 9, 11, 0.95);
          --music-surface: rgba(24, 24, 27, 0.9);
          --music-surface-soft: rgba(39, 39, 42, 0.88);
          --music-overlay: rgba(0, 0, 0, 0.72);
          --music-glass: rgba(255, 255, 255, 0.05);
          --music-glass-strong: rgba(255, 255, 255, 0.1);
          --music-border: rgba(255, 255, 255, 0.1);
          --music-text: #f8fafc;
          --music-text-soft: #cbd5e1;
          --music-text-muted: #94a3b8;
        }

        .music-theme {
          background: linear-gradient(180deg, var(--music-bg) 0%, color-mix(in srgb, var(--music-bg) 82%, #22c55e 18%) 100%);
          color: var(--music-text);
        }

        .music-theme :is([class*='bg-zinc-950'], [class*='bg-zinc-900']),
        .music-theme-portal :is([class*='bg-zinc-950'], [class*='bg-zinc-900']) {
          background-color: var(--music-bg-strong) !important;
        }

        .music-theme [class*='bg-zinc-800'],
        .music-theme-portal [class*='bg-zinc-800'] {
          background-color: var(--music-surface-soft) !important;
        }

        .music-theme :is([class*='bg-white/5'], [class*='bg-white/6'], [class*='bg-white/8'], [class*='bg-white/10'], [class*='bg-white/12']),
        .music-theme-portal :is([class*='bg-white/5'], [class*='bg-white/6'], [class*='bg-white/8'], [class*='bg-white/10'], [class*='bg-white/12']) {
          background-color: var(--music-glass) !important;
        }

        .music-theme [class*='bg-white/20'],
        .music-theme-portal [class*='bg-white/20'] {
          background-color: var(--music-glass-strong) !important;
        }

        .music-theme :is([class*='bg-black/90'], [class*='bg-black/50'], [class*='bg-black/30']),
        .music-theme-portal :is([class*='bg-black/90'], [class*='bg-black/50'], [class*='bg-black/30']) {
          background-color: var(--music-overlay) !important;
        }

        .music-theme :is([class*='border-white/'], [class*='border-zinc-']),
        .music-theme-portal :is([class*='border-white/'], [class*='border-zinc-']) {
          border-color: var(--music-border) !important;
        }

        .music-theme :is([class*='text-white'], [class*='text-zinc-200']),
        .music-theme-portal :is([class*='text-white'], [class*='text-zinc-200']) {
          color: var(--music-text) !important;
        }

        .music-theme :is([class*='text-zinc-300'], [class*='text-zinc-400']),
        .music-theme-portal :is([class*='text-zinc-300'], [class*='text-zinc-400']) {
          color: var(--music-text-soft) !important;
        }

        .music-theme :is([class*='text-zinc-500'], [class*='text-zinc-600']),
        .music-theme-portal :is([class*='text-zinc-500'], [class*='text-zinc-600']) {
          color: var(--music-text-muted) !important;
        }

        .music-theme :is([class*='from-zinc-800'], [class*='from-zinc-900']) {
          --tw-gradient-from: var(--music-surface-soft) var(--tw-gradient-from-position) !important;
          --tw-gradient-to: rgb(255 255 255 / 0) var(--tw-gradient-to-position) !important;
          --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
        }

        .music-theme :is([class*='to-zinc-900'], [class*='to-zinc-800']) {
          --tw-gradient-to: var(--music-bg-strong) var(--tw-gradient-to-position) !important;
        }

        .music-theme input::placeholder,
        .music-theme textarea::placeholder {
          color: var(--music-text-muted) !important;
        }
      `}</style>
      </>
    </div>
  );
}
