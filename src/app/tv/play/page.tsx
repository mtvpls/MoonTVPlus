'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Heart,
  Info,
  Layers,
  ListVideo,
  Loader2,
  Maximize,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  ShieldOff,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  type Dispatch,
  type FocusEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import {
  convertDanmakuFormat,
  getDanmakuById,
  getEpisodes,
  initDanmakuModule,
  loadDanmakuDisplayState,
  saveDanmakuDisplayState,
  searchAnime,
} from '@/lib/danmaku/api';

import TVNativeVideo from '@/components/tv/player/TVNativeVideo';
import {
  fetchTVDetail,
  formatTVTime,
  resolveTVEpisodeUrl,
} from '@/components/tv/player/utils';
import TVVirtualRemote from '@/components/tv/TVVirtualRemote';

const TV_DANMAKU_LANES = 8;
const TV_DANMAKU_SPAWN_GRACE = 0.6;
const TV_DANMAKU_SEEK_WINDOW = 8;
const TV_DANMAKU_MAX_ITEMS = 3000;
const TV_DANMAKU_SETTINGS_KEY = 'tv_danmaku_settings';
const TV_VOLUME_KEY = 'tv_player_volume';
const TV_MUTED_KEY = 'tv_player_muted';
const REMOTE_KEY_DEDUPE_MS = 350;

type TVDanmakuSettings = {
  fontSize: number;
  displayArea: number;
  opacity: number;
};

const DEFAULT_TV_DANMAKU_SETTINGS: TVDanmakuSettings = {
  fontSize: 30,
  displayArea: 42,
  opacity: 0.75,
};

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

function loadTVDanmakuSettings(): TVDanmakuSettings {
  if (typeof window === 'undefined') return DEFAULT_TV_DANMAKU_SETTINGS;

  try {
    const saved = localStorage.getItem(TV_DANMAKU_SETTINGS_KEY);
    if (!saved) return DEFAULT_TV_DANMAKU_SETTINGS;
    const parsed = JSON.parse(saved) as Partial<TVDanmakuSettings>;
    return {
      fontSize:
        typeof parsed.fontSize === 'number'
          ? parsed.fontSize
          : DEFAULT_TV_DANMAKU_SETTINGS.fontSize,
      displayArea:
        typeof parsed.displayArea === 'number'
          ? parsed.displayArea
          : DEFAULT_TV_DANMAKU_SETTINGS.displayArea,
      opacity:
        typeof parsed.opacity === 'number'
          ? parsed.opacity
          : DEFAULT_TV_DANMAKU_SETTINGS.opacity,
    };
  } catch {
    return DEFAULT_TV_DANMAKU_SETTINGS;
  }
}

function getTVDanmakuDuration(text: string) {
  return Math.max(6, 12 - Math.min(6, text.length / 6));
}

function blurTVPlayerControl() {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.closest('[data-tv-player-control]')
  ) {
    active.blur();
  }
}

function scrollFocusedControlIntoView(event: FocusEvent<HTMLElement>) {
  const target = event.target;
  if (target instanceof HTMLElement) {
    target.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: 'smooth',
    });
  }
}

function updateTVDanmakuSetting(
  field: keyof TVDanmakuSettings,
  direction: -1 | 1,
  setDanmakuSettings: Dispatch<SetStateAction<TVDanmakuSettings>>
) {
  setDanmakuSettings((prev) => {
    if (field === 'opacity') {
      const next = Math.max(0.25, Math.min(1, prev.opacity + direction * 0.05));
      return { ...prev, opacity: Math.round(next * 100) / 100 };
    }

    if (field === 'displayArea') {
      const next = Math.max(24, Math.min(72, prev.displayArea + direction * 2));
      return { ...prev, displayArea: next };
    }

    const next = Math.max(20, Math.min(46, prev.fontSize + direction * 1));
    return { ...prev, fontSize: next };
  });
}

function getDanmakuSettingField(
  target: HTMLElement | null
): keyof TVDanmakuSettings | null {
  if (!(target instanceof HTMLInputElement) || target.type !== 'range')
    return null;
  const field = target.dataset.tvDanmakuField;
  if (field === 'fontSize' || field === 'displayArea' || field === 'opacity')
    return field;
  return null;
}

function getFocusableElementsInScope(scope: HTMLElement) {
  return Array.from(
    scope.querySelectorAll<HTMLElement>(
      [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',')
    )
  ).filter((element) => !element.closest('[data-tv-no-focus="true"]'));
}

function moveFocusWithinScope(scope: HTMLElement, direction: 'up' | 'down') {
  const elements = getFocusableElementsInScope(scope);
  if (elements.length === 0) return;

  const active = document.activeElement;
  const index = active instanceof HTMLElement ? elements.indexOf(active) : -1;
  if (index === -1) {
    elements[0].focus({ preventScroll: true });
    return;
  }

  const nextIndex =
    direction === 'down'
      ? Math.min(elements.length - 1, index + 1)
      : Math.max(0, index - 1);
  elements[nextIndex]?.focus({ preventScroll: true });
}

function TVPlayClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [showPanel, setShowPanel] = useState(true);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showDanmakuSettings, setShowDanmakuSettings] = useState(false);
  const [toggleCommand, setToggleCommand] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [digitBuffer, setDigitBuffer] = useState('');
  const [episodePage, setEpisodePage] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [initialVolumeState] = useState(loadTVVolumeState);
  const [muted, setMuted] = useState(initialVolumeState.muted);
  const [volume, setVolume] = useState(initialVolumeState.volume);
  const [showVolumeHint, setShowVolumeHint] = useState(false);
  const [seekHint, setSeekHint] = useState<{
    current: number;
    duration: number;
    delta: number;
  } | null>(null);
  const [adFilterEnabled, setAdFilterEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('enable_blockad');
    return saved === null ? true : saved === 'true';
  });
  const [danmakuEnabled, setDanmakuEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = loadDanmakuDisplayState();
    if (saved !== null) return saved;
    const legacySaved = localStorage.getItem('tv_danmaku_enabled');
    return legacySaved === null ? true : legacySaved === 'true';
  });
  const [danmakuItems, setDanmakuItems] = useState<
    Array<{ text: string; time: number; color: string; mode: number }>
  >([]);
  const [danmakuSettings, setDanmakuSettings] = useState<TVDanmakuSettings>(
    () => loadTVDanmakuSettings()
  );
  const [activeDanmakuItems, setActiveDanmakuItems] = useState<
    Array<{
      id: string;
      text: string;
      time: number;
      color: string;
      duration: number;
      lane: number;
    }>
  >([]);
  const [playbackRate, setPlaybackRate] = useState(() => {
    if (typeof window === 'undefined') return 1;
    return Number(localStorage.getItem('tv_playback_rate') || '1') || 1;
  });
  const [skipConfig, setSkipConfig] = useState<{
    enable?: boolean;
    intro_time?: number;
    outro_time?: number;
  } | null>(null);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const timeRef = useRef({ current: 0, duration: 0 });
  const episodeButtonRefs = useRef<Record<number, HTMLButtonElement | null>>(
    {}
  );
  const detailCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const danmakuFontSizeInputRef = useRef<HTMLInputElement | null>(null);
  const digitTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const volumeHintTimerRef = useRef<number | null>(null);
  const seekHintTimerRef = useRef<number | null>(null);
  const menuKeyTimeRef = useRef(0);
  const spawnedDanmakuRef = useRef<Set<string>>(new Set());
  const lastDanmakuTimeRef = useRef(0);
  const skippedIntroRef = useRef('');
  const skippedOutroRef = useRef('');
  const lastSavedRef = useRef<{
    source: string;
    id: string;
    index: number;
    playTime: number;
    totalTime: number;
  } | null>(null);

  const source = searchParams.get('source');
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  const fileName = searchParams.get('fileName');
  const initialIndex = Number(searchParams.get('index') || '0');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchTVDetail({ source, id, title, fileName })
      .then((data) => {
        if (!alive) return;
        setDetail(data.detail);
        setSources(data.sources);
        const maxIndex = Math.max(0, (data.detail.episodes?.length || 1) - 1);
        const explicitIndex = searchParams.has('index');
        let safeIndex = Math.max(
          0,
          Math.min(
            initialIndex || data.detail.initialEpisodeIndex || 0,
            maxIndex
          )
        );
        if (!explicitIndex && data.detail.source && data.detail.id) {
          getAllPlayRecords()
            .then((records) => {
              if (!alive) return;
              const record =
                records[generateStorageKey(data.detail.source, data.detail.id)];
              if (record?.index) {
                const rememberedIndex = Math.max(
                  0,
                  Math.min(maxIndex, record.index - 1)
                );
                setEpisodeIndex(rememberedIndex);
                setStartTime(record.play_time > 1 ? record.play_time : 0);
              }
            })
            .catch(() => undefined);
        } else {
          setStartTime(0);
        }
        setEpisodeIndex(safeIndex);
      })
      .catch(
        (err) =>
          alive &&
          setError(err instanceof Error ? err.message : '加载播放信息失败')
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, id, title, fileName, initialIndex]);

  useEffect(() => {
    let alive = true;
    async function resolve() {
      if (!detail?.episodes?.[episodeIndex]) return;
      setResolving(true);
      setVideoUrl('');
      setPlaybackError(false);
      try {
        const url = await resolveTVEpisodeUrl(
          detail.episodes[episodeIndex],
          detail.source,
          detail.proxyMode
        );
        if (alive) setVideoUrl(url);
      } catch (err) {
        if (alive)
          setError(err instanceof Error ? err.message : '获取播放地址失败');
      } finally {
        if (alive) setResolving(false);
      }
    }
    resolve();
    return () => {
      alive = false;
    };
  }, [detail, episodeIndex, retryNonce]);

  const episodeTitle = useMemo(
    () =>
      detail?.episodes_titles?.[episodeIndex] || `第 ${episodeIndex + 1} 集`,
    [detail, episodeIndex]
  );

  useEffect(() => {
    initDanmakuModule();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined')
      localStorage.setItem('enable_blockad', String(adFilterEnabled));
  }, [adFilterEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    saveDanmakuDisplayState(danmakuEnabled);
    localStorage.setItem('tv_danmaku_enabled', String(danmakuEnabled));
  }, [danmakuEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      TV_DANMAKU_SETTINGS_KEY,
      JSON.stringify(danmakuSettings)
    );
  }, [danmakuSettings]);

  useEffect(() => {
    if (typeof window !== 'undefined')
      localStorage.setItem('tv_playback_rate', String(playbackRate));
  }, [playbackRate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TV_VOLUME_KEY, String(volume));
    localStorage.setItem(TV_MUTED_KEY, String(muted));
  }, [muted, volume]);

  useEffect(() => {
    let alive = true;
    async function loadDanmaku() {
      setDanmakuItems([]);
      setActiveDanmakuItems([]);
      spawnedDanmakuRef.current.clear();
      lastDanmakuTimeRef.current = timeRef.current.current;
      if (!danmakuEnabled || !detail?.title) return;
      try {
        const search = await searchAnime(title || detail.title);
        const anime = search.animes?.[0];
        if (!alive || !anime?.animeId) return;
        const eps = await getEpisodes(anime.animeId);
        const ep =
          eps.bangumi?.episodes?.[
            Math.min(
              episodeIndex,
              Math.max(0, (eps.bangumi?.episodes?.length || 1) - 1)
            )
          ];
        if (!alive || !ep?.episodeId) return;
        const comments = await getDanmakuById(
          ep.episodeId,
          detail.title,
          episodeIndex,
          undefined,
          {
            animeId: anime.animeId,
            animeTitle: anime.animeTitle,
            episodeTitle: ep.episodeTitle,
            searchKeyword: title || detail.title,
          }
        );
        if (!alive) return;
        lastDanmakuTimeRef.current = Math.max(
          0,
          timeRef.current.current - TV_DANMAKU_SEEK_WINDOW - 1
        );
        setDanmakuItems(
          convertDanmakuFormat(comments).slice(0, TV_DANMAKU_MAX_ITEMS)
        );
      } catch {
        if (alive) setDanmakuItems([]);
      }
    }
    loadDanmaku();
    return () => {
      alive = false;
    };
  }, [danmakuEnabled, detail?.title, episodeIndex, title]);

  useEffect(() => {
    if (!danmakuEnabled || danmakuItems.length === 0) {
      setActiveDanmakuItems([]);
      spawnedDanmakuRef.current.clear();
      lastDanmakuTimeRef.current = time.current;
      return;
    }

    const current = time.current;
    const previous = lastDanmakuTimeRef.current;
    const jumped = current < previous - 1 || current - previous > 2;
    const spawnWindow = jumped
      ? TV_DANMAKU_SEEK_WINDOW
      : Math.max(TV_DANMAKU_SPAWN_GRACE, current - previous + 0.2);

    const spawned = spawnedDanmakuRef.current;
    if (jumped) spawned.clear();
    const nextItems = danmakuItems
      .map((item, index) => {
        const id = `${index}-${item.time}-${item.text}`;
        return {
          id,
          text: item.text,
          time: item.time,
          color: item.color,
          duration: getTVDanmakuDuration(item.text),
          lane: index % TV_DANMAKU_LANES,
        };
      })
      .filter((item) => {
        const delta = jumped
          ? Math.abs(item.time - current)
          : current - item.time;
        return delta >= 0 && delta <= spawnWindow && !spawned.has(item.id);
      })
      .slice(0, TV_DANMAKU_LANES);

    if (nextItems.length > 0) {
      nextItems.forEach((item) => spawned.add(item.id));
    }

    setActiveDanmakuItems((prev) => {
      if (jumped) return nextItems;
      if (nextItems.length === 0) return prev;
      return [...prev, ...nextItems];
    });

    lastDanmakuTimeRef.current = current;
  }, [danmakuEnabled, danmakuItems, time.current]);

  useEffect(() => {
    if (!detail?.source || !detail?.id) return;
    isFavorited(detail.source, detail.id)
      .then(setFavorited)
      .catch(() => undefined);
    getSkipConfig(detail.source, detail.id)
      .then(setSkipConfig)
      .catch(() => setSkipConfig(null));
  }, [detail?.source, detail?.id]);

  const switchEpisode = (next: number) => {
    if (!detail) return;
    const max = detail.episodes.length - 1;
    const target = Math.max(0, Math.min(max, next));
    setStartTime(0);
    setEpisodeIndex(target);
    setEpisodePage(Math.floor(target / 30));
    setShowPanel(true);
  };

  const onTime = useCallback(
    (current: number, duration: number) => {
      const next = { current, duration };
      timeRef.current = next;
      setTime(next);

      if (!skipConfig?.enable || !duration) return;
      const video = document.querySelector<HTMLVideoElement>(
        '[data-tv-player-root] video'
      );
      if (!video) return;
      const episodeKey = `${detail?.source || ''}-${
        detail?.id || ''
      }-${episodeIndex}`;
      const intro = Math.max(0, skipConfig.intro_time || 0);
      if (
        intro > 1 &&
        current > 0.5 &&
        current < intro &&
        skippedIntroRef.current !== episodeKey
      ) {
        skippedIntroRef.current = episodeKey;
        video.currentTime = intro;
        return;
      }
      const outroRaw = skipConfig.outro_time || 0;
      const outroStart =
        outroRaw < 0 ? duration - Math.abs(outroRaw) : duration - outroRaw;
      if (
        outroRaw !== 0 &&
        outroStart > 0 &&
        current >= outroStart &&
        skippedOutroRef.current !== episodeKey
      ) {
        skippedOutroRef.current = episodeKey;
        switchEpisode(episodeIndex + 1);
      }
    },
    [detail, episodeIndex, skipConfig]
  );

  useEffect(() => {
    if (!detail) return;
    const saveProgress = () => {
      const playTime = Math.floor(timeRef.current.current || 0);
      const totalTime = Math.floor(timeRef.current.duration || 0);

      // 参考 /play：无有效进度时不保存；同一秒/同一集重复触发不保存，避免网络里刷 /api/playrecords。
      if (playTime <= 0 && totalTime <= 0) return;

      const last = lastSavedRef.current;
      if (
        last &&
        last.source === detail.source &&
        last.id === detail.id &&
        last.index === episodeIndex + 1 &&
        last.playTime === playTime &&
        last.totalTime === totalTime
      ) {
        return;
      }

      lastSavedRef.current = {
        source: detail.source,
        id: detail.id,
        index: episodeIndex + 1,
        playTime,
        totalTime,
      };

      savePlayRecord(detail.source, detail.id, {
        title: detail.title,
        source_name: detail.source_name,
        year: detail.year || '',
        cover: detail.poster || '',
        index: episodeIndex + 1,
        total_episodes: detail.episodes?.length || 1,
        play_time: playTime,
        total_time: totalTime,
        save_time: Date.now(),
        search_title: title || detail.title,
      }).catch(() => undefined);
    };

    const timer = window.setInterval(() => {
      saveProgress();
    }, 20000);
    return () => {
      window.clearInterval(timer);
      saveProgress();
    };
  }, [detail, episodeIndex, title]);

  const showSeekOverlay = (
    current: number,
    duration: number,
    delta: number
  ) => {
    setSeekHint({ current, duration, delta });
    if (seekHintTimerRef.current) window.clearTimeout(seekHintTimerRef.current);
    seekHintTimerRef.current = window.setTimeout(() => setSeekHint(null), 1200);
  };

  const seekBy = (delta: number, showOverlay = false) => {
    const video = document.querySelector<HTMLVideoElement>(
      '[data-tv-player-root] video'
    );
    if (!video || !Number.isFinite(video.duration)) return;
    const duration = video.duration || 0;
    const next = Math.max(
      0,
      Math.min(duration, (video.currentTime || 0) + delta)
    );
    video.currentTime = next;
    if (showOverlay) showSeekOverlay(next, duration, delta);
  };

  const seekTo = (value: number) => {
    const video = document.querySelector<HTMLVideoElement>(
      '[data-tv-player-root] video'
    );
    if (!video || !Number.isFinite(video.duration)) return;
    const duration = video.duration || 0;
    const next = Math.max(0, Math.min(duration, value));
    video.currentTime = next;
    showSeekOverlay(next, duration, 0);
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

  const revealPanel = useCallback(() => {
    setShowPanel(true);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setShowPanel(false);
      setShowEpisodes(false);
      setShowDanmakuSettings(false);
      blurTVPlayerControl();
    }, 10000);
  }, []);

  const toggleFavorite = async () => {
    if (!detail) return;
    if (favorited) {
      await deleteFavorite(detail.source, detail.id);
      setFavorited(false);
    } else {
      await saveFavorite(detail.source, detail.id, {
        title: detail.title,
        source_name: detail.source_name || detail.source,
        year: detail.year || '',
        cover: detail.poster || '',
        total_episodes: detail.episodes?.length || 1,
        save_time: Date.now(),
        search_title: title || detail.title,
        vod_remarks: detail.vod_remarks,
      });
      setFavorited(true);
    }
  };

  const cyclePlaybackRate = () => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const currentIndex = rates.findIndex((rate) => rate === playbackRate);
    setPlaybackRate(rates[(currentIndex + 1 + rates.length) % rates.length]);
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
    if (showPanel || showEpisodes || showDanmakuSettings) revealPanel();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [revealPanel, showDanmakuSettings, showEpisodes, showPanel]);

  const switchSource = async (item: SearchResult) => {
    if (!detail) return;
    if (detail.source === item.source && detail.id === item.id) return;
    revealPanel();
    setShowEpisodes(false);
    setLoading(true);
    setIsBuffering(false);
    try {
      let next = item;
      if (!item.episodes?.length) {
        const data = await fetchTVDetail({
          source: item.source,
          id: item.id,
          title: item.title,
        });
        next = data.detail;
      }
      const maxIndex = Math.max(0, (next.episodes?.length || 1) - 1);
      let targetIndex = Math.max(0, Math.min(episodeIndex, maxIndex));
      let targetStartTime = 0;
      try {
        const records = await getAllPlayRecords();
        const record = records[generateStorageKey(next.source, next.id)];
        if (record?.index) {
          targetIndex = Math.max(0, Math.min(maxIndex, record.index - 1));
          targetStartTime = record.play_time > 1 ? record.play_time : 0;
        }
      } catch {
        // 读取播放记录失败时保留当前集数，避免切源失败。
      }
      setDetail(next);
      setEpisodeIndex(targetIndex);
      setStartTime(targetStartTime);
      setEpisodePage(Math.floor(targetIndex / 30));
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换播放源失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showDetail) {
      window.requestAnimationFrame(() =>
        detailCloseButtonRef.current?.focus({ preventScroll: true })
      );
    }
  }, [showDetail]);

  useEffect(() => {
    if (showDanmakuSettings) {
      window.requestAnimationFrame(() =>
        danmakuFontSizeInputRef.current?.focus({ preventScroll: true })
      );
    }
  }, [showDanmakuSettings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (showDetail && event.key === 'Escape') {
        event.preventDefault();
        setShowDetail(false);
        revealPanel();
        return;
      }

      if (showDanmakuSettings && event.key === 'Escape') {
        event.preventDefault();
        setShowDanmakuSettings(false);
        blurTVPlayerControl();
        revealPanel();
        return;
      }

      const isMenuKey =
        event.key === 'ContextMenu' ||
        event.key === 'Menu' ||
        event.key === 'BrowserContextMenu' ||
        event.code === 'ContextMenu' ||
        event.code === 'Menu' ||
        event.keyCode === 93 ||
        event.keyCode === 82 ||
        event.which === 93 ||
        event.which === 82;
      if (isMenuKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const now = Date.now();
        if (now - menuKeyTimeRef.current < REMOTE_KEY_DEDUPE_MS) return;
        menuKeyTimeRef.current = now;
        if (showPanel || showEpisodes || showDanmakuSettings) {
          setShowPanel(false);
          setShowEpisodes(false);
          setShowDanmakuSettings(false);
          blurTVPlayerControl();
        } else {
          revealPanel();
        }
        return;
      }

      if (/^[0-9]$/.test(event.key) && detail?.episodes?.length) {
        event.preventDefault();
        const nextBuffer = `${digitBuffer}${event.key}`.slice(-3);
        setDigitBuffer(nextBuffer);
        if (digitTimerRef.current) window.clearTimeout(digitTimerRef.current);
        digitTimerRef.current = window.setTimeout(() => {
          const target = Number(nextBuffer);
          if (target > 0) switchEpisode(target - 1);
          setDigitBuffer('');
        }, 850);
      }
      if (event.key === 'Enter') {
        const active = document.activeElement;
        const isControlFocused =
          active instanceof HTMLElement &&
          Boolean(active.closest('[data-tv-player-control]'));
        if (!showPanel && !showEpisodes) {
          event.preventDefault();
          event.stopImmediatePropagation();
          blurTVPlayerControl();
          setToggleCommand((value) => value + 1);
          return;
        }
        if (!isControlFocused) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setToggleCommand((value) => value + 1);
          return;
        }
        return;
      }

      if (
        !showPanel &&
        !showEpisodes &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        event.preventDefault();
        const base = event.repeat ? 30 : 10;
        seekBy(event.key === 'ArrowLeft' ? -base : base, true);
        return;
      }

      if (
        !showPanel &&
        !showEpisodes &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        setVideoVolume(volume + (event.key === 'ArrowUp' ? 0.05 : -0.05));
        return;
      }

      if (showPanel || showEpisodes) {
        revealPanel();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (showDetail) setShowDetail(false);
        else if (showDanmakuSettings) {
          setShowDanmakuSettings(false);
          blurTVPlayerControl();
        } else if (showEpisodes) {
          setShowEpisodes(false);
          blurTVPlayerControl();
        } else if (showPanel) {
          setShowPanel(false);
          blurTVPlayerControl();
        } else router.back();
      }
      if (event.key === 'PageUp') switchEpisode(episodeIndex - 1);
      if (event.key === 'PageDown') switchEpisode(episodeIndex + 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    detail?.episodes?.length,
    digitBuffer,
    episodeIndex,
    revealPanel,
    router,
    showDanmakuSettings,
    showDetail,
    showEpisodes,
    showPanel,
    volume,
  ]);

  useEffect(() => {
    if (!showEpisodes) return;
    const targetPage = Math.floor(episodeIndex / 30);
    setEpisodePage(targetPage);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => {
      episodeButtonRefs.current[episodeIndex]?.focus({ preventScroll: true });
    });
  }, [episodeIndex, showEpisodes]);

  useEffect(() => {
    if (!showEpisodes) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [showEpisodes]);

  const episodePages = useMemo(() => {
    const total = detail?.episodes?.length || 0;
    return Math.max(1, Math.ceil(total / 30));
  }, [detail?.episodes?.length]);

  const visibleEpisodeIndexes = useMemo(() => {
    const total = detail?.episodes?.length || 0;
    const start = Math.max(0, Math.min(episodePage, episodePages - 1)) * 30;
    return Array.from(
      { length: Math.max(0, Math.min(30, total - start)) },
      (_, idx) => start + idx
    );
  }, [detail?.episodes?.length, episodePage, episodePages]);

  if (loading) {
    return (
      <main className='fixed inset-0 flex items-center justify-center bg-black text-3xl font-bold text-white'>
        <Loader2 className='mr-4 h-10 w-10 animate-spin text-rose-500' />
        正在进入电视播放...
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className='fixed inset-0 flex items-center justify-center bg-black p-10 text-center text-white'>
        <section
          role='alert'
          className='max-w-3xl rounded-[36px] border border-red-500/40 bg-red-950/50 p-10 shadow-2xl shadow-red-950/40'
        >
          <AlertTriangle className='mx-auto mb-5 h-16 w-16 text-red-300' />
          <h1 className='text-4xl font-black text-red-100'>
            {error || '播放信息不存在'}
          </h1>
          <div className='mt-8 flex justify-center gap-4'>
            <button
              onClick={() => window.location.reload()}
              className='tv-focusable flex cursor-pointer items-center gap-3 rounded-2xl bg-rose-600 px-7 py-4 text-2xl font-black outline-none focus:ring-4 focus:ring-rose-300'
            >
              <RotateCcw className='h-7 w-7' />
              重试
            </button>
            <button
              onClick={() => router.back()}
              className='tv-focusable rounded-2xl bg-white/10 px-7 py-4 text-2xl font-black outline-none focus:ring-4 focus:ring-white/40'
            >
              返回
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main
      data-tv-player-root
      data-tv-controls-open={
        showPanel || showEpisodes || showDetail || showDanmakuSettings
          ? 'true'
          : 'false'
      }
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        if (now - menuKeyTimeRef.current < REMOTE_KEY_DEDUPE_MS) return;
        menuKeyTimeRef.current = now;
        if (showPanel || showEpisodes || showDanmakuSettings) {
          setShowPanel(false);
          setShowEpisodes(false);
          setShowDanmakuSettings(false);
          blurTVPlayerControl();
        } else {
          revealPanel();
        }
      }}
      className='fixed inset-0 overflow-hidden bg-black text-white'
    >
      {videoUrl ? (
        <TVNativeVideo
          key={`${videoUrl}-${retryNonce}`}
          url={videoUrl}
          poster={detail.poster}
          title={detail.title}
          onTime={onTime}
          command={toggleCommand}
          startTime={startTime}
          onError={() => setPlaybackError(true)}
          onPlayingChange={setIsPlaying}
          onBufferingChange={setIsBuffering}
          adFilterEnabled={adFilterEnabled}
          playbackRate={playbackRate}
        />
      ) : (
        <div className='flex h-full w-full items-center justify-center text-3xl font-bold text-white'>
          <Loader2 className='mr-4 h-10 w-10 animate-spin text-rose-500' />
          {resolving ? '正在解析播放地址...' : '准备播放...'}
        </div>
      )}
      {activeDanmakuItems.length > 0 && (
        <div
          className='pointer-events-none absolute inset-x-0 top-12 z-10 overflow-hidden'
          style={{ height: `${danmakuSettings.displayArea}vh` }}
        >
          {activeDanmakuItems.map((item) => (
            <div
              key={item.id}
              className='absolute whitespace-nowrap text-3xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]'
              onAnimationEnd={() => {
                setActiveDanmakuItems((prev) =>
                  prev.filter((active) => active.id !== item.id)
                );
              }}
              style={{
                top: `${item.lane * 12}%`,
                color: item.color || '#fff',
                fontSize: `${danmakuSettings.fontSize}px`,
                opacity: danmakuSettings.opacity,
                animation: `tv-danmaku ${item.duration}s linear forwards`,
                animationPlayState:
                  isPlaying && !isBuffering ? 'running' : 'paused',
              }}
            >
              {item.text}
            </div>
          ))}
          <style jsx>{`
            @keyframes tv-danmaku {
              from {
                transform: translateX(100vw);
              }
              to {
                transform: translateX(-120%);
              }
            }
          `}</style>
        </div>
      )}

      {playbackError && (
        <div
          role='alert'
          className='absolute inset-0 z-30 flex items-center justify-center bg-black/72 p-8 text-white backdrop-blur-sm'
        >
          <section className='max-w-3xl rounded-[36px] border border-white/10 bg-slate-950/92 p-9 text-center shadow-2xl shadow-black/70'>
            <AlertTriangle className='mx-auto mb-5 h-14 w-14 text-amber-300' />
            <h2 className='text-4xl font-black'>当前视频加载失败</h2>
            <p className='mt-3 text-2xl text-slate-300'>
              可以重试当前地址，或打开选集与线路面板切换播放源。
            </p>
            <div className='mt-8 flex justify-center gap-4'>
              <button
                onClick={() => {
                  setPlaybackError(false);
                  setRetryNonce((v) => v + 1);
                }}
                className='tv-focusable flex cursor-pointer items-center gap-3 rounded-2xl bg-rose-600 px-7 py-4 text-2xl font-black outline-none focus:ring-4 focus:ring-rose-300'
              >
                <RotateCcw className='h-7 w-7' />
                重试
              </button>
              <button
                onClick={() => {
                  setPlaybackError(false);
                  setShowPanel(true);
                  setShowEpisodes(true);
                }}
                className='tv-focusable flex cursor-pointer items-center gap-3 rounded-2xl bg-white/10 px-7 py-4 text-2xl font-black outline-none focus:ring-4 focus:ring-white/40'
              >
                <ListVideo className='h-7 w-7' />
                换源/选集
              </button>
            </div>
          </section>
        </div>
      )}

      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          showPanel ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className='absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/90 to-transparent' />
        <div className='absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/95 to-transparent' />
      </div>

      <div
        className={`absolute left-8 right-8 top-8 flex items-center justify-between transition-opacity duration-300 ${
          showPanel ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          onClick={() => router.back()}
          data-tv-player-control
          className='tv-focusable flex cursor-pointer items-center gap-3 rounded-2xl bg-black/70 px-5 py-4 text-2xl font-black outline-none backdrop-blur'
        >
          <ArrowLeft className='h-7 w-7' />
          返回
        </button>
        <div className='rounded-2xl bg-black/70 px-6 py-4 text-right backdrop-blur'>
          <div className='max-w-[60vw] truncate text-3xl font-black'>
            {detail.title}
          </div>
          <div className='mt-1 text-xl text-slate-300'>
            {episodeTitle} · {detail.source_name}
          </div>
        </div>
      </div>

      <div
        data-tv-player-control
        className={`absolute bottom-8 left-8 right-8 transition-opacity duration-300 ${
          showPanel ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className='rounded-[28px] bg-black/75 p-4 backdrop-blur'>
          <div
            onFocusCapture={scrollFocusedControlIntoView}
            className='flex items-center gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_button]:shrink-0 [&_button]:whitespace-nowrap'
          >
            <button
              onClick={() => switchEpisode(episodeIndex - 1)}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-xl font-bold outline-none'
            >
              <SkipBack className='h-6 w-6' />
              上一集
            </button>
            <button
              onClick={() => setToggleCommand((value) => value + 1)}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl bg-rose-600 px-6 py-4 text-xl font-black outline-none'
            >
              {isPlaying ? (
                <Pause className='h-6 w-6' />
              ) : (
                <Play className='h-6 w-6 fill-current' />
              )}
              {isPlaying ? '暂停' : '播放'}
            </button>
            <button
              onClick={() => switchEpisode(episodeIndex + 1)}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-xl font-bold outline-none'
            >
              下一集
              <SkipForward className='h-6 w-6' />
            </button>
            <button
              onClick={() => setShowEpisodes((v) => !v)}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-xl font-bold outline-none'
            >
              <ListVideo className='h-6 w-6' />
              选集
            </button>
            <button
              onClick={toggleFavorite}
              data-tv-player-control
              className={`tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl px-5 py-4 text-xl font-bold outline-none ${
                favorited ? 'bg-rose-600' : 'bg-white/10'
              }`}
            >
              <Heart className={`h-6 w-6 ${favorited ? 'fill-current' : ''}`} />
              收藏
            </button>
            <button
              onClick={() => {
                setShowDetail(true);
                revealPanel();
              }}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-xl font-bold outline-none'
            >
              <Info className='h-6 w-6' />
              详情
            </button>
            <button
              onClick={() => setDanmakuEnabled((v) => !v)}
              data-tv-player-control
              className={`tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl px-5 py-4 text-xl font-bold outline-none ${
                danmakuEnabled ? 'bg-rose-600' : 'bg-white/10'
              }`}
            >
              <MessageCircle className='h-6 w-6' />
              弹幕
            </button>
            <button
              onClick={() => {
                setShowEpisodes(false);
                setShowDanmakuSettings(true);
                revealPanel();
              }}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-xl font-bold outline-none'
            >
              <SlidersHorizontal className='h-6 w-6' />
              弹幕设置
            </button>
            <button
              onClick={() => setAdFilterEnabled((v) => !v)}
              data-tv-player-control
              className={`tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl px-5 py-4 text-xl font-bold outline-none ${
                adFilterEnabled ? 'bg-rose-600' : 'bg-white/10'
              }`}
            >
              <ShieldOff className='h-6 w-6' />
              去广告
            </button>
            <button
              onClick={cyclePlaybackRate}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-xl font-bold outline-none'
            >
              {playbackRate}x
            </button>
            <button
              onClick={toggleMute}
              data-tv-player-control
              className='tv-focusable rounded-2xl bg-white/10 p-4 outline-none'
              title='静音'
            >
              {muted ? (
                <VolumeX className='h-6 w-6' />
              ) : (
                <Volume2 className='h-6 w-6' />
              )}
            </button>
            <button
              onClick={toggleFullscreen}
              data-tv-player-control
              className='tv-focusable rounded-2xl bg-white/10 p-4 outline-none'
            >
              <Maximize className='h-6 w-6' />
            </button>
            <span className='shrink-0 whitespace-nowrap px-2 text-xl font-bold text-slate-200'>
              {formatTVTime(time.current)} / {formatTVTime(time.duration)}
            </span>
          </div>
        </div>
        <div className='mt-4 rounded-3xl bg-black/70 p-4 backdrop-blur'>
          <input
            aria-label='播放进度'
            data-tv-no-focus='true'
            tabIndex={-1}
            type='range'
            min='0'
            max={Math.max(1, time.duration || 1)}
            step='1'
            value={Math.min(time.current, time.duration || time.current)}
            onChange={(e) => seekTo(Number(e.target.value))}
            className='h-3 w-full cursor-pointer accent-rose-600'
          />
          <div className='mt-2 flex items-center justify-between text-lg font-bold text-slate-200'>
            <span>{formatTVTime(time.current)}</span>
            <span>
              {time.duration
                ? `${Math.max(
                    0,
                    Math.round((time.current / time.duration) * 100)
                  )}%`
                : '0%'}
            </span>
            <span>{formatTVTime(time.duration)}</span>
          </div>
        </div>
      </div>

      {showEpisodes && (
        <aside className='absolute bottom-40 right-8 max-h-[55vh] w-[560px] overflow-y-auto rounded-[34px] border border-white/10 bg-slate-950/92 p-6 shadow-2xl shadow-black/70 backdrop-blur-2xl'>
          <h2 className='mb-5 flex items-center gap-3 text-3xl font-black'>
            <Layers className='h-8 w-8 text-rose-500' />
            选集与线路
          </h2>
          <div className='mb-6'>
            <div className='mb-2 text-xl font-black text-slate-300'>播放源</div>
            <div className='flex gap-3 overflow-x-auto px-2 py-3 [scrollbar-width:none]'>
              {sources.length > 0 ? (
                sources.map((item) => (
                  <button
                    key={`${item.source}-${item.id}`}
                    onClick={() => switchSource(item)}
                    data-tv-player-control
                    className={`tv-focusable shrink-0 cursor-pointer rounded-2xl px-5 py-3 text-xl font-bold outline-none focus:ring-4 focus:ring-rose-300 ${
                      detail.source === item.source && detail.id === item.id
                        ? 'bg-rose-600'
                        : 'bg-white/10'
                    }`}
                  >
                    {item.source_name || item.source}
                  </button>
                ))
              ) : (
                <span className='text-xl text-slate-400'>暂无其他播放源</span>
              )}
            </div>
          </div>
          {episodePages > 1 && (
            <div className='mb-5 flex gap-3 overflow-x-auto px-2 py-2 [scrollbar-width:none]'>
              {Array.from({ length: episodePages }, (_, page) => (
                <button
                  key={page}
                  onClick={() => setEpisodePage(page)}
                  data-tv-player-control
                  className={`tv-focusable shrink-0 cursor-pointer rounded-2xl px-5 py-3 text-xl font-black outline-none focus:ring-4 focus:ring-rose-300 ${
                    page === episodePage ? 'bg-rose-600' : 'bg-white/10'
                  }`}
                >
                  {page * 30 + 1}-
                  {Math.min((page + 1) * 30, detail.episodes.length)}
                </button>
              ))}
            </div>
          )}
          <div className='grid grid-cols-4 gap-3'>
            {visibleEpisodeIndexes.map((index) => (
              <button
                key={index}
                ref={(el) => {
                  episodeButtonRefs.current[index] = el;
                }}
                onClick={() => switchEpisode(index)}
                data-tv-player-control
                className={`tv-focusable min-h-16 cursor-pointer rounded-2xl px-3 py-3 text-lg font-black outline-none focus:ring-4 focus:ring-rose-300 ${
                  index === episodeIndex ? 'bg-rose-600' : 'bg-white/10'
                }`}
              >
                {detail.episodes_titles?.[index] || `第 ${index + 1} 集`}
              </button>
            ))}
          </div>
        </aside>
      )}
      {showDanmakuSettings && (
        <div className='absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-10 backdrop-blur-sm'>
          <section
            data-tv-player-control
            data-tv-focus-scope='active'
            data-tv-danmaku-settings
            className='w-[720px] max-w-[92vw] rounded-[34px] border border-white/10 bg-slate-950/95 p-7 text-white shadow-2xl shadow-black/80'
            onKeyDownCapture={(event) => {
              const target = event.target;
              if (
                !(target instanceof HTMLElement) ||
                !target.closest('[data-tv-danmaku-settings]')
              )
                return;

              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                if (
                  target instanceof HTMLInputElement &&
                  target.type === 'range'
                ) {
                  const field = getDanmakuSettingField(target);
                  if (!field) return;
                  event.preventDefault();
                  event.stopPropagation();
                  updateTVDanmakuSetting(
                    field,
                    event.key === 'ArrowRight' ? 1 : -1,
                    setDanmakuSettings
                  );
                  revealPanel();
                }
                return;
              }

              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                moveFocusWithinScope(
                  event.currentTarget as HTMLElement,
                  event.key === 'ArrowDown' ? 'down' : 'up'
                );
                revealPanel();
              }
            }}
          >
            <div className='mb-7 flex items-center justify-between gap-5'>
              <h2 className='flex items-center gap-3 text-3xl font-black'>
                <SlidersHorizontal className='h-8 w-8 text-rose-500' />
                弹幕设置
              </h2>
              <button
                onClick={() => {
                  setShowDanmakuSettings(false);
                  blurTVPlayerControl();
                }}
                data-tv-player-control
                className='tv-focusable flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-2xl bg-white/10 px-5 py-4 text-2xl font-black outline-none focus:ring-4 focus:ring-rose-300'
              >
                <X className='h-7 w-7' />
                关闭
              </button>
            </div>

            <div className='space-y-7'>
              <label className='block'>
                <div className='mb-3 flex items-center justify-between text-xl font-bold'>
                  <span>字号</span>
                  <span className='text-rose-200'>
                    {danmakuSettings.fontSize}px
                  </span>
                </div>
                <input
                  ref={danmakuFontSizeInputRef}
                  aria-label='弹幕字号'
                  data-tv-danmaku-field='fontSize'
                  data-tv-player-control
                  type='range'
                  min='20'
                  max='46'
                  step='1'
                  value={danmakuSettings.fontSize}
                  onChange={(event) =>
                    setDanmakuSettings((prev) => ({
                      ...prev,
                      fontSize: Number(event.target.value),
                    }))
                  }
                  className='tv-focusable h-3 w-full cursor-pointer accent-rose-600 outline-none'
                />
              </label>

              <label className='block'>
                <div className='mb-3 flex items-center justify-between text-xl font-bold'>
                  <span>显示区域</span>
                  <span className='text-rose-200'>
                    {danmakuSettings.displayArea}%
                  </span>
                </div>
                <input
                  aria-label='弹幕显示区域'
                  data-tv-danmaku-field='displayArea'
                  data-tv-player-control
                  type='range'
                  min='24'
                  max='72'
                  step='2'
                  value={danmakuSettings.displayArea}
                  onChange={(event) =>
                    setDanmakuSettings((prev) => ({
                      ...prev,
                      displayArea: Number(event.target.value),
                    }))
                  }
                  className='tv-focusable h-3 w-full cursor-pointer accent-rose-600 outline-none'
                />
              </label>

              <label className='block'>
                <div className='mb-3 flex items-center justify-between text-xl font-bold'>
                  <span>不透明度</span>
                  <span className='text-rose-200'>
                    {Math.round(danmakuSettings.opacity * 100)}%
                  </span>
                </div>
                <input
                  aria-label='弹幕不透明度'
                  data-tv-danmaku-field='opacity'
                  data-tv-player-control
                  type='range'
                  min='25'
                  max='100'
                  step='5'
                  value={Math.round(danmakuSettings.opacity * 100)}
                  onChange={(event) =>
                    setDanmakuSettings((prev) => ({
                      ...prev,
                      opacity: Number(event.target.value) / 100,
                    }))
                  }
                  className='tv-focusable h-3 w-full cursor-pointer accent-rose-600 outline-none'
                />
              </label>
            </div>
          </section>
        </div>
      )}
      {showDetail && (
        <div className='absolute inset-0 z-40 flex items-center justify-center bg-black/72 p-10 backdrop-blur-sm'>
          <section
            data-tv-player-control
            className='max-h-[82vh] w-[980px] max-w-[92vw] overflow-y-auto rounded-[42px] border border-white/10 bg-slate-950/95 p-8 text-white shadow-2xl shadow-black/80'
          >
            <div className='mb-6 flex items-start justify-between gap-6'>
              <div>
                <h2 className='text-5xl font-black'>{detail.title}</h2>
                <div className='mt-4 flex flex-wrap gap-3 text-xl font-bold text-slate-200'>
                  <span className='rounded-full bg-rose-600 px-4 py-2'>
                    {detail.source_name || detail.source}
                  </span>
                  {detail.year && (
                    <span className='rounded-full bg-white/10 px-4 py-2'>
                      {detail.year}
                    </span>
                  )}
                  {detail.type_name && (
                    <span className='rounded-full bg-white/10 px-4 py-2'>
                      {detail.type_name}
                    </span>
                  )}
                  {detail.vod_remarks && (
                    <span className='rounded-full bg-white/10 px-4 py-2'>
                      {detail.vod_remarks}
                    </span>
                  )}
                  <span className='rounded-full bg-white/10 px-4 py-2'>
                    {episodeTitle}
                  </span>
                </div>
              </div>
              <button
                ref={detailCloseButtonRef}
                onClick={() => setShowDetail(false)}
                data-tv-player-control
                className='tv-focusable flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-2xl font-black outline-none focus:ring-4 focus:ring-rose-300'
              >
                <X className='h-7 w-7' />
                关闭
              </button>
            </div>
            {detail.poster && (
              <img
                src={detail.poster}
                alt=''
                className='float-left mr-7 mb-4 h-72 w-48 rounded-3xl object-cover shadow-xl shadow-black/50'
              />
            )}
            <p className='whitespace-pre-line text-2xl leading-relaxed text-slate-200'>
              {detail.desc || '暂无详情简介'}
            </p>
          </section>
        </div>
      )}
      {digitBuffer && (
        <div className='absolute right-10 top-32 rounded-3xl bg-black/75 px-7 py-5 text-5xl font-black text-white shadow-2xl'>
          第 {digitBuffer} 集
        </div>
      )}
      {showVolumeHint && !showPanel && !showEpisodes && (
        <div className='absolute right-10 top-1/2 flex -translate-y-1/2 flex-col items-center gap-4 rounded-3xl bg-black/80 px-6 py-7 text-3xl font-black text-white shadow-2xl backdrop-blur'>
          {muted || volume <= 0 ? (
            <VolumeX className='h-10 w-10' />
          ) : (
            <Volume2 className='h-10 w-10' />
          )}
          <div className='relative h-56 w-4 overflow-hidden rounded-full bg-white/20'>
            <div
              className='absolute bottom-0 left-0 right-0 rounded-full bg-rose-600'
              style={{ height: `${Math.round((muted ? 0 : volume) * 100)}%` }}
            />
          </div>
          <div className='min-w-16 text-center'>
            {Math.round((muted ? 0 : volume) * 100)}
          </div>
        </div>
      )}
      {seekHint && !showPanel && !showEpisodes && (
        <div className='absolute bottom-16 left-1/2 w-[720px] max-w-[86vw] -translate-x-1/2 rounded-[34px] bg-black/82 px-8 py-6 text-white shadow-2xl backdrop-blur'>
          <div className='mb-4 flex items-center justify-between text-3xl font-black'>
            <span>
              {seekHint.delta > 0
                ? `快进 ${seekHint.delta}s`
                : seekHint.delta < 0
                ? `快退 ${Math.abs(seekHint.delta)}s`
                : '定位进度'}
            </span>
            <span>
              {formatTVTime(seekHint.current)} /{' '}
              {formatTVTime(seekHint.duration)}
            </span>
          </div>
          <div className='h-3 overflow-hidden rounded-full bg-white/20'>
            <div
              className='h-full rounded-full bg-rose-600'
              style={{
                width: seekHint.duration
                  ? `${Math.min(
                      100,
                      (seekHint.current / seekHint.duration) * 100
                    )}%`
                  : '0%',
              }}
            />
          </div>
        </div>
      )}
      <TVVirtualRemote />
    </main>
  );
}

export default function TVPlayPage() {
  return (
    <Suspense fallback={null}>
      <TVPlayClient />
    </Suspense>
  );
}
