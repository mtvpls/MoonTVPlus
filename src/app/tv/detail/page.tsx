'use client';

import { ArrowLeft, Loader2, Play, Server } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';
import { SearchResult } from '@/lib/types';

import TVLayout from '@/components/tv/TVLayout';
import {
  fetchTVDetail,
  resolveTVEpisodeUrl,
} from '@/components/tv/player/utils';

type SourceTestInfo = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  bitrate: string;
  score: number;
  status: 'testing' | 'ok' | 'fail';
};

function parseSpeedKBps(speed: string) {
  const match = speed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2] === 'MB/s' ? value * 1024 : value;
}

function qualityScore(quality: string) {
  switch (quality) {
    case '4K':
      return 100;
    case '2K':
      return 85;
    case '1080p':
      return 75;
    case '720p':
      return 60;
    case '480p':
      return 40;
    case 'SD':
      return 20;
    default:
      return 0;
  }
}

function sourceKey(item: Pick<SearchResult, 'source' | 'id'>) {
  return `${item.source}-${item.id}`;
}

function sourceStatusRank(info?: SourceTestInfo) {
  if (info?.status === 'ok') return 0;
  if (info?.status === 'testing') return 1;
  if (info?.status === 'fail') return 2;
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

function TVDetailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testingSources, setTestingSources] = useState(false);
  const testedSourcesSignatureRef = useRef('');
  const sourceTestsRef = useRef<Record<string, SourceTestInfo>>({});
  const speedSamplesRef = useRef<number[]>([]);
  const pingSamplesRef = useRef<number[]>([]);
  const [sourceTests, setSourceTests] = useState<
    Record<string, SourceTestInfo>
  >({});

  const source = searchParams.get('source');
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  const fileName = searchParams.get('fileName');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchTVDetail({ source, id, title, fileName })
      .then((data) => {
        if (!alive) return;
        setDetail(data.detail);
        setSources(data.sources);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : '加载详情失败');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, id, title, fileName]);

  const poster = useMemo(
    () => (detail?.poster ? processImageUrl(detail.poster) : ''),
    [detail?.poster]
  );

  useEffect(() => {
    sourceTestsRef.current = sourceTests;
  }, [sourceTests]);

  const rankedSources = useMemo(
    () => sortSourcesByTests(sources, sourceTests),
    [sourceTests, sources]
  );

  const bestSource = rankedSources[0] || detail;

  const play = (target = detail, episode?: number) => {
    if (!target) return;
    const qs = new URLSearchParams({
      source: target.source,
      id: target.id,
      title: target.title,
    });
    if (typeof episode === 'number') qs.set('index', String(episode));
    if (fileName && target.source === source && target.id === id)
      qs.set('fileName', fileName);
    router.push(`/tv/play?${qs.toString()}`);
  };

  const calculateSourceScore = useCallback(
    (
      testResult: Pick<SourceTestInfo, 'quality' | 'loadSpeed' | 'pingTime'>,
      maxSpeed: number,
      minPing: number,
      maxPing: number,
      weight = 0
    ) => {
      const speed = parseSpeedKBps(testResult.loadSpeed);
      const speedScore =
        speed > 0 ? Math.min(100, (speed / maxSpeed) * 100) : 30;
      const pingScore = (() => {
        const ping = testResult.pingTime;
        if (ping <= 0) return 0;
        if (maxPing === minPing) return 100;
        return Math.min(
          100,
          Math.max(0, ((maxPing - ping) / (maxPing - minPing)) * 100)
        );
      })();

      return (
        Math.round(
          (qualityScore(testResult.quality) * 0.4 +
            speedScore * 0.4 +
            pingScore * 0.2 +
            weight) *
            100
        ) / 100
      );
    },
    []
  );

  const fetchPlayableSource = useCallback(async (item: SearchResult) => {
    if (item.episodes?.length) return item;
    const data = await fetchTVDetail({
      source: item.source,
      id: item.id,
      title: item.title,
    });
    return data.detail;
  }, []);

  const testSource = useCallback(
    async (
      item: SearchResult
    ): Promise<{
      item: SearchResult;
      result: Omit<SourceTestInfo, 'score' | 'status'> | null;
    }> => {
      try {
        const playable = await fetchPlayableSource(item);
        const rawUrl =
          playable.episodes?.[
            Math.min(1, Math.max(0, playable.episodes.length - 1))
          ];
        if (!rawUrl) throw new Error('无播放地址');
        const testUrl = await resolveTVEpisodeUrl(
          rawUrl,
          playable.source,
          playable.proxyMode
        );
        const result = await getVideoResolutionFromM3u8(testUrl, 5000);
        return { item: playable, result };
      } catch {
        return { item, result: null };
      }
    },
    [fetchPlayableSource]
  );

  const updateSourceTest = useCallback(
    (item: SearchResult, info: SourceTestInfo) => {
      const key = sourceKey(item);
      const nextTests = { ...sourceTestsRef.current, [key]: info };
      sourceTestsRef.current = nextTests;
      setSourceTests(nextTests);
      setSources((currentSources) => {
        const nextSources = currentSources.map((sourceItem) =>
          sourceKey(sourceItem) === key ? item : sourceItem
        );
        return sortSourcesByTests(nextSources, nextTests);
      });
      setDetail((current) => {
        if (!current || sourceKey(current) !== key) return current;
        return item;
      });
    },
    []
  );

  const testAllSources = useCallback(
    async (candidateSources = sources) => {
      if (candidateSources.length === 0 || testingSources) return null;
      setTestingSources(true);
      speedSamplesRef.current = [];
      pingSamplesRef.current = [];

      const initialTests: Record<string, SourceTestInfo> = {};
      candidateSources.forEach((item) => {
        initialTests[sourceKey(item)] = {
          quality: '测速中',
          loadSpeed: '测量中...',
          pingTime: 0,
          bitrate: '未知',
          score: 0,
          status: 'testing',
        };
      });
      sourceTestsRef.current = initialTests;
      setSourceTests(initialTests);
      setSources((currentSources) =>
        sortSourcesByTests(currentSources, initialTests)
      );

      let completedCount = 0;
      let bestSource: SearchResult | null = null;
      let nextIndex = 0;
      const maxConcurrency = Math.max(
        1,
        Math.min(Math.ceil(candidateSources.length / 2), 8)
      );

      const worker = async () => {
        while (nextIndex < candidateSources.length) {
          const currentIndex = nextIndex++;
          const originalItem = candidateSources[currentIndex];
          const { item, result } = await testSource(originalItem);

          if (result) {
            const speed = parseSpeedKBps(result.loadSpeed);
            if (speed > 0) speedSamplesRef.current.push(speed);
            if (result.pingTime > 0)
              pingSamplesRef.current.push(result.pingTime);
            const maxSpeed =
              speedSamplesRef.current.length > 0
                ? Math.max(...speedSamplesRef.current)
                : 1024;
            const minPing =
              pingSamplesRef.current.length > 0
                ? Math.min(...pingSamplesRef.current)
                : 50;
            const maxPing =
              pingSamplesRef.current.length > 0
                ? Math.max(...pingSamplesRef.current)
                : 1000;
            const info: SourceTestInfo = {
              ...result,
              score: calculateSourceScore(
                result,
                maxSpeed,
                minPing,
                maxPing,
                item.weight ?? 0
              ),
              status: 'ok',
            };
            updateSourceTest(item, info);
            const currentBest = sortSourcesByTests(
              [item, ...(bestSource ? [bestSource] : [])],
              { ...sourceTestsRef.current, [sourceKey(item)]: info }
            )[0];
            bestSource = currentBest || item;
          } else {
            updateSourceTest(item, {
              quality: '失败',
              loadSpeed: '不可用',
              pingTime: 0,
              bitrate: '未知',
              score: -1,
              status: 'fail',
            });
          }

          completedCount += 1;
          if (completedCount === candidateSources.length) {
            setTestingSources(false);
          }
        }
      };

      try {
        await Promise.all(
          Array.from(
            { length: Math.min(maxConcurrency, candidateSources.length) },
            () => worker()
          )
        );
        return (
          sortSourcesByTests(candidateSources, sourceTestsRef.current)[0] ||
          bestSource
        );
      } finally {
        setTestingSources(false);
      }
    },
    [
      calculateSourceScore,
      sources,
      testSource,
      testingSources,
      updateSourceTest,
    ]
  );

  useEffect(() => {
    if (loading || sources.length <= 1) return;
    const signature = Array.from(new Set(sources.map(sourceKey)))
      .sort()
      .join('|');
    if (!signature || testedSourcesSignatureRef.current === signature) return;
    testedSourcesSignatureRef.current = signature;
    testAllSources(sources).catch(() => setTestingSources(false));
  }, [loading, sources, testAllSources]);

  if (loading) {
    return (
      <TVLayout>
        <div className='mt-20 flex items-center justify-center gap-4 text-3xl text-slate-200'>
          <Loader2 className='h-10 w-10 animate-spin text-rose-500' />
          正在加载详情...
        </div>
      </TVLayout>
    );
  }

  if (error || !detail) {
    return (
      <TVLayout>
        <section className='rounded-[36px] border border-red-500/40 bg-red-950/40 p-10 text-3xl font-bold text-red-100'>
          {error || '详情不存在'}
        </section>
      </TVLayout>
    );
  }

  return (
    <TVLayout>
      <section className='relative overflow-hidden rounded-[44px] border border-white/10 bg-slate-950/80 p-8 shadow-2xl shadow-black/70'>
        {poster && (
          <img
            src={poster}
            alt=''
            className='absolute inset-0 h-full w-full object-cover opacity-20 blur-xl'
          />
        )}
        <div className='relative grid grid-cols-[300px_1fr] gap-10'>
          <div className='overflow-hidden rounded-[32px] bg-slate-900 shadow-2xl shadow-black/70'>
            {poster ? (
              <img
                src={poster}
                alt={detail.title}
                className='aspect-[2/3] h-full w-full object-cover'
              />
            ) : (
              <div className='aspect-[2/3]' />
            )}
          </div>
          <div className='py-2'>
            <button
              onClick={() => router.back()}
              className='tv-focusable mb-6 flex cursor-pointer items-center gap-2 rounded-2xl bg-white/10 px-5 py-3 text-xl font-bold outline-none'
            >
              <ArrowLeft className='h-6 w-6' />
              返回
            </button>
            <h1 className='text-6xl font-black tracking-tight text-white'>
              {detail.title}
            </h1>
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
            </div>
            {detail.desc && (
              <p className='mt-6 line-clamp-5 max-w-5xl text-2xl leading-relaxed text-slate-300'>
                {detail.desc}
              </p>
            )}
            <button
              onClick={() => play(bestSource)}
              className='tv-focusable mt-8 flex cursor-pointer items-center gap-3 rounded-3xl bg-rose-600 px-9 py-5 text-3xl font-black text-white outline-none'
            >
              <Play className='h-9 w-9 fill-current' /> 立即播放
            </button>
          </div>
        </div>
      </section>

      {sources.length > 1 && (
        <section className='mt-10 rounded-[36px] border border-white/10 bg-white/[0.04] p-6'>
          <div className='mb-5 flex flex-wrap items-center justify-between gap-4'>
            <h2 className='text-4xl font-black'>播放源</h2>
            <div className='flex items-center gap-3 rounded-2xl bg-white/10 px-5 py-3 text-xl font-black text-slate-100'>
              {testingSources && (
                <Loader2 className='h-6 w-6 animate-spin text-amber-300' />
              )}
              <span>
                {testingSources
                  ? '正在自动优选测速并排序...'
                  : Object.keys(sourceTests).length > 0
                  ? '已按优选测速结果自动排序'
                  : '将自动优选测速排序'}
              </span>
            </div>
          </div>
          <div className='flex flex-wrap gap-4 px-4 py-4'>
            {rankedSources.map((item, index) => {
              const info = sourceTests[sourceKey(item)];
              const active =
                detail.source === item.source && detail.id === item.id;
              return (
                <button
                  key={`${item.source}-${item.id}`}
                  onClick={() => play(item)}
                  className={`tv-focusable flex min-w-[210px] cursor-pointer flex-col items-start justify-center gap-1 whitespace-nowrap rounded-2xl px-6 py-4 text-left text-2xl font-bold outline-none ${
                    active
                      ? 'bg-rose-600 text-white'
                      : 'bg-white/10 text-slate-200'
                  }`}
                >
                  <span className='flex items-center gap-2'>
                    <Server className='h-6 w-6' /> #{index + 1}{' '}
                    {item.source_name || item.source}
                  </span>
                  {info && (
                    <span
                      className={`text-base font-bold ${
                        info.status === 'ok'
                          ? 'text-emerald-200'
                          : info.status === 'testing'
                          ? 'text-amber-200'
                          : 'text-red-200'
                      }`}
                    >
                      {info.status === 'ok'
                        ? `${info.quality} · ${info.loadSpeed}`
                        : info.status === 'testing'
                        ? '测速中...'
                        : '测试失败'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className='mt-10 rounded-[36px] border border-white/10 bg-white/[0.04] p-6'>
        <h2 className='mb-5 text-4xl font-black'>选集</h2>
        <div className='grid grid-cols-3 gap-4 md:grid-cols-5 lg:grid-cols-8'>
          {(detail.episodes_titles?.length
            ? detail.episodes_titles
            : detail.episodes
          ).map((ep, index) => (
            <button
              key={`${ep}-${index}`}
              onClick={() => play(bestSource, index)}
              className='tv-focusable min-h-20 cursor-pointer rounded-2xl bg-white/10 px-4 py-3 text-xl font-black text-white outline-none'
            >
              {detail.episodes_titles?.[index] || `第 ${index + 1} 集`}
            </button>
          ))}
        </div>
      </section>
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
