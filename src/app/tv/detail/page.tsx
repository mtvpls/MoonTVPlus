'use client';

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Gauge,
  Heart,
  Layers,
  Loader2,
  Play,
  Star,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { deleteFavorite, isFavorited, saveFavorite } from '@/lib/db.client';
import {
  fetchTVDetailMetadata,
  TVDetailMetadata,
} from '@/lib/tv-detail-metadata';
import { getTVSearchType, getTVSearchYear } from '@/lib/tv-search';
import {
  getActiveTVBoxBridgeLine,
  getTVBoxBridgeLines,
  isTVBoxBridgeSource,
} from '@/lib/tvbox-bridge.shared';
import type { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import {
  probeTVSource,
  TVSourceProbeResult,
} from '@/components/tv/player/probe';
import {
  fetchTVDetail,
  fetchTVSourceDetail,
  getTVErrorMessage,
} from '@/components/tv/player/utils';
import TVLayout from '@/components/tv/TVLayout';

type SourceTestInfo = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  bitrate: string;
  score: number;
  weight: number;
  status: 'waiting' | 'testing' | 'ok' | 'unsupported' | 'fail';
  reason?: string;
  line?: string;
};

function parseSpeedKBps(speed: string) {
  const match = speed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2] === 'MB/s' ? value * 1024 : value;
}

function qualityScore(quality: string) {
  return (
    { '4K': 100, '2K': 85, '1080p': 75, '720p': 60, '480p': 40, SD: 20 }[
      quality
    ] || 0
  );
}

function sourceKey(item: Pick<SearchResult, 'source' | 'id'>) {
  return item.source + '-' + item.id;
}

function sourceStatusRank(info?: SourceTestInfo) {
  if (info?.status === 'ok') return 0;
  if (info?.status === 'unsupported') return 2;
  if (info?.status === 'fail') return 3;
  return 1;
}

function sortSourcesByTests(
  sourceList: SearchResult[],
  testMap: Record<string, SourceTestInfo>
) {
  return [...sourceList].sort((a, b) => {
    const infoA = testMap[sourceKey(a)];
    const infoB = testMap[sourceKey(b)];
    const rankA = sourceStatusRank(infoA);
    const rankB = sourceStatusRank(infoB);
    if (rankA !== rankB) return rankA - rankB;
    if (
      infoA?.status === 'ok' &&
      infoB?.status === 'ok' &&
      infoA.score !== infoB.score
    ) {
      return infoB.score - infoA.score;
    }
    return (b.weight ?? 0) - (a.weight ?? 0);
  });
}

function scoreSourceTests(tests: Record<string, SourceTestInfo>) {
  const completed = Object.values(tests).filter((info) => info.status === 'ok');
  const maxSpeed = Math.max(
    ...completed.map((info) => parseSpeedKBps(info.loadSpeed)),
    1
  );
  const pings = completed
    .map((info) => info.pingTime)
    .filter((ping) => ping > 0);
  const minPing = pings.length ? Math.min(...pings) : 0;
  const maxPing = pings.length ? Math.max(...pings) : 0;
  return Object.fromEntries(
    Object.entries(tests).map(([key, info]) => {
      if (info.status !== 'ok') return [key, info];
      const speed = parseSpeedKBps(info.loadSpeed);
      const speedScore =
        speed > 0 ? Math.min(100, (speed / maxSpeed) * 100) : 30;
      const pingScore =
        info.pingTime <= 0
          ? 0
          : maxPing === minPing
          ? 100
          : Math.max(
              0,
              ((maxPing - info.pingTime) / (maxPing - minPing)) * 100
            );
      return [
        key,
        {
          ...info,
          score:
            qualityScore(info.quality) * 0.4 +
            speedScore * 0.4 +
            pingScore * 0.2 +
            info.weight,
        },
      ];
    })
  );
}

function testLabel(info?: SourceTestInfo) {
  if (!info || info.status === 'waiting') return '等待测速';
  if (info.status === 'testing') return '测速中...';
  if (info.status === 'unsupported' || info.status === 'fail')
    return '测速失败';
  if (parseSpeedKBps(info.loadSpeed) > 0)
    return info.quality + ' · ' + info.loadSpeed;
  return info.quality === '未知' ? '已验证播放' : info.quality + ' · 可播放';
}

function SourceArtwork({
  poster,
  fallback,
}: {
  poster?: string;
  fallback?: string;
}) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const url = [poster, fallback].find(
    (candidate) => candidate && !failedImages.includes(candidate)
  );
  return url ? (
    <Image
      src={url}
      alt=''
      fill
      unoptimized
      sizes='(min-width: 1536px) 224px, (min-width: 768px) 192px, 144px'
      className='object-cover'
      onError={() => setFailedImages((current) => [...current, url])}
    />
  ) : (
    <div className='absolute inset-0 flex items-center justify-center bg-neutral-900'>
      <Film className='h-12 w-12 text-white/20' aria-hidden='true' />
    </div>
  );
}

function TVDetailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testingSources, setTestingSources] = useState(false);
  const [sourceTests, setSourceTests] = useState<
    Record<string, SourceTestInfo>
  >({});
  const [metadata, setMetadata] = useState<TVDetailMetadata | null>(null);
  const [failedArtwork, setFailedArtwork] = useState<string[]>([]);
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(
    null
  );
  const [expandedSourceKey, setExpandedSourceKey] = useState<string | null>(
    null
  );
  const [loadingLinesKey, setLoadingLinesKey] = useState<string | null>(null);
  const [lineError, setLineError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(true);
  const [favoriteError, setFavoriteError] = useState('');
  const testedSourcesSignatureRef = useRef('');
  const sourceTestsRef = useRef<Record<string, SourceTestInfo>>({});
  const generationRef = useRef(0);
  const testRunRef = useRef(0);
  const testingRef = useRef(false);
  const detailRequestsRef = useRef(new Map<string, Promise<SearchResult>>());
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const sourceButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const favoriteKeyRef = useRef('');

  const source = searchParams.get('source');
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  const fileName = searchParams.get('fileName');
  const line = searchParams.get('line');
  const year = searchParams.get('year');
  const stype = searchParams.get('stype');
  const searchQuery = searchParams.get('q');

  useEffect(() => {
    const generation = ++generationRef.current;
    testRunRef.current += 1;
    testingRef.current = false;
    testedSourcesSignatureRef.current = '';
    sourceTestsRef.current = {};
    detailRequestsRef.current.clear();
    setLoading(true);
    setError('');
    setDetail(null);
    setSources([]);
    setSourceTests({});
    setTestingSources(false);
    setSelectedSourceKey(null);
    setExpandedSourceKey(null);
    setLoadingLinesKey(null);
    setLineError(null);
    fetchTVDetail({
      source,
      id,
      title,
      fileName,
      line,
      year,
      stype,
      searchQuery,
    })
      .then((data) => {
        if (generation !== generationRef.current) return;
        setDetail(data.detail);
        setSources(data.sources);
      })
      .catch((err) => {
        if (generation !== generationRef.current) return;
        setError(getTVErrorMessage(err, '加载详情失败，请稍后重试'));
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false);
      });
    return () => {
      generationRef.current += 1;
      testRunRef.current += 1;
    };
  }, [source, id, title, fileName, line, year, stype, searchQuery]);

  // 使用影片标题作为稳定身份，补线路和测速不会重新请求 TMDB。
  const metadataTitle = title?.trim() || detail?.title.trim() || '';
  useEffect(() => {
    let alive = true;
    setMetadata(null);
    setFailedArtwork([]);
    fetchTVDetailMetadata(metadataTitle).then((result) => {
      if (alive) setMetadata(result);
    });
    return () => {
      alive = false;
    };
  }, [metadataTitle]);

  const rankedSources = useMemo(
    () => sortSourcesByTests(sources, sourceTests),
    [sourceTests, sources]
  );
  const playbackSource =
    rankedSources.find((item) => sourceKey(item) === selectedSourceKey) ||
    rankedSources[0] ||
    detail;
  const expandedSource = sources.find(
    (item) => sourceKey(item) === expandedSourceKey
  );
  const favoriteSource = playbackSource?.source;
  const favoriteId = playbackSource?.id;
  favoriteKeyRef.current = playbackSource ? sourceKey(playbackSource) : '';

  useEffect(() => {
    let alive = true;
    setFavorited(false);
    setFavoriteError('');
    if (!favoriteSource || !favoriteId) return;
    setFavoriteBusy(true);
    isFavorited(favoriteSource, favoriteId)
      .then((value) => {
        if (alive) setFavorited(value);
      })
      .catch(() => {
        if (alive) setFavoriteError('读取收藏状态失败');
      })
      .finally(() => {
        if (alive) setFavoriteBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [favoriteSource, favoriteId]);

  const detailId = detail?.id;
  useEffect(() => {
    if (loading || !detailId) return;
    const frame = window.requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        playButtonRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, detailId]);

  const play = (
    target = playbackSource,
    episode?: number,
    selectedLine?: string
  ) => {
    if (!target) return;
    const qs = new URLSearchParams({
      source: target.source,
      id: target.id,
      title: target.title,
      year: year || getTVSearchYear(target),
      stype: stype || getTVSearchType(target),
    });
    if (searchQuery) qs.set('q', searchQuery);
    if (typeof episode === 'number') qs.set('index', String(episode));
    const targetLine =
      selectedLine ||
      target.activeLine ||
      (target.source === source && target.id === id ? line : null);
    if (targetLine) qs.set('line', targetLine);
    if (fileName && target.source === source && target.id === id)
      qs.set('fileName', fileName);
    router.push('/tv/play?' + qs.toString());
  };

  const fetchPlayableSource = useCallback(async (item: SearchResult) => {
    if (
      isTVBoxBridgeSource(item.source)
        ? getTVBoxBridgeLines(item).length > 0
        : item.episodes?.length
    )
      return item;

    const key = sourceKey(item);
    const pending = detailRequestsRef.current.get(key);
    if (pending) return pending;
    const generation = generationRef.current;
    const request = fetchTVSourceDetail({
      source: item.source,
      id: item.id,
      title: item.title,
      line: item.activeLine,
    })
      .then((data) => {
        const playable = { ...item, ...data };
        if (generation === generationRef.current) {
          // 先保留线路元数据，测速失败不会把线路一起清空。
          setSources((current) =>
            current.map((candidate) =>
              sourceKey(candidate) === key ? playable : candidate
            )
          );
          setDetail((current) =>
            current && sourceKey(current) === key ? playable : current
          );
        }
        return playable;
      })
      .finally(() => {
        if (detailRequestsRef.current.get(key) === request)
          detailRequestsRef.current.delete(key);
      });
    detailRequestsRef.current.set(key, request);
    return request;
  }, []);

  const testSource = useCallback(
    async (item: SearchResult): Promise<TVSourceProbeResult> => {
      let playable = item;
      try {
        playable = await fetchPlayableSource(item);
        return await probeTVSource(playable);
      } catch (err) {
        return {
          item: playable,
          status: 'fail',
          reason: err instanceof Error ? err.message : '获取源详情失败',
        };
      }
    },
    [fetchPlayableSource]
  );

  const updateSourceTest = useCallback((outcome: TVSourceProbeResult) => {
    const { item } = outcome;
    const info: SourceTestInfo = {
      ...(outcome.status === 'ok'
        ? outcome.result
        : {
            quality: '未知',
            loadSpeed: '未知',
            pingTime: 0,
            bitrate: '未知',
            reason: getTVErrorMessage(
              outcome.reason,
              '该线路测速失败，请尝试其他线路'
            ),
          }),
      score: 0,
      weight: item.weight ?? 0,
      status: outcome.status,
      line: outcome.line,
    };
    const nextTests = scoreSourceTests({
      ...sourceTestsRef.current,
      [sourceKey(item)]: info,
    });
    sourceTestsRef.current = nextTests;
    setSourceTests(nextTests);
    setSources((current) =>
      current.map((candidate) =>
        sourceKey(candidate) === sourceKey(item) ? item : candidate
      )
    );
    setDetail((current) =>
      current && sourceKey(current) === sourceKey(item) ? item : current
    );
  }, []);

  const testAllSources = useCallback(
    async (candidates: SearchResult[]) => {
      if (!candidates.length || testingRef.current) return;
      const run = ++testRunRef.current;
      testingRef.current = true;
      setTestingSources(true);
      const initialTests = Object.fromEntries(
        candidates.map((item) => [
          sourceKey(item),
          {
            quality: '未知',
            loadSpeed: '未知',
            pingTime: 0,
            bitrate: '未知',
            score: 0,
            weight: item.weight ?? 0,
            status: 'waiting' as const,
          },
        ])
      );
      sourceTestsRef.current = initialTests;
      setSourceTests(initialTests);
      let nextIndex = 0;
      const worker = async () => {
        while (run === testRunRef.current && nextIndex < candidates.length) {
          const item = candidates[nextIndex++];
          const key = sourceKey(item);
          const nextTests: Record<string, SourceTestInfo> = {
            ...sourceTestsRef.current,
            [key]: { ...sourceTestsRef.current[key], status: 'testing' },
          };
          sourceTestsRef.current = nextTests;
          setSourceTests(nextTests);
          const outcome = await testSource(item);
          if (run !== testRunRef.current) return;
          updateSourceTest(outcome);
        }
      };
      try {
        await Promise.all(
          Array.from({ length: Math.min(candidates.length, 4) }, () => worker())
        );
      } finally {
        if (run === testRunRef.current) {
          testingRef.current = false;
          setTestingSources(false);
        }
      }
    },
    [testSource, updateSourceTest]
  );

  useEffect(() => {
    if (loading || !sources.length) return;
    const signature = Array.from(new Set(sources.map(sourceKey)))
      .sort()
      .join('|');
    if (!signature || testedSourcesSignatureRef.current === signature) return;
    testedSourcesSignatureRef.current = signature;
    void testAllSources(sources);
  }, [loading, sources, testAllSources]);

  const selectSource = async (item: SearchResult) => {
    if (!isTVBoxBridgeSource(item.source)) {
      play(item);
      return;
    }
    const key = sourceKey(item);
    setSelectedSourceKey(key);
    if (expandedSourceKey === key) {
      setExpandedSourceKey(null);
      return;
    }
    setExpandedSourceKey(key);
    setLineError(null);
    if (getTVBoxBridgeLines(item).length) return;
    const generation = generationRef.current;
    setLoadingLinesKey(key);
    try {
      await fetchPlayableSource(item);
    } catch (err) {
      if (generation === generationRef.current)
        setLineError({
          key,
          message: getTVErrorMessage(err, '加载线路失败，请稍后重试'),
        });
    } finally {
      if (generation === generationRef.current)
        setLoadingLinesKey((current) => (current === key ? null : current));
    }
  };

  const toggleFavorite = async () => {
    if (!playbackSource || favoriteBusy) return;
    setFavoriteBusy(true);
    setFavoriteError('');
    const generation = generationRef.current;
    const key = sourceKey(playbackSource);
    const stillCurrent = () =>
      generation === generationRef.current && favoriteKeyRef.current === key;
    try {
      if (favorited) {
        await deleteFavorite(playbackSource.source, playbackSource.id);
      } else {
        await saveFavorite(playbackSource.source, playbackSource.id, {
          title: detail?.title || playbackSource.title,
          source_name: playbackSource.source_name || playbackSource.source,
          year:
            getTVSearchYear(playbackSource) ||
            metadata?.releaseDate?.slice(0, 4) ||
            '',
          cover: playbackSource.poster || metadata?.poster || '',
          total_episodes: playbackSource.episodes?.length || 1,
          save_time: Date.now(),
          search_title: searchQuery || title || playbackSource.title,
          vod_remarks: playbackSource.vod_remarks,
        });
      }
      if (stillCurrent()) setFavorited(!favorited);
    } catch {
      if (stillCurrent()) setFavoriteError('保存收藏失败，请重试');
    } finally {
      if (stillCurrent()) setFavoriteBusy(false);
    }
  };

  const artworkCandidates = [
    metadata?.backdrop,
    metadata?.poster,
    detail?.poster,
  ]
    .filter((url): url is string => Boolean(url))
    .map(processImageUrl);
  const artwork = artworkCandidates.find((url) => !failedArtwork.includes(url));
  const hasBackdrop = Boolean(
    metadata?.backdrop && artwork === processImageUrl(metadata.backdrop)
  );
  const fallbackPoster = metadata?.poster
    ? processImageUrl(metadata.poster)
    : detail?.poster
    ? processImageUrl(detail.poster)
    : '';
  const overview = (metadata?.overview || detail?.desc || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const genres = metadata?.genres?.length
    ? metadata.genres.map((genre) => genre.name).join('  ')
    : detail?.type_name || '';
  const releaseDate =
    metadata?.releaseDate || getTVSearchYear(detail || { year: year || '' });
  const episodes = playbackSource?.episodes || [];
  const episodeTitles = playbackSource?.episodes_titles || [];
  const expandedLines = expandedSource
    ? getTVBoxBridgeLines(expandedSource)
    : [];
  const activeLine = expandedSource
    ? getActiveTVBoxBridgeLine(expandedSource)
    : undefined;
  const expandedTest = expandedSourceKey
    ? sourceTests[expandedSourceKey]
    : undefined;
  const successfulCount = Object.values(sourceTests).filter(
    (info) => info.status === 'ok'
  ).length;
  const hasStartedTesting = Object.keys(sourceTests).length > 0;

  return (
    <TVLayout showNav={false} fullBleed>
      <div className='relative min-h-screen bg-[#050505] pb-20'>
        <header className='absolute left-6 top-6 z-20 md:left-12 md:top-8 lg:left-[5.5vw]'>
          <button
            type='button'
            onClick={() => router.back()}
            onFocus={(event) =>
              event.currentTarget.scrollIntoView({
                block: 'start',
                inline: 'nearest',
                behavior: window.matchMedia?.(
                  '(prefers-reduced-motion: reduce)'
                ).matches
                  ? 'auto'
                  : 'smooth',
              })
            }
            className='tv-focusable flex cursor-pointer items-center gap-2 rounded-full bg-black/35 px-5 py-3 text-lg font-semibold text-white outline-none transition-colors hover:bg-white/15 md:text-xl'
          >
            <ArrowLeft className='h-6 w-6' aria-hidden='true' />
            返回
          </button>
        </header>
        <div
          className='pointer-events-none absolute inset-x-0 top-0 h-screen overflow-hidden'
          aria-hidden='true'
        >
          {artwork && (
            <Image
              src={artwork}
              alt=''
              fill
              unoptimized
              priority
              sizes='100vw'
              className={
                'object-cover object-top ' +
                (hasBackdrop ? '' : 'opacity-40 blur-sm')
              }
              onError={() =>
                setFailedArtwork((current) => [...current, artwork])
              }
              data-tv-detail-backdrop='true'
            />
          )}
          <div className='absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.32)_48%,rgba(0,0,0,0.05)_100%)]' />
          <div className='absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.15)_0%,rgba(5,5,5,0.05)_35%,rgba(5,5,5,0.35)_68%,#050505_100%)]' />
        </div>

        {loading ? (
          <div
            role='status'
            className='relative flex min-h-[88vh] items-center justify-center gap-4 text-2xl text-white/75 md:text-3xl'
          >
            <Loader2
              className='h-10 w-10 animate-spin motion-reduce:animate-none'
              aria-hidden='true'
            />
            正在加载详情...
          </div>
        ) : error || !detail ? (
          <div
            role='alert'
            className='relative flex min-h-[88vh] items-center justify-center px-8 text-2xl text-red-200 md:text-3xl'
          >
            {error || '详情不存在'}
          </div>
        ) : (
          <>
            <section className='relative flex min-h-[88vh] flex-col justify-end px-6 pb-12 pt-40 sm:px-12 md:pb-16 md:pt-[26vh] lg:px-[5.5vw]'>
              <div className='max-w-[62rem]'>
                <h1 className='break-words text-[clamp(2.5rem,5.5vw,6.25rem)] font-black leading-[1.15] tracking-wide text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.35)]'>
                  {detail.title}
                </h1>
                <div className='mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-lg font-medium text-white/90 md:text-2xl'>
                  {metadata?.rating && (
                    <span
                      className='flex items-center gap-2 font-bold text-rose-500'
                      aria-label={'TMDB 评分 ' + metadata.rating}
                    >
                      <Star
                        className='h-6 w-6 fill-current'
                        aria-hidden='true'
                      />
                      {metadata.rating}
                    </span>
                  )}
                  {genres && <span>{genres}</span>}
                </div>
                <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-white/55 md:text-xl'>
                  {releaseDate && <span>{releaseDate}</span>}
                  {detail.vod_remarks && <span>· {detail.vod_remarks}</span>}
                  {playbackSource && (
                    <span>
                      · {playbackSource.source_name || playbackSource.source}
                    </span>
                  )}
                </div>
                {overview && (
                  <p className='mt-7 line-clamp-4 max-w-[60rem] text-lg leading-relaxed text-white/75 md:text-xl 2xl:text-2xl'>
                    {overview}
                  </p>
                )}
                <div
                  className='mt-8 flex items-center gap-4'
                  data-tv-focus-row='horizontal'
                >
                  <button
                    ref={playButtonRef}
                    type='button'
                    onClick={() => play()}
                    className='tv-focusable tv-focusable-light flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-full bg-white px-8 py-4 text-2xl font-bold text-black outline-none transition-colors hover:bg-neutral-200 md:min-h-20 md:px-10 md:text-3xl'
                  >
                    <Play
                      className='h-7 w-7 fill-current md:h-8 md:w-8'
                      aria-hidden='true'
                    />
                    立即播放
                  </button>
                  <button
                    id='tv-detail-favorite'
                    type='button'
                    data-tv-focus-right={
                      sources.length ? '#tv-detail-retest' : undefined
                    }
                    onClick={() => void toggleFavorite()}
                    disabled={favoriteBusy}
                    aria-label={favorited ? '取消收藏' : '收藏'}
                    aria-pressed={favorited}
                    className='tv-focusable flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white outline-none transition-colors hover:bg-white/25 disabled:cursor-default disabled:opacity-50 md:h-20 md:w-20'
                  >
                    {favoriteBusy ? (
                      <Loader2
                        className='h-7 w-7 animate-spin motion-reduce:animate-none'
                        aria-hidden='true'
                      />
                    ) : (
                      <Heart
                        className={
                          'h-7 w-7 md:h-8 md:w-8 ' +
                          (favorited ? 'fill-rose-500 text-rose-500' : '')
                        }
                        aria-hidden='true'
                      />
                    )}
                  </button>
                </div>
                {favoriteError && (
                  <p role='status' className='mt-3 text-lg text-amber-200'>
                    {favoriteError}
                  </p>
                )}
              </div>
            </section>

            {sources.length > 0 && (
              <section
                className='relative pt-4'
                aria-labelledby='tv-detail-sources'
              >
                <div className='mb-3 flex flex-wrap items-center justify-between gap-3 px-6 sm:px-12 lg:px-[5.5vw]'>
                  <div className='flex items-baseline gap-4'>
                    <h2
                      id='tv-detail-sources'
                      className='text-2xl font-bold md:text-3xl'
                    >
                      播放源
                    </h2>
                    <span className='text-lg text-white/45'>
                      {sources.length} 个源
                    </span>
                  </div>
                  <div
                    className='flex max-w-full flex-wrap items-center gap-4'
                    data-tv-focus-row='horizontal'
                  >
                    <span
                      role='status'
                      className='flex items-center gap-2 text-base text-white/50 md:text-lg'
                    >
                      {testingSources && (
                        <Loader2
                          className='h-5 w-5 animate-spin motion-reduce:animate-none'
                          aria-hidden='true'
                        />
                      )}
                      {testingSources
                        ? '正在测速...'
                        : !hasStartedTesting
                        ? '准备测速...'
                        : '测速完成 · ' + successfulCount + ' 个源已验证'}
                    </span>
                    <button
                      id='tv-detail-retest'
                      type='button'
                      data-tv-focus-explicit='true'
                      data-tv-focus-left='#tv-detail-favorite'
                      onClick={() => {
                        if (!testingSources) void testAllSources(sources);
                      }}
                      aria-disabled={testingSources}
                      className='tv-focusable flex cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-base text-white/75 outline-none transition-colors hover:bg-white/20 aria-disabled:cursor-default aria-disabled:opacity-40 md:text-lg'
                    >
                      <Gauge className='h-5 w-5' aria-hidden='true' />
                      重新测速
                    </button>
                  </div>
                </div>
                <div
                  className='flex gap-5 overflow-x-auto overscroll-x-contain px-6 py-5 [scrollbar-width:none] sm:px-12 lg:px-[5.5vw] [&::-webkit-scrollbar]:hidden'
                  data-tv-focus-row='horizontal'
                >
                  {rankedSources.map((item, index) => {
                    const key = sourceKey(item);
                    const info = sourceTests[key];
                    const lines = getTVBoxBridgeLines(item);
                    const bridge = isTVBoxBridgeSource(item.source);
                    const expanded = expandedSourceKey === key;
                    const active =
                      playbackSource && sourceKey(playbackSource) === key;
                    const name = item.source_name || item.source;
                    return (
                      <button
                        key={key}
                        ref={(element) => {
                          if (element)
                            sourceButtonsRef.current.set(key, element);
                          else sourceButtonsRef.current.delete(key);
                        }}
                        type='button'
                        onClick={() => void selectSource(item)}
                        aria-label={'#' + (index + 1) + ' ' + name}
                        aria-expanded={bridge ? expanded : undefined}
                        aria-controls={
                          bridge
                            ? 'tv-lines-' + encodeURIComponent(key)
                            : undefined
                        }
                        className={
                          'tv-focusable w-36 shrink-0 cursor-pointer rounded-2xl border bg-neutral-900 text-left outline-none transition-colors hover:border-white/60 md:w-48 2xl:w-56 ' +
                          (active
                            ? 'border-white/80 ring-2 ring-white/80'
                            : 'border-white/15')
                        }
                      >
                        <div className='relative aspect-[2/3] overflow-hidden rounded-t-2xl'>
                          <SourceArtwork
                            poster={
                              item.poster
                                ? processImageUrl(item.poster)
                                : undefined
                            }
                            fallback={fallbackPoster}
                          />
                          <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/10' />
                          {active && (
                            <span className='absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white'>
                              <Check className='h-4 w-4' aria-hidden='true' />
                            </span>
                          )}
                          {lines.length > 0 && (
                            <span className='absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-base font-bold text-black'>
                              <Layers className='h-4 w-4' aria-hidden='true' />
                              {lines.length}
                            </span>
                          )}
                          <div className='absolute inset-x-0 bottom-0 p-3 md:p-4'>
                            <span className='block text-sm text-white/50'>
                              #{index + 1}
                            </span>
                            <span className='mt-1 line-clamp-2 text-lg font-bold text-white md:text-xl'>
                              {name}
                            </span>
                          </div>
                        </div>
                        <div className='px-3 py-3 md:px-4'>
                          <span
                            className={
                              'block truncate text-sm md:text-base ' +
                              (info?.status === 'ok'
                                ? 'text-emerald-300'
                                : info?.status === 'fail' ||
                                  info?.status === 'unsupported'
                                ? 'text-red-300'
                                : info?.status === 'testing'
                                ? 'text-amber-200'
                                : 'text-white/55')
                            }
                            title={info?.reason}
                          >
                            {testLabel(info)}
                          </span>
                          <span className='mt-2 flex items-center gap-1 text-sm text-white/70 md:text-base'>
                            {bridge ? (
                              <>
                                {expanded ? (
                                  <ChevronUp
                                    className='h-4 w-4'
                                    aria-hidden='true'
                                  />
                                ) : (
                                  <ChevronDown
                                    className='h-4 w-4'
                                    aria-hidden='true'
                                  />
                                )}
                                {expanded ? '收起线路' : '展开线路'}
                              </>
                            ) : (
                              <>
                                <Play className='h-4 w-4' aria-hidden='true' />
                                播放
                              </>
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {expandedSource && (
                  <div
                    className='mx-6 mt-2 rounded-3xl border border-white/10 bg-white/[0.06] p-5 sm:mx-12 md:p-6 lg:mx-[5.5vw]'
                    role='group'
                    aria-label={
                      (expandedSource.source_name || expandedSource.source) +
                      ' 的播放线路'
                    }
                    id={
                      'tv-lines-' +
                      encodeURIComponent(sourceKey(expandedSource))
                    }
                  >
                    <div className='mb-4 flex items-center justify-between gap-3'>
                      <h3 className='flex items-center gap-2 text-xl font-bold md:text-2xl'>
                        <Layers className='h-6 w-6' aria-hidden='true' />
                        {expandedSource.source_name || expandedSource.source} ·
                        播放线路
                      </h3>
                      <button
                        type='button'
                        onClick={() => {
                          setExpandedSourceKey(null);
                          if (expandedSourceKey)
                            sourceButtonsRef.current
                              .get(expandedSourceKey)
                              ?.focus({ preventScroll: true });
                        }}
                        className='tv-focusable flex cursor-pointer items-center gap-1 rounded-full bg-white/10 px-4 py-2 text-lg outline-none transition-colors hover:bg-white/20'
                      >
                        <ChevronUp className='h-5 w-5' aria-hidden='true' />
                        收起
                      </button>
                    </div>
                    {expandedTest?.reason && (
                      <p className='mb-4 text-base text-amber-200 md:text-lg'>
                        {testLabel(expandedTest)}：{expandedTest.reason}
                      </p>
                    )}
                    {loadingLinesKey === sourceKey(expandedSource) ? (
                      <p
                        role='status'
                        className='flex items-center gap-2 text-xl text-white/60'
                      >
                        <Loader2
                          className='h-6 w-6 animate-spin motion-reduce:animate-none'
                          aria-hidden='true'
                        />
                        正在加载线路...
                      </p>
                    ) : expandedLines.length ? (
                      <div
                        className='flex flex-wrap gap-3'
                        data-tv-focus-row='horizontal'
                      >
                        {expandedLines.map((bridgeLine, lineIndex) => (
                          <button
                            key={bridgeLine.name + '-' + lineIndex}
                            type='button'
                            disabled={bridgeLine.episodes.length === 0}
                            onClick={() =>
                              play(expandedSource, undefined, bridgeLine.name)
                            }
                            className={
                              'tv-focusable min-h-14 cursor-pointer rounded-xl px-5 py-3 text-lg font-semibold outline-none transition-colors hover:bg-white/20 disabled:cursor-default disabled:opacity-40 md:text-xl ' +
                              (activeLine?.name === bridgeLine.name
                                ? 'bg-white/20 text-white'
                                : 'bg-white/10 text-white/75')
                            }
                          >
                            {bridgeLine.name} · {bridgeLine.episodes.length} 集
                            {expandedTest?.status === 'ok' &&
                              expandedTest.line === bridgeLine.name && (
                                <span className='ml-3 text-base text-emerald-300'>
                                  可播放
                                </span>
                              )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p role='status' className='text-xl text-white/60'>
                        {lineError?.key === sourceKey(expandedSource)
                          ? lineError.message
                          : '该源暂未提供播放线路'}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            {episodes.length > 0 && (
              <section
                className='relative mt-10 px-6 sm:px-12 lg:px-[5.5vw]'
                aria-labelledby='tv-detail-episodes'
              >
                <div className='mb-5 flex flex-wrap items-baseline gap-4'>
                  <h2
                    id='tv-detail-episodes'
                    className='text-2xl font-bold md:text-3xl'
                  >
                    选集
                  </h2>
                  <span className='text-lg text-white/45'>
                    {playbackSource?.source_name || playbackSource?.source}
                    {playbackSource?.activeLine
                      ? ' · ' + playbackSource.activeLine
                      : ''}
                  </span>
                </div>
                <div className='grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8'>
                  {episodes.map((ep, index) => (
                    <button
                      key={ep + '-' + index}
                      type='button'
                      onClick={() => play(playbackSource, index)}
                      className='tv-focusable min-h-16 cursor-pointer rounded-xl bg-white/10 px-4 py-3 text-xl font-semibold text-white outline-none transition-colors hover:bg-white/20'
                    >
                      {episodeTitles[index] || '第 ' + (index + 1) + ' 集'}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </TVLayout>
  );
}

export default function TVDetailPage() {
  return (
    <Suspense fallback={null}>
      <TVDetailClient />
    </Suspense>
  );
}
