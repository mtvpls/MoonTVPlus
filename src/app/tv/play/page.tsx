'use client';

import {
  AlertTriangle,
  Heart,
  Info,
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
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type Dispatch,
  type FocusEvent,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { isAnimeCategoryText } from '@/lib/anime-keyword-expr';
import {
  convertDanmakuFormat,
  getDanmakuById,
  getEpisodes,
  initDanmakuModule,
  loadDanmakuDisplayState,
  saveDanmakuDisplayState,
  searchAnime,
} from '@/lib/danmaku/api';
import {
  type PlayRecord,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  savePlayRecord,
} from '@/lib/db.client';
import { loadTVPlayerUpDownAction } from '@/lib/tv-preferences';
import {
  mergeTVBoxBridgePlaybackSources,
  restoreTVBoxBridgePlaybackLine,
} from '@/lib/tvbox-bridge.playback';
import {
  getActiveTVBoxBridgeLine,
  getTVBoxBridgeLines,
  isTVBoxBridgeSource,
  resolveEpisodeIndexForLine,
} from '@/lib/tvbox-bridge.shared';
import type { SearchResult } from '@/lib/types';
import { useTVFavorite } from '@/hooks/useTVFavorite';

import { scrollTVPlayerControlIntoView } from '@/components/tv/player/focus';
import TVNativeVideo from '@/components/tv/player/TVNativeVideo';
import {
  type TVEpisodePlayback,
  fetchTVDetail,
  fetchTVSourceDetail,
  formatTVTime,
  getTVErrorMessage,
  resolveTVEpisodePlayback,
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
const TV_EPISODE_GRID_COLUMNS = 4;

const TV_EPISODE_FOCUS_GROUPS = [
  'close',
  'sources',
  'lines',
  'pages',
  'episodes',
] as const;
type TVEpisodeFocusGroup = (typeof TV_EPISODE_FOCUS_GROUPS)[number];
type TVEpisodeFocusDirection = 'up' | 'down' | 'left' | 'right';
type TVPlayerDialog = 'episodes' | 'detail' | 'danmaku';

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
    scrollTVPlayerControlIntoView(target);
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

function getEpisodePanelGroupElements(
  panel: HTMLElement,
  group: TVEpisodeFocusGroup
) {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      `[data-tv-episode-focus-group="${group}"]:not([disabled])`
    )
  );
}

function getEpisodePanelFirstElement(panel: HTMLElement) {
  for (const group of TV_EPISODE_FOCUS_GROUPS) {
    const first = getEpisodePanelGroupElements(panel, group)[0];
    if (first) return first;
  }
  return null;
}

function focusEpisodePanelElement(element: HTMLElement | null | undefined) {
  if (!element) return false;
  element.focus({ preventScroll: true });
  scrollTVPlayerControlIntoView(element);
  return true;
}

function getClosestByHorizontalCenter(
  elements: HTMLElement[],
  anchor: HTMLElement
) {
  if (elements.length === 0) return null;
  const anchorRect = anchor.getBoundingClientRect();
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  return elements.reduce((closest, item) => {
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.left + itemRect.width / 2;
    const closestRect = closest.getBoundingClientRect();
    const closestCenter = closestRect.left + closestRect.width / 2;
    return Math.abs(itemCenter - anchorCenter) <
      Math.abs(closestCenter - anchorCenter)
      ? item
      : closest;
  }, elements[0]);
}

function getSelectedEpisodePanelButton(
  panel: HTMLElement,
  episodeIndex: number
) {
  return panel.querySelector<HTMLElement>(
    `[data-tv-episode-index="${episodeIndex}"]`
  );
}

function focusEpisodePanelInitial(
  panel: HTMLElement | null,
  episodeIndex: number
) {
  if (!panel) return false;
  const active = document.activeElement;
  if (active instanceof HTMLElement && panel.contains(active)) {
    focusEpisodePanelElement(active);
    return true;
  }

  return focusEpisodePanelElement(
    getSelectedEpisodePanelButton(panel, episodeIndex) ||
      getEpisodePanelFirstElement(panel)
  );
}

function moveFocusWithinEpisodePanel(
  panel: HTMLElement | null,
  direction: TVEpisodeFocusDirection,
  episodeIndex: number
) {
  if (!panel) return;

  const active = document.activeElement;
  const activeElement =
    active instanceof HTMLElement && panel.contains(active)
      ? active.closest<HTMLElement>('[data-tv-episode-focus-group]')
      : null;

  if (!activeElement) {
    focusEpisodePanelInitial(panel, episodeIndex);
    return;
  }

  const group = activeElement.dataset.tvEpisodeFocusGroup as
    | TVEpisodeFocusGroup
    | undefined;
  if (!group || !TV_EPISODE_FOCUS_GROUPS.includes(group)) {
    focusEpisodePanelInitial(panel, episodeIndex);
    return;
  }

  const elements = getEpisodePanelGroupElements(panel, group);
  const index = elements.indexOf(activeElement);
  if (index < 0) {
    focusEpisodePanelInitial(panel, episodeIndex);
    return;
  }

  const gridColumns =
    group === 'episodes' && activeElement.parentElement
      ? window
          .getComputedStyle(activeElement.parentElement)
          .gridTemplateColumns.trim()
          .split(/\s+/).length
      : TV_EPISODE_GRID_COLUMNS;
  let target: HTMLElement | null = activeElement;

  if (direction === 'left' || direction === 'right') {
    const delta = direction === 'right' ? 1 : -1;

    if (group === 'episodes') {
      const rowStart = Math.floor(index / gridColumns) * gridColumns;
      const rowEnd = Math.min(rowStart + gridColumns - 1, elements.length - 1);
      const nextIndex = Math.max(rowStart, Math.min(rowEnd, index + delta));
      target = elements[nextIndex] || activeElement;
    } else {
      const nextIndex = Math.max(
        0,
        Math.min(elements.length - 1, index + delta)
      );
      target = elements[nextIndex] || activeElement;
    }

    focusEpisodePanelElement(target);
    return;
  }

  if (group === 'episodes') {
    const nextIndex =
      direction === 'up' ? index - gridColumns : index + gridColumns;

    if (nextIndex >= 0 && nextIndex < elements.length) {
      focusEpisodePanelElement(elements[nextIndex]);
      return;
    }
  }

  const delta = direction === 'down' ? 1 : -1;
  for (
    let groupIndex = TV_EPISODE_FOCUS_GROUPS.indexOf(group) + delta;
    groupIndex >= 0 && groupIndex < TV_EPISODE_FOCUS_GROUPS.length;
    groupIndex += delta
  ) {
    const nextGroup = TV_EPISODE_FOCUS_GROUPS[groupIndex];
    const nextElements = getEpisodePanelGroupElements(panel, nextGroup);
    const nextTarget =
      (nextGroup === 'episodes'
        ? getSelectedEpisodePanelButton(panel, episodeIndex)
        : null) || getClosestByHorizontalCenter(nextElements, activeElement);
    if (nextTarget) {
      target = nextTarget;
      break;
    }
  }

  focusEpisodePanelElement(target);
}

function TVPlayClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [playback, setPlayback] = useState<TVEpisodePlayback | null>(null);
  const videoUrl = playback?.url || '';
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
  const { favorited, toggleFavorite: updateFavorite } = useTVFavorite(
    detail?.source,
    detail?.id
  );
  const [initialVolumeState] = useState(loadTVVolumeState);
  const [muted, setMuted] = useState(initialVolumeState.muted);
  const [volume, setVolume] = useState(initialVolumeState.volume);
  const [showVolumeHint, setShowVolumeHint] = useState(false);
  const [upDownAction] = useState(loadTVPlayerUpDownAction);
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
  const playPauseButtonRef = useRef<HTMLButtonElement | null>(null);
  const episodesPanelRef = useRef<HTMLElement | null>(null);
  const episodeButtonRefs = useRef<Record<number, HTMLButtonElement | null>>(
    {}
  );
  const detailCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const danmakuFontSizeInputRef = useRef<HTMLInputElement | null>(null);
  const dialogReturnFocusRef = useRef<{
    trigger: HTMLElement;
    dialog: TVPlayerDialog;
  } | null>(null);
  const digitTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const volumeHintTimerRef = useRef<number | null>(null);
  const seekHintTimerRef = useRef<number | null>(null);
  const menuKeyTimeRef = useRef(0);
  const spawnedDanmakuRef = useRef<Set<string>>(new Set());
  const lastDanmakuTimeRef = useRef(0);
  const skippedIntroRef = useRef('');
  const skippedOutroRef = useRef('');
  const manualPlaybackParamsRef = useRef<string | null>(null);
  const progressSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSavedRef = useRef<{
    source: string;
    id: string;
    index: number;
    playTime: number;
    totalTime: number;
    line?: string;
  } | null>(null);

  const source = searchParams.get('source');
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  const fileName = searchParams.get('fileName');
  const initialIndex = Number(searchParams.get('index') || '0');
  const explicitIndex = searchParams.has('index');
  const requestedLine = searchParams.get('line');
  const year = searchParams.get('year');
  const stype = searchParams.get('stype');
  const searchQuery = searchParams.get('q');
  const playbackParams = searchParams.toString();
  const bridgeLines = getTVBoxBridgeLines(detail || {});
  const activeBridgeLine = getActiveTVBoxBridgeLine(detail || {});

  useEffect(() => {
    // 手动切源/线路已经更新详情，URL 同步后无需再加载默认线路。
    if (manualPlaybackParamsRef.current === playbackParams) {
      manualPlaybackParamsRef.current = null;
      return;
    }
    manualPlaybackParamsRef.current = null;
    let alive = true;
    setLoading(true);
    setError('');
    setDetail(null);
    setPlayback(null);
    fetchTVDetail({
      source,
      id,
      title,
      fileName,
      line: requestedLine,
      year,
      stype,
      searchQuery,
    })
      .then(async (data) => {
        if (!alive) return;
        let record: PlayRecord | undefined;
        try {
          const records = await getAllPlayRecords();
          record =
            records[generateStorageKey(data.detail.source, data.detail.id)];
        } catch {
          // 播放记录不可用时使用请求指定的线路与集数。
        }
        const selectedDetail = await restoreTVBoxBridgePlaybackLine(
          data.detail,
          requestedLine,
          async () => record?.line
        );
        if (!alive) return;
        const desiredIndex = explicitIndex
          ? initialIndex
          : record?.index
          ? record.index - 1
          : selectedDetail.initialEpisodeIndex || 0;
        const safeIndex = resolveEpisodeIndexForLine(
          selectedDetail.episodes.length,
          Number.isFinite(desiredIndex) ? desiredIndex : 0
        );
        setDetail(selectedDetail);
        setSources(
          mergeTVBoxBridgePlaybackSources(data.sources, selectedDetail)
        );
        setEpisodeIndex(safeIndex);
        setEpisodePage(Math.floor(safeIndex / 30));
        setStartTime(
          !explicitIndex &&
            record?.index === safeIndex + 1 &&
            record.play_time > 1
            ? record.play_time
            : 0
        );
      })
      .catch(
        (err) =>
          alive &&
          setError(getTVErrorMessage(err, '加载播放信息失败，请稍后重试'))
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [
    source,
    id,
    title,
    fileName,
    initialIndex,
    explicitIndex,
    requestedLine,
    year,
    stype,
    searchQuery,
    playbackParams,
  ]);

  useEffect(() => {
    let alive = true;
    async function resolve() {
      setPlayback(null);
      if (loading || !detail) return;
      setError('');
      setPlaybackError(false);
      timeRef.current = { current: startTime, duration: 0 };
      setTime(timeRef.current);
      if (!detail.episodes?.[episodeIndex]) {
        setResolving(false);
        setError('该线路没有可播放的剧集');
        return;
      }
      setResolving(true);
      try {
        const result = await resolveTVEpisodePlayback(
          detail.episodes[episodeIndex],
          detail.source,
          detail.proxyMode
        );
        if (alive) setPlayback(result);
      } catch (err) {
        if (alive)
          setError(getTVErrorMessage(err, '获取播放地址失败，请尝试其他线路'));
      } finally {
        if (alive) setResolving(false);
      }
    }
    resolve();
    return () => {
      alive = false;
    };
  }, [detail, episodeIndex, retryNonce, loading, startTime]);

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
      const episodeKey = `${detail?.source || ''}-${detail?.id || ''}-${
        detail?.activeLine || ''
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
    if (loading || !detail) return;
    const line = getActiveTVBoxBridgeLine(detail)?.name;
    const saveProgress = (saveLine = false) => {
      const playTime = Number.isFinite(timeRef.current.current)
        ? Math.floor(timeRef.current.current || 0)
        : 0;
      const totalTime = Number.isFinite(timeRef.current.duration)
        ? Math.floor(timeRef.current.duration || 0)
        : 0;

      // 参考 /play：无有效进度时不保存；同一秒/同一集重复触发不保存，避免网络里刷 /api/playrecords。
      if (!saveLine && playTime <= 0 && totalTime <= 0) return;

      const last = lastSavedRef.current;
      if (
        last &&
        last.source === detail.source &&
        last.id === detail.id &&
        last.index === episodeIndex + 1 &&
        last.line === line &&
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
        line,
      };

      const record: PlayRecord = {
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
        is_anime: isAnimeCategoryText(detail.type_name, detail.class),
        line,
      };
      // 旧线路的清理保存先完成，避免覆盖刚选中的线路记录。
      progressSaveQueueRef.current = progressSaveQueueRef.current
        .then(() => savePlayRecord(detail.source, detail.id, record))
        .catch(() => undefined);
    };

    if (line) saveProgress(true);
    const timer = window.setInterval(() => {
      saveProgress();
    }, 20000);
    return () => {
      window.clearInterval(timer);
      saveProgress();
    };
  }, [detail, episodeIndex, title, startTime, loading]);

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
    if (showEpisodes || showDetail || showDanmakuSettings) return;
    idleTimerRef.current = window.setTimeout(() => {
      setShowPanel(false);
      blurTVPlayerControl();
    }, 10000);
  }, [showDanmakuSettings, showDetail, showEpisodes]);

  const openPlayerDialog = (dialog: TVPlayerDialog, trigger: HTMLElement) => {
    dialogReturnFocusRef.current = { trigger, dialog };
    setShowEpisodes(dialog === 'episodes');
    setShowDetail(dialog === 'detail');
    setShowDanmakuSettings(dialog === 'danmaku');
    revealPanel();
  };

  const closePlayerDialog = useCallback(() => {
    setShowEpisodes(false);
    setShowDetail(false);
    setShowDanmakuSettings(false);
    revealPanel();
  }, [revealPanel]);

  useEffect(() => {
    if (showEpisodes || showDetail || showDanmakuSettings) return;
    const returnFocus = dialogReturnFocusRef.current;
    if (!showPanel) {
      dialogReturnFocusRef.current = null;
      return;
    }
    // 等按钮重新出现再聚焦；错误提示继续使用自己的操作焦点。
    if (loading || playbackError || error) return;

    const raf = window.requestAnimationFrame(() => {
      dialogReturnFocusRef.current = null;
      const trigger = returnFocus
        ? returnFocus.trigger.isConnected
          ? returnFocus.trigger
          : document.querySelector<HTMLElement>(
              `[data-tv-player-dialog-trigger="${returnFocus.dialog}"]`
            )
        : playPauseButtonRef.current;
      trigger?.focus({ preventScroll: true });
      if (trigger) scrollTVPlayerControlIntoView(trigger);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    error,
    loading,
    playbackError,
    showDanmakuSettings,
    showDetail,
    showEpisodes,
    showPanel,
  ]);

  const toggleFavorite = () => {
    if (!detail) return;
    updateFavorite({
      title: detail.title,
      source_name: detail.source_name || detail.source,
      year: detail.year || '',
      cover: detail.poster || '',
      total_episodes: detail.episodes?.length || 1,
      save_time: Date.now(),
      search_title: title || detail.title,
      vod_remarks: detail.vod_remarks,
    });
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
    if (showPanel || showEpisodes || showDetail || showDanmakuSettings)
      revealPanel();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [revealPanel, showDanmakuSettings, showDetail, showEpisodes, showPanel]);

  const updatePlaybackUrl = (target: SearchResult, index: number) => {
    const nextUrl = new URL(window.location.href);
    const previousParams = nextUrl.searchParams.toString();
    if (
      nextUrl.searchParams.get('source') !== target.source ||
      nextUrl.searchParams.get('id') !== target.id
    ) {
      nextUrl.searchParams.delete('fileName');
    }
    nextUrl.searchParams.set('source', target.source);
    nextUrl.searchParams.set('id', target.id);
    nextUrl.searchParams.set('title', title || target.title);
    const line = getActiveTVBoxBridgeLine(target)?.name;
    if (line) nextUrl.searchParams.set('line', line);
    else nextUrl.searchParams.delete('line');
    if (nextUrl.searchParams.has('index'))
      nextUrl.searchParams.set('index', String(index));
    const nextParams = nextUrl.searchParams.toString();
    if (nextParams === previousParams) return;
    manualPlaybackParamsRef.current = nextParams;
    // Next.js 会保留内部 history 状态，并把外部 URL 更新同步到 useSearchParams。
    window.history.replaceState(null, '', nextUrl.toString());
  };

  const switchLine = (name: string) => {
    if (!detail || activeBridgeLine?.name === name) return;
    const line = bridgeLines.find((item) => item.name === name);
    if (!line?.episodes.length) return;
    const nextDetail: SearchResult = {
      ...detail,
      activeLine: line.name,
      episodes: line.episodes,
      episodes_titles: line.episodes_titles,
      vod_total: line.episodes.length,
    };
    const targetIndex = resolveEpisodeIndexForLine(
      line.episodes.length,
      episodeIndex
    );
    const video = document.querySelector<HTMLVideoElement>(
      '[data-tv-player-root] video'
    );
    const currentTime = video?.currentTime || timeRef.current.current || 0;
    setStartTime(targetIndex === episodeIndex ? currentTime : 0);
    setEpisodeIndex(targetIndex);
    setEpisodePage(Math.floor(targetIndex / 30));
    setDetail(nextDetail);
    setSources((current) =>
      mergeTVBoxBridgePlaybackSources(current, nextDetail)
    );
    setPlayback(null);
    setError('');
    setPlaybackError(false);
    revealPanel();
    updatePlaybackUrl(nextDetail, targetIndex);
  };

  const switchSource = async (item: SearchResult) => {
    if (!detail) return;
    if (detail.source === item.source && detail.id === item.id) return;
    revealPanel();
    setShowEpisodes(false);
    setLoading(true);
    setIsBuffering(false);
    setError('');
    try {
      let next = item;
      if (
        !item.episodes?.length ||
        (isTVBoxBridgeSource(item.source) &&
          getTVBoxBridgeLines(item).length === 0)
      ) {
        next = await fetchTVSourceDetail({
          source: item.source,
          id: item.id,
          title: item.title,
        });
      }
      let record: PlayRecord | undefined;
      try {
        const records = await getAllPlayRecords();
        record = records[generateStorageKey(next.source, next.id)];
      } catch {
        // 读取播放记录失败时保留当前集数，避免切源失败。
      }
      next = await restoreTVBoxBridgePlaybackLine(
        next,
        null,
        async () => record?.line
      );
      const targetIndex = resolveEpisodeIndexForLine(
        next.episodes.length,
        record?.index ? record.index - 1 : episodeIndex
      );
      const targetStartTime =
        record?.index === targetIndex + 1 && record.play_time > 1
          ? record.play_time
          : 0;
      setDetail(next);
      setSources((current) => mergeTVBoxBridgePlaybackSources(current, next));
      setEpisodeIndex(targetIndex);
      setStartTime(targetStartTime);
      setEpisodePage(Math.floor(targetIndex / 30));
      updatePlaybackUrl(next, targetIndex);
    } catch (err) {
      setError(getTVErrorMessage(err, '切换播放源失败，请尝试其他源'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showDetail) {
      const raf = window.requestAnimationFrame(() =>
        detailCloseButtonRef.current?.focus({ preventScroll: true })
      );
      return () => window.cancelAnimationFrame(raf);
    }
  }, [showDetail]);

  useEffect(() => {
    if (showDanmakuSettings) {
      const raf = window.requestAnimationFrame(() =>
        danmakuFontSizeInputRef.current?.focus({ preventScroll: true })
      );
      return () => window.cancelAnimationFrame(raf);
    }
  }, [showDanmakuSettings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 虚拟遥控器会在多个目标派发同一个事件，每个按键只能处理一次。
      if (event.defaultPrevented) return;

      // 错误提示中的按钮继续接收方向键和确认键。
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-tv-player-alert]') &&
        (event.key.startsWith('Arrow') ||
          event.key === 'Enter' ||
          event.key === 'Tab')
      )
        return;

      if (
        (showEpisodes || showDetail || showDanmakuSettings) &&
        event.key === 'Escape'
      ) {
        event.preventDefault();
        closePlayerDialog();
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
        showEpisodes &&
        (event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        revealPanel();
        moveFocusWithinEpisodePanel(
          episodesPanelRef.current,
          event.key
            .replace('Arrow', '')
            .toLowerCase() as TVEpisodeFocusDirection,
          episodeIndex
        );
        return;
      }

      if (showEpisodes && event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        revealPanel();
        moveFocusWithinEpisodePanel(
          episodesPanelRef.current,
          event.shiftKey ? 'up' : 'down',
          episodeIndex
        );
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
        if (upDownAction === 'volume') {
          setVideoVolume(volume + (event.key === 'ArrowUp' ? 0.05 : -0.05));
        } else {
          revealPanel();
        }
        return;
      }

      if (showPanel || showEpisodes) {
        revealPanel();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (showPanel) {
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
    closePlayerDialog,
    detail?.episodes?.length,
    digitBuffer,
    episodeIndex,
    revealPanel,
    router,
    showDanmakuSettings,
    showDetail,
    showEpisodes,
    showPanel,
    upDownAction,
    volume,
  ]);

  useEffect(() => {
    if (!showEpisodes) return;
    const targetPage = Math.floor(episodeIndex / 30);
    setEpisodePage(targetPage);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const raf = window.requestAnimationFrame(() => {
      focusEpisodePanelElement(episodeButtonRefs.current[episodeIndex]);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [episodeIndex, showEpisodes]);

  useEffect(() => {
    if (!showEpisodes) return;

    let raf = window.requestAnimationFrame(() => {
      focusEpisodePanelInitial(episodesPanelRef.current, episodeIndex);
    });

    const keepFocusInsideEpisodesPanel = (event: Event) => {
      const panel = episodesPanelRef.current;
      const target = event.target;
      if (!panel || (target instanceof Node && panel.contains(target))) return;

      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        focusEpisodePanelInitial(episodesPanelRef.current, episodeIndex);
      });
    };

    document.addEventListener('focusin', keepFocusInsideEpisodesPanel, true);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      document.removeEventListener(
        'focusin',
        keepFocusInsideEpisodesPanel,
        true
      );
    };
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
      <main className='fixed inset-0 flex items-center justify-center bg-black text-xl text-[#ededed]'>
        <Loader2
          strokeWidth={1.5}
          aria-hidden='true'
          className='mr-4 h-[18px] w-[18px] animate-spin motion-reduce:animate-none text-[#a1a1a6]'
        />
        正在进入电视播放
      </main>
    );
  }

  if (!detail) {
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
          className='max-w-3xl rounded-2xl border border-rose-300/20 bg-[#19191b] p-6'
        >
          <AlertTriangle
            strokeWidth={1.5}
            aria-hidden='true'
            className='mx-auto mb-5 h-16 w-16 text-[#ededed]'
          />
          <h1 className='text-3xl font-medium text-[#ededed]'>
            {error || '播放信息不存在'}
          </h1>
          <div className='mt-8 flex justify-center gap-4'>
            <button
              autoFocus
              onClick={() => window.location.reload()}
              className='tv-focusable flex cursor-pointer items-center gap-3 rounded-lg bg-[#ededed] px-5 py-3 text-xl font-medium text-[#141415] outline-none hover:bg-white'
            >
              <RotateCcw
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
              重试
            </button>
            <button
              onClick={() => router.back()}
              className='tv-focusable rounded-lg bg-[#232325] px-5 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
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
      className='fixed inset-0 overflow-hidden bg-black text-[#ededed]'
    >
      {videoUrl ? (
        <TVNativeVideo
          key={`${videoUrl}-${retryNonce}`}
          url={videoUrl}
          sourceType={playback?.sourceType}
          live={playback?.live}
          poster={detail.poster}
          title={detail.title}
          onTime={onTime}
          command={toggleCommand}
          startTime={startTime}
          onError={() => {
            setPlaybackError(true);
            setShowEpisodes(false);
            setShowDanmakuSettings(false);
            setShowDetail(false);
          }}
          onPlayingChange={setIsPlaying}
          onBufferingChange={setIsBuffering}
          adFilterEnabled={adFilterEnabled}
          playbackRate={playbackRate}
        />
      ) : (
        <div className='flex h-full w-full items-center justify-center text-xl text-[#ededed]'>
          <Loader2
            strokeWidth={1.5}
            aria-hidden='true'
            className='mr-4 h-[18px] w-[18px] animate-spin motion-reduce:animate-none text-[#a1a1a6]'
          />
          {resolving ? '正在解析播放地址' : '准备播放'}
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

      {(playbackError || error) && !resolving && (
        <div
          role='alert'
          data-tv-player-alert
          data-tv-focus-scope='active'
          className='absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-8 text-[#ededed]'
        >
          <section className='max-w-3xl rounded-2xl border border-white/[0.08] bg-[#19191b] p-8 text-center'>
            <AlertTriangle
              strokeWidth={1.5}
              aria-hidden='true'
              className='mx-auto mb-5 h-14 w-14 text-[#ededed]'
            />
            <h2 className='text-3xl font-medium'>当前视频加载失败</h2>
            <p className='mt-3 text-xl leading-8 text-[#a1a1a6]'>
              {error ||
                '可以重试当前地址，或打开选集与线路面板切换播放源或线路。'}
            </p>
            <div className='mt-8 flex justify-center gap-4'>
              <button
                autoFocus
                onClick={() => {
                  setPlaybackError(false);
                  setError('');
                  setStartTime(timeRef.current.current);
                  setRetryNonce((v) => v + 1);
                }}
                className='tv-focusable flex cursor-pointer items-center gap-3 rounded-lg bg-[#303033] px-5 py-3 text-xl font-medium outline-none'
              >
                <RotateCcw
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px]'
                />
                重试
              </button>
              <button
                onClick={(event) => {
                  setPlaybackError(false);
                  setError('');
                  openPlayerDialog('episodes', event.currentTarget);
                }}
                className='tv-focusable flex cursor-pointer items-center gap-3 rounded-lg bg-[#232325] px-5 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
              >
                <ListVideo
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px]'
                />
                换源/线路/选集
              </button>
            </div>
          </section>
        </div>
      )}

      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          showPanel ? 'opacity-100' : 'invisible pointer-events-none opacity-0'
        }`}
      >
        <div className='absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/90 to-transparent' />
        <div className='absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/95 to-transparent' />
      </div>

      <div
        className={`absolute left-6 right-6 top-6 flex justify-end lg:left-8 lg:right-8 lg:top-8 transition-opacity duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          showPanel ? 'opacity-100' : 'invisible pointer-events-none opacity-0'
        }`}
      >
        <div className='min-w-0 rounded-2xl bg-[#19191b]/95 px-4 py-3 text-right'>
          <div className='max-w-[60vw] truncate text-2xl font-medium'>
            {detail.title}
          </div>
          <div className='mt-1 max-w-[60vw] truncate text-lg text-[#a1a1a6]'>
            {episodeTitle} · {detail.source_name}
          </div>
        </div>
      </div>

      <div
        data-tv-player-control
        className={`absolute bottom-6 left-6 right-6 lg:left-8 lg:right-8 transition-opacity duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          showPanel ? 'opacity-100' : 'invisible pointer-events-none opacity-0'
        }`}
      >
        <div className='rounded-2xl border border-white/[0.08] bg-[#19191b]/95 p-2'>
          <div
            onFocusCapture={scrollFocusedControlIntoView}
            className='flex items-center gap-2 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_button]:shrink-0 [&_button]:whitespace-nowrap'
          >
            <button
              onClick={() => switchEpisode(episodeIndex - 1)}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
            >
              <SkipBack
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
              上一集
            </button>
            <button
              ref={playPauseButtonRef}
              onClick={() => setToggleCommand((value) => value + 1)}
              data-tv-player-control
              className='tv-focusable tv-focusable-light flex min-h-14 cursor-pointer items-center gap-2 rounded-lg bg-[#ededed] px-5 py-3 text-xl font-medium text-[#141415] outline-none hover:bg-white'
            >
              {isPlaying ? (
                <Pause
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px]'
                />
              ) : (
                <Play
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px] fill-current'
                />
              )}
              {isPlaying ? '暂停' : '播放'}
            </button>
            <button
              onClick={() => switchEpisode(episodeIndex + 1)}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
            >
              下一集
              <SkipForward
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
            </button>
            <button
              onClick={(event) =>
                openPlayerDialog('episodes', event.currentTarget)
              }
              data-tv-player-dialog-trigger='episodes'
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
            >
              <ListVideo
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
              选集
            </button>
            <button
              aria-pressed={favorited}
              onClick={toggleFavorite}
              data-tv-player-control
              className={`tv-focusable flex cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-xl font-medium outline-none ${
                favorited ? 'bg-[#303033]' : 'bg-[#232325]'
              }`}
            >
              <Heart
                strokeWidth={1.5}
                aria-hidden='true'
                className={`h-[18px] w-[18px] ${
                  favorited ? 'fill-current' : ''
                }`}
              />
              收藏
            </button>
            <button
              onClick={(event) =>
                openPlayerDialog('detail', event.currentTarget)
              }
              data-tv-player-dialog-trigger='detail'
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
            >
              <Info
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
              详情
            </button>
            <button
              aria-pressed={danmakuEnabled}
              onClick={() => setDanmakuEnabled((v) => !v)}
              data-tv-player-control
              className={`tv-focusable flex cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-xl font-medium outline-none ${
                danmakuEnabled ? 'bg-[#303033]' : 'bg-[#232325]'
              }`}
            >
              <MessageCircle
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
              弹幕
            </button>
            <button
              onClick={(event) =>
                openPlayerDialog('danmaku', event.currentTarget)
              }
              data-tv-player-dialog-trigger='danmaku'
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
            >
              <SlidersHorizontal
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
              弹幕设置
            </button>
            <button
              aria-pressed={adFilterEnabled}
              onClick={() => setAdFilterEnabled((v) => !v)}
              data-tv-player-control
              className={`tv-focusable flex cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-xl font-medium outline-none ${
                adFilterEnabled ? 'bg-[#303033]' : 'bg-[#232325]'
              }`}
            >
              <ShieldOff
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
              去广告
            </button>
            <button
              onClick={cyclePlaybackRate}
              data-tv-player-control
              className='tv-focusable flex cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
            >
              {playbackRate}x
            </button>
            <button
              aria-label={muted ? '取消静音' : '静音'}
              aria-pressed={muted}
              onClick={toggleMute}
              data-tv-player-control
              className='tv-focusable h-14 w-14 rounded-lg bg-[#232325] p-4 outline-none hover:bg-[#303033]'
              title='静音'
            >
              {muted ? (
                <VolumeX
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px]'
                />
              ) : (
                <Volume2
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px]'
                />
              )}
            </button>
            <button
              aria-label='全屏'
              onClick={toggleFullscreen}
              data-tv-player-control
              className='tv-focusable h-14 w-14 rounded-lg bg-[#232325] p-4 outline-none hover:bg-[#303033]'
            >
              <Maximize
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
            </button>
            <span className='shrink-0 whitespace-nowrap px-2 text-lg tabular-nums text-[#a1a1a6]'>
              {formatTVTime(time.current)} / {formatTVTime(time.duration)}
            </span>
          </div>
        </div>
        <div className='mt-3 rounded-2xl bg-[#19191b]/95 p-4'>
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
            className='h-6 w-full cursor-pointer accent-[#ededed]'
          />
          <div className='mt-1 flex items-center justify-between text-lg tabular-nums text-[#a1a1a6]'>
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
        <aside
          ref={episodesPanelRef}
          data-tv-episode-panel
          data-tv-focus-scope='active'
          role='dialog'
          aria-modal='true'
          aria-label='选集与线路'
          className='absolute inset-y-6 right-6 z-20 w-[min(640px,calc(100vw-48px))] overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:right-8'
        >
          <div className='mb-5 flex items-center justify-between gap-3'>
            <h2 className='text-2xl font-medium'>选集与线路</h2>
            <button
              type='button'
              aria-label='关闭选集'
              data-tv-player-control
              data-tv-episode-focus-group='close'
              onClick={closePlayerDialog}
              className='tv-focusable flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#232325] outline-none hover:bg-[#303033]'
            >
              <X
                strokeWidth={1.5}
                aria-hidden='true'
                className='h-[18px] w-[18px]'
              />
            </button>
          </div>
          <div className='mb-6'>
            <div className='mb-2 text-xl font-medium text-[#a1a1a6]'>
              播放源
            </div>
            <div className='-mx-2 flex gap-3 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none]'>
              {sources.length > 0 ? (
                sources.map((item) => (
                  <button
                    key={`${item.source}-${item.id}`}
                    onClick={() => switchSource(item)}
                    data-tv-player-control
                    aria-pressed={
                      detail.source === item.source && detail.id === item.id
                    }
                    title={item.source_name || item.source}
                    data-tv-episode-focus-group='sources'
                    className={`tv-focusable min-h-14 max-w-[calc(100vw-112px)] shrink-0 cursor-pointer truncate rounded-lg px-4 py-3 lg:max-w-80 text-xl font-medium outline-none hover:bg-[#303033] ${
                      detail.source === item.source && detail.id === item.id
                        ? 'bg-[#303033]'
                        : 'bg-[#232325]'
                    }`}
                  >
                    {item.source_name || item.source}
                  </button>
                ))
              ) : (
                <span className='text-xl text-[#8d8d93]'>暂无其他播放源</span>
              )}
            </div>
          </div>
          {bridgeLines.length > 0 && (
            <div className='mb-6'>
              <div className='mb-2 text-xl font-medium text-[#a1a1a6]'>
                播放线路
              </div>
              <div className='-mx-2 flex gap-3 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none]'>
                {bridgeLines.map((line, index) => (
                  <button
                    key={`${line.name}-${index}`}
                    onClick={() => switchLine(line.name)}
                    disabled={line.episodes.length === 0}
                    aria-pressed={activeBridgeLine?.name === line.name}
                    data-tv-player-control
                    title={line.name}
                    data-tv-episode-focus-group='lines'
                    className={`tv-focusable min-h-14 max-w-[calc(100vw-112px)] shrink-0 cursor-pointer truncate rounded-lg px-4 py-3 lg:max-w-80 text-xl font-medium outline-none hover:bg-[#303033] disabled:cursor-default disabled:opacity-40 ${
                      activeBridgeLine?.name === line.name
                        ? 'bg-[#303033]'
                        : 'bg-[#232325]'
                    }`}
                  >
                    {line.name} · {line.episodes.length} 集
                  </button>
                ))}
              </div>
            </div>
          )}
          {episodePages > 1 && (
            <div className='-mx-2 mb-5 flex gap-3 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none]'>
              {Array.from({ length: episodePages }, (_, page) => (
                <button
                  key={page}
                  onClick={() => setEpisodePage(page)}
                  data-tv-player-control
                  aria-pressed={page === episodePage}
                  data-tv-episode-focus-group='pages'
                  className={`tv-focusable min-h-14 max-w-[calc(100vw-112px)] shrink-0 cursor-pointer truncate rounded-lg px-4 py-3 lg:max-w-80 text-xl font-medium outline-none hover:bg-[#303033] ${
                    page === episodePage ? 'bg-[#303033]' : 'bg-[#232325]'
                  }`}
                >
                  {page * 30 + 1}-
                  {Math.min((page + 1) * 30, detail.episodes.length)}
                </button>
              ))}
            </div>
          )}
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
            {visibleEpisodeIndexes.map((index) => (
              <button
                key={index}
                ref={(el) => {
                  episodeButtonRefs.current[index] = el;
                }}
                onClick={() => switchEpisode(index)}
                data-tv-player-control
                data-tv-episode-focus-group='episodes'
                aria-pressed={index === episodeIndex}
                data-tv-episode-index={index}
                className={`tv-focusable min-h-14 min-w-0 cursor-pointer break-words rounded-lg px-3 py-3 text-lg font-medium outline-none hover:bg-[#303033] ${
                  index === episodeIndex ? 'bg-[#303033]' : 'bg-[#232325]'
                }`}
              >
                {detail.episodes_titles?.[index] || `第 ${index + 1} 集`}
              </button>
            ))}
          </div>
        </aside>
      )}
      {showDanmakuSettings && (
        <div className='absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6'>
          <section
            data-tv-player-control
            data-tv-focus-scope='active'
            data-tv-danmaku-settings
            role='dialog'
            aria-modal='true'
            aria-label='弹幕设置'
            className='max-h-[calc(100dvh-48px)] w-[720px] max-w-full overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#19191b] p-7 text-[#ededed]'
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
            <div className='mb-6 flex items-center justify-between gap-4'>
              <h2 className='flex items-center gap-3 text-2xl font-medium'>
                <SlidersHorizontal
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px] text-[#a1a1a6]'
                />
                弹幕设置
              </h2>
              <button
                onClick={closePlayerDialog}
                data-tv-player-control
                className='tv-focusable flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
              >
                <X
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px]'
                />
                关闭
              </button>
            </div>

            <div className='space-y-6'>
              <label className='block'>
                <div className='mb-3 flex items-center justify-between text-xl font-medium'>
                  <span>字号</span>
                  <span className='text-[#ededed]'>
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
                  className='tv-focusable h-6 w-full cursor-pointer accent-[#ededed] outline-none'
                />
              </label>

              <label className='block'>
                <div className='mb-3 flex items-center justify-between text-xl font-medium'>
                  <span>显示区域</span>
                  <span className='text-[#ededed]'>
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
                  className='tv-focusable h-6 w-full cursor-pointer accent-[#ededed] outline-none'
                />
              </label>

              <label className='block'>
                <div className='mb-3 flex items-center justify-between text-xl font-medium'>
                  <span>不透明度</span>
                  <span className='text-[#ededed]'>
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
                  className='tv-focusable h-6 w-full cursor-pointer accent-[#ededed] outline-none'
                />
              </label>
            </div>
          </section>
        </div>
      )}
      {showDetail && (
        <div className='absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6'>
          <section
            data-tv-player-control
            data-tv-focus-scope='active'
            role='dialog'
            aria-modal='true'
            aria-label='视频详情'
            className='max-h-[calc(100dvh-48px)] w-[980px] max-w-full overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#19191b] p-8 text-[#ededed]'
          >
            <div className='mb-6 flex items-start justify-between gap-4'>
              <div className='min-w-0'>
                <h2 className='break-words text-3xl font-medium'>
                  {detail.title}
                </h2>
                <div className='mt-4 flex flex-wrap gap-3 text-xl font-medium text-[#a1a1a6]'>
                  <span className='text-[#a1a1a6]'>
                    {detail.source_name || detail.source}
                  </span>
                  {detail.year && (
                    <span className='text-[#a1a1a6]'>{detail.year}</span>
                  )}
                  {detail.type_name && (
                    <span className='text-[#a1a1a6]'>{detail.type_name}</span>
                  )}
                  {detail.vod_remarks && (
                    <span className='text-[#a1a1a6]'>{detail.vod_remarks}</span>
                  )}
                  <span className='text-[#a1a1a6]'>{episodeTitle}</span>
                </div>
              </div>
              <button
                ref={detailCloseButtonRef}
                onClick={closePlayerDialog}
                data-tv-player-control
                className='tv-focusable flex shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-[#232325] px-4 py-3 text-xl font-medium outline-none hover:bg-[#303033]'
              >
                <X
                  strokeWidth={1.5}
                  aria-hidden='true'
                  className='h-[18px] w-[18px]'
                />
                关闭
              </button>
            </div>
            {detail.poster && (
              <img
                src={detail.poster}
                alt=''
                className='mb-4 w-32 rounded-lg object-cover sm:float-left sm:mr-6 sm:w-48'
              />
            )}
            <p className='whitespace-pre-line break-words text-xl leading-8 text-[#a1a1a6]'>
              {detail.desc || '暂无详情简介'}
            </p>
          </section>
        </div>
      )}
      {digitBuffer && (
        <div className='absolute right-6 top-24 rounded-2xl bg-[#19191b]/95 px-6 py-4 text-4xl font-medium text-[#ededed]'>
          第 {digitBuffer} 集
        </div>
      )}
      {showVolumeHint && !showPanel && !showEpisodes && (
        <div className='absolute right-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 rounded-2xl bg-[#19191b]/95 px-4 py-5 text-xl text-[#ededed]'>
          {muted || volume <= 0 ? (
            <VolumeX
              strokeWidth={1.5}
              aria-hidden='true'
              className='h-[18px] w-[18px]'
            />
          ) : (
            <Volume2
              strokeWidth={1.5}
              aria-hidden='true'
              className='h-[18px] w-[18px]'
            />
          )}
          <div className='relative h-40 w-2 overflow-hidden rounded-full bg-white/20'>
            <div
              className='absolute bottom-0 left-0 right-0 rounded-full bg-[#ededed]'
              style={{ height: `${Math.round((muted ? 0 : volume) * 100)}%` }}
            />
          </div>
          <div className='min-w-16 text-center'>
            {Math.round((muted ? 0 : volume) * 100)}
          </div>
        </div>
      )}
      {seekHint && !showPanel && !showEpisodes && (
        <div className='absolute bottom-16 left-1/2 w-[720px] max-w-[86vw] -translate-x-1/2 rounded-2xl bg-[#19191b]/95 px-8 py-6 text-[#ededed]'>
          <div className='mb-4 flex flex-wrap items-center justify-between gap-3 text-xl tabular-nums'>
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
              className='h-full rounded-full bg-[#ededed]'
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
