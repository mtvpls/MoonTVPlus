/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { usePlaySync } from '@/hooks/usePlaySync';
import { getDoubanDetail } from '@/lib/douban.client';
import { useDownload } from '@/contexts/DownloadContext';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
  getDanmakuFilterConfig,
  getEpisodeFilterConfig,
} from '@/lib/db.client';
import {
  convertDanmakuFormat,
  getDanmakuById,
  getEpisodes,
  loadDanmakuMemory,
  loadDanmakuSettings,
  saveDanmakuMemory,
  saveDanmakuSettings,
  searchAnime,
  initDanmakuModule,
} from '@/lib/danmaku/api';
import type { DanmakuAnime, DanmakuSelection, DanmakuSettings } from '@/lib/danmaku/types';
import { SearchResult, DanmakuFilterConfig, EpisodeFilterConfig } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import DownloadEpisodeSelector from '@/components/DownloadEpisodeSelector';
import PageLayout from '@/components/PageLayout';
import DoubanComments from '@/components/DoubanComments';
import DanmakuFilterSettings from '@/components/DanmakuFilterSettings';
import Toast, { ToastProps } from '@/components/Toast';
import { useEnableComments } from '@/hooks/useEnableComments';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

// Wake Lock API 类型声明
interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const enableComments = useEnableComments();
  const { addDownloadTask } = useDownload();

  // 获取 Proxy M3U8 Token
  const proxyToken = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN || '' : '';

  // 获取用户认证信息
  const authInfo = typeof window !== 'undefined' ? getAuthInfoFromBrowserCookie() : null;

  // 离线下载功能配置
  const enableOfflineDownload = typeof window !== 'undefined'
    ? (window as any).RUNTIME_CONFIG?.ENABLE_OFFLINE_DOWNLOAD || false
    : false;
  const hasOfflinePermission = authInfo?.role === 'owner' || authInfo?.role === 'admin';

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 外部播放器去广告开关（独立状态，默认 false）
  const [externalPlayerAdBlock, setExternalPlayerAdBlock] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('external_player_adblock');
      if (v !== null) return v === 'true';
    }
    return false;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('external_player_adblock', String(externalPlayerAdBlock));
    }
  }, [externalPlayerAdBlock]);

  // 自定义去广告代码（从服务器获取并缓存）
  const customAdFilterCodeRef = useRef<string>('');

  // 初始化时获取自定义去广告代码
  useEffect(() => {
    const fetchAdFilterCode = async () => {
      if (typeof window === 'undefined') return;

      try {
        // 先从 localStorage 获取缓存的代码，立即可用
        const cachedCode = localStorage.getItem('custom_ad_filter_code_cache');
        const cachedVersion = localStorage.getItem('custom_ad_filter_version_cache');

        if (cachedCode) {
          customAdFilterCodeRef.current = cachedCode;
          console.log('使用缓存的去广告代码');
        }

        // 第一步：先只获取版本号，检查是否需要更新
        const versionResponse = await fetch('/api/ad-filter');
        if (!versionResponse.ok) {
          console.warn('获取去广告代码版本失败，使用缓存');
          return;
        }

        const { version } = await versionResponse.json();

        // 如果版本号为 0，说明去广告未设置，清空缓存并跳过
        if (version === 0) {
          console.log('去广告代码未设置（版本 0），清空缓存');
          localStorage.removeItem('custom_ad_filter_code_cache');
          localStorage.removeItem('custom_ad_filter_version_cache');
          customAdFilterCodeRef.current = '';
          return;
        }

        // 如果版本号不一致或没有缓存，才获取完整代码
        if (!cachedVersion || parseInt(cachedVersion) !== version) {
          console.log('检测到去广告代码更新（版本 ' + version + '），获取最新代码');

          // 第二步：获取完整代码
          const fullResponse = await fetch('/api/ad-filter?full=true');
          if (!fullResponse.ok) {
            console.warn('获取完整去广告代码失败，使用缓存');
            return;
          }

          const { code } = await fullResponse.json();

          if (code) {
            localStorage.setItem('custom_ad_filter_code_cache', code);
            localStorage.setItem('custom_ad_filter_version_cache', version.toString());
            customAdFilterCodeRef.current = code;
          } else if (!cachedCode) {
            // 如果服务器没有代码且本地也没有缓存，清空缓存
            localStorage.removeItem('custom_ad_filter_code_cache');
            localStorage.removeItem('custom_ad_filter_version_cache');
          }
        } else {
          console.log('去广告代码已是最新版本（版本 ' + version + '）');
        }
      } catch (error) {
        console.error('获取去广告代码配置失败:', error);
        // 失败时已经使用了缓存，无需额外处理
      }
    };

    fetchAdFilterCode();
  }, []);

  // Anime4K超分相关状态
  const [webGPUSupported, setWebGPUSupported] = useState<boolean>(false);
  const [anime4kEnabled, setAnime4kEnabled] = useState<boolean>(false);
  const [anime4kMode, setAnime4kMode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('anime4k_mode');
      if (v !== null) return v;
    }
    return 'ModeA';
  });
  const [anime4kScale, setAnime4kScale] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('anime4k_scale');
      if (v !== null) return parseFloat(v);
    }
    return 2.0;
  });
  const anime4kRef = useRef<any>(null);
  const anime4kEnabledRef = useRef(anime4kEnabled);
  const anime4kModeRef = useRef(anime4kMode);
  const anime4kScaleRef = useRef(anime4kScale);
  useEffect(() => {
    anime4kEnabledRef.current = anime4kEnabled;
    anime4kModeRef.current = anime4kMode;
    anime4kScaleRef.current = anime4kScale;
  }, [anime4kEnabled, anime4kMode, anime4kScale]);

  // 检测WebGPU支持
  useEffect(() => {
    const checkWebGPUSupport = async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：浏览器不支持WebGPU API');
        return;
      }

      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) {
          setWebGPUSupported(false);
          console.log('WebGPU不支持：无法获取GPU适配器');
          return;
        }

        setWebGPUSupported(true);
        console.log('WebGPU支持检测：✅ 支持');
      } catch (err) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：', err);
      }
    };

    checkWebGPUSupport();
  }, []);

  // 弹幕相关状态
  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>(
    loadDanmakuSettings()
  );
  const [danmakuFilterConfig, setDanmakuFilterConfig] = useState<DanmakuFilterConfig | null>(null);
  const danmakuFilterConfigRef = useRef<DanmakuFilterConfig | null>(null);
  const [episodeFilterConfig, setEpisodeFilterConfig] = useState<EpisodeFilterConfig | null>(null);
  const episodeFilterConfigRef = useRef<EpisodeFilterConfig | null>(null);
  const [currentDanmakuSelection, setCurrentDanmakuSelection] =
    useState<DanmakuSelection | null>(null);
  const [danmakuEpisodesList, setDanmakuEpisodesList] = useState<
    Array<{ episodeId: number; episodeTitle: string }>
  >([]);
  const [danmakuLoading, setDanmakuLoading] = useState(false);
  const [danmakuCount, setDanmakuCount] = useState(0);
  const danmakuPluginRef = useRef<any>(null);
  const danmakuSettingsRef = useRef(danmakuSettings);

  // 多条弹幕匹配结果
  const [danmakuMatches, setDanmakuMatches] = useState<DanmakuAnime[]>([]);
  const [showDanmakuSourceSelector, setShowDanmakuSourceSelector] = useState(false);
  const [showDanmakuFilterSettings, setShowDanmakuFilterSettings] = useState(false);
  const [currentSearchKeyword, setCurrentSearchKeyword] = useState<string>(''); // 当前搜索使用的关键词
  const [toast, setToast] = useState<ToastProps | null>(null);

  useEffect(() => {
    danmakuSettingsRef.current = danmakuSettings;
  }, [danmakuSettings]);

  // 初始化弹幕模块（清理过期缓存）
  useEffect(() => {
    initDanmakuModule();
  }, []);

  // 加载弹幕过滤配置
  useEffect(() => {
    const loadFilterConfig = async () => {
      try {
        const config = await getDanmakuFilterConfig();
        if (config) {
          setDanmakuFilterConfig(config);
          danmakuFilterConfigRef.current = config;
        } else {
          // 如果没有配置，设置默认空配置
          const defaultConfig: DanmakuFilterConfig = { rules: [] };
          setDanmakuFilterConfig(defaultConfig);
          danmakuFilterConfigRef.current = defaultConfig;
        }

        // 加载集数过滤配置
        const episodeConfig = await getEpisodeFilterConfig();
        if (episodeConfig) {
          setEpisodeFilterConfig(episodeConfig);
          episodeFilterConfigRef.current = episodeConfig;
        } else {
          const defaultEpisodeConfig: EpisodeFilterConfig = { rules: [] };
          setEpisodeFilterConfig(defaultEpisodeConfig);
          episodeFilterConfigRef.current = defaultEpisodeConfig;
        }
      } catch (error) {
        console.error('加载过滤配置失败:', error);
      }
    };
    loadFilterConfig();
  }, []);

  // 同步弹幕过滤配置到ref
  useEffect(() => {
    danmakuFilterConfigRef.current = danmakuFilterConfig;
  }, [danmakuFilterConfig]);

  // 同步集数过滤配置到ref
  useEffect(() => {
    episodeFilterConfigRef.current = episodeFilterConfig;
  }, [episodeFilterConfig]);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);
  // 豆瓣评分数据
  const [doubanRating, setDoubanRating] = useState<{
    value: number;
    count: number;
    star_count: number;
  } | null>(null);
  // 豆瓣额外信息
  const [doubanCardSubtitle, setDoubanCardSubtitle] = useState<string>('');
  const [doubanAka, setDoubanAka] = useState<string[]>([]);
  const [doubanYear, setDoubanYear] = useState<string>(''); // 从 pubdate 提取的年份
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(() => {
    const episodeParam = searchParams.get('episode');
    if (episodeParam) {
      const episode = parseInt(episodeParam, 10);
      return episode > 0 ? episode - 1 : 0; // URL 中是 1-based，内部是 0-based
    }
    return 0;
  });

  // 监听 URL 参数变化，更新集数索引（用于房员跟随换集）
  useEffect(() => {
    const episodeParam = searchParams.get('episode');
    if (episodeParam) {
      const episode = parseInt(episodeParam, 10);
      const newIndex = episode > 0 ? episode - 1 : 0;
      console.log('[PlayPage] Checking episode from URL:', { urlEpisode: episode, currentIndex: currentEpisodeIndex, newIndex });
      if (newIndex !== currentEpisodeIndex) {
        console.log('[PlayPage] URL episode changed, updating index to:', newIndex);
        setCurrentEpisodeIndex(newIndex);
      }
    }
  }, [searchParams, currentEpisodeIndex]);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 监听剧集切换，自动加载对应的弹幕
  const lastLoadedEpisodeIdRef = useRef<number | null>(null);

  useEffect(() => {
    // 只有在有弹幕选择且有剧集列表时才自动切换
    if (
      currentDanmakuSelection &&
      danmakuEpisodesList.length > 0 &&
      currentEpisodeIndex < danmakuEpisodesList.length
    ) {
      const episode = danmakuEpisodesList[currentEpisodeIndex];
      if (episode && episode.episodeId !== currentDanmakuSelection.episodeId) {
        // 避免重复加载同一集的弹幕
        if (lastLoadedEpisodeIdRef.current === episode.episodeId) {
          console.log(`跳过重复加载弹幕: episodeId=${episode.episodeId}`);
          return;
        }

        // 自动加载新集数的弹幕
        const newSelection: DanmakuSelection = {
          animeId: currentDanmakuSelection.animeId,
          episodeId: episode.episodeId,
          animeTitle: currentDanmakuSelection.animeTitle,
          episodeTitle: episode.episodeTitle,
        };
        setCurrentDanmakuSelection(newSelection);
        lastLoadedEpisodeIdRef.current = episode.episodeId;
        loadDanmaku(episode.episodeId);
        console.log(`自动切换弹幕到第 ${currentEpisodeIndex + 1} 集`);
      }
    }
  }, [currentEpisodeIndex]);

  // 获取豆瓣评分数据
  useEffect(() => {
    const fetchDoubanRating = async () => {
      if (!videoDoubanId || videoDoubanId === 0) {
        setDoubanRating(null);
        setDoubanCardSubtitle('');
        setDoubanAka([]);
        setDoubanYear('');
        return;
      }

      try {
        const doubanData = await getDoubanDetail(videoDoubanId.toString());

        // 设置评分
        if (doubanData.rating) {
          setDoubanRating({
            value: doubanData.rating.value,
            count: doubanData.rating.count,
            star_count: doubanData.rating.star_count,
          });
        } else {
          setDoubanRating(null);
        }

        // 设置 card_subtitle
        if (doubanData.card_subtitle) {
          setDoubanCardSubtitle(doubanData.card_subtitle);
        }

        // 设置 aka（别名）
        if (doubanData.aka && doubanData.aka.length > 0) {
          setDoubanAka(doubanData.aka);
        }

        // 处理 pubdate 获取年份
        if (doubanData.pubdate && doubanData.pubdate.length > 0) {
          const pubdateStr = doubanData.pubdate[0];
          // 删除括号中的内容，包括括号
          const yearMatch = pubdateStr.replace(/\([^)]*\)/g, '').trim();
          if (yearMatch) {
            setDoubanYear(yearMatch);
          }
        }
      } catch (error) {
        console.error('获取豆瓣评分失败:', error);
        setDoubanRating(null);
        setDoubanCardSubtitle('');
        setDoubanAka([]);
        setDoubanYear('');
      }
    };

    fetchDoubanRating();
  }, [videoDoubanId]);


  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 下载选集面板显示状态
  const [showDownloadSelector, setShowDownloadSelector] = useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放器就绪状态（用于触发 usePlaySync 的事件监听器设置）
  const [playerReady, setPlayerReady] = useState(false);

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // Wake Lock 相关
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 观影室同步功能
  const playSync = usePlaySync({
    artPlayerRef,
    videoId: currentId || '',  // 使用 currentId 状态而不是 searchParams
    videoName: videoTitle || detail?.title || '正在加载...',
    videoYear: videoYear || detail?.year || '',
    searchTitle: searchTitle || '',
    currentEpisode: currentEpisodeIndex + 1,
    currentSource: currentSource || '',
    videoUrl: videoUrl || '',
    playerReady: playerReady,  // 传递播放器就绪状态
  });

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (let start = 0; start < sources.length; start += batchSize) {
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source) => {
          try {
            // 检查是否有第一集的播放地址
            if (!source.episodes || source.episodes.length === 0) {
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
            };
          } catch (error) {
            return null;
          }
        })
      );
      allResults.push(...batchResults);
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 过滤出成功的结果用于优选计算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('所有播放源测速都失败，使用第一个播放源');
      return sources[0];
    }

    // 找出所有有效速度的最大值，用于线性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // 找出所有有效延迟的最小值和最大值，用于线性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 计算每个结果的评分
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    // 按综合评分排序，选择最佳播放源
    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${index + 1}. ${
          result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
          result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`
      );
    });

    return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
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
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
  };

  // 检查是否有本地下载的视频
  const checkLocalDownload = async (
    source: string,
    videoId: string,
    episodeIndex: number
  ): Promise<boolean> => {
    if (!enableOfflineDownload || !hasOfflinePermission) {
      return false;
    }

    try {
      const response = await fetch(
        `/api/offline-download?action=check&source=${encodeURIComponent(source)}&videoId=${encodeURIComponent(videoId)}&episodeIndex=${episodeIndex}`
      );

      if (response.ok) {
        const data = await response.json();
        return data.downloaded || false;
      }
    } catch (error) {
      console.error('检查本地下载失败:', error);
    }

    return false;
  };

  // 更新视频地址
  const updateVideoUrl = async (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }

    let newUrl = detailData?.episodes[episodeIndex] || '';

    // 检查是否有本地下载的文件
    const hasLocalFile = await checkLocalDownload(currentSource, currentId, episodeIndex);

    if (hasLocalFile) {
      // 使用本地代理接口，URL以.m3u8结尾以便Artplayer自动识别
      newUrl = `/api/offline-download/local/${currentSource}/${currentId}/${episodeIndex}/playlist.m3u8`;
      console.log('使用本地下载文件播放:', newUrl);
    }

    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  // 处理下载指定集数（支持批量下载）
  const handleDownloadEpisode = async (episodeIndexes: number[], offlineMode = false) => {
    if (!detail || !detail.episodes || episodeIndexes.length === 0) {
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '无法获取视频地址';
      }
      return;
    }

    const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
    const origin = `${window.location.protocol}//${window.location.host}`;

    let successCount = 0;
    let failCount = 0;

    // 批量处理下载
    for (const episodeIndex of episodeIndexes) {
      if (episodeIndex >= detail.episodes.length) {
        failCount++;
        continue;
      }

      const episodeUrl = detail.episodes[episodeIndex];

      // 离线下载模式：无论是否开启去广告，都走非去广告逻辑
      const proxyUrl = offlineMode
        ? episodeUrl  // 离线下载不使用代理，直接使用原始URL
        : (externalPlayerAdBlock
            ? `${origin}/api/proxy-m3u8?url=${encodeURIComponent(episodeUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
            : episodeUrl);

      const isM3u8 = episodeUrl.toLowerCase().includes('.m3u8') || episodeUrl.toLowerCase().includes('/m3u8/');

      if (offlineMode && isM3u8) {
        // 离线下载模式 - 调用服务器API
        try {
          const downloadTitle = `${videoTitle}_第${episodeIndex + 1}集`;
          const response = await fetch('/api/offline-download', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              source: currentSource,
              videoId: currentId,
              episodeIndex,
              title: downloadTitle,
              m3u8Url: proxyUrl,
              metadata: detail ? {
                videoTitle: detail.title,
                cover: detail.poster,
                description: detail.desc,
                year: detail.year,
                rating: undefined, // SearchResult 没有 rating 字段
                totalEpisodes: detail.episodes?.length,
              } : undefined,
            }),
          });

          const data = await response.json();

          if (response.ok) {
            successCount++;
          } else {
            console.error(`离线下载任务创建失败 (第${episodeIndex + 1}集):`, data.error);
            failCount++;
          }
        } catch (error) {
          console.error(`离线下载任务创建失败 (第${episodeIndex + 1}集):`, error);
          failCount++;
        }
      } else if (isM3u8) {
        // M3U8格式 - 使用新的下载器，TS 格式
        try {
          const downloadTitle = `${videoTitle}_第${episodeIndex + 1}集`;
          await addDownloadTask(proxyUrl, downloadTitle, 'TS');
          successCount++;
        } catch (error) {
          console.error(`添加下载任务失败 (第${episodeIndex + 1}集):`, error);
          failCount++;
        }
      } else {
        // 普通视频格式 - 直接下载
        try {
          const a = document.createElement('a');
          a.href = proxyUrl;
          a.download = `${videoTitle}_第${episodeIndex + 1}集.mp4`;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          successCount++;
          // 添加延迟避免浏览器阻止多个下载
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          console.error(`下载失败 (第${episodeIndex + 1}集):`, error);
          failCount++;
        }
      }
    }

    // 显示结果通知
    if (artPlayerRef.current) {
      if (failCount === 0) {
        artPlayerRef.current.notice.show = offlineMode
          ? `已创建 ${successCount} 个离线下载任务！`
          : `已添加 ${successCount} 个下载任务！`;
      } else if (successCount === 0) {
        artPlayerRef.current.notice.show = '下载失败，请重试';
      } else {
        artPlayerRef.current.notice.show = `成功 ${successCount} 个，失败 ${failCount} 个`;
      }
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }

    // 确保 playsinline 属性存在（iOS 兼容性）
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    // 使用 property 方式也设置一次，确保兼容性
    (video as any).playsInline = true;
    (video as any).webkitPlaysInline = true;
  };

  // Wake Lock 相关函数
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
        console.log('Wake Lock 已启用');
      }
    } catch (err) {
      console.warn('Wake Lock 请求失败:', err);
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock 已释放');
      }
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  };

  // 清理播放器资源的统一函数
  const cleanupPlayer = () => {
    if (artPlayerRef.current) {
      try {
        // 在销毁前从弹幕插件读取最新配置并保存
        if (danmakuPluginRef.current?.option && artPlayerRef.current.storage) {
          // 获取当前弹幕设置的快照，避免循环引用
          const currentDanmakuSettings = danmakuSettingsRef.current;
          const danmakuPluginOption = danmakuPluginRef.current.option;
          
          const currentSettings = {
            ...currentDanmakuSettings,
            opacity: danmakuPluginOption.opacity || currentDanmakuSettings.opacity,
            fontSize: danmakuPluginOption.fontSize || currentDanmakuSettings.fontSize,
            speed: danmakuPluginOption.speed || currentDanmakuSettings.speed,
            marginTop: (danmakuPluginOption.margin && danmakuPluginOption.margin[0]) ?? currentDanmakuSettings.marginTop,
            marginBottom: (danmakuPluginOption.margin && danmakuPluginOption.margin[1]) ?? currentDanmakuSettings.marginBottom,
          };

          // 保存到 localStorage 和 art.storage
          saveDanmakuSettings(currentSettings);
          artPlayerRef.current.storage.set('danmaku_settings', currentSettings);

          console.log('播放器销毁前保存弹幕设置:', currentSettings);
        }

        // 销毁 HLS 实例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }

        // 销毁 ArtPlayer 实例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;

        console.log('播放器资源已清理');
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
        artPlayerRef.current = null;
      }
    }
  };

  // 初始化Anime4K超分
  const initAnime4K = async () => {
    if (!artPlayerRef.current?.video) return;

    let frameRequestId: number | null = null; // 在外层声明，以便错误处理中使用
    let outputCanvas: HTMLCanvasElement | null = null; // 在外层声明，以便错误处理中清理

    try {
      if (anime4kRef.current) {
        anime4kRef.current.stop?.();
        anime4kRef.current = null;
      }

      const video = artPlayerRef.current.video as HTMLVideoElement;

      // 等待视频元数据加载完成
      if (!video.videoWidth || !video.videoHeight) {
        console.warn('视频尺寸未就绪，等待loadedmetadata事件');
        await new Promise<void>((resolve) => {
          const handler = () => {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          };
          video.addEventListener('loadedmetadata', handler);
          // 如果已经加载过了，立即resolve
          if (video.videoWidth && video.videoHeight) {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          }
        });
      }

      // 再次检查视频尺寸
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('无法获取视频尺寸');
      }

      // 检查视频是否正在播放
      console.log('视频播放状态:', {
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        currentTime: video.currentTime,
      });

      // 检测是否为Firefox
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
      console.log('浏览器检测:', isFirefox ? 'Firefox' : 'Chrome/Edge/其他');

      // 创建输出canvas（显示给用户的）
      outputCanvas = document.createElement('canvas');
      const container = artPlayerRef.current.template.$video.parentElement;

      // 使用用户选择的超分倍数
      const scale = anime4kScaleRef.current;
      outputCanvas.width = Math.floor(video.videoWidth * scale);  // 确保是整数
      outputCanvas.height = Math.floor(video.videoHeight * scale);

      // 验证outputCanvas尺寸
      console.log('outputCanvas尺寸:', outputCanvas.width, 'x', outputCanvas.height);
      if (!outputCanvas.width || !outputCanvas.height ||
          !isFinite(outputCanvas.width) || !isFinite(outputCanvas.height)) {
        throw new Error(`outputCanvas尺寸无效: ${outputCanvas.width}x${outputCanvas.height}, scale: ${scale}`);
      }

      outputCanvas.style.position = 'absolute';
      outputCanvas.style.top = '0';
      outputCanvas.style.left = '0';
      outputCanvas.style.width = '100%';
      outputCanvas.style.height = '100%';
      outputCanvas.style.objectFit = 'contain';
      outputCanvas.style.cursor = 'pointer';
      outputCanvas.style.zIndex = '1';
      // 确保canvas背景透明，避免Firefox中的渲染问题
      outputCanvas.style.backgroundColor = 'transparent';

      // Firefox兼容性处理：创建中间canvas
      let sourceCanvas: HTMLCanvasElement | null = null;
      let sourceCtx: CanvasRenderingContext2D | null = null;

      if (isFirefox) {
        // Firefox的WebGPU不支持直接使用HTMLVideoElement
        // 使用标准HTMLCanvasElement（更好的兼容性）
        sourceCanvas = document.createElement('canvas');

        // 获取视频尺寸并记录
        const videoW = video.videoWidth;
        const videoH = video.videoHeight;
        console.log('Firefox：准备创建canvas - 视频尺寸:', videoW, 'x', videoH);

        // 设置canvas尺寸
        const canvasW = Math.floor(videoW);
        const canvasH = Math.floor(videoH);
        console.log('Firefox：计算后的canvas尺寸:', canvasW, 'x', canvasH);

        sourceCanvas.width = canvasW;
        sourceCanvas.height = canvasH;

        // 立即验证赋值结果
        console.log('Firefox：Canvas创建后立即检查:');
        console.log('  - sourceCanvas.width:', sourceCanvas.width);
        console.log('  - sourceCanvas.height:', sourceCanvas.height);
        console.log('  - 赋值是否成功:', sourceCanvas.width === canvasW && sourceCanvas.height === canvasH);

        // 验证sourceCanvas尺寸
        if (!sourceCanvas.width || !sourceCanvas.height ||
            !isFinite(sourceCanvas.width) || !isFinite(sourceCanvas.height)) {
          throw new Error(`sourceCanvas尺寸无效: ${sourceCanvas.width}x${sourceCanvas.height}`);
        }

        if (sourceCanvas.width !== canvasW || sourceCanvas.height !== canvasH) {
          throw new Error(`sourceCanvas尺寸赋值异常: 期望 ${canvasW}x${canvasH}, 实际 ${sourceCanvas.width}x${sourceCanvas.height}`);
        }

        sourceCtx = sourceCanvas.getContext('2d', {
          willReadFrequently: true,
          alpha: false  // 禁用alpha通道，提高性能
        });

        if (!sourceCtx) {
          throw new Error('无法创建2D上下文');
        }

        // 先绘制一帧到canvas，确保有内容
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
          console.log('Firefox：已绘制初始帧到sourceCanvas');
        }

        console.log('Firefox检测：使用HTMLCanvasElement中转方案');
      }

      // 在outputCanvas上监听点击事件，触发播放器的暂停/播放切换
      const handleCanvasClick = () => {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
        }
      };
      outputCanvas.addEventListener('click', handleCanvasClick);

      // 在outputCanvas上监听双击事件，触发全屏切换
      const handleCanvasDblClick = () => {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        }
      };
      outputCanvas.addEventListener('dblclick', handleCanvasDblClick);

      // 隐藏原始video元素（使用opacity而不是display:none以保持视频解码）
      // Firefox在display:none时可能会停止视频解码，导致黑屏
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.position = 'absolute';
      video.style.zIndex = '-1';

      // 插入outputCanvas到容器
      container.insertBefore(outputCanvas, video);

      // Firefox兼容性：创建视频帧捕获循环
      if (isFirefox && sourceCtx && sourceCanvas) {
        const captureVideoFrame = () => {
          if (sourceCtx && sourceCanvas && video.readyState >= video.HAVE_CURRENT_DATA) {
            sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
          }
          frameRequestId = requestAnimationFrame(captureVideoFrame);
        };
        captureVideoFrame();
        console.log('Firefox：视频帧捕获循环已启动');
      }

      // 动态导入 anime4k-webgpu 及对应的模式
      const { render: anime4kRender, ModeA, ModeB, ModeC, ModeAA, ModeBB, ModeCA } = await import('anime4k-webgpu');

      let ModeClass: any;
      const modeName = anime4kModeRef.current;

      switch (modeName) {
        case 'ModeA':
          ModeClass = ModeA;
          break;
        case 'ModeB':
          ModeClass = ModeB;
          break;
        case 'ModeC':
          ModeClass = ModeC;
          break;
        case 'ModeAA':
          ModeClass = ModeAA;
          break;
        case 'ModeBB':
          ModeClass = ModeBB;
          break;
        case 'ModeCA':
          ModeClass = ModeCA;
          break;
        default:
          ModeClass = ModeA;
      }

      // 使用anime4k-webgpu的render函数
      // Firefox使用sourceCanvas，其他浏览器直接使用video
      const renderConfig: any = {
        video: isFirefox ? sourceCanvas : video, // Firefox使用canvas中转，其他浏览器直接使用video
        canvas: outputCanvas,
        pipelineBuilder: (device: GPUDevice, inputTexture: GPUTexture) => {
          if (!outputCanvas) {
            throw new Error('outputCanvas is null in pipelineBuilder');
          }
          const mode = new ModeClass({
            device,
            inputTexture,
            nativeDimensions: {
              width: Math.floor(video.videoWidth),  // 确保是整数
              height: Math.floor(video.videoHeight),
            },
            targetDimensions: {
              width: Math.floor(outputCanvas.width),  // 确保是整数
              height: Math.floor(outputCanvas.height),
            },
          });
          return [mode];
        },
      };

      console.log('开始初始化Anime4K渲染器...');
      console.log('输入源:', isFirefox ? 'HTMLCanvasElement (Firefox兼容)' : 'video (原生)');
      console.log('视频尺寸:', video.videoWidth, 'x', video.videoHeight);
      console.log('输出Canvas尺寸:', outputCanvas.width, 'x', outputCanvas.height);
      console.log('nativeDimensions:', Math.floor(video.videoWidth), 'x', Math.floor(video.videoHeight));
      console.log('targetDimensions:', Math.floor(outputCanvas.width), 'x', Math.floor(outputCanvas.height));

      // Firefox调试：检查sourceCanvas状态
      if (isFirefox && sourceCanvas) {
        console.log('sourceCanvas详细信息:');
        console.log('  - width:', sourceCanvas.width, 'height:', sourceCanvas.height);
        console.log('  - clientWidth:', sourceCanvas.clientWidth, 'clientHeight:', sourceCanvas.clientHeight);
        console.log('  - offsetWidth:', sourceCanvas.offsetWidth, 'offsetHeight:', sourceCanvas.offsetHeight);

        // 尝试读取一个像素，确认canvas有内容
        if (sourceCtx) {
          try {
            const imageData = sourceCtx.getImageData(0, 0, 1, 1);
            console.log('  - 像素数据可读:', imageData.data.length > 0);
          } catch (err) {
            console.error('  - 无法读取像素数据:', err);
          }
        }
      }

      const controller = await anime4kRender(renderConfig);
      console.log('Anime4K渲染器初始化成功');

      anime4kRef.current = {
        controller,
        canvas: outputCanvas,
        sourceCanvas: isFirefox ? sourceCanvas : null,
        frameRequestId: isFirefox ? frameRequestId : null,
        handleCanvasClick,
        handleCanvasDblClick,
      };

      console.log('Anime4K超分已启用，模式:', anime4kModeRef.current, '倍数:', scale);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = `超分已启用 (${anime4kModeRef.current}, ${scale}x)`;
      }
    } catch (err) {
      console.error('初始化Anime4K失败:', err);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '超分启用失败：' + (err instanceof Error ? err.message : '未知错误');
      }

      // 停止帧捕获循环
      if (frameRequestId) {
        cancelAnimationFrame(frameRequestId);
      }

      // 移除outputCanvas（如果已创建）
      if (outputCanvas && outputCanvas.parentNode) {
        outputCanvas.parentNode.removeChild(outputCanvas);
      }

      // 恢复video显示
      if (artPlayerRef.current?.video) {
        artPlayerRef.current.video.style.opacity = '1';
        artPlayerRef.current.video.style.pointerEvents = 'auto';
        artPlayerRef.current.video.style.position = '';
        artPlayerRef.current.video.style.zIndex = '';
      }
    }
  };

  // 清理Anime4K
  const cleanupAnime4K = async () => {
    if (anime4kRef.current) {
      try {
        // 停止帧捕获循环（仅Firefox）
        if (anime4kRef.current.frameRequestId) {
          cancelAnimationFrame(anime4kRef.current.frameRequestId);
          console.log('Firefox：帧捕获循环已停止');
        }

        // 停止渲染循环
        anime4kRef.current.controller?.stop?.();

        // 移除canvas事件监听器
        if (anime4kRef.current.canvas) {
          if (anime4kRef.current.handleCanvasClick) {
            anime4kRef.current.canvas.removeEventListener('click', anime4kRef.current.handleCanvasClick);
          }
          if (anime4kRef.current.handleCanvasDblClick) {
            anime4kRef.current.canvas.removeEventListener('dblclick', anime4kRef.current.handleCanvasDblClick);
          }
        }

        // 移除canvas
        if (anime4kRef.current.canvas && anime4kRef.current.canvas.parentNode) {
          anime4kRef.current.canvas.parentNode.removeChild(anime4kRef.current.canvas);
        }

        // 清理sourceCanvas（仅Firefox）
        if (anime4kRef.current.sourceCanvas) {
          if (anime4kRef.current.sourceCanvas instanceof OffscreenCanvas) {
            // OffscreenCanvas的清理
            const ctx = anime4kRef.current.sourceCanvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, anime4kRef.current.sourceCanvas.width, anime4kRef.current.sourceCanvas.height);
            }
            console.log('Firefox：OffscreenCanvas已清理');
          } else {
            // HTMLCanvasElement的清理
            const ctx = anime4kRef.current.sourceCanvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, anime4kRef.current.sourceCanvas.width, anime4kRef.current.sourceCanvas.height);
            }
            console.log('Firefox：HTMLCanvasElement已清理');
          }
        }

        anime4kRef.current = null;

        // 恢复原始video显示
        if (artPlayerRef.current?.video) {
          artPlayerRef.current.video.style.opacity = '1';
          artPlayerRef.current.video.style.pointerEvents = 'auto';
          artPlayerRef.current.video.style.position = '';
          artPlayerRef.current.video.style.zIndex = '';
        }

        console.log('Anime4K已清理');
      } catch (err) {
        console.warn('清理Anime4K时出错:', err);
      }
    }
  };

  // 切换Anime4K状态
  const toggleAnime4K = async (enabled: boolean) => {
    try {
      if (enabled) {
        await initAnime4K();
      } else {
        await cleanupAnime4K();
      }
      setAnime4kEnabled(enabled);
      localStorage.setItem('enable_anime4k', String(enabled));
    } catch (err) {
      console.error('切换超分状态失败:', err);
    }
  };

  // 更改Anime4K模式
  const changeAnime4KMode = async (mode: string) => {
    try {
      setAnime4kMode(mode);
      localStorage.setItem('anime4k_mode', mode);

      if (anime4kEnabledRef.current) {
        await cleanupAnime4K();
        await initAnime4K();
      }
    } catch (err) {
      console.error('更改超分模式失败:', err);
    }
  };

  // 更改Anime4K分辨率倍数
  const changeAnime4KScale = async (scale: number) => {
    try {
      setAnime4kScale(scale);
      localStorage.setItem('anime4k_scale', scale.toString());

      if (anime4kEnabledRef.current) {
        await cleanupAnime4K();
        await initAnime4K();
      }
    } catch (err) {
      console.error('更改超分倍数失败:', err);
    }
  };

  function filterAdsFromM3U8(type: string, m3u8Content: string): string {
    // 尝试使用缓存的自定义去广告代码
    if (customAdFilterCodeRef.current && customAdFilterCodeRef.current.trim()) {
      try {
        // 移除 TypeScript 类型注解，转换为纯 JavaScript
        const jsCode = customAdFilterCodeRef.current
          // 移除函数参数的类型注解：name: type
          .replace(/(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g, '$1$3')
          // 移除函数返回值类型注解：): type {
          .replace(/\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g, ') {')
          // 移除变量声明的类型注解：const name: type =
          .replace(/(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g, '$1 $2 =');

        // 创建并执行自定义函数
        const customFunction = new Function('type', 'm3u8Content',
          jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
        );
        return customFunction(type, m3u8Content);
      } catch (err) {
        console.error('执行自定义去广告代码失败，使用默认规则:', err);
        // 如果自定义代码执行失败，继续使用默认规则
      }
    }

    // 默认去广告规则
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    let nextdelete = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (nextdelete) {
        nextdelete = false;
        continue;
      }

      // 只过滤#EXT-X-DISCONTINUITY标识
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        if (
          type == 'ruyi' &&
          (line.includes('EXTINF:5.640000') ||
            line.includes('EXTINF:2.960000') ||
            line.includes('EXTINF:3.480000') ||
            line.includes('EXTINF:4.000000') ||
            line.includes('EXTINF:0.960000') ||
            line.includes('EXTINF:10.000000') ||
            line.includes('EXTINF:1.266667'))
        ) {
          nextdelete = true;
          continue;
        }

        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        
        // 安全地更新播放器设置，仅在播放器存在时执行
        if (artPlayerRef.current && artPlayerRef.current.setting) {
          try {
            artPlayerRef.current.setting.update({
              name: '跳过片头片尾',
              html: '跳过片头片尾',
              switch: skipConfigRef.current.enable,
              onSwitch: function (item: any) {
                const newConfig = {
                  ...skipConfigRef.current,
                  enable: !item.switch,
                };
                handleSkipConfigChange(newConfig);
                return !item.switch;
              },
            });
            artPlayerRef.current.setting.update({
              name: '设置片头',
              html: '设置片头',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0
                  ? '设置片头时间'
                  : `${formatTime(skipConfigRef.current.intro_time)}`,
              onClick: function () {
                const currentTime = artPlayerRef.current?.currentTime || 0;
                if (currentTime > 0) {
                  const newConfig = {
                    ...skipConfigRef.current,
                    intro_time: currentTime,
                  };
                  handleSkipConfigChange(newConfig);
                  return `${formatTime(currentTime)}`;
                }
              },
            });
            artPlayerRef.current.setting.update({
              name: '设置片尾',
              html: '设置片尾',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.outro_time >= 0
                  ? '设置片尾时间'
                  : `-${formatTime(-skipConfigRef.current.outro_time)}`,
              onClick: function () {
                const outroTime =
                  -(
                    artPlayerRef.current?.duration -
                    artPlayerRef.current?.currentTime
                  ) || 0;
                if (outroTime < 0) {
                  const newConfig = {
                    ...skipConfigRef.current,
                    outro_time: outroTime,
                  };
                  handleSkipConfigChange(newConfig);
                  return `-${formatTime(-outroTime)}`;
                }
              },
            });
          } catch (settingErr) {
            console.warn('更新播放器设置失败:', settingErr);
          }
        }
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 不到一小时，格式为 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超过一小时，格式为 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  // 创建自定义 HLS loader 的工厂函数
  const createCustomHlsLoader = (HlsLib: any) => {
    return class CustomHlsJsLoader extends HlsLib.DefaultConfig.loader {
      constructor(config: any) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context: any, config: any, callbacks: any) {
          // 拦截manifest和level请求
          if (
            (context as any).type === 'manifest' ||
            (context as any).type === 'level'
          ) {
            const onSuccess = callbacks.onSuccess;
            callbacks.onSuccess = function (
              response: any,
              stats: any,
              context: any
            ) {
              // 如果是m3u8文件，处理内容以移除广告分段
              if (response.data && typeof response.data === 'string') {
                // 过滤掉广告段 - 实现更精确的广告过滤逻辑
                response.data = filterAdsFromM3U8(
                  currentSourceRef.current,
                  response.data
                );
              }
              return onSuccess(response, stats, context, null);
            };
          }
          // 执行原始load方法
          load(context, config, callbacks);
        };
      }
    };
  };

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}`
        );
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果，根据规则过滤
        const results = data.results.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
                (searchType === 'movie' && result.episodes.length === 1)
              : true)
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在获取视频详情...'
          : '🔍 正在搜索播放源...'
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (source) => source.source === currentSource && source.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      // 指定源和id且无需优选
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      }

      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 加载播放记录
      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(detailData.source, detailData.id);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新当前选集索引
          if (targetIndex < detailData.episodes.length && targetIndex >= 0) {
            setCurrentEpisodeIndex(targetIndex);
            currentEpisodeIndexRef.current = targetIndex;
          }

          // 保存待恢复的播放进度，待播放器就绪后跳转
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, []);

  // 监听 URL 参数变化，处理换源和换视频（用于房员跟随房主操作）
  useEffect(() => {
    const urlSource = searchParams.get('source');
    const urlId = searchParams.get('id');

    // 只在URL参数存在且与当前状态不同时才处理
    if (urlSource && urlId && (urlSource !== currentSource || urlId !== currentId)) {
      console.log('[PlayPage] Detected source/id change from URL:', {
        urlSource,
        urlId,
        currentSource,
        currentId
      });

      // 检查新的source和id是否在可用源列表中
      const targetSource = availableSources.find(
        (source) => source.source === urlSource && source.id === urlId
      );

      if (targetSource) {
        console.log('[PlayPage] Found matching source in available sources, updating...');

        // 记录当前播放进度
        const currentPlayTime = artPlayerRef.current?.currentTime || 0;

        // 获取URL中的episode参数
        const episodeParam = searchParams.get('episode');
        const targetEpisode = episodeParam ? parseInt(episodeParam, 10) - 1 : 0;

        // 更新视频源信息
        setCurrentSource(urlSource);
        setCurrentId(urlId);
        setVideoTitle(targetSource.title);
        setVideoYear(targetSource.year);
        setVideoCover(targetSource.poster);
        setVideoDoubanId(targetSource.douban_id || 0);
        setDetail(targetSource);

        // 更新集数
        if (targetEpisode >= 0 && targetEpisode < targetSource.episodes.length) {
          setCurrentEpisodeIndex(targetEpisode);

          // 如果是同一集,保存播放进度以便恢复
          if (targetEpisode === currentEpisodeIndex && currentPlayTime > 1) {
            resumeTimeRef.current = currentPlayTime;
          } else {
            resumeTimeRef.current = null;
          }
        }
      } else {
        console.log('[PlayPage] Source not found in available sources, reloading page...');
        // 如果新源不在可用列表中,强制刷新页面重新加载
        window.location.reload();
      }
    }
  }, [searchParams, currentSource, currentId, availableSources, currentEpisodeIndex]);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  // 检查集数是否被过滤
  const isEpisodeFilteredByTitle = (title: string): boolean => {
    const filterConfig = episodeFilterConfigRef.current;
    if (!filterConfig || filterConfig.rules.length === 0) {
      return false;
    }

    for (const rule of filterConfig.rules) {
      if (!rule.enabled) continue;

      try {
        if (rule.type === 'normal' && title.includes(rule.keyword)) {
          return true;
        }
        if (rule.type === 'regex' && new RegExp(rule.keyword).test(title)) {
          return true;
        }
      } catch (e) {
        console.error('集数过滤规则错误:', e);
      }
    }
    return false;
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;

    if (!d || !d.episodes || idx >= d.episodes.length - 1) {
      return;
    }

    // 保存当前进度
    if (artPlayerRef.current && !artPlayerRef.current.paused) {
      saveCurrentPlayProgress();
    }

    // 查找下一个未被过滤的集数
    let nextIdx = idx + 1;
    while (nextIdx < d.episodes.length) {
      const episodeTitle = d.episodes_titles?.[nextIdx];
      const isFiltered = episodeTitle && isEpisodeFilteredByTitle(episodeTitle);

      if (!isFiltered) {
        setCurrentEpisodeIndex(nextIdx);
        return;
      }
      nextIdx++;
    }

    // 所有后续集数都被屏蔽
    if (artPlayerRef.current) {
      artPlayerRef.current.notice.show = '后续集数均已屏蔽';
      artPlayerRef.current.pause();
    }
  };

  // ---------------------------------------------------------------------------
  // 弹幕处理函数
  // ---------------------------------------------------------------------------
  // 加载弹幕到播放器
  const loadDanmaku = async (episodeId: number) => {
    if (!danmakuPluginRef.current) {
      console.warn('弹幕插件未初始化');
      return;
    }

    setDanmakuLoading(true);

    try {
      // 先清空当前弹幕并隐藏
      danmakuPluginRef.current.hide();
      danmakuPluginRef.current.config({
        danmuku: [],
      });
      danmakuPluginRef.current.load();

      // 获取弹幕数据
      const comments = await getDanmakuById(episodeId);

      if (comments.length === 0) {
        console.warn('未获取到弹幕数据');
        setDanmakuLoading(false);
        return;
      }

      // 转换弹幕格式
      let danmakuData = convertDanmakuFormat(comments);

      // 手动应用过滤规则（因为缓存的弹幕不会经过播放器的 filter 函数）
      const filterConfig = danmakuFilterConfigRef.current;
      if (filterConfig && filterConfig.rules.length > 0) {
        const originalCount = danmakuData.length;
        danmakuData = danmakuData.filter((danmu) => {
          for (const rule of filterConfig.rules) {
            // 跳过未启用的规则
            if (!rule.enabled) continue;

            try {
              if (rule.type === 'normal') {
                // 普通模式：字符串包含匹配
                if (danmu.text.includes(rule.keyword)) {
                  return false;
                }
              } else if (rule.type === 'regex') {
                // 正则模式：正则表达式匹配
                if (new RegExp(rule.keyword).test(danmu.text)) {
                  return false;
                }
              }
            } catch (e) {
              console.error('弹幕过滤规则错误:', e);
            }
          }
          return true;
        });
        const filteredCount = originalCount - danmakuData.length;
        if (filteredCount > 0) {
          console.log(`弹幕过滤: 原始 ${originalCount} 条，过滤 ${filteredCount} 条，剩余 ${danmakuData.length} 条`);
        }
      }

      // 加载弹幕到插件，同时应用当前的弹幕设置
      const currentSettings = danmakuSettingsRef.current;
      danmakuPluginRef.current.config({
        danmuku: danmakuData,
        speed: currentSettings.speed,
        opacity: currentSettings.opacity,
        fontSize: currentSettings.fontSize,
        margin: [currentSettings.marginTop, currentSettings.marginBottom],
        synchronousPlayback: currentSettings.synchronousPlayback,
      });
      danmakuPluginRef.current.load();

      // 根据设置显示或隐藏弹幕
      if (currentSettings.enabled) {
        danmakuPluginRef.current.show();
      } else {
        danmakuPluginRef.current.hide();
      }

      setDanmakuCount(danmakuData.length);
      console.log(`弹幕加载成功，共 ${danmakuData.length} 条`);

      // 延迟一下让用户看到弹幕数量
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      console.error('加载弹幕失败:', error);
      setDanmakuCount(0);
    } finally {
      setDanmakuLoading(false);
    }
  };

  // 处理弹幕选择
  const handleDanmakuSelect = async (selection: DanmakuSelection) => {
    setCurrentDanmakuSelection(selection);

    // 保存选择记忆（包含搜索关键词）
    saveDanmakuMemory(
      videoTitleRef.current,
      selection.animeId,
      selection.episodeId,
      selection.animeTitle,
      selection.episodeTitle,
      selection.searchKeyword // 保存用户使用的搜索关键词
    );

    // 获取该动漫的所有剧集列表
    try {
      const episodesResult = await getEpisodes(selection.animeId);
      if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
        setDanmakuEpisodesList(episodesResult.bangumi.episodes);
      }
    } catch (error) {
      console.error('获取弹幕剧集列表失败:', error);
    }

    // 加载弹幕
    await loadDanmaku(selection.episodeId);
  };

  // 处理用户选择弹幕源
  const handleDanmakuSourceSelect = async (selectedAnime: DanmakuAnime) => {
    setShowDanmakuSourceSelector(false);
    setDanmakuLoading(true);

    try {
      const title = videoTitleRef.current;
      console.log('[弹幕] 用户选择弹幕源 - 视频:', title, '弹幕源:', selectedAnime.animeTitle);

      // 获取剧集列表
      const episodesResult = await getEpisodes(selectedAnime.animeId);

      if (
        episodesResult.success &&
        episodesResult.bangumi.episodes.length > 0
      ) {
        // 保存剧集列表
        setDanmakuEpisodesList(episodesResult.bangumi.episodes);

        // 根据当前集数选择对应的弹幕
        const currentEp = currentEpisodeIndexRef.current;
        const episode =
          episodesResult.bangumi.episodes[
            Math.min(currentEp, episodesResult.bangumi.episodes.length - 1)
          ];

        if (episode) {
          const selection: DanmakuSelection = {
            animeId: selectedAnime.animeId,
            episodeId: episode.episodeId,
            animeTitle: selectedAnime.animeTitle,
            episodeTitle: episode.episodeTitle,
          };

          setCurrentDanmakuSelection(selection);

          // 保存选择记忆（使用当前搜索关键词）
          saveDanmakuMemory(
            title,
            selection.animeId,
            selection.episodeId,
            selection.animeTitle,
            selection.episodeTitle,
            currentSearchKeyword || undefined // 使用保存的搜索关键词
          );

          // 加载弹幕
          await loadDanmaku(episode.episodeId);

          console.log('用户选择弹幕源:', selection);
        }
      } else {
        console.warn('未找到剧集信息');
      }
    } catch (error) {
      console.error('加载弹幕失败:', error);
    } finally {
      setDanmakuLoading(false);
    }
  };

  // 手动重新选择弹幕源（忽略记忆）- 保留供将来使用
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleReselectDanmakuSource = async () => {
    const title = videoTitleRef.current;
    if (!title) {
      console.warn('视频标题为空，无法搜索弹幕');
      return;
    }

    console.log('[弹幕] 用户手动重新选择弹幕源 - 视频:', title);
    setDanmakuLoading(true);

    try {
      const searchResult = await searchAnime(title);

      if (searchResult.success && searchResult.animes.length > 0) {
        // 如果有多个匹配结果，让用户选择
        if (searchResult.animes.length > 1) {
          console.log(`[弹幕] 找到 ${searchResult.animes.length} 个弹幕源`);
          setDanmakuMatches(searchResult.animes);
          setShowDanmakuSourceSelector(true);
          setDanmakuLoading(false);
          return;
        }

        // 只有一个结果，直接使用
        const anime = searchResult.animes[0];
        await handleDanmakuSourceSelect(anime);
      } else {
        console.warn('[弹幕] 未找到匹配的弹幕');
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '未找到匹配的弹幕源';
        }
        setDanmakuLoading(false);
      }
    } catch (error) {
      console.error('[弹幕] 搜索失败:', error);
      setDanmakuLoading(false);
    }
  };

  // 自动搜索并加载弹幕
  const autoSearchDanmaku = async () => {
    const title = videoTitleRef.current;
    if (!title) {
      console.warn('视频标题为空，无法自动搜索弹幕');
      return;
    }

    console.log('[弹幕] 开始自动搜索 - 视频标题:', title);

    // 检查是否有记忆
    const memory = loadDanmakuMemory(title);
    if (memory) {
      console.log('[弹幕] 找到缓存 - 视频:', title, '→ 弹幕源:', memory.animeTitle);

      // 获取该动漫的所有剧集列表
      try {
        const episodesResult = await getEpisodes(memory.animeId);
        if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
          setDanmakuEpisodesList(episodesResult.bangumi.episodes);

          // 根据当前集数选择对应的弹幕
          const currentEp = currentEpisodeIndexRef.current;
          const episode =
            episodesResult.bangumi.episodes[
              Math.min(currentEp, episodesResult.bangumi.episodes.length - 1)
            ];

          if (episode) {
            const selection: DanmakuSelection = {
              animeId: memory.animeId,
              episodeId: episode.episodeId,
              animeTitle: memory.animeTitle,
              episodeTitle: episode.episodeTitle,
            };

            setCurrentDanmakuSelection(selection);

            // 更新选择记忆（保留原搜索词）
            saveDanmakuMemory(
              title,
              selection.animeId,
              selection.episodeId,
              selection.animeTitle,
              selection.episodeTitle,
              memory.searchKeyword // 保留原有的搜索关键词
            );

            console.log('[弹幕] 使用缓存成功，跳过搜索');
            lastLoadedEpisodeIdRef.current = episode.episodeId;
            await loadDanmaku(episode.episodeId);
            return; // 成功使用缓存，直接返回
          }
        }

        // 如果使用记忆加载失败（没有找到对应的剧集），清除该记忆并继续自动搜索
        console.warn('[弹幕] 缓存中没有找到对应剧集，清除缓存并重新搜索');
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '缓存的弹幕源失效，正在重新搜索...';
        }
        // 清除失效的记忆
        if (typeof window !== 'undefined') {
          try {
            const memoriesJson = localStorage.getItem('danmaku_memories');
            if (memoriesJson) {
              const memories = JSON.parse(memoriesJson);
              delete memories[title];
              localStorage.setItem('danmaku_memories', JSON.stringify(memories));
              console.log('[弹幕] 已清除失效的缓存');
            }
          } catch (e) {
            console.error('[弹幕] 清除缓存失败:', e);
          }
        }
      } catch (error) {
        console.error('[弹幕] 使用缓存加载失败:', error);
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '缓存的弹幕源失效，正在重新搜索...';
        }
        // 清除失效的记忆
        if (typeof window !== 'undefined') {
          try {
            const memoriesJson = localStorage.getItem('danmaku_memories');
            if (memoriesJson) {
              const memories = JSON.parse(memoriesJson);
              delete memories[title];
              localStorage.setItem('danmaku_memories', JSON.stringify(memories));
              console.log('[弹幕] 已清除失效的缓存');
            }
          } catch (e) {
            console.error('[弹幕] 清除缓存失败:', e);
          }
        }
      }
      // 如果缓存加载失败，继续执行后面的自动搜索逻辑
    }

    // 自动搜索弹幕
    setDanmakuLoading(true);

    // 优先使用保存的搜索关键词，否则使用视频标题
    const searchKeyword = memory?.searchKeyword || title;
    console.log('[弹幕] 搜索关键词:', searchKeyword, memory?.searchKeyword ? '(使用保存的关键词)' : '(使用视频标题)');

    try {
      const searchResult = await searchAnime(searchKeyword);

      if (searchResult.success && searchResult.animes.length > 0) {
        // 如果有多个匹配结果，让用户选择
        if (searchResult.animes.length > 1) {
          console.log(`找到 ${searchResult.animes.length} 个弹幕源，等待用户选择`);
          setDanmakuMatches(searchResult.animes);
          setCurrentSearchKeyword(searchKeyword); // 保存当前搜索关键词
          setShowDanmakuSourceSelector(true);
          setDanmakuLoading(false);
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = `找到 ${searchResult.animes.length} 个弹幕源，请选择`;
          }
          return;
        }

        // 只有一个结果，直接使用
        const anime = searchResult.animes[0];

        // 获取剧集列表
        const episodesResult = await getEpisodes(anime.animeId);

        if (
          episodesResult.success &&
          episodesResult.bangumi.episodes.length > 0
        ) {
          // 保存剧集列表
          setDanmakuEpisodesList(episodesResult.bangumi.episodes);

          // 根据当前集数选择对应的弹幕
          const currentEp = currentEpisodeIndexRef.current;
          const episode =
            episodesResult.bangumi.episodes[
              Math.min(currentEp, episodesResult.bangumi.episodes.length - 1)
            ];

          if (episode) {
            const selection: DanmakuSelection = {
              animeId: anime.animeId,
              episodeId: episode.episodeId,
              animeTitle: anime.animeTitle,
              episodeTitle: episode.episodeTitle,
            };

            setCurrentDanmakuSelection(selection);

            // 保存选择记忆（保存搜索关键词）
            saveDanmakuMemory(
              title,
              selection.animeId,
              selection.episodeId,
              selection.animeTitle,
              selection.episodeTitle,
              searchKeyword // 保存实际使用的搜索关键词
            );

            // 加载弹幕
            lastLoadedEpisodeIdRef.current = episode.episodeId;
            await loadDanmaku(episode.episodeId);

            console.log('自动搜索弹幕成功:', selection);
          }
        } else {
          console.warn('未找到剧集信息');
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '弹幕加载失败：未找到剧集信息';
          }
        }
      } else {
        console.warn('未找到匹配的弹幕');
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '未找到匹配的弹幕，可在弹幕选项卡手动搜索';
        }
      }
    } catch (error) {
      console.error('自动搜索弹幕失败:', error);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '弹幕加载失败，请检查网络或稍后重试';
      }
    } finally {
      setDanmakuLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度和清理资源
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };

    // 页面可见性变化时保存播放进度和释放 Wake Lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // 页面重新可见时，如果正在播放则重新请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  useEffect(() => {
    if (
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 检测是否为 iOS 设备（iPhone、iPad、iPod）
    const isIOS = (() => {
      if (typeof window === 'undefined') return false;

      const ua = navigator.userAgent;

      // 排除 Windows Phone（它的 UA 中也包含 iPhone）
      if ((window as any).MSStream) return false;

      // 方法1：检测 UA 中的 iOS 设备标识
      if (/iPad|iPhone|iPod/.test(ua)) {
        console.log('[设备检测] iOS 设备（通过 UA）:', ua);
        return true;
      }

      // 方法2：检测 iPad（iOS 13+ 桌面模式）
      // 条件：UA 包含 Mac + 支持触摸 + 不是 Windows/Linux
      const isMacUA = ua.includes('Mac OS X');
      const hasTouch = 'ontouchend' in document;
      const isNotWindows = !ua.includes('Windows');
      const isNotLinux = !ua.includes('Linux');

      if (isMacUA && hasTouch && isNotWindows && isNotLinux) {
        console.log('[设备检测] iPad 桌面模式:', { ua, hasTouch });
        return true;
      }

      console.log('[设备检测] 非 iOS 设备:', { ua, hasTouch });
      return false;
    })();

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      cleanupPlayer();
    }

    // 异步初始化播放器
    const initPlayer = async () => {
      try {
        // 动态导入播放器库
        const [ArtplayerModule, HlsModule, DanmukuPlugin] = await Promise.all([
          import('artplayer'),
          import('hls.js'),
          import('artplayer-plugin-danmuku'),
        ]);

        const Artplayer = ArtplayerModule.default;
        const Hls = HlsModule.default;
        const artplayerPluginDanmuku = DanmukuPlugin.default as any;

        // 创建自定义 HLS loader
        const CustomHlsJsLoader = createCustomHlsLoader(Hls);

        // 创建新的播放器实例
        Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        Artplayer.USE_RAF = true;

        artPlayerRef.current = new Artplayer({
          container: artRef.current!,
        url: videoUrl,
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: !isIOS,  // iOS 禁用原生全屏按钮，避免触发系统播放器
        fullscreenWeb: true,  // 保留网页全屏按钮（所有平台）
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#22c55e',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
          playsInline: true,
          'webkit-playsinline': 'true',
        } as any,
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加载');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }

            // 每次创建HLS实例时，都读取最新的blockAdEnabled状态
            const shouldUseCustomLoader = blockAdEnabledRef.current;

            const hls = new Hls({
              debug: false, // 关闭日志
              enableWorker: true, // WebWorker 解码，降低主线程压力
              lowLatencyMode: true, // 开启低延迟 LL-HLS

              /* 缓冲/内存相关 */
              maxBufferLength: 30, // 前向缓冲最大 30s，过大容易导致高延迟
              backBufferLength: 30, // 仅保留 30s 已播放内容，避免内存占用
              maxBufferSize: 60 * 1000 * 1000, // 约 60MB，超出后触发清理

              /* 自定义loader */
              loader: (shouldUseCustomLoader
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader) as any,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            // 额外确保 iOS 内联播放属性（防止全屏时使用系统播放器）
            video.setAttribute('playsinline', 'true');
            video.setAttribute('webkit-playsinline', 'true');
            (video as any).playsInline = true;
            (video as any).webkitPlaysInline = true;

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('网络错误，尝试恢复...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('无法恢复的错误');
                    hls.destroy();
                    break;
                }
              }
            });
          },
        },
        // 弹幕插件
        plugins: [
          artplayerPluginDanmuku({
            danmuku: [],
            speed: danmakuSettingsRef.current.speed,
            opacity: danmakuSettingsRef.current.opacity,
            fontSize: danmakuSettingsRef.current.fontSize,
            color: '#FFFFFF',
            mode: 0,
            margin: [danmakuSettingsRef.current.marginTop, danmakuSettingsRef.current.marginBottom],
            antiOverlap: true,
            synchronousPlayback: danmakuSettingsRef.current.synchronousPlayback,
            emitter: false,
            // 主题
            theme: 'dark',
            filter: (danmu: any) => {
              // 应用过滤规则
              const filterConfig = danmakuFilterConfigRef.current;
              if (filterConfig && filterConfig.rules.length > 0) {
                for (const rule of filterConfig.rules) {
                  // 跳过未启用的规则
                  if (!rule.enabled) continue;

                  try {
                    if (rule.type === 'normal') {
                      // 普通模式：字符串包含匹配
                      if (danmu.text.includes(rule.keyword)) {
                        return false;
                      }
                    } else if (rule.type === 'regex') {
                      // 正则模式：正则表达式匹配
                      if (new RegExp(rule.keyword).test(danmu.text)) {
                        return false;
                      }
                    }
                  } catch (e) {
                    console.error('弹幕过滤规则错误:', e);
                  }
                }
              }
              return true;
            },
          }),
        ],
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_) {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            html: '弹幕过滤',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="#ffffff"/><path d="M8 12h8" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/></svg>',
            tooltip: '配置弹幕过滤规则',
            onClick() {
              // 如果播放器处于全屏状态，先退出全屏
              if (artPlayerRef.current && artPlayerRef.current.fullscreen) {
                artPlayerRef.current.fullscreen = false;
                // 延迟一下再显示弹窗，确保全屏退出动画完成
                setTimeout(() => {
                  setShowDanmakuFilterSettings(true);
                }, 300);
              } else {
                setShowDanmakuFilterSettings(true);
              }
              return '打开设置';
            },
          },
          ...(webGPUSupported ? [
            {
              name: 'Anime4K超分',
              html: 'Anime4K超分',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-4 0-7-3-7-7V9l7-3.5L19 9v4c0 4-3 7-7 7z" fill="#ffffff"/><path d="M10 12l2 2 4-4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
              switch: anime4kEnabledRef.current,
              onSwitch: async function (item: any) {
                const newVal = !item.switch;
                await toggleAnime4K(newVal);
                return newVal;
              },
            },
            {
              name: '超分模式',
              html: '超分模式',
              selector: [
                {
                  html: 'ModeA (快速)',
                  value: 'ModeA',
                  default: anime4kModeRef.current === 'ModeA',
                },
                {
                  html: 'ModeB (平衡)',
                  value: 'ModeB',
                  default: anime4kModeRef.current === 'ModeB',
                },
                {
                  html: 'ModeC (质量)',
                  value: 'ModeC',
                  default: anime4kModeRef.current === 'ModeC',
                },
                {
                  html: 'ModeAA (增强快速)',
                  value: 'ModeAA',
                  default: anime4kModeRef.current === 'ModeAA',
                },
                {
                  html: 'ModeBB (增强平衡)',
                  value: 'ModeBB',
                  default: anime4kModeRef.current === 'ModeBB',
                },
                {
                  html: 'ModeCA (最高质量)',
                  value: 'ModeCA',
                  default: anime4kModeRef.current === 'ModeCA',
                },
              ],
              onSelect: async function (item: any) {
                await changeAnime4KMode(item.value);
                return item.html;
              },
            },
            {
              name: '超分倍数',
              html: '超分倍数',
              selector: [
                {
                  html: '1.5x',
                  value: '1.5',
                  default: anime4kScaleRef.current === 1.5,
                },
                {
                  html: '2.0x',
                  value: '2.0',
                  default: anime4kScaleRef.current === 2.0,
                },
                {
                  html: '3.0x',
                  value: '3.0',
                  default: anime4kScaleRef.current === 3.0,
                },
                {
                  html: '4.0x',
                  value: '4.0',
                  default: anime4kScaleRef.current === 4.0,
                },
              ],
              onSelect: async function (item: any) {
                await changeAnime4KScale(parseFloat(item.value));
                return item.html;
              },
            }
          ] : []),
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              // 安全地获取当前播放时间，避免循环依赖
              const player = artPlayerRef.current;
              if (player && player.currentTime) {
                const currentTime = player.currentTime || 0;
                if (currentTime > 0) {
                  const newConfig = {
                    ...skipConfigRef.current,
                    intro_time: currentTime,
                  };
                  handleSkipConfigChange(newConfig);
                  return `${formatTime(currentTime)}`;
                }
              }
              return '';
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              // 安全地获取播放器时长和当前时间，避免循环依赖
              const player = artPlayerRef.current;
              if (player && player.duration && player.currentTime) {
                const outroTime =
                  -(player.duration - player.currentTime) || 0;
                if (outroTime < 0) {
                  const newConfig = {
                    ...skipConfigRef.current,
                    outro_time: outroTime,
                  };
                  handleSkipConfigChange(newConfig);
                  return `-${formatTime(-outroTime)}`;
                }
              }
              return '';
            },
          },
        ],
        // 控制栏配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              // 房员禁用下一集按钮
              if (playSync.shouldDisableControls) {
                if (artPlayerRef.current) {
                  artPlayerRef.current.notice.show = '房员无法切换集数，请等待房主操作';
                }
                return;
              }
              handleNextEpisode();
            },
          },
          // iOS 设备上添加自定义全屏按钮（横屏和竖屏都显示）
          ...(isIOS ? [{
            position: 'right',
            index: 100,  // 大数字确保在设置按钮右边
            html: '<i class="art-icon ios-portrait-fullscreen"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" fill="currentColor"/></svg></i>',
            tooltip: '全屏',
            style: {
              color: '#fff',
            },
            mounted: function($el: HTMLElement) {
              // 添加 CSS 样式：横屏和竖屏都显示
              const style = document.createElement('style');
              style.textContent = `
                /* iOS 自定义全屏按钮在所有方向都显示 */
                .ios-portrait-fullscreen {
                  display: inline-flex !important;
                }
                /* iOS 全屏选择对话框样式（遵循项目统一风格） */
                .ios-fullscreen-dialog {
                  position: fixed;
                  top: 0;
                  left: 0;
                  right: 0;
                  bottom: 0;
                  background: rgba(0, 0, 0, 0.6);
                  backdrop-filter: blur(4px);
                  z-index: 1000;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 16px;
                }
                .ios-fullscreen-dialog-content {
                  background: white;
                  border-radius: 16px;
                  max-width: 480px;
                  width: 100%;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                  overflow: hidden;
                }
                .dark .ios-fullscreen-dialog-content {
                  background: rgb(31, 41, 55);
                }

                /* 标题栏 */
                .ios-fullscreen-dialog-header {
                  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                  padding: 20px 24px;
                }
                .ios-fullscreen-dialog-title {
                  font-size: 20px;
                  font-weight: 700;
                  color: white;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                  margin-bottom: 6px;
                }
                .ios-fullscreen-dialog-title svg {
                  stroke: white;
                }
                .ios-fullscreen-dialog-subtitle {
                  font-size: 14px;
                  color: rgba(255, 255, 255, 0.9);
                  margin: 0;
                }

                /* 选项列表 */
                .ios-fullscreen-dialog-options {
                  padding: 16px;
                  display: flex;
                  flex-direction: column;
                  gap: 12px;
                }
                .ios-fullscreen-option {
                  display: flex;
                  align-items: center;
                  gap: 16px;
                  padding: 16px;
                  background: rgb(249, 250, 251);
                  border: 2px solid transparent;
                  border-radius: 12px;
                  cursor: pointer;
                  transition: all 0.2s;
                  text-align: left;
                }
                .dark .ios-fullscreen-option {
                  background: rgba(55, 65, 81, 0.5);
                }
                .ios-fullscreen-option:hover {
                  background: rgb(243, 244, 246);
                  border-color: #22c55e;
                  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.15);
                }
                .dark .ios-fullscreen-option:hover {
                  background: rgb(55, 65, 81);
                }
                .ios-fullscreen-option:active {
                  transform: scale(0.98);
                }

                /* 推荐选项 */
                .ios-fullscreen-option-recommended {
                  border-color: #22c55e;
                }

                /* 选项图标 */
                .ios-fullscreen-option-icon {
                  flex-shrink: 0;
                  width: 48px;
                  height: 48px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: white;
                  border-radius: 10px;
                  color: #22c55e;
                }
                .dark .ios-fullscreen-option-icon {
                  background: rgb(31, 41, 55);
                }
                .ios-fullscreen-option-recommended .ios-fullscreen-option-icon {
                  background: #22c55e;
                  color: white;
                }

                /* 选项内容 */
                .ios-fullscreen-option-content {
                  flex: 1;
                }
                .ios-fullscreen-option-title {
                  font-size: 16px;
                  font-weight: 600;
                  color: rgb(17, 24, 39);
                  margin-bottom: 4px;
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .dark .ios-fullscreen-option-title {
                  color: white;
                }
                .ios-fullscreen-option-badge {
                  display: inline-block;
                  padding: 2px 8px;
                  background: #22c55e;
                  color: white;
                  font-size: 12px;
                  font-weight: 500;
                  border-radius: 4px;
                }
                .ios-fullscreen-option-desc {
                  font-size: 13px;
                  color: rgb(107, 114, 128);
                  line-height: 1.4;
                }
                .dark .ios-fullscreen-option-desc {
                  color: rgb(156, 163, 175);
                }

                /* 箭头图标 */
                .ios-fullscreen-option-arrow {
                  flex-shrink: 0;
                  color: rgb(209, 213, 219);
                  transition: transform 0.2s;
                }
                .dark .ios-fullscreen-option-arrow {
                  color: rgb(75, 85, 99);
                }
                .ios-fullscreen-option:hover .ios-fullscreen-option-arrow {
                  transform: translateX(4px);
                  color: #22c55e;
                }

                /* 底部提示 */
                .ios-fullscreen-dialog-footer {
                  padding: 16px 24px;
                  background: rgb(249, 250, 251);
                  border-top: 1px solid rgb(229, 231, 235);
                  display: flex;
                  align-items: flex-start;
                  gap: 10px;
                  font-size: 12px;
                  color: rgb(107, 114, 128);
                  line-height: 1.5;
                }
                .dark .ios-fullscreen-dialog-footer {
                  background: rgba(17, 24, 39, 0.5);
                  border-top-color: rgb(55, 65, 81);
                  color: rgb(156, 163, 175);
                }
                .ios-fullscreen-dialog-footer svg {
                  flex-shrink: 0;
                  margin-top: 2px;
                  stroke: currentColor;
                }
              `;
              document.head.appendChild(style);
            },
            click: function () {
              if (!artPlayerRef.current) return;

              // 检测是否在 PWA 模式下
              const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                            window.matchMedia('(display-mode: fullscreen)').matches ||
                            (window.navigator as any).standalone === true;

              // 检查是否已经在原生全屏状态
              const isInNativeFullscreen = document.fullscreenElement !== null;

              // 如果已经在原生全屏状态，退出原生全屏
              if (isInNativeFullscreen) {
                document.exitFullscreen().catch((err: Error) => {
                  console.error('退出全屏失败:', err);
                });
                return;
              }

              // 如果已经在网页全屏状态，退出网页全屏
              if (artPlayerRef.current.fullscreenWeb) {
                artPlayerRef.current.fullscreenWeb = false;
                return;
              }

              // 如果在 PWA 模式下，直接使用容器全屏（可以隐藏状态栏）
              if (isPWA) {
                const container = artPlayerRef.current.template.$container;
                if (container && container.webkitEnterFullscreen) {
                  container.webkitEnterFullscreen().catch((err: Error) => {
                    console.error('PWA 全屏失败:', err);
                    // 如果失败，降级使用网页全屏
                    artPlayerRef.current.fullscreenWeb = true;
                  });
                } else {
                  // 不支持原生全屏，使用网页全屏
                  artPlayerRef.current.fullscreenWeb = true;
                }
                return;
              }

              // 非 PWA 模式：创建对话框（使用项目统一风格）
              const dialog = document.createElement('div');
              dialog.className = 'ios-fullscreen-dialog';
              dialog.innerHTML = `
                <div class="ios-fullscreen-dialog-content">
                  <!-- 标题栏 -->
                  <div class="ios-fullscreen-dialog-header">
                    <h3 class="ios-fullscreen-dialog-title">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" stroke="currentColor" stroke-width="2" fill="none"/>
                      </svg>
                      选择全屏模式
                    </h3>
                    <p class="ios-fullscreen-dialog-subtitle">
                      由于 iOS 系统限制，原生全屏会使用系统播放器，将无法显示弹幕及使用部分播放器功能。网页全屏可能无法完全占满屏幕，但可保留所有功能。
                    </p>
                  </div>

                  <!-- 选项列表 -->
                  <div class="ios-fullscreen-dialog-options">
                    <!-- 网页全屏选项 -->
                    <button class="ios-fullscreen-option ios-fullscreen-option-recommended" data-action="web">
                      <div class="ios-fullscreen-option-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                          <path d="M7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z" fill="currentColor"/>
                        </svg>
                      </div>
                      <div class="ios-fullscreen-option-content">
                        <div class="ios-fullscreen-option-title">
                          网页全屏
                          <span class="ios-fullscreen-option-badge">推荐</span>
                        </div>
                        <div class="ios-fullscreen-option-desc">
                          保留弹幕、控制栏等所有功能
                        </div>
                      </div>
                      <svg class="ios-fullscreen-option-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                    </button>

                    <!-- 原生全屏选项 -->
                    <button class="ios-fullscreen-option" data-action="native">
                      <div class="ios-fullscreen-option-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" stroke="currentColor" stroke-width="2"/>
                        </svg>
                      </div>
                      <div class="ios-fullscreen-option-content">
                        <div class="ios-fullscreen-option-title">
                          原生全屏
                        </div>
                        <div class="ios-fullscreen-option-desc">
                          使用系统播放器，部分功能不可用
                        </div>
                      </div>
                      <svg class="ios-fullscreen-option-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>

                  <!-- 底部提示 -->
                  <div class="ios-fullscreen-dialog-footer">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                      <path d="M12 16v-4m0-4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span>将网站添加到主屏幕（PWA）后，网页全屏可以完全全屏</span>
                  </div>
                </div>
              `;

              // 添加到页面
              document.body.appendChild(dialog);

              // 点击背景关闭
              dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                  document.body.removeChild(dialog);
                }
              });

              // 按钮点击事件
              const buttons = dialog.querySelectorAll('.ios-fullscreen-option');
              buttons.forEach(button => {
                button.addEventListener('click', () => {
                  const action = button.getAttribute('data-action');

                  if (action === 'web') {
                    // 网页全屏
                    if (artPlayerRef.current) {
                      artPlayerRef.current.fullscreenWeb = true;
                    }
                  } else if (action === 'native') {
                    // 原生全屏（尝试使用浏览器的全屏 API）
                    if (artPlayerRef.current && artPlayerRef.current.template.$video) {
                      const videoElement = artPlayerRef.current.template.$video;
                      if (videoElement.requestFullscreen) {
                        videoElement.requestFullscreen();
                      } else if ((videoElement as any).webkitEnterFullscreen) {
                        (videoElement as any).webkitEnterFullscreen();
                      }
                    }
                  }

                  // 关闭对话框
                  document.body.removeChild(dialog);
                });
              });
            },
          }] : []),
        ],
      });

      // 监听播放器事件
      artPlayerRef.current.on('ready', async () => {
        setError(null);

        // 标记播放器已就绪，触发 usePlaySync 设置事件监听器
        setPlayerReady(true);
        console.log('[PlayPage] Player ready, triggering sync setup');

        // iOS 设备：动态调整弹幕设置面板位置，避免被遮挡
        if (isIOS && artPlayerRef.current) {
          // 使用 MutationObserver 监听弹幕设置面板的显示
          let isAdjusting = false; // 防止重复调整的标记
          const observer = new MutationObserver(() => {
            if (isAdjusting) return; // 如果正在调整，跳过

            const panel = document.querySelector('.apd-config-panel') as HTMLElement;
            if (panel && panel.style.display !== 'none') {
              // 获取当前的 left 值
              const currentLeft = parseInt(panel.style.left || '0', 10);

              // 如果 left 值异常小（iOS 上只有 -5px），调整为正常值（-246px，比标准位置再往左 100px）
              if (currentLeft > -50) {
                isAdjusting = true; // 设置标记，防止重复触发
                const adjustedLeft = -246;
                panel.style.left = `${adjustedLeft}px`;
                console.log('[iOS] 已调整弹幕设置面板位置: 从', currentLeft, '调整为', adjustedLeft);

                // 延迟重置标记
                setTimeout(() => {
                  isAdjusting = false;
                }, 100);
              }
            }
          });

          // 监听整个播放器容器的 DOM 变化
          if (artRef.current) {
            observer.observe(artRef.current, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style', 'class']
            });
          }

          // 清理函数
          artPlayerRef.current.on('destroy', () => {
            observer.disconnect();
          });
        }

        // iOS 设备：监听屏幕方向变化，自动调整全屏状态
        if (isIOS && artPlayerRef.current) {
          const handleOrientationChange = () => {
            if (!artPlayerRef.current) return;

            // 获取当前屏幕方向
            const isLandscape = window.matchMedia('(orientation: landscape)').matches;
            const isPortrait = window.matchMedia('(orientation: portrait)').matches;

            console.log('[iOS] 屏幕方向变化:', {
              isLandscape,
              isPortrait,
              fullscreenWeb: artPlayerRef.current.fullscreenWeb
            });

            // 如果在网页全屏状态下旋转到横屏，切换到正常全屏
            if (artPlayerRef.current.fullscreenWeb && isLandscape) {
              console.log('[iOS] 横屏模式：从网页全屏切换到正常全屏');
              // 先退出网页全屏
              artPlayerRef.current.fullscreenWeb = false;
              // 延迟一下再进入正常全屏，确保布局已更新
              setTimeout(() => {
                if (artPlayerRef.current) {
                  artPlayerRef.current.fullscreenWeb = true;
                }
              }, 100);
            }
          };

          // 监听屏幕方向变化
          window.addEventListener('orientationchange', handleOrientationChange);
          // 也监听 resize 事件（某些设备上更可靠）
          window.addEventListener('resize', handleOrientationChange);

          // 清理函数
          artPlayerRef.current.on('destroy', () => {
            window.removeEventListener('orientationchange', handleOrientationChange);
            window.removeEventListener('resize', handleOrientationChange);
          });
        }

        // 从 art.storage 读取弹幕设置并应用
        if (artPlayerRef.current) {
          const storedDanmakuSettings = artPlayerRef.current.storage.get('danmaku_settings');
          if (storedDanmakuSettings) {
            // 合并存储的设置到当前设置
            const mergedSettings = {
              ...danmakuSettingsRef.current,
              ...storedDanmakuSettings,
            };
            setDanmakuSettings(mergedSettings);
            saveDanmakuSettings(mergedSettings);
          }
        }

        // 保存弹幕插件引用
        if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
          danmakuPluginRef.current = artPlayerRef.current.plugins.artplayerPluginDanmuku;

          // 监听弹幕配置变化事件
          artPlayerRef.current.on('artplayerPluginDanmuku:config', () => {
            if (danmakuPluginRef.current?.option) {
              const newSettings = {
                ...danmakuSettingsRef.current,
                opacity: danmakuPluginRef.current.option.opacity || danmakuSettingsRef.current.opacity,
                fontSize: danmakuPluginRef.current.option.fontSize || danmakuSettingsRef.current.fontSize,
                speed: danmakuPluginRef.current.option.speed || danmakuSettingsRef.current.speed,
                marginTop: (danmakuPluginRef.current.option.margin && danmakuPluginRef.current.option.margin[0]) ?? danmakuSettingsRef.current.marginTop,
                marginBottom: (danmakuPluginRef.current.option.margin && danmakuPluginRef.current.option.margin[1]) ?? danmakuSettingsRef.current.marginBottom,
              };

              // 保存到 localStorage 和 art.storage
              setDanmakuSettings(newSettings);
              saveDanmakuSettings(newSettings);
              if (artPlayerRef.current?.storage) {
                artPlayerRef.current.storage.set('danmaku_settings', newSettings);
              }

              console.log('弹幕设置已更新并保存:', newSettings);
            }
          });

          // 根据设置显示或隐藏弹幕
          if (danmakuSettingsRef.current.enabled) {
            danmakuPluginRef.current.show();
          } else {
            danmakuPluginRef.current.hide();
          }

          // 自动搜索并加载弹幕
          await autoSearchDanmaku();
        }

        // 播放器就绪后，如果正在播放则请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

      // 监听播放状态变化，控制 Wake Lock
      artPlayerRef.current.on('play', () => {
        requestWakeLock();
      });

      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        saveCurrentPlayProgress();
      });

      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
      });

      // 如果播放器初始化时已经在播放状态，则请求 Wake Lock
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // 监听视频可播放事件，这时恢复播放进度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        // 若存在需要恢复的播放进度，则跳转
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隐藏换源加载状态
        setIsVideoLoading(false);
      });

      // 监听视频时间更新事件，实现跳过片头片尾
      artPlayerRef.current.on('video:timeupdate', () => {
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;
        const now = Date.now();

        // 限制跳过检查频率为1.5秒一次
        if (now - lastSkipCheckRef.current < 1500) return;
        lastSkipCheckRef.current = now;

        // 跳过片头
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time
        ) {
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
            skipConfigRef.current.intro_time
          )})`;
        }

        // 跳过片尾
        if (
          skipConfigRef.current.outro_time < 0 &&
          duration > 0 &&
          currentTime >
            artPlayerRef.current.duration + skipConfigRef.current.outro_time
        ) {
          if (
            currentEpisodeIndexRef.current <
            (detailRef.current?.episodes?.length || 1) - 1
          ) {
            handleNextEpisode();
          } else {
            artPlayerRef.current.pause();
          }
          artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
            skipConfigRef.current.outro_time
          )})`;
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器错误:', err);
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
      });

      // 监听视频播放结束事件，自动播放下一集（房员禁用）
      artPlayerRef.current.on('video:ended', () => {
        // 房员禁用自动播放下一集
        if (playSync.shouldDisableControls) {
          console.log('[PlayPage] Member cannot auto-play next episode');
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '等待房主切换下一集';
          }
          return;
        }

        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;

        if (!d || !d.episodes || idx >= d.episodes.length - 1) {
          return;
        }

        // 查找下一个未被过滤的集数
        let nextIdx = idx + 1;
        while (nextIdx < d.episodes.length) {
          const episodeTitle = d.episodes_titles?.[nextIdx];
          const isFiltered = episodeTitle && isEpisodeFilteredByTitle(episodeTitle);

          if (!isFiltered) {
            setTimeout(() => {
              setCurrentEpisodeIndex(nextIdx);
            }, 1000);
            return;
          }
          nextIdx++;
        }

        // 所有后续集数都被屏蔽
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '后续集数均已屏蔽，已自动停止';
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000;
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }
      });

      artPlayerRef.current.on('pause', () => {
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      } catch (err) {
        console.error('创建播放器失败:', err);
        setError('播放器初始化失败');
      }
    };

    // 调用异步初始化函数
    initPlayer();
  }, [videoUrl, loading, blockAdEnabled, currentEpisodeIndex, detail]);

  // 当组件卸载时清理定时器、Wake Lock 和播放器资源
  useEffect(() => {
    return () => {
      // 清理定时器
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      // 释放 Wake Lock
      releaseWakeLock();

      // 清理Anime4K
      cleanupAnime4K();

      // 销毁播放器实例
      cleanupPlayer();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 动画影院图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>
                  {loadingStage === 'searching' && '🔍'}
                  {loadingStage === 'preferring' && '⚡'}
                  {loadingStage === 'fetching' && '🎬'}
                  {loadingStage === 'ready' && '✨'}
                </div>
                {/* 旋转光环 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮动粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 进度指示器 */}
            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'preferring' ||
                        loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'preferring'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'ready'
                      ? 'bg-green-500 scale-125'
                      : 'bg-gray-300'
                  }`}
                ></div>
              </div>

              {/* 进度条 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                      loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加载消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 错误图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脉冲效果 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>

              {/* 浮动错误粒子 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 错误信息 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            {/* 操作按钮 */}
            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      {/* 弹幕源选择对话框 */}
      {showDanmakuSourceSelector && danmakuMatches.length > 0 && (
        <div className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm'>
          <div className='relative w-full max-w-2xl max-h-[80vh] mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden'>
            {/* 标题栏 */}
            <div className='sticky top-0 z-10 bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-4'>
              <h3 className='text-xl font-bold text-white flex items-center gap-2'>
                <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z' />
                </svg>
                选择弹幕源
              </h3>
              <p className='text-sm text-white/90 mt-1'>
                找到 {danmakuMatches.length} 个匹配的弹幕源，请选择一个
              </p>
            </div>

            {/* 列表区域 */}
            <div className='overflow-y-auto max-h-[60vh] p-4'>
              <div className='space-y-4'>
                {danmakuMatches.map((anime, index) => (
                  <button
                    key={anime.animeId}
                    onClick={() => handleDanmakuSourceSelect(anime)}
                    className='w-full flex flex-col p-5 bg-gray-50 dark:bg-gray-700/50
                             hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all
                             duration-200 text-left group border-2 border-transparent
                             hover:border-green-500 hover:shadow-lg'
                  >
                    {/* 顶部：序号和标题 */}
                    <div className='flex items-start gap-3 mb-3'>
                      {/* 序号 */}
                      <div className='flex-shrink-0 w-8 h-8 rounded-full bg-green-500 text-white
                                    flex items-center justify-center font-bold text-sm
                                    group-hover:bg-green-600 transition-colors duration-200'>
                        {index + 1}
                      </div>

                      {/* 标题 */}
                      <h4 className='flex-1 text-lg font-bold text-gray-900 dark:text-white
                                   group-hover:text-green-600 dark:group-hover:text-green-400
                                   transition-colors duration-200 leading-tight'>
                        {anime.animeTitle}
                      </h4>

                      {/* 选择图标 */}
                      <div className='flex-shrink-0'>
                        <svg className='w-6 h-6 text-gray-400 group-hover:text-green-500
                                      transition-colors duration-200'
                             fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2}
                                d='M9 5l7 7-7 7' />
                        </svg>
                      </div>
                    </div>

                    {/* 主体内容 */}
                    <div className='flex gap-4'>
                      {/* 封面 */}
                      {anime.imageUrl && (
                        <div className='flex-shrink-0 w-20 h-28 rounded-lg overflow-hidden shadow-md
                                      group-hover:shadow-xl transition-shadow duration-200'>
                          <img
                            src={anime.imageUrl}
                            alt={anime.animeTitle}
                            className='w-full h-full object-cover'
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        </div>
                      )}

                      {/* 详细信息 */}
                      <div className='flex-1 space-y-2'>
                        {/* 基本信息标签 */}
                        <div className='flex flex-wrap gap-2'>
                          {anime.typeDescription && (
                            <span className='inline-flex items-center px-2.5 py-1 rounded-md
                                           bg-blue-100 dark:bg-blue-900/30 text-blue-700
                                           dark:text-blue-300 text-sm font-medium'>
                              📺 {anime.typeDescription}
                            </span>
                          )}
                          {anime.episodeCount && (
                            <span className='inline-flex items-center px-2.5 py-1 rounded-md
                                           bg-purple-100 dark:bg-purple-900/30 text-purple-700
                                           dark:text-purple-300 text-sm font-medium'>
                              🎬 {anime.episodeCount} 集
                            </span>
                          )}
                          {anime.startDate && (
                            <span className='inline-flex items-center px-2.5 py-1 rounded-md
                                           bg-gray-100 dark:bg-gray-600 text-gray-700
                                           dark:text-gray-300 text-sm font-medium'>
                              📅 {anime.startDate}
                            </span>
                          )}
                        </div>

                        {/* 动漫ID */}
                        <div className='text-xs text-gray-500 dark:text-gray-400'>
                          弹幕库 ID: {anime.animeId}
                        </div>

                        {/* 提示信息 */}
                        <div className='text-sm text-gray-600 dark:text-gray-300 pt-1
                                      opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                          点击选择此弹幕源
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className='sticky bottom-0 z-10 bg-white dark:bg-gray-800 border-t
                          border-gray-200 dark:border-gray-700 px-6 py-4'>
              <button
                onClick={() => {
                  setShowDanmakuSourceSelector(false);
                  setDanmakuMatches([]);
                }}
                className='w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-700
                         hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700
                         dark:text-gray-300 rounded-lg font-medium transition-colors
                         duration-200'
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片标题 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > ${
                  detail?.episodes_titles?.[currentEpisodeIndex] ||
                  `第 ${currentEpisodeIndex + 1} 集`
                }`}
              </span>
            )}
          </h1>
        </div>
        {/* 第二行：播放器和选集 */}
        <div className='space-y-2'>
          {/* 折叠控制 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 精致的状态指示点 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 flex flex-col ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              {/* 播放器容器 */}
              <div className='relative w-full h-[300px] lg:flex-1 lg:min-h-0'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                {/* 换源加载蒙层 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      {/* 动画影院图标 */}
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>🎬</div>
                          {/* 旋转光环 */}
                          <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>

                        {/* 浮动粒子效果 */}
                        <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                          <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                          <div
                            className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                            style={{ animationDelay: '0.5s' }}
                          ></div>
                          <div
                            className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                            style={{ animationDelay: '1s' }}
                          ></div>
                        </div>
                      </div>

                      {/* 换源消息 */}
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          {videoLoadingStage === 'sourceChanging'
                            ? '🔄 切换播放源...'
                            : '🔄 视频加载中...'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 弹幕加载蒙层 */}
                {danmakuLoading && (
                  <div className='absolute top-0 right-0 m-4 bg-black/80 backdrop-blur-sm rounded-lg px-4 py-2 z-[600] flex items-center gap-2 border border-green-500/30'>
                    {danmakuCount > 0 ? (
                      <>
                        <svg
                          className='w-4 h-4 text-green-500'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M5 13l4 4L19 7'
                          />
                        </svg>
                        <span className='text-sm font-medium text-green-400'>
                          已加载 {danmakuCount} 条弹幕
                        </span>
                      </>
                    ) : (
                      <>
                        <div className='w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin'></div>
                        <span className='text-sm font-medium text-green-400'>
                          加载弹幕中...
                        </span>
                      </>
                    )}
                  </div>
                )}

                
              </div>

              {/* 第三方应用打开按钮 - 观影室同步状态下隐藏 */}
              {videoUrl && !playSync.isInRoom && (
                <div className='mt-3 px-2 lg:flex-shrink-0 flex justify-end'>
                  <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 border border-gray-200/50 dark:border-gray-700/50 w-full lg:w-auto overflow-x-auto'>
                    <div className='flex gap-1.5 justify-between lg:flex-wrap items-center'>
                      <div className='flex gap-1.5 lg:flex-wrap'>
                        {/* 下载按钮 */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setShowDownloadSelector(true);
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-green-400 flex-shrink-0'
                          title='下载视频'
                        >
                          <svg
                            className='w-4 h-4 flex-shrink-0 text-white'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'
                            />
                          </svg>
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-white'>
                            下载
                          </span>
                        </button>

                        {/* PotPlayer */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(videoUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : videoUrl;
                            // URL encode 避免冒号被吃掉
                            window.open(`potplayer://${proxyUrl}`, '_blank');
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                          title='PotPlayer'
                        >
                          <img
                            src='/players/potplayer.png'
                            alt='PotPlayer'
                            className='w-4 h-4 flex-shrink-0'
                          />
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                            PotPlayer
                          </span>
                        </button>

                      {/* VLC */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(videoUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : videoUrl;
                          // URL encode 避免冒号被吃掉
                          window.open(`vlc://${proxyUrl}`, '_blank');
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                        title='VLC'
                      >
                        <img
                          src='/players/vlc.png'
                          alt='VLC'
                          className='w-4 h-4 flex-shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          VLC
                        </span>
                      </button>

                      {/* MPV */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(videoUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : videoUrl;
                          // URL encode 避免冒号被吃掉
                          window.open(`mpv://${proxyUrl}`, '_blank');
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                        title='MPV'
                      >
                        <img
                          src='/players/mpv.png'
                          alt='MPV'
                          className='w-4 h-4 flex-shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          MPV
                        </span>
                      </button>

                      {/* MX Player */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(videoUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : videoUrl;
                          window.open(
                            `intent://${proxyUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(
                              videoTitle
                            )};end`,
                            '_blank'
                          );
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                        title='MX Player'
                      >
                        <img
                          src='/players/mxplayer.png'
                          alt='MX Player'
                          className='w-4 h-4 flex-shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          MX Player
                        </span>
                      </button>

                      {/* nPlayer */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(videoUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : videoUrl;
                          window.open(`nplayer-${proxyUrl}`, '_blank');
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                        title='nPlayer'
                      >
                        <img
                          src='/players/nplayer.png'
                          alt='nPlayer'
                          className='w-4 h-4 flex-shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          nPlayer
                        </span>
                      </button>

                      {/* IINA */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(videoUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : videoUrl;
                          window.open(
                            `iina://weblink?url=${encodeURIComponent(
                              proxyUrl
                            )}`,
                            '_blank'
                          );
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                        title='IINA'
                      >
                        <img
                          src='/players/iina.png'
                          alt='IINA'
                          className='w-4 h-4 flex-shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          IINA
                        </span>
                      </button>
                      </div>

                      {/* 去广告开关 */}
                      <button
                        onClick={() => setExternalPlayerAdBlock(!externalPlayerAdBlock)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer border flex-shrink-0 ${
                          externalPlayerAdBlock
                            ? 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white border-blue-400'
                            : 'bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                        }`}
                        title={externalPlayerAdBlock ? '去广告已开启' : '去广告已关闭'}
                      >
                        <svg
                          className='w-4 h-4 flex-shrink-0'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          {externalPlayerAdBlock ? (
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                            />
                          ) : (
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636'
                            />
                          )}
                        </svg>
                        <span className='whitespace-nowrap'>
                          {externalPlayerAdBlock ? '去广告' : '去广告'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 选集和换源 - 在移动端始终显示，在 lg 及以上可折叠 */}
            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={playSync.shouldDisableControls ? () => { /* disabled */ } : handleEpisodeChange}
                onSourceChange={playSync.shouldDisableControls ? () => { /* disabled */ } : handleSourceChange}
                isRoomMember={playSync.shouldDisableControls}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
                onDanmakuSelect={handleDanmakuSelect}
                currentDanmakuSelection={currentDanmakuSelection}
                episodeFilterConfig={episodeFilterConfig}
                onFilterConfigUpdate={setEpisodeFilterConfig}
                onShowToast={(message, type) => {
                  setToast({ message, type, onClose: () => setToast(null) });
                }}
              />
            </div>
          </div>
        </div>

        {/* 详情展示 */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 标题 */}
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full flex-wrap gap-2'>
                <span className={doubanAka.length > 0 ? 'relative group cursor-help' : ''}>
                  {videoTitle || '影片标题'}
                  {/* aka 悬浮提示 */}
                  {doubanAka.length > 0 && (
                    <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 dark:bg-gray-900 text-white text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-out whitespace-nowrap z-[100] pointer-events-none'>
                      <div className='font-semibold text-xs text-gray-400 mb-1'>又名：</div>
                      {doubanAka.map((name, index) => (
                        <div key={index} className='text-sm'>
                          {name}
                        </div>
                      ))}
                      <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800 dark:border-t-gray-900'></div>
                    </div>
                  )}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='flex-shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
                {/* 豆瓣评分显示 */}
                {doubanRating && doubanRating.value > 0 && (
                  <div className='flex items-center gap-2 text-base font-normal'>
                    {/* 星级显示 */}
                    <div className='flex items-center gap-1'>
                      {[1, 2, 3, 4, 5].map((star) => {
                        const starValue = doubanRating.value / 2; // 转换为5星制
                        const isFullStar = star <= Math.floor(starValue);
                        const isHalfStar = !isFullStar && star <= Math.ceil(starValue) && starValue % 1 >= 0.25;

                        return (
                          <div key={star} className='relative w-5 h-5'>
                            {isFullStar ? (
                              // 全星
                              <svg
                                className='w-5 h-5 text-yellow-400 fill-yellow-400'
                                viewBox='0 0 24 24'
                                xmlns='http://www.w3.org/2000/svg'
                              >
                                <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                              </svg>
                            ) : isHalfStar ? (
                              // 半星
                              <>
                                {/* 空星背景 */}
                                <svg
                                  className='absolute w-5 h-5 text-gray-300 dark:text-gray-600 fill-gray-300 dark:fill-gray-600'
                                  viewBox='0 0 24 24'
                                  xmlns='http://www.w3.org/2000/svg'
                                >
                                  <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                                </svg>
                                {/* 半星遮罩 */}
                                <svg
                                  className='absolute w-5 h-5 text-yellow-400 fill-yellow-400'
                                  viewBox='0 0 24 24'
                                  xmlns='http://www.w3.org/2000/svg'
                                  style={{ clipPath: 'inset(0 50% 0 0)' }}
                                >
                                  <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                                </svg>
                              </>
                            ) : (
                              // 空星
                              <svg
                                className='w-5 h-5 text-gray-300 dark:text-gray-600 fill-gray-300 dark:fill-gray-600'
                                viewBox='0 0 24 24'
                                xmlns='http://www.w3.org/2000/svg'
                              >
                                <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                              </svg>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* 评分数值 */}
                    <span className='text-gray-700 dark:text-gray-300 font-semibold'>
                      {doubanRating.value.toFixed(1)}
                    </span>
                    {/* 评分人数 */}
                    <span className='text-gray-500 dark:text-gray-400 text-sm'>
                      ({doubanRating.count.toLocaleString()}人评价)
                    </span>
                  </div>
                )}
              </h1>

              {/* 关键信息行 */}
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {/* 优先使用 doubanYear，如果没有则使用 detail.year 或 videoYear */}
                {(doubanYear || detail?.year || videoYear) && (
                  <span>{doubanYear || detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {/* 剧情简介 */}
              {(doubanCardSubtitle || detail?.desc) && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {/* card_subtitle 在前，desc 在后 */}
                  {doubanCardSubtitle && (
                    <div className='mb-3 pb-3 border-b border-gray-300 dark:border-gray-700'>
                      {doubanCardSubtitle}
                    </div>
                  )}
                  {detail?.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='relative bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <>
                    <img
                      src={processImageUrl(videoCover)}
                      alt={videoTitle}
                      className='w-full h-full object-cover'
                    />

                    {/* 豆瓣链接按钮 */}
                    {videoDoubanId !== 0 && (
                      <a
                        href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='absolute top-3 left-3'
                      >
                        <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                          <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                          </svg>
                        </div>
                      </a>
                    )}
                  </>
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 豆瓣评论区域 */}
        {videoDoubanId !== 0 && enableComments && (
          <div className='mt-6 px-4'>
            <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden'>
              {/* 标题 */}
              <div className='px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2'>
                  <svg className='w-5 h-5' fill='currentColor' viewBox='0 0 24 24'>
                    <path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/>
                  </svg>
                  豆瓣评论
                </h3>
              </div>

              {/* 评论内容 */}
              <div className='p-6'>
                <DoubanComments doubanId={videoDoubanId} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast通知 */}
      {toast && <Toast {...toast} />}

      {/* 下载选集面板 */}
      <DownloadEpisodeSelector
        isOpen={showDownloadSelector}
        onClose={() => setShowDownloadSelector(false)}
        totalEpisodes={totalEpisodes}
        episodesTitles={detail?.episodes_titles || []}
        videoTitle={videoTitle}
        currentEpisodeIndex={currentEpisodeIndex}
        onDownload={handleDownloadEpisode}
        enableOfflineDownload={enableOfflineDownload}
        hasOfflinePermission={hasOfflinePermission}
      />

      {/* 弹幕过滤设置对话框 */}
      <DanmakuFilterSettings
        isOpen={showDanmakuFilterSettings}
        onClose={() => setShowDanmakuFilterSettings(false)}
        onConfigUpdate={(config) => {
          setDanmakuFilterConfig(config);
          danmakuFilterConfigRef.current = config;

          // 重新加载弹幕以应用新的过滤规则
          if (danmakuPluginRef.current) {
            try {
              danmakuPluginRef.current.load();
              console.log('弹幕过滤规则已更新，重新加载弹幕');
            } catch (error) {
              console.error('重新加载弹幕失败:', error);
            }
          }
        }}
        onShowToast={(message, type) => {
          setToast({
            message,
            type,
            onClose: () => setToast(null),
          });
        }}
      />
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
