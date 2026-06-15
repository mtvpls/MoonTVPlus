'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useWatchRoomContext } from '@/components/WatchRoomProvider';
import type { MusicQueueItem, MusicSyncState } from '@/types/watch-room';

interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

const SPECTRUM_BIN_COUNT = 72;
const SPECTRUM_EDGE_TRIM = 8;
const SPECTRUM_REFERENCE_VOLUME = 10;
const SPECTRUM_MIN_VOLUME = 5;
const SPECTRUM_MAX_REFERENCE_VOLUME = 15;
const SPECTRUM_IDLE_LEVEL = 0.04;

function buildStreamUrl(song: MusicQueueItem, quality: string) {
  const params = new URLSearchParams({
    songId: song.id,
    source: song.platform,
    quality,
    songmid: song.songmid || song.id.split('_').slice(1).join('_'),
    name: song.name,
    artist: song.artist,
  });

  if (song.durationText) params.set('durationText', song.durationText);
  return `/api/music/v2/stream?${params.toString()}`;
}

function parseLyricText(text: string) {
  const map = new Map<number, string>();
  const timestampPattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  text.split('\n').forEach((line) => {
    const matches: Array<RegExpExecArray> = [];
    timestampPattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = timestampPattern.exec(line)) !== null) {
      matches.push(match);
    }

    if (matches.length === 0) return;
    const content = line.replace(/\[[^\]]+\]/g, '').trim();
    matches.forEach((current) => {
      const min = Number(current[1] || 0);
      const sec = Number(current[2] || 0);
      const ms = Number((current[3] || '0').padEnd(3, '0'));
      map.set(min * 60 + sec + ms / 1000, content);
    });
  });
  return map;
}

function parseLyric(lyricText = '', tlyricText = ''): LyricLine[] {
  const main = parseLyricText(lyricText);
  const trans = parseLyricText(tlyricText);
  const times = Array.from(main.keys());
  trans.forEach((_value, key) => {
    if (!times.includes(key)) times.push(key);
  });
  times.sort((a, b) => a - b);
  return times.map((time) => ({
    time,
    text: main.get(time) || '',
    translation: trans.get(time),
  })).filter((line) => line.text || line.translation);
}

function adjustedTime(state: Pick<MusicSyncState, 'currentTime' | 'updatedAt'>, playing: boolean) {
  if (!playing) return state.currentTime;
  return Math.max(0, state.currentTime + (Date.now() - state.updatedAt) / 1000);
}

function formatTime(time: number) {
  if (!Number.isFinite(time) || time < 0) return '--:--';
  const total = Math.floor(time);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function AudioSpectrumCanvas({
  bars,
  compact = false,
  volume = SPECTRUM_REFERENCE_VOLUME,
}: {
  bars: number[];
  compact?: boolean;
  volume?: number;
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

      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#10b981';

      const visualVolume = Math.max(SPECTRUM_MIN_VOLUME, volume || SPECTRUM_REFERENCE_VOLUME);
      const visualVolumeScale =
        visualVolume > SPECTRUM_MAX_REFERENCE_VOLUME
          ? Math.sqrt(SPECTRUM_MAX_REFERENCE_VOLUME / visualVolume)
          : SPECTRUM_REFERENCE_VOLUME / visualVolume;

      for (let i = 0; i < count; i++) {
        const q = Math.max(SPECTRUM_IDLE_LEVEL, sampleBar(i)) * scaleBase * visualVolumeScale;
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
  }, [bars, compact, volume]);

  return (
    <div className={`relative w-full overflow-hidden ${compact ? 'h-6' : 'h-8'}`} aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-50" />
    </div>
  );
}

const VINYL_NEEDLE_SVG = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><path d="M21,21 C21,65 86,70 86,100" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="6" stroke-linecap="round"/><path d="M20,20 C20,65 85,70 85,100" fill="none" stroke="%23e0e0e0" stroke-width="4.5" stroke-linecap="round"/><path d="M19,20 C19,65 84,70 84,100" fill="none" stroke="%23fff" stroke-width="1.5" stroke-linecap="round"/><g transform="translate(85, 100) rotate(25)"><rect x="-6" y="0" width="12" height="18" rx="2" fill="%23ccc"/><rect x="-4" y="5" width="8" height="14" rx="1" fill="%23333"/><rect x="-2" y="16" width="4" height="5" rx="1" fill="%23d43c33"/></g><circle cx="20" cy="20" r="10" fill="%23f0f0f0" stroke="%23ccc" stroke-width="1"/><circle cx="20" cy="20" r="4" fill="%23fff"/><circle cx="20" cy="20" r="1.5" fill="%23999"/></svg>')`;

function VinylTurntable({ song, isPlaying }: { song: MusicQueueItem; isPlaying: boolean }) {
  return (
    <div className="relative mx-auto mt-12 mb-5 flex h-[280px] w-[280px] items-center justify-center md:mt-16 md:mb-8 md:h-[340px] md:w-[340px]">
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
          animation: 'music-room-vinyl-spin 20s linear infinite',
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
          {song.pic ? (
            <img src={song.pic} alt={song.name} className="h-full w-full rounded-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl text-zinc-500">♪</div>
          )}
        </div>
        <div className="absolute z-20 h-3 w-3 rounded-full bg-zinc-950 ring-1 ring-white/30" />
      </div>
    </div>
  );
}

export default function WatchRoomMusicPage() {
  const router = useRouter();
  const watchRoom = useWatchRoomContext();
  const { currentRoom, isOwner, socket } = watchRoom;
  const audioRef = useRef<HTMLAudioElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastSongKeyRef = useRef('');
  const volumeRef = useRef(100);
  const playbackRequestIdRef = useRef(0);
  const lyricRequestIdRef = useRef(0);
  const mobileLyricsContainerRef = useRef<HTMLDivElement>(null);
  const desktopLyricsContainerRef = useRef<HTMLDivElement>(null);
  const mobileVolumeControlRef = useRef<HTMLDivElement>(null);
  const desktopVolumeControlRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<MusicSyncState | null>(() => (
    currentRoom?.currentState?.type === 'music' ? currentRoom.currentState : null
  ));
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [needsActivation, setNeedsActivation] = useState(true);
  const [volume, setVolume] = useState(100);
  const [isDark, setIsDark] = useState(true);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'cover' | 'lyrics'>('cover');
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: SPECTRUM_BIN_COUNT }, () => SPECTRUM_IDLE_LEVEL));

  useEffect(() => {
    const nextState =
      currentRoom?.roomType === 'music' && currentRoom.currentState?.type === 'music'
        ? currentRoom.currentState
        : null;

    setState((prev) => {
      if (prev === nextState) return prev;
      return nextState;
    });

    if (!nextState) {
      playbackRequestIdRef.current += 1;
      audioRef.current?.pause();
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    setCurrentTime(adjustedTime(nextState, nextState.isPlaying));
    if (Number.isFinite(nextState.song.duration) && nextState.song.duration) {
      setDuration(nextState.song.duration);
    }
  }, [currentRoom?.currentState, currentRoom?.id, currentRoom?.roomType]);

  const currentLyricIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= currentTime) index = i;
      else break;
    }
    return index;
  }, [lyrics, currentTime]);

  useEffect(() => {
    if (currentLyricIndex < 0) return;
    const container = window.innerWidth < 768 ? mobileLyricsContainerRef.current : desktopLyricsContainerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(`[data-lyric-index="${currentLyricIndex}"]`);
    if (!active) return;
    active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentLyricIndex]);

  useEffect(() => {
    if (!currentRoom) {
      router.replace('/watch-room');
      return;
    }
    if (currentRoom.roomType !== 'music' || isOwner) {
      router.replace('/watch-room');
    }
  }, [currentRoom, isOwner, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncTheme = () => setIsDark(document.documentElement.classList.contains('dark'));
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!showVolumeSlider) return;
      const target = event.target as Node | null;
      if (!target) return;
      const insideMobile = mobileVolumeControlRef.current?.contains(target) ?? false;
      const insideDesktop = desktopVolumeControlRef.current?.contains(target) ?? false;
      if (!insideMobile && !insideDesktop) {
        setShowVolumeSlider(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showVolumeSlider]);

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  const ensureAnalyser = async () => {
    const audio = audioRef.current;
    if (!audio || typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    if (!mediaSourceRef.current) mediaSourceRef.current = audioContextRef.current.createMediaElementSource(audio);
    if (!analyserRef.current) {
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      mediaSourceRef.current.connect(analyser);
      analyser.connect(audioContextRef.current.destination);
      analyserRef.current = analyser;
    }
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
  };

  const applyPlaybackState = async (nextState: MusicSyncState) => {
    const audio = audioRef.current;
    if (!audio) return;
    const requestId = ++playbackRequestIdRef.current;

    const key = `${nextState.song.platform}:${nextState.song.id}:${nextState.quality}`;
    if (key !== lastSongKeyRef.current) {
      lastSongKeyRef.current = key;
      const lyricRequestId = ++lyricRequestIdRef.current;
      audio.src = buildStreamUrl(nextState.song, nextState.quality);
      audio.load();
      setLyrics([]);

      fetch('/api/music/v2/lyric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          song: {
            songId: nextState.song.id,
            source: nextState.song.platform,
            name: nextState.song.name,
            singer: nextState.song.artist,
            songmid: nextState.song.songmid,
          },
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (lyricRequestId !== lyricRequestIdRef.current) return;
          if (!data.success) return;
          const lyricText = typeof data.data?.lyric === 'string' ? data.data.lyric : data.data?.lyric?.lyric ?? '';
          const tlyricText = typeof data.data?.tlyric === 'string' ? data.data.tlyric : data.data?.lyric?.tlyric ?? '';
          setLyrics(parseLyric(lyricText, tlyricText));
        })
        .catch(() => undefined);
    }

    if (requestId !== playbackRequestIdRef.current) return;

    const targetTime = adjustedTime(nextState, nextState.isPlaying);
    const seek = () => {
      if (requestId !== playbackRequestIdRef.current) return;
      if (Number.isFinite(targetTime) && Math.abs(audio.currentTime - targetTime) > 0.8) {
        audio.currentTime = Math.min(targetTime, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.25) : targetTime);
      }
    };

    if (audio.readyState >= 1) seek();
    else audio.addEventListener('loadedmetadata', seek, { once: true });

    if (requestId !== playbackRequestIdRef.current) return;

    if (nextState.isPlaying && !needsActivation) {
      await ensureAnalyser();
      if (requestId !== playbackRequestIdRef.current) return;
      try {
        await audio.play();
      } catch {
        if (requestId === playbackRequestIdRef.current) {
          setNeedsActivation(true);
        }
      }
      if (requestId !== playbackRequestIdRef.current || !nextState.isPlaying) {
        audio.pause();
      }
    } else {
      audio.pause();
    }
  };

  useEffect(() => {
    if (!state) return;
    void applyPlaybackState(state);
  }, [state, needsActivation]);

  useEffect(() => {
    if (!socket) return;

    const handleState = (nextState: MusicSyncState) => {
      setState(nextState);
      setCurrentTime(adjustedTime(nextState, nextState.isPlaying));
      if (Number.isFinite(nextState.song.duration) && nextState.song.duration) {
        setDuration(nextState.song.duration);
      }
    };
    socket.on('music:change', handleState);
    socket.on('music:update', handleState);
    socket.on('music:queue', handleState);
    socket.on('music:play', handleState);
    socket.on('music:pause', handleState);
    socket.on('music:seek', handleState);

    return () => {
      socket.off('music:change', handleState);
      socket.off('music:update', handleState);
      socket.off('music:queue', handleState);
      socket.off('music:play', handleState);
      socket.off('music:pause', handleState);
      socket.off('music:seek', handleState);
    };
  }, [socket]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('ended', () => audio.pause());

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        setBars(Array.from({ length: SPECTRUM_BIN_COUNT }, (_, index) => {
          const start = Math.floor((index / SPECTRUM_BIN_COUNT) * data.length);
          const end = Math.max(start + 1, Math.floor(((index + 1) / SPECTRUM_BIN_COUNT) * data.length));
          let total = 0;
          for (let i = start; i < end; i++) total += data[i] || 0;
          return Math.max(SPECTRUM_IDLE_LEVEL, Math.min(1, total / Math.max(1, end - start) / 255));
        }));
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, []);

  const activate = async () => {
    setNeedsActivation(false);
    await ensureAnalyser();
    if (state?.isPlaying) {
      audioRef.current?.play().catch(() => setNeedsActivation(true));
    }
  };

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const song = state?.song;
  const nextSong = state?.nextSong || null;
  const themeRootClass = isDark ? 'bg-zinc-950 text-white' : 'bg-white text-zinc-900';
  const showCoverPanel = mobilePanel === 'cover';
  const showLyricsPanel = mobilePanel === 'lyrics';
  const isPlaying = Boolean(state?.isPlaying);
  const lyricActiveClass = isDark
    ? 'scale-105 text-lg font-bold text-emerald-300 md:text-2xl'
    : 'scale-105 text-lg font-bold text-emerald-600 md:text-2xl';
  const lyricNearbyClass = isDark ? 'text-base text-zinc-400' : 'text-base text-zinc-500';
  const lyricIdleClass = isDark ? 'text-sm text-zinc-600' : 'text-sm text-zinc-500';

  return (
    <main className={`relative min-h-screen overflow-hidden transition-colors ${themeRootClass}`}>
      <style>{`
        @keyframes music-room-vinyl-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <audio ref={audioRef} className="hidden" />

      {song?.pic && (
        <img src={song.pic} alt="" className={`absolute inset-0 h-full w-full object-cover blur-3xl ${isDark ? 'opacity-20' : 'opacity-12'}`} />
      )}
      <div className={`absolute inset-0 ${isDark ? 'bg-zinc-950/80' : 'bg-white/75'}`} />

      <section className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6">
        <div className={`mb-4 flex items-center justify-between gap-4 text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          <button
            onClick={() => router.push('/watch-room')}
            className={`rounded-md border px-3 py-2 transition-colors ${isDark ? 'border-white/10 text-zinc-300 hover:bg-white/10' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100'}`}
          >
            返回观影室
          </button>
          <span className="truncate">房间：{currentRoom?.name || '-'}</span>
        </div>

        {song ? (
          <>
            <div className="md:hidden">
              <div className="mx-auto flex w-full max-w-[430px] flex-col gap-3">
                <div ref={mobileVolumeControlRef} className={`rounded-2xl border px-3 py-3 ${isDark ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-white/80 shadow-sm'}`}>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setMobilePanel(showCoverPanel ? 'lyrics' : 'cover')}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-800">
                        {song.pic ? (
                          <img src={song.pic} alt={song.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-base text-zinc-500">♪</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{song.name}</div>
                        <div className={`truncate text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>{song.artist}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVolumeSlider((prev) => !prev)}
                      className={`relative shrink-0 transition-colors ${isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-900'}`}
                      title="音量"
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                      </svg>
                      <div className={`absolute right-0 top-6 z-20 transition-opacity ${showVolumeSlider ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                        <div className={`rounded-lg border p-3 shadow-xl ${isDark ? 'border-white/10 bg-zinc-900/95' : 'border-zinc-200 bg-white'}`}>
                          <div className="flex flex-col items-center gap-2">
                            <span className={`text-xs font-mono ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{volume}</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={volume}
                              onChange={(e) => setVolume(Number(e.target.value))}
                              className="h-24 w-2 cursor-pointer appearance-none rounded-full accent-emerald-400"
                              style={{ writingMode: 'vertical-lr', WebkitAppearance: 'slider-vertical' }}
                            />
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {showCoverPanel ? (
                  <div className={`rounded-2xl border px-4 py-4 ${isDark ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-white/80 shadow-sm'}`}>
                    <div className="flex flex-col gap-4">
                      <VinylTurntable song={song} isPlaying={Boolean(state?.isPlaying)} />
                      <AudioSpectrumCanvas bars={bars} compact volume={volume} />
                      <div className="flex items-center gap-2 text-xs tabular-nums">
                        <span className={`w-10 ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>{formatTime(currentTime)}</span>
                        <div className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-zinc-200'}`}>
                          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
                        </div>
                        <span className={`w-10 text-right ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                <div
                  ref={mobileLyricsContainerRef}
                  className={`rounded-2xl border px-4 py-4 ${isDark ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-white/80 shadow-sm'}`}
                >
                    <div className="max-h-[64vh] overflow-y-auto px-1">
                      {lyrics.length > 0 ? (
                        <div className="space-y-3">
                          {lyrics.map((line, index) => (
                            <div
                              key={`${line.time}-${index}`}
                              data-lyric-index={index}
                              className={`text-center transition-all duration-300 ${
                                index === currentLyricIndex
                                  ? lyricActiveClass
                                  : index === currentLyricIndex - 1 || index === currentLyricIndex + 1
                                    ? lyricNearbyClass
                                    : lyricIdleClass
                              }`}
                            >
                              <div>{line.text || '♪'}</div>
                              {line.translation && <div className={`mt-1 text-sm font-normal ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>{line.translation}</div>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`flex min-h-[48vh] items-center justify-center ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>暂无歌词</div>
                      )}
                    </div>
                    <div className="mt-3">
                      <AudioSpectrumCanvas bars={bars} compact volume={volume} />
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs tabular-nums">
                      <span className={`w-10 ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>{formatTime(currentTime)}</span>
                      <div className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-zinc-200'}`}>
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
                      </div>
                      <span className={`w-10 text-right ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>{formatTime(duration)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="hidden md:grid flex-1 gap-4 md:grid-cols-[420px_minmax(0,1fr)]">
              <div className={`${showCoverPanel ? 'block' : 'hidden'} min-w-0 md:block`}>
                  <div ref={desktopVolumeControlRef} className={`rounded-lg border p-4 md:p-6 ${isDark ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-white/80 shadow-sm'}`}>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowVolumeSlider((prev) => !prev)}
                      className={`absolute right-0 top-0 z-10 shrink-0 transition-colors ${isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-900'}`}
                      title="音量"
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <div className={`absolute right-0 top-6 z-20 transition-opacity ${showVolumeSlider ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                      <div className={`rounded-lg border p-3 shadow-xl ${isDark ? 'border-white/10 bg-zinc-900/95' : 'border-zinc-200 bg-white'}`}>
                        <div className="flex flex-col items-center gap-2">
                          <span className={`text-xs font-mono ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{volume}</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={volume}
                            onChange={(e) => setVolume(Number(e.target.value))}
                            className="h-24 w-2 cursor-pointer appearance-none rounded-full accent-emerald-400"
                            style={{ writingMode: 'vertical-lr', WebkitAppearance: 'slider-vertical' }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <VinylTurntable song={song} isPlaying={Boolean(state?.isPlaying)} />
                  <AudioSpectrumCanvas bars={bars} compact volume={volume} />
                  <div className="mt-4 text-center">
                    <h1 className="truncate text-xl font-bold md:text-3xl">{song.name}</h1>
                    <p className={`mt-2 truncate text-sm md:text-base ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{song.artist}</p>
                    {nextSong && <p className={`mt-2 truncate text-xs md:text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>下一首：{nextSong.name} - {nextSong.artist}</p>}
                  </div>
                  <div className="mt-5 flex items-center gap-2 text-xs tabular-nums">
                    <span className={`w-10 ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>{formatTime(currentTime)}</span>
                    <div className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-zinc-200'}`}>
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
                    </div>
                    <span className={`w-10 text-right ${isDark ? 'text-zinc-500' : 'text-zinc-600'}`}>{formatTime(duration)}</span>
                  </div>
                </div>
              </div>

              <div
                ref={desktopLyricsContainerRef}
                className={`${showLyricsPanel ? 'block' : 'hidden'} min-h-0 rounded-lg border p-4 md:block md:h-[70vh] md:overflow-y-auto md:p-6 ${isDark ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-white/80 shadow-sm'}`}
              >
                {lyrics.length > 0 ? (
                  <div className="space-y-4">
                    {lyrics.map((line, index) => (
                      <div
                        key={`${line.time}-${index}`}
                        data-lyric-index={index}
                        className={`text-center transition-all duration-300 ${
                          index === currentLyricIndex
                            ? lyricActiveClass
                            : index === currentLyricIndex - 1 || index === currentLyricIndex + 1
                              ? lyricNearbyClass
                              : lyricIdleClass
                        }`}
                      >
                        <div>{line.text || '♪'}</div>
                        {line.translation && <div className={`mt-1 text-sm font-normal ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>{line.translation}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`flex h-full min-h-[200px] items-center justify-center ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>暂无歌词</div>
                )}
              </div>
            </div>

          </>
        ) : (
          <div className={`flex flex-1 items-center justify-center ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>等待房主播放音乐</div>
        )}
      </section>

      {needsActivation && song && (
        <div className={`absolute inset-0 z-20 flex items-center justify-center backdrop-blur ${isDark ? 'bg-black/70' : 'bg-white/60'}`}>
          <button
            type="button"
            onClick={activate}
            className="rounded-full bg-emerald-500 px-8 py-4 text-base font-semibold text-white shadow-2xl hover:bg-emerald-600"
          >
            点击加入一起听
          </button>
        </div>
      )}
    </main>
  );
}
