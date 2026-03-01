/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { AlertCircle,Cloud, Heart, Sparkles, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  convertDanmakuFormat,
  getDanmakuById,
  getDanmakuFromCache,
  getEpisodes,
  initDanmakuModule,
  loadDanmakuDisplayState,
  loadDanmakuSettings,
  saveDanmakuDisplayState,
  saveDanmakuSettings,
  searchAnime,
} from '@/lib/danmaku/api';
import {
  getDanmakuAnimeId,
  getDanmakuSearchKeyword,
  getDanmakuSourceIndex,
  getManualDanmakuSelection,
  saveDanmakuAnimeId,
  saveDanmakuSearchKeyword,
  saveDanmakuSourceIndex,
  saveManualDanmakuSelection,
} from '@/lib/danmaku/selection-memory';
import type { DanmakuAnime, DanmakuComment,DanmakuSelection, DanmakuSettings } from '@/lib/danmaku/types';
import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getDanmakuFilterConfig,
  getEpisodeFilterConfig,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanDetail } from '@/lib/douban.client';
import { getTMDBImageUrl } from '@/lib/tmdb.search';
import { DanmakuFilterConfig, EpisodeFilterConfig,SearchResult } from '@/lib/types';
import { base58Decode, getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';
import { useEnableComments } from '@/hooks/useEnableComments';
import { usePlaySync } from '@/hooks/usePlaySync';

import AIChatPanel from '@/components/AIChatPanel';
import CorrectDialog from '@/components/CorrectDialog';
import DanmakuFilterSettings from '@/components/DanmakuFilterSettings';
import DetailPanel from '@/components/DetailPanel';
import DoubanComments from '@/components/DoubanComments';
import DownloadEpisodeSelector from '@/components/DownloadEpisodeSelector';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';
import PansouSearch from '@/components/PansouSearch';
import { useSite } from '@/components/SiteProvider';
import SmartRecommendations from '@/components/SmartRecommendations';
import Toast, { ToastProps } from '@/components/Toast';

import { useDownload } from '@/contexts/DownloadContext';

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
  const { siteName } = useSite();

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

  // TMDB背景图
  const [tmdbBackdrop, setTmdbBackdrop] = useState<string | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 网盘搜索弹窗状态
  const [showPansouDialog, setShowPansouDialog] = useState(false);

  // AI问片状态
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDefaultMessageWithVideo, setAiDefaultMessageWithVideo] = useState('');

  // 纠错弹窗状态
  const [showCorrectDialog, setShowCorrectDialog] = useState(false);

  // 详情面板状态
  const [showDetailPanel, setShowDetailPanel] = useState(false);

  // 检查AI功能是否启用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.AI_ENABLED &&
        (window as any).RUNTIME_CONFIG?.AI_ENABLE_PLAYPAGE_ENTRY;
      setAiEnabled(enabled);

      // 加载AI默认消息配置
      const defaultMsg = (window as any).RUNTIME_CONFIG?.AI_DEFAULT_MESSAGE_WITH_VIDEO;
      if (defaultMsg) {
        setAiDefaultMessageWithVideo(defaultMsg);
      }
    }
  }, []);

  // 网页全屏状态 - 控制导航栏的显示隐藏
  const [isWebFullscreen, setIsWebFullscreen] = useState(false);
  // 原生全屏状态
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  // 监听浏览器原生全屏事件
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement;
      setIsNativeFullscreen(isFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      clearRefreshTimer();
    };
  }, []);

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

        // 从 window.RUNTIME_CONFIG 获取版本号
        const version = (window as any).RUNTIME_CONFIG?.CUSTOM_AD_FILTER_VERSION || 0;

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

          // 获取完整代码
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
        // 修复anime4k-webgpu库的buffer size限制问题
        // 在全局层面patch requestAdapter，确保所有adapter都有正确的limits
        const originalRequestAdapter = (navigator as any).gpu.requestAdapter.bind((navigator as any).gpu);

        (navigator as any).gpu.requestAdapter = async (options?: any) => {
          const adapter = await originalRequestAdapter(options);
          if (!adapter) return adapter;

          // 保存原始的requestDevice方法
          const originalRequestDevice = adapter.requestDevice.bind(adapter);

          // 重写requestDevice方法，添加必要的buffer size限制
          adapter.requestDevice = async (descriptor?: any) => {
            const adapterLimits = adapter.limits;

            // 合并用户提供的descriptor和我们需要的limits
            const enhancedDescriptor = {
              ...descriptor,
              requiredLimits: {
                ...descriptor?.requiredLimits,
                // 使用adapter支持的最大值，但不超过2GB
                maxBufferSize: Math.min(adapterLimits.maxBufferSize || 2147483648, 2147483648),
                maxStorageBufferBindingSize: Math.min(adapterLimits.maxStorageBufferBindingSize || 1073741824, 1073741824),
              }
            };

            console.log('WebGPU设备请求配置:', enhancedDescriptor.requiredLimits);
            return originalRequestDevice(enhancedDescriptor);
          };

          return adapter;
        };

        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) {
          setWebGPUSupported(false);
          console.log('WebGPU不支持：无法获取GPU适配器');
          return;
        }

        setWebGPUSupported(true);
        console.log('WebGPU支持检测：✅ 支持');
        console.log('Adapter limits:', {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
        });
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
  const [danmakuOriginalCount, setDanmakuOriginalCount] = useState(0);
  const danmakuPluginRef = useRef<any>(null);
  const danmakuSettingsRef = useRef(danmakuSettings);

  // 弹幕显示状态的 ref，初始化时从 localStorage 读取
  const danmakuDisplayStateRef = useRef<boolean>(
    (() => {
      const saved = loadDanmakuDisplayState();
      return saved !== false; // null 或 true 都返回 true
    })()
  );

  // 弹幕热力图完全禁用开关（默认不禁用，即启用热力图功能）
  const [danmakuHeatmapDisabled, setDanmakuHeatmapDisabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('danmaku_heatmap_disabled');
      if (v !== null) return v === 'true';
    }
    return false; // 默认不禁用
  });
  const danmakuHeatmapDisabledRef = useRef(danmakuHeatmapDisabled);
  useEffect(() => {
    danmakuHeatmapDisabledRef.current = danmakuHeatmapDisabled;
  }, [danmakuHeatmapDisabled]);

  // 弹幕热力图开关（默认开启）
  const [danmakuHeatmapEnabled, setDanmakuHeatmapEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('danmaku_heatmap_enabled');
      if (v !== null) return v === 'true';
    }
    return true; // 默认开启
  });
  const danmakuHeatmapEnabledRef = useRef(danmakuHeatmapEnabled);
  useEffect(() => {
    danmakuHeatmapEnabledRef.current = danmakuHeatmapEnabled;
  }, [danmakuHeatmapEnabled]);

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

  // 更新浏览器标题
  useEffect(() => {
    if (videoTitle) {
      document.title = `${siteName} - ${videoTitle}`;
    } else {
      document.title = siteName;
    }
  }, [videoTitle, siteName]);
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

  // 纠错后的描述信息（用于显示，不触发 detail 更新）
  const [correctedDesc, setCorrectedDesc] = useState<string>('');

  // 当前源和ID - source 直接存储完整格式（如 'emby_wumei' 或 'emby'）
  const [currentSource, setCurrentSource] = useState(searchParams.get('source') || '');
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');
  const [fileName] = useState(searchParams.get('fileName') || ''); // 小雅源：用户点击的文件名
  const isDirectPlay = currentSource === 'directplay';

  // 解析 source 参数以获取 embyKey（仅用于 API 调用）
  const parseSourceForApi = (source: string): { source: string; embyKey?: string } => {
    if (source.startsWith('emby_')) {
      const key = source.substring(5);
      return { source: 'emby', embyKey: key };
    }
    return { source };
  };

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

  // 监听 URL 参数变化，当切换到不同视频时重新加载页面
  useEffect(() => {
    const urlTitle = searchParams.get('title') || '';
    const reloadParam = searchParams.get('_reload');

    // 只在有 _reload 参数且标题变化时才重新加载页面
    // 这样可以避免初始化、API返回、房间同步等场景的误触发
    // 只有用户主动点击推荐时才会添加 _reload 参数
    if (reloadParam && urlTitle && urlTitle !== videoTitle && !isSourceChangingRef.current) {
      console.log('[PlayPage] User clicked recommendation, reloading page');
      window.location.reload();
    }

    // 重置换源标记
    isSourceChangingRef.current = false;
  }, [searchParams, videoTitle]);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const isSourceChangingRef = useRef(false); // 标记是否正在换源

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

  // 当集数改变时，重置下集预缓存标记
  useEffect(() => {
    nextEpisodePreCacheTriggeredRef.current = false;
    nextEpisodeDanmakuPreloadTriggeredRef.current = false;
    // 清理之前的预缓存 HLS 实例
    if (nextEpisodePreCacheHlsRef.current) {
      try {
        nextEpisodePreCacheHlsRef.current.destroy();
      } catch (e) {
        console.error('清理预缓存 HLS 实例失败:', e);
      }
      nextEpisodePreCacheHlsRef.current = null;
    }
  }, [currentEpisodeIndex]);

  // 监听剧集切换，自动加载对应的弹幕
  const lastLoadedEpisodeIndexForDanmakuRef = useRef<number | null>(null);
  const loadingDanmakuEpisodeIdRef = useRef<number | null>(null);

  useEffect(() => {
    // 等待初始化完成（播放记录恢复完成）
    if (loading) {
      return;
    }

    if (isDirectPlay) {
      return;
    }

    // 检查是否禁用了自动装填弹幕
    const disableAutoLoad = localStorage.getItem('disableAutoLoadDanmaku') === 'true';
    if (disableAutoLoad) {
      console.log('[弹幕] 已禁用自动装填弹幕，跳过自动加载');
      return;
    }

    // 检查集数是否有效且是否已改变
    if (currentEpisodeIndex < 0 || !videoTitle) {
      return;
    }

    // 如果集数已经加载过，跳过
    if (lastLoadedEpisodeIndexForDanmakuRef.current === currentEpisodeIndex) {
      return;
    }

    // 标记当前集数已加载
    lastLoadedEpisodeIndexForDanmakuRef.current = currentEpisodeIndex;

    console.log(`[弹幕] 剧集切换到第 ${currentEpisodeIndex + 1} 集，自动加载弹幕`);

    // 立即清空当前弹幕（使用 reset 方法，不触发显示/隐藏事件）
    if (danmakuPluginRef.current) {
      danmakuPluginRef.current.reset();
      setDanmakuCount(0);
    }

    // 自动加载弹幕的逻辑
    const loadDanmakuForCurrentEpisode = async () => {
      const title = videoTitleRef.current;
      if (!title) {
        console.warn('[弹幕] 视频标题为空，无法加载弹幕');
        return;
      }

      const episodeIndex = currentEpisodeIndexRef.current;
      console.log(`[弹幕] 开始加载第 ${episodeIndex + 1} 集弹幕`);

      // 先尝试从 IndexedDB 缓存加载
      try {
        const cachedData = await getDanmakuFromCache(title, episodeIndex);
        if (cachedData && cachedData.comments.length > 0) {
          console.log(`[弹幕] 使用缓存: title="${title}", episodeIndex=${episodeIndex}, 数量=${cachedData.comments.length}`);

          // 如果弹幕插件还未初始化，等待初始化
          if (!danmakuPluginRef.current) {
            console.log('[弹幕] 弹幕插件未初始化，等待初始化...');
            // 缓存命中但插件未初始化，不执行搜索，等待下次触发
            return;
          }

          setDanmakuLoading(true);

          // 转换弹幕格式
          let danmakuData = convertDanmakuFormat(cachedData.comments);

          // 手动应用过滤规则
          const filterConfig = danmakuFilterConfigRef.current;
          if (filterConfig && filterConfig.rules.length > 0) {
            const originalCount = danmakuData.length;
            danmakuData = danmakuData.filter((danmu) => {
              for (const rule of filterConfig.rules) {
                if (!rule.enabled) continue;
                try {
                  if (rule.type === 'normal') {
                    if (danmu.text.includes(rule.keyword)) {
                      return false;
                    }
                  } else if (rule.type === 'regex') {
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

          // 应用弹幕数量限制
          const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
          let calculatedOriginalCount = 0;
          if (maxCount > 0 && danmakuData.length > maxCount) {
            const originalCount = danmakuData.length;
            const step = danmakuData.length / maxCount;
            const limitedData = [];
            for (let i = 0; i < maxCount; i++) {
              limitedData.push(danmakuData[Math.floor(i * step)]);
            }
            danmakuData = limitedData;
            calculatedOriginalCount = originalCount;
            setDanmakuOriginalCount(originalCount);
            console.log(`弹幕数量限制: 原始 ${originalCount} 条，限制到 ${danmakuData.length} 条`);
          } else {
            // 没有应用限制，不显示原始数量
            setDanmakuOriginalCount(0);
          }

          // 加载弹幕到插件
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

          // 根据保存的显示状态来决定显示或隐藏弹幕
          const savedDisplayState = loadDanmakuDisplayState();
          if (savedDisplayState === false) {
            danmakuPluginRef.current.hide();
          } else {
            danmakuPluginRef.current.show();
          }

          setDanmakuCount(danmakuData.length);
          console.log(`[弹幕] 缓存加载成功，共 ${danmakuData.length} 条`);

          // 更新当前选择状态（使用实时计算的数量）
          if (cachedData.metadata) {
            setCurrentDanmakuSelection({
              animeId: cachedData.metadata.animeId || 0,
              episodeId: cachedData.metadata.episodeId || 0,
              animeTitle: cachedData.metadata.animeTitle || '',
              episodeTitle: cachedData.metadata.episodeTitle || '',
              searchKeyword: cachedData.metadata.searchKeyword,
              danmakuCount: danmakuData.length,
              danmakuOriginalCount: calculatedOriginalCount > 0 ? calculatedOriginalCount : undefined,
            });
          }

          await new Promise((resolve) => setTimeout(resolve, 1500));
          setDanmakuLoading(false);

          return; // 使用缓存成功，直接返回
        }
      } catch (error) {
        console.error('[弹幕] 读取缓存失败:', error);
      }

      // 没有缓存，先检查是否有手动选择的剧集 ID
      console.log(`[弹幕] 第 ${episodeIndex + 1} 集缓存未命中`);

      // 检查是否有手动选择的剧集 ID
      const manualEpisodeId = getManualDanmakuSelection(title, episodeIndex);
      if (manualEpisodeId) {
        console.log(`[弹幕记忆] 使用手动选择的剧集 ID: ${manualEpisodeId}`);
        try {
          // 需要获取完整的 selection 信息来调用 handleDanmakuSelect
          // 但这里只有 episodeId，所以保持直接调用 loadDanmaku
          setDanmakuLoading(true);
          await loadDanmaku(manualEpisodeId);
          console.log('[弹幕记忆] 使用手动选择的弹幕成功');
          return; // 使用手动选择成功，直接返回
        } catch (error) {
          console.error('[弹幕记忆] 使用手动选择的弹幕失败:', error);
          // 继续执行自动搜索
        }
      }

      // 尝试使用保存的动漫ID自动匹配剧集
      const savedAnimeId = getDanmakuAnimeId(title);
      if (savedAnimeId) {
        console.log(`[弹幕记忆] 尝试使用保存的动漫ID: ${savedAnimeId}`);
        setDanmakuLoading(true);
        try {
          const episodesResult = await getEpisodes(savedAnimeId);

          if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
            // 根据当前集数选择对应的弹幕
            const videoEpTitle = detailRef.current?.episodes_titles?.[episodeIndex];
            const episode = matchDanmakuEpisode(episodeIndex, episodesResult.bangumi.episodes, videoEpTitle);

            if (episode) {
              console.log(`[弹幕记忆] 使用保存的动漫ID匹配成功: ${episode.episodeTitle}`);

              const selection: DanmakuSelection = {
                animeId: savedAnimeId,
                episodeId: episode.episodeId,
                animeTitle: episodesResult.bangumi.animeTitle,
                episodeTitle: episode.episodeTitle,
              };

              setDanmakuEpisodesList(episodesResult.bangumi.episodes);

              // 通过统一的 handleDanmakuSelect 处理弹幕加载
              await handleDanmakuSelect(selection);
              return; // 匹配成功，直接返回
            } else {
              console.log('[弹幕记忆] 使用保存的动漫ID匹配失败，降级到关键词搜索');
            }
          }
        } catch (error) {
          console.error('[弹幕记忆] 使用保存的动漫ID失败:', error);
        }
      }

      // 执行自动搜索弹幕（优先使用保存的关键词）
      console.log(`[弹幕] 开始自动搜索`);
      setDanmakuLoading(true);

      // 优先使用保存的搜索关键词，否则使用视频标题
      const savedKeyword = getDanmakuSearchKeyword(title);
      const searchKeyword = savedKeyword || title;
      console.log(`[弹幕] 搜索关键词: ${searchKeyword}${savedKeyword ? ' (使用保存的关键词)' : ' (使用视频标题)'}`);

      try {
        const searchResult = await searchAnime(searchKeyword);

        if (searchResult.success && searchResult.animes.length > 0) {
          // 应用智能过滤：优先匹配年份和标题
          const videoYear = detailRef.current?.year;
          const filteredAnimes = filterDanmakuSources(
            searchResult.animes,
            title,
            videoYear
          );

          // 如果有多个匹配结果，先检查是否有记忆的选择
          if (filteredAnimes.length > 1) {
            console.log(`找到 ${filteredAnimes.length} 个弹幕源`);

            // 检查是否有上次选择的下标
            const rememberedIndex = getDanmakuSourceIndex(title);
            if (rememberedIndex !== null && rememberedIndex < filteredAnimes.length) {
              console.log(`[弹幕记忆] 使用上次选择的弹幕源，下标: ${rememberedIndex}`);
              const anime = filteredAnimes[rememberedIndex];

              // 获取剧集列表
              const episodesResult = await getEpisodes(anime.animeId);

              if (
                episodesResult.success &&
                episodesResult.bangumi.episodes.length > 0
              ) {
                // 根据当前集数选择对应的弹幕
                const currentEp = currentEpisodeIndexRef.current;
                const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
                const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

                if (episode) {
                  const selection: DanmakuSelection = {
                    animeId: anime.animeId,
                    episodeId: episode.episodeId,
                    animeTitle: anime.animeTitle,
                    episodeTitle: episode.episodeTitle,
                  };

                  // 设置剧集列表
                  setDanmakuEpisodesList(episodesResult.bangumi.episodes);

                  console.log('使用记忆的弹幕源成功:', selection);

                  // 通过统一的 handleDanmakuSelect 处理弹幕加载
                  await handleDanmakuSelect(selection);
                  setDanmakuLoading(false);
                  return;
                }
              }
            }

            // 没有记忆或记忆失效，让用户选择
            console.log(`等待用户选择弹幕源`);
            setDanmakuMatches(filteredAnimes);
            setCurrentSearchKeyword(searchKeyword); // 保存当前搜索关键词
            setShowDanmakuSourceSelector(true);
            setDanmakuLoading(false);
            if (artPlayerRef.current) {
              artPlayerRef.current.notice.show = `找到 ${filteredAnimes.length} 个弹幕源，请选择`;
            }
            return;
          }

          // 只有一个结果，直接使用
          const anime = filteredAnimes[0];

          // 获取剧集列表
          const episodesResult = await getEpisodes(anime.animeId);

          if (
            episodesResult.success &&
            episodesResult.bangumi.episodes.length > 0
          ) {
            // 根据当前集数选择对应的弹幕
            const currentEp = currentEpisodeIndexRef.current;
            const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
            const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

            if (episode) {
              const selection: DanmakuSelection = {
                animeId: anime.animeId,
                episodeId: episode.episodeId,
                animeTitle: anime.animeTitle,
                episodeTitle: episode.episodeTitle,
              };

              // 设置剧集列表
              setDanmakuEpisodesList(episodesResult.bangumi.episodes);

              console.log('自动搜索弹幕成功:', selection);

              // 通过统一的 handleDanmakuSelect 处理弹幕加载
              await handleDanmakuSelect(selection);
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

    loadDanmakuForCurrentEpisode();
  }, [currentEpisodeIndex, videoTitle, loading, isDirectPlay]);

  // 获取豆瓣评分数据
  useEffect(() => {
    const fetchDoubanRating = async () => {
      if (isDirectPlay) {
        setDoubanRating(null);
        setDoubanCardSubtitle('');
        setDoubanAka([]);
        setDoubanYear('');
        return;
      }

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
  }, [videoDoubanId, isDirectPlay]);

  // 获取TMDB背景图
  useEffect(() => {
    const fetchTMDBBackdrop = async () => {
      if (isDirectPlay) {
        setTmdbBackdrop(null);
        return;
      }

      // 检查是否禁用背景图
      if (typeof window !== 'undefined') {
        const disabled = localStorage.getItem('tmdb_backdrop_disabled');
        if (disabled === 'true') {
          setTmdbBackdrop(null);
          return;
        }
      }

      if (!videoTitle) {
        setTmdbBackdrop(null);
        return;
      }

      try {
        // 检查title到tmdbId的映射缓存（1个月）
        const mappingCacheKey = `tmdb_title_mapping_${videoTitle}`;
        const mappingCache = localStorage.getItem(mappingCacheKey);
        let cachedId: string | null = null;

        if (mappingCache) {
          try {
            const { tmdbId, timestamp } = JSON.parse(mappingCache);
            const cacheAge = Date.now() - timestamp;
            const cacheMaxAge = 30 * 24 * 60 * 60 * 1000; // 1个月

            if (cacheAge < cacheMaxAge && tmdbId) {
              console.log('使用缓存的TMDB ID映射');
              cachedId = tmdbId;

              // 检查TMDB详情缓存（1天）
              const detailsCacheKey = `tmdb_details_${tmdbId}`;
              const detailsCache = localStorage.getItem(detailsCacheKey);

              if (detailsCache) {
                try {
                  const { data, timestamp: detTimestamp } = JSON.parse(detailsCache);
                  const detCacheAge = Date.now() - detTimestamp;
                  const detCacheMaxAge = 24 * 60 * 60 * 1000; // 1天

                  if (detCacheAge < detCacheMaxAge && data && data.backdrop) {
                    console.log('使用缓存的TMDB详情数据');
                    setTmdbBackdrop(processImageUrl(data.backdrop));

                    // 如果没有豆瓣ID，使用TMDb数据补充
                    if (!videoDoubanId || videoDoubanId === 0) {
                      populateDoubanFieldsFromTMDB(data);
                    }
                    return;
                  }
                } catch (e) {
                  console.error('解析详情缓存失败:', e);
                }
              }
            }
          } catch (e) {
            console.error('解析映射缓存失败:', e);
          }
        }

        // 构建请求URL
        const url = cachedId
          ? `/api/tmdb-details?cachedId=${encodeURIComponent(cachedId)}`
          : `/api/tmdb-details?title=${encodeURIComponent(videoTitle)}`;

        const response = await fetch(url);

        if (!response.ok) {
          console.log('获取TMDB详情失败');
          setTmdbBackdrop(null);
          return;
        }

        const result = await response.json();

        if (result.backdrop) {
          setTmdbBackdrop(processImageUrl(result.backdrop));

          // 如果没有豆瓣ID，使用TMDb数据补充
          if (!videoDoubanId || videoDoubanId === 0) {
            populateDoubanFieldsFromTMDB(result);
          }

          // 保存title到tmdbId的映射到localStorage（1个月）
          if (result.tmdbId) {
            try {
              localStorage.setItem(
                mappingCacheKey,
                JSON.stringify({
                  tmdbId: result.tmdbId,
                  timestamp: Date.now(),
                })
              );

              // 保存TMDB详情数据到localStorage（1天）
              const detailsCacheKey = `tmdb_details_${result.tmdbId}`;
              localStorage.setItem(
                detailsCacheKey,
                JSON.stringify({
                  data: result,
                  timestamp: Date.now(),
                })
              );
            } catch (e) {
              console.error('保存缓存失败:', e);
            }
          }
        } else {
          setTmdbBackdrop(null);
        }
      } catch (error) {
        console.error('获取TMDB背景图失败:', error);
        setTmdbBackdrop(null);
      }
    };

    // 辅助函数：使用TMDb数据填充豆瓣字段
    const populateDoubanFieldsFromTMDB = (tmdbData: any) => {
      // 设置评分
      if (tmdbData.rating) {
        const ratingValue = parseFloat(tmdbData.rating);
        setDoubanRating({
          value: ratingValue,
          count: 0, // TMDb不提供评分人数
          star_count: Math.round(ratingValue / 2), // 转换为5星制
        });
      }

      // 设置年份
      if (tmdbData.releaseDate) {
        const year = tmdbData.releaseDate.split('-')[0];
        setDoubanYear(year);
      }

      // 设置card_subtitle（优先使用genres标签，否则使用年份和类型）
      if (tmdbData.genres && Array.isArray(tmdbData.genres) && tmdbData.genres.length > 0) {
        const genreNames = tmdbData.genres.map((g: any) => g.name).join(' / ');
        setDoubanCardSubtitle(genreNames);
      } else if (tmdbData.mediaType && tmdbData.releaseDate) {
        // 兜底：如果没有genres，使用年份和类型
        const year = tmdbData.releaseDate.split('-')[0];
        const typeText = tmdbData.mediaType === 'movie' ? '电影' : '电视剧';
        setDoubanCardSubtitle(`${year} / ${typeText}`);
      }
    };

    fetchTMDBBackdrop();
  }, [videoTitle, videoDoubanId, isDirectPlay]);


  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 视频清晰度列表
  const [videoQualities, setVideoQualities] = useState<Array<{name: string, url: string}>>([]);

  // Xiaoya链接刷新相关状态
  const [isRefreshingUrl, setIsRefreshingUrl] = useState(false); // 是否正在刷新链接
  const retryCountRef = useRef(0); // 重试计数
  const lastRefreshTimeRef = useRef(0); // 上次刷新时间
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null); // 14分钟定时器
  const currentXiaoyaUrlRef = useRef<string>(''); // 当前xiaoya原始URL（用于刷新）
  const isInitialLoadRef = useRef(true); // 标记是否为首次加载

  // 视频源代理模式状态
  const [sourceProxyMode, setSourceProxyMode] = useState(false);

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;
  const directEpisodeLabel = detail?.episodes_titles?.[currentEpisodeIndex] || '直链';
  const shouldShowEpisodeLabel = totalEpisodes > 1 || isDirectPlay;
  const episodeLabel = isDirectPlay
    ? directEpisodeLabel
    : detail?.episodes_titles?.[currentEpisodeIndex] || `第 ${currentEpisodeIndex + 1} 集`;
  const playerEpisodeLabel = isDirectPlay
    ? directEpisodeLabel
    : `第${currentEpisodeIndex + 1}集`;

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
  const [backgroundSourcesLoading, setBackgroundSourcesLoading] = useState(false);

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
    Map<string, { quality: string; loadSpeed: string; pingTime: number; bitrate: string }>
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
  const [videoError, setVideoError] = useState<string | null>(null);

  // 播放器就绪状态（用于触发 usePlaySync 的事件监听器设置）
  const [playerReady, setPlayerReady] = useState(false);

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  // 下集预缓存相关
  const nextEpisodePreCacheTriggeredRef = useRef<boolean>(false);
  const nextEpisodePreCacheHlsRef = useRef<any>(null);
  const nextEpisodeDanmakuPreloadTriggeredRef = useRef<boolean>(false);

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

  // 判断剧集状态
  const getSeriesStatus = (detail: SearchResult | null): 'completed' | 'ongoing' | 'unknown' => {
    if (!detail) return 'unknown';

    // 方法1：通过 vod_remarks 判断
    if (detail.vod_remarks) {
      const remarks = detail.vod_remarks.toLowerCase();
      // 判定为完结的关键词
      const completedKeywords = ['全', '完结', '大结局', 'end', '完'];
      // 判定为连载的关键词
      const ongoingKeywords = ['更新至', '连载', '第', '更新到'];

      // 如果包含连载关键词，则为连载中
      if (ongoingKeywords.some(keyword => remarks.includes(keyword))) {
        return 'ongoing';
      }

      // 如果包含完结关键词，则为已完结
      if (completedKeywords.some(keyword => remarks.includes(keyword))) {
        return 'completed';
      }
    }

    // 方法2：通过 vod_total 和实际集数对比判断
    if (detail.vod_total && detail.vod_total > 0 && detail.episodes && detail.episodes.length > 0) {
      // 如果实际集数 >= 总集数，则为已完结
      if (detail.episodes.length >= detail.vod_total) {
        return 'completed';
      }
      // 如果实际集数 < 总集数，则为连载中
      return 'ongoing';
    }

    // 无法判断，返回 unknown
    return 'unknown';
  };

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 获取配置以获取权重信息
    let weightMap = new Map<string, number>();
    try {
      const configResponse = await fetch('/api/admin/config');
      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData.Config?.SourceConfig) {
          configData.Config.SourceConfig.forEach((source: any) => {
            weightMap.set(source.key, source.weight ?? 0);
          });
        }
      }
    } catch (error) {
      console.warn('获取配置失败，权重将使用默认值0:', error);
    }

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number; bitrate: string };
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
        bitrate: string;
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
      testResult: { quality: string; loadSpeed: string; pingTime: number; bitrate: string };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    // 如果所有测速都失败，仍然按权重排序返回
    if (successfulResults.length === 0) {
      console.warn('所有播放源测速都失败，按权重排序');
      const sortedByWeight = [...sources].sort((a, b) => {
        const weightA = weightMap.get(a.source) ?? 0;
        const weightB = weightMap.get(b.source) ?? 0;
        return weightB - weightA;
      });
      return sortedByWeight[0];
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
        maxPing,
        weightMap.get(result.source.source) ?? 0
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
    maxPing: number,
    weight: number = 0
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

    // 权重加分 - 直接加到总分上（0-100分）
    score += weight;

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

  /**
   * 刷新xiaoya链接（静默刷新，不改变videoUrl状态）
   * @param hls HLS实例
   * @param video 视频元素
   * @param isScheduled 是否为定时刷新（true=定时，false=错误触发）
   */
  const refreshXiaoyaUrl = async (
    hls: any,
    video: HTMLVideoElement,
    isScheduled = false
  ) => {
    // 防抖：距离上次刷新不足3秒则不刷新
    const now = Date.now();
    if (now - lastRefreshTimeRef.current < 3000) {
      console.log('[链接刷新] 防抖跳过');
      return false;
    }

    // 重试次数限制（仅对错误触发的刷新）
    if (!isScheduled && retryCountRef.current >= 3) {
      console.error('[链接刷新] 重试次数已达上限');
      setVideoError('链接已过期且刷新失败，请手动刷新页面');
      hls.destroy();
      return false;
    }

    // 检查是否有原始URL
    if (!currentXiaoyaUrlRef.current) {
      console.warn('[链接刷新] 无原始URL，跳过刷新');
      return false;
    }

    console.log(`[链接刷新] 开始刷新 (${isScheduled ? '定时' : '错误触发'})`);
    setIsRefreshingUrl(true);

    if (!isScheduled) {
      retryCountRef.current++;
    }
    lastRefreshTimeRef.current = now;

    try {
      // 保存当前播放进度
      const currentTime = video.currentTime;
      const isPaused = video.paused;

      console.log(`[链接刷新] 开始刷新 (${isScheduled ? '定时' : '错误触发'}), 当前时间:`, currentTime);

      // 重新获取播放链接（添加时间戳避免缓存）
      const separator = currentXiaoyaUrlRef.current.includes('?') ? '&' : '?';
      const fetchUrl = `${currentXiaoyaUrlRef.current}${separator}format=json&t=${Date.now()}`;

      const response = await fetch(fetchUrl);
      const data = await response.json();

      if (!data.url) {
        throw new Error('未获取到有效链接');
      }

      console.log('[链接刷新] 获取到新链接');

      // 先停止HLS加载
      hls.stopLoad();

      // 使用HLS的loadSource方法直接加载新链接（不改变videoUrl状态）
      hls.loadSource(data.url);

      // 监听加载完成事件，恢复播放进度
      const onManifestParsed = () => {
        // 从指定位置开始加载
        hls.startLoad(currentTime);

        // 等待视频可以seek
        const onLoadedData = () => {
          video.removeEventListener('loadeddata', onLoadedData);

          // 设置播放位置
          if (currentTime > 0) {
            video.currentTime = currentTime;

            // 等待seek完成
            const onSeeked = () => {
              console.log('[链接刷新] 刷新完成，恢复到:', video.currentTime);

              video.removeEventListener('seeked', onSeeked);

              // 恢复播放状态
              if (!isPaused) {
                video.play().catch(err => {
                  console.warn('[链接刷新] 自动播放失败:', err);
                });
              } else {
                // 确保暂停状态
                video.pause();
              }

              setIsRefreshingUrl(false);

              // 显示提示
              if (artPlayerRef.current) {
                artPlayerRef.current.notice.show = isScheduled
                  ? '链接已自动刷新'
                  : '链接已过期并自动刷新';
              }

              // 刷新成功，重置重试计数
              retryCountRef.current = 0;

              // 重新启动14分钟定时器
              startRefreshTimer(hls, video);
            };

            video.addEventListener('seeked', onSeeked, { once: true });
          } else {
            // 如果是从头开始
            if (!isPaused) {
              video.play().catch(err => {
                console.warn('[链接刷新] 自动播放失败:', err);
              });
            } else {
              // 确保暂停状态
              video.pause();
            }

            setIsRefreshingUrl(false);

            if (artPlayerRef.current) {
              artPlayerRef.current.notice.show = isScheduled
                ? '链接已自动刷新'
                : '链接已过期并自动刷新';
            }

            retryCountRef.current = 0;
            startRefreshTimer(hls, video);
          }
        };

        video.addEventListener('loadeddata', onLoadedData, { once: true });
      };

      // 使用 hls.constructor.Events 访问事件常量
      const HlsEvents = (hls.constructor as any).Events;
      hls.once(HlsEvents.MANIFEST_PARSED, onManifestParsed);

      // 添加超时保护（10秒内未加载完成则认为失败）
      setTimeout(() => {
        hls.off(HlsEvents.MANIFEST_PARSED, onManifestParsed);
        if (isRefreshingUrl) {
          console.error('[链接刷新] 加载超时');
          setIsRefreshingUrl(false);
          throw new Error('加载超时');
        }
      }, 10000);

      return true;
    } catch (error) {
      console.error('[链接刷新] 刷新失败:', error);
      setIsRefreshingUrl(false);

      // 如果是定时刷新失败，不显示错误（继续使用旧链接）
      if (isScheduled) {
        console.warn('[链接刷新] 定时刷新失败，继续使用旧链接');
        // 5分钟后再试一次
        setTimeout(() => {
          if (hls && video && currentXiaoyaUrlRef.current) {
            refreshXiaoyaUrl(hls, video, true);
          }
        }, 5 * 60 * 1000);
        return false;
      }

      // 错误触发的刷新失败，如果还有重试次数，延迟后再试
      if (retryCountRef.current < 3) {
        console.log(`[链接刷新] 2秒后重试 (${retryCountRef.current}/3)`);
        setTimeout(() => {
          if (hls && video && currentXiaoyaUrlRef.current) {
            refreshXiaoyaUrl(hls, video, false);
          }
        }, 2000);
      } else {
        setVideoError('链接刷新失败，请手动刷新页面');
        hls.destroy();
      }

      return false;
    }
  };

  /**
   * 启动14分钟定时刷新器
   */
  const startRefreshTimer = (hls: any, video: HTMLVideoElement) => {
    // 清除旧定时器
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    // 只对xiaoya源启动定时器
    if (!currentXiaoyaUrlRef.current) {
      return;
    }

    console.log('[定时刷新] 启动14分钟定时器');

    // 14分钟 = 840000毫秒
    refreshTimerRef.current = setTimeout(() => {
      console.log('[定时刷新] 14分钟到期，开始刷新');
      if (hls && video && currentXiaoyaUrlRef.current) {
        refreshXiaoyaUrl(hls, video, true);
      }
    }, 14 * 60 * 1000);
  };

  /**
   * 清除刷新定时器
   */
  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      console.log('[定时刷新] 清除定时器');
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  // 更新视频地址
  const updateVideoUrl = async (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    // 重置刷新相关状态
    retryCountRef.current = 0;
    lastRefreshTimeRef.current = 0;
    currentXiaoyaUrlRef.current = ''; // 清空旧的原始URL
    clearRefreshTimer(); // 清除旧的定时器
    isInitialLoadRef.current = true; // 重置为首次加载

    // 动态设置 referrer policy：不发送 Referer
    const existingMeta = document.querySelector('meta[name="referrer"]');
    if (!existingMeta) {
      const meta = document.createElement('meta');
      meta.name = 'referrer';
      meta.content = 'no-referrer';
      document.head.appendChild(meta);
    }

    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      // openlist 和 emby 源的剧集是懒加载的，如果 episodes 为空则跳过
      if ((detailData?.source === 'openlist' || detailData?.source === 'emby') && (!detailData.episodes || detailData.episodes.length === 0)) {
        return;
      }
      setVideoUrl('');
      return;
    }

    let newUrl = detailData?.episodes[episodeIndex] || '';

    // 如果是小雅或 openlist 接口，先请求获取真实 URL
    if (newUrl.startsWith('/api/xiaoya/play') || newUrl.startsWith('/api/openlist/play')) {
      try {
        // 保存原始URL（用于后续刷新）
        currentXiaoyaUrlRef.current = newUrl;

        // 添加 format=json 参数
        const separator = newUrl.includes('?') ? '&' : '?';
        const fetchUrl = `${newUrl}${separator}format=json`;

        const response = await fetch(fetchUrl);
        const data = await response.json();
        if (data.url) {
          newUrl = data.url;
          // 保存清晰度列表
          if (data.qualities && data.qualities.length > 0) {
            setVideoQualities(data.qualities);
          } else {
            setVideoQualities([]);
          }
        }
      } catch (error) {
        console.error('获取播放链接失败:', error);
        setVideoQualities([]);
        currentXiaoyaUrlRef.current = ''; // 获取失败，清空
      }
    } else {
      // 非小雅/openlist 源，清空清晰度列表
      setVideoQualities([]);
    }

    // 检查是否有本地下载的文件
    const hasLocalFile = await checkLocalDownload(currentSource, currentId, episodeIndex);

    if (hasLocalFile) {
      // 使用本地代理接口,URL以.m3u8结尾以便Artplayer自动识别
      newUrl = `/api/offline-download/local/${currentSource}/${currentId}/${episodeIndex}/playlist.m3u8`;
      console.log('使用本地下载文件播放:', newUrl);
    } else if (sourceProxyMode && newUrl) {
      // 如果视频源启用了代理模式,且不是本地下载,则通过代理播放
      newUrl = `/api/proxy/vod/m3u8?url=${encodeURIComponent(newUrl)}&source=${encodeURIComponent(currentSource)}`;
      console.log('使用代理模式播放:', newUrl);
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
  const cleanupPlayer = async () => {
    // 清除刷新定时器
    clearRefreshTimer();

    // 先清理Anime4K，避免GPU纹理错误
    await cleanupAnime4K();

    if (artPlayerRef.current) {
      try {
        // 在销毁前先移除弹幕显示/隐藏事件监听器，避免 destroy 时触发 hide 事件导致状态被错误保存
        if (artPlayerRef.current) {
          artPlayerRef.current.off('artplayerPluginDanmuku:show');
          artPlayerRef.current.off('artplayerPluginDanmuku:hide');
        }

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

        // 清空 DOM 容器，确保没有残留元素
        if (artRef.current) {
          artRef.current.innerHTML = '';
        }

        console.log('播放器资源已清理');
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
        artPlayerRef.current = null;
        // 即使出错也要清空容器
        if (artRef.current) {
          artRef.current.innerHTML = '';
        }
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
        anime4kRef.current.controller?.stop?.();
        anime4kRef.current = null;
        // 等待旧实例完全停止，避免双重渲染
        await new Promise(resolve => setTimeout(resolve, 100));
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

    // 广告关键字列表
    const adKeywords = [
      'sponsor',
      '/ad/',
      '/ads/',
      'advert',
      'advertisement',
      '/adjump',
      'redtraffic'
    ];

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // 跳过 #EXT-X-DISCONTINUITY 标识
      if (line.includes('#EXT-X-DISCONTINUITY')) {
        i++;
        continue;
      }

      // 如果是 EXTINF 行，检查下一行 URL 是否包含广告关键字
      if (line.includes('#EXTINF:')) {
        // 检查下一行 URL 是否包含广告关键字
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const containsAdKeyword = adKeywords.some(keyword =>
            nextLine.toLowerCase().includes(keyword.toLowerCase())
          );

          if (containsAdKeyword) {
            // 跳过 EXTINF 行和 URL 行
            i += 2;
            continue;
          }
        }
      }

      // 保留当前行
      filteredLines.push(line);
      i++;
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
              name: '跳过配置',
              html: '跳过配置',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0 && skipConfigRef.current.outro_time === 0
                  ? '设置跳过配置'
                  : `片头: ${formatTime(skipConfigRef.current.intro_time)} | 片尾: ${formatTime(Math.abs(skipConfigRef.current.outro_time))}`,
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
      id: string,
      title: string,
      fileNameParam?: string
    ): Promise<SearchResult[]> => {
      try {
        let url = `/api/source-detail?source=${source}&id=${id}&title=${encodeURIComponent(title)}`;
        // 如果有fileName参数（小雅源），添加到URL
        if (fileNameParam) {
          url += `&fileName=${encodeURIComponent(fileNameParam)}`;
        }
        const detailResponse = await fetch(url);
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        const sourcesWithCorrections = applyCorrectionsToSources([detailData]);
        setAvailableSources(sourcesWithCorrections);
        return sourcesWithCorrections;
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    // 规范化标题用于聚合（去除特殊符号、括号、空格和全角空格）
    const normalizeTitle = (title: string) => {
      return title
        .replace(/[\s\u3000]/g, '') // 去除空格和全角空格
        .replace(/[()（）[\]【】{}「」『』<>《》]/g, '') // 去除各种括号
        .replace(/[^\w\u4e00-\u9fa5]/g, ''); // 去除特殊符号，保留字母、数字、下划线和中文
    };

    // 辅助函数：获取视频类型
    const getType = (item: SearchResult): 'movie' | 'tv' => {
      // 1. Emby 和 OpenList 源：使用 type_name（基于 TMDB，最可靠）
      if (item.source === 'emby' || item.source?.startsWith('emby_') || item.source === 'openlist') {
        return item.type_name === '电影' ? 'movie' : 'tv';
      }

      // 2. API 采集源：综合判断
      const typeName = item.type_name?.toLowerCase() || '';

      // 2.1 明确包含"电影"或"movie"或"片"的，判断为电影
      if (typeName.includes('电影') || typeName.includes('movie') ||
          typeName.endsWith('片') && !typeName.includes('动漫')) {
        return 'movie';
      }

      // 2.2 包含"剧"、"动漫"、"综艺"等关键词的，判断为剧集
      if (typeName.includes('剧') || typeName.includes('动漫') ||
          typeName.includes('综艺') || typeName.includes('anime')) {
        return 'tv';
      }

      // 2.3 检查 episodes_titles：如果包含"第X集"，判断为剧集
      if (item.episodes_titles && item.episodes_titles.length > 0) {
        const firstTitle = item.episodes_titles[0] || '';
        if (/第\d+集|第\d+话|EP?\d+/i.test(firstTitle)) {
          return 'tv';
        }
      }

      // 2.4 兜底：使用 episodes.length（最不可靠）
      return item.episodes.length === 1 ? 'movie' : 'tv';
    };


    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        // 先检查 sessionStorage 中是否有缓存
        const cacheKey = `search_cache_${query.trim()}`;
        let results: SearchResult[] = [];

        if (typeof window !== 'undefined') {
          try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
              console.log('[Play] 使用 sessionStorage 缓存的搜索结果');
              const cachedData = JSON.parse(cached);

              // 处理缓存的搜索结果，根据规则过滤
           results = cachedData.filter(
                (result: SearchResult) =>
                  normalizeTitle(result.title).toLowerCase() ===
                    normalizeTitle(videoTitleRef.current).toLowerCase() &&
                  (videoYearRef.current
                    ? result.year.toLowerCase() === videoYearRef.current.toLowerCase() ||
              !result.year ||
                      result.year.trim() === '' ||
                      result.year === 'unknown' ||
                 !/^\d{4}$/.test(result.year)
              : true) &&
            (searchType
                    ? getType(result) === searchType
                    : true)
              );

              setAvailableSources(applyCorrectionsToSources(results));
              return results;
            }
          } catch (error) {
            console.error('[Play] 读取缓存失败:', error);
            // 继续执行 API 调用
          }
        }

        // 如果没有缓存，调用 API
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果，根据规则过滤
        results = data.results.filter(
          (result: SearchResult) =>
            normalizeTitle(result.title).toLowerCase() ===
              normalizeTitle(videoTitleRef.current).toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase() ||
                !result.year ||
                result.year.trim() === '' ||
                result.year === 'unknown' ||
                !/^\d{4}$/.test(result.year)
          : true) &&
            (searchType
              ? getType(result) === searchType
              : true)
        );
        setAvailableSources(applyCorrectionsToSources(results));
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
      if (currentSource === 'directplay') {
        if (!currentId) {
          setError('缺少直链地址');
          setLoading(false);
          return;
        }

        setLoading(true);
        setLoadingStage('fetching');
        setLoadingMessage('🎬 正在准备直链播放...');

        let directUrl = '';
        try {
          directUrl = base58Decode(currentId);
        } catch (decodeError) {
          console.error('直链地址解析失败:', decodeError);
          setError('直链地址解析失败');
          setLoading(false);
          return;
        }

        const directDetail: SearchResult = {
          id: currentId,
          title: '直链播放',
          poster: '',
          episodes: [directUrl],
          episodes_titles: ['直链'],
          source: 'directplay',
          source_name: '直链',
          class: '',
          year: '',
          desc: '',
          type_name: '',
          douban_id: 0,
        };

        setNeedPrefer(false);
        setCurrentSource('directplay');
        setCurrentId(currentId);
        setVideoTitle('直链播放');
        setVideoYear('');
        setVideoCover('');
        setVideoDoubanId(0);
        setCorrectedDesc('');
        setDetail(directDetail);
        setSourceProxyMode(false);
        setAvailableSources([directDetail]);
        setCurrentEpisodeIndex(0);
        setSourceSearchError(null);
        setSourceSearchLoading(false);
        setBackgroundSourcesLoading(false);

        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('source', 'directplay');
        newUrl.searchParams.set('id', currentId);
        newUrl.searchParams.delete('prefer');
        newUrl.searchParams.delete('fileName');
        window.history.replaceState({}, '', newUrl.toString());

        setLoadingStage('ready');
        setLoadingMessage('✨ 准备就绪，即将开始播放...');
        setTimeout(() => {
          setLoading(false);
        }, 500);
        return;
      }

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

      // 如果已经有了source和id，优先通过单个详情接口快速获取
      let detailData: SearchResult | null = null;
      let sourcesInfo: SearchResult[] = [];

      if (currentSource && currentId) {
        // 先快速获取当前源的详情
        try {
          // currentSource 已经是完整格式（如 'emby_wumei'）
          // 如果是小雅源且有fileName参数，传递给API
          const currentSourceDetail = await fetchSourceDetail(
            currentSource,
            currentId,
            searchTitle || videoTitle,
            currentSource === 'xiaoya' ? fileName : undefined
          );
          if (currentSourceDetail.length > 0) {
            detailData = currentSourceDetail[0];
            sourcesInfo = currentSourceDetail;
          }
        } catch (err) {
          console.error('获取当前源详情失败:', err);
        }

        // 异步获取其他源信息，不阻塞播放
        setBackgroundSourcesLoading(true);
        fetchSourcesData(searchTitle || videoTitle).then((sources) => {
          // 合并当前源和搜索到的其他源
          const allSources = [...sourcesInfo];
          sources.forEach((source) => {
            // 避免重复添加当前源
            if (!(source.source === currentSource && source.id === currentId)) {
              allSources.push(source);
            }
          });
          setAvailableSources(applyCorrectionsToSources(allSources));
          setBackgroundSourcesLoading(false);
        }).catch((err) => {
          console.error('异步获取其他源失败:', err);
          setBackgroundSourcesLoading(false);
        });
      } else {
        // 没有source和id，正常搜索流程
        sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      }

      if (!detailData && sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      if (!detailData) {
        detailData = sourcesInfo[0];
      }
      // 指定源和id且无需优选
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;

          // 如果是 openlist 或 emby 源且 episodes 为空，需要调用 detail 接口获取完整信息
          if ((detailData.source === 'openlist' || detailData.source === 'emby' || detailData.source.startsWith('emby_')) && (!detailData.episodes || detailData.episodes.length === 0)) {
            console.log('[Play] OpenList/Emby source has no episodes, fetching detail...');
            // currentSource 已经是完整格式
            const detailSources = await fetchSourceDetail(currentSource, currentId, searchTitle || videoTitle);
            if (detailSources.length > 0) {
              detailData = detailSources[0];
            }
          }
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

        // 过滤掉 openlist、所有 emby 源和 xiaoya 源，它们不参与测速
        const sourcesToTest = sourcesInfo.filter(s => {
          // 检查是否为 openlist
          if (s.source === 'openlist') return false;

          // 检查是否为 emby 源（包括 emby 和 emby_xxx 格式）
          if (s.source === 'emby' || s.source.startsWith('emby_')) return false;

          // 检查是否为 xiaoya 源
          if (s.source === 'xiaoya') return false;

          return true;
        });

        const excludedSources = sourcesInfo.filter(s =>
          s.source === 'openlist' ||
          s.source === 'emby' ||
          s.source.startsWith('emby_') ||
          s.source === 'xiaoya'
        );

        if (sourcesToTest.length > 0) {
          detailData = await preferBestSource(sourcesToTest);
        } else if (excludedSources.length > 0) {
          // 如果只有 openlist/emby/xiaoya 源，直接使用第一个
          detailData = excludedSources[0];
        } else {
          detailData = sourcesInfo[0];
        }
      }

      console.log(detailData.source, detailData.id);

      // 如果是 openlist 或 emby 源且 episodes 为空，需要调用 detail 接口获取完整信息
      if ((detailData.source === 'openlist' || detailData.source === 'emby') && (!detailData.episodes || detailData.episodes.length === 0)) {
        console.log('[Play] OpenList/Emby source has no episodes after selection, fetching detail...');
        const detailSources = await fetchSourceDetail(detailData.source, detailData.id, detailData.title || videoTitleRef.current);
        if (detailSources.length > 0) {
          detailData = detailSources[0];
        }
      }

      setNeedPrefer(false);
      // 直接使用 detailData.source（已经是完整格式）
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);

      // 如果是小雅源，检查并应用纠错信息
      if (detailData.source === 'xiaoya') {
        const correction = getXiaoyaCorrection(detailData.source, detailData.id);
        if (correction) {
          console.log('发现小雅源纠错信息，正在应用...', correction);
          detailData = applyCorrection(detailData, correction);
          // 同时设置纠错后的描述
          if (correction.overview) {
            setCorrectedDesc(correction.overview);
          }
        }
      }

      // 更新所有相关状态（在应用纠错信息之后）
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);

      setDetail(detailData);
      setSourceProxyMode(detailData.proxyMode || false); // 从 detail 数据中读取代理模式
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
      // 只有当元数据不是从文件获取时，才删除fileName参数
      if (detailData.metadataSource !== 'file') {
        newUrl.searchParams.delete('fileName');
      }
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 加载播放记录
      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(detailData.source, detailData.id);
        const record = allRecords[key];

        // 确定初始集数索引
        let initialIndex = 0;
        let shouldResumeTime = false;

        if (record) {
          // 有播放记录
          const recordIndex = record.index - 1;
          const recordTime = record.play_time;

          // 如果有initialEpisodeIndex（用户从文件点击进入）
          if (detailData.initialEpisodeIndex !== undefined) {
            // 如果播放记录的集数和点击的文件集数一致，则使用播放记录的时间
            if (recordIndex === detailData.initialEpisodeIndex) {
              initialIndex = recordIndex;
              shouldResumeTime = true;
              resumeTimeRef.current = recordTime;
              console.log('[Play] 播放记录集数与点击文件一致，恢复播放进度:', recordTime);
            } else {
              // 否则使用点击的文件集数，从头开始播放
              initialIndex = detailData.initialEpisodeIndex;
              console.log('[Play] 使用点击的文件集数:', initialIndex);
            }
          } else {
            // 没有initialEpisodeIndex，使用播放记录
            initialIndex = recordIndex;
            shouldResumeTime = true;
            resumeTimeRef.current = recordTime;
            console.log('[Play] 使用播放记录集数:', initialIndex);
          }
        } else {
          // 没有播放记录
          if (detailData.initialEpisodeIndex !== undefined) {
            // 使用点击的文件集数
            initialIndex = detailData.initialEpisodeIndex;
            console.log('[Play] 没有播放记录，使用点击的文件集数:', initialIndex);
          } else {
            // 默认从第0集开始
            initialIndex = 0;
            console.log('[Play] 没有播放记录，从第0集开始');
          }
        }

        // 更新当前选集索引
        if (initialIndex < detailData.episodes.length && initialIndex >= 0) {
          setCurrentEpisodeIndex(initialIndex);
          currentEpisodeIndexRef.current = initialIndex;
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
      // 检查新的source和id是否在可用源列表中
      // 如果 availableSources 还是空的，说明数据还在加载中，不做处理
      if (availableSources.length === 0) {
        return;
      }

      const targetSource = availableSources.find(
        (source) => source.source === urlSource && source.id === urlId
      );

      if (targetSource) {
        // 记录当前播放进度
        const currentPlayTime = artPlayerRef.current?.currentTime || 0;

        // 获取URL中的episode参数
        const episodeParam = searchParams.get('episode');
        const targetEpisode = episodeParam ? parseInt(episodeParam, 10) - 1 : 0;

        // 更新视频源信息（urlSource 已经是完整格式）
        setCurrentSource(urlSource);
        setCurrentId(urlId);
        setVideoTitle(targetSource.title);
        setVideoYear(targetSource.year);
        setVideoCover(targetSource.poster);
        setVideoDoubanId(targetSource.douban_id || 0);
        setDetail(targetSource);
        setSourceProxyMode(targetSource.proxyMode || false); // 从 detail 数据中读取代理模式

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
        // 如果新源不在可用列表中,强制刷新页面重新加载
        window.location.reload();
      }
    }
  }, [searchParams, currentSource, currentId, availableSources, currentEpisodeIndex]);

  // 监听 detail 和 currentEpisodeIndex 变化，动态更新字幕
  useEffect(() => {
    if (!artPlayerRef.current || !detail) return;

    const currentSubtitles = detail.subtitles?.[currentEpisodeIndex] || [];
    const savedSubtitleSize = typeof window !== 'undefined' ? localStorage.getItem('subtitleSize') || '2em' : '2em';

    // 如果有字幕，更新播放器字幕
    if (currentSubtitles.length > 0) {
      artPlayerRef.current.subtitle.switch(currentSubtitles[0].url, {
        type: 'vtt',
        style: {
          color: '#fff',
          fontSize: savedSubtitleSize,
        },
        encoding: 'utf-8',
      });

      // 移除旧的字幕设置，添加新的
      try {
        artPlayerRef.current.setting.remove('subtitle-selector');
      } catch (e) {
        // 忽略错误，可能设置项不存在
      }

      const subtitleOptions = [
        { html: '关闭', url: '' },
        ...currentSubtitles.map((sub: any) => ({
          html: sub.label,
          url: sub.url,
        })),
      ];

      artPlayerRef.current.setting.add({
        name: 'subtitle-selector',
        html: '字幕',
        selector: subtitleOptions,
        onSelect: function (item: any) {
          if (artPlayerRef.current) {
            if (item.url === '') {
              artPlayerRef.current.subtitle.show = false;
            } else {
              artPlayerRef.current.subtitle.switch(item.url, {
                name: item.html,
              });
              artPlayerRef.current.subtitle.show = true;
            }
          }
          return item.html;
        },
      });
    } else {
      // 没有字幕时，隐藏字幕并移除字幕设置
      artPlayerRef.current.subtitle.show = false;
      try {
        artPlayerRef.current.setting.remove('subtitle-selector');
      } catch (e) {
        // 忽略错误，可能设置项不存在
      }
    }
  }, [detail, currentEpisodeIndex]);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 标记正在换源，防止 title 变化触发页面刷新
      isSourceChangingRef.current = true;

      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);
      setVideoError(null);

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

      let newDetail: SearchResult | undefined = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 如果是 openlist 或 emby 源且 episodes 为空，需要调用 detail 接口获取完整信息
      if ((newDetail.source === 'openlist' || newDetail.source === 'emby' || newDetail.source.startsWith('emby_')) && (!newDetail.episodes || newDetail.episodes.length === 0)) {
        try {
          const detailResponse = await fetch(`/api/source-detail?source=${newSource}&id=${newId}&title=${encodeURIComponent(newTitle)}`);
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            if (!detailData) {
              throw new Error('获取的详情数据为空');
            }
            newDetail = detailData;
          } else {
            throw new Error('获取 openlist 详情失败');
          }
        } catch (err) {
          console.error('获取 openlist 详情失败:', err);
          setIsVideoLoading(false);
          setError('获取视频详情失败，请重试');
          return;
        }
      }

      // 再次确认 newDetail 不为空（类型守卫）
      if (!newDetail) {
        setError('视频详情数据无效');
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
      newUrl.searchParams.set('title', newDetail.title || newTitle);
      window.history.replaceState({}, '', newUrl.toString());

      // 如果是小雅源，检查并应用纠错信息
      let finalTitle = newDetail.title || newTitle;
      let finalCover = newDetail.poster;
      let finalDesc = '';

      if (newDetail.source === 'xiaoya') {
        const correction = getXiaoyaCorrection(newDetail.source, newDetail.id);
        if (correction) {
          console.log('换源到小雅源，发现纠错信息，正在应用...', correction);
          if (correction.title) {
            finalTitle = correction.title;
          }
          if (correction.posterPath) {
            finalCover = processImageUrl(getTMDBImageUrl(correction.posterPath));
          }
          if (correction.overview) {
            finalDesc = correction.overview;
          }
          // 应用纠错信息到 newDetail
          newDetail = applyCorrection(newDetail, correction);
        }
      }

      setVideoTitle(finalTitle);
      setVideoYear(newDetail.year);
      setVideoCover(finalCover);
      setCorrectedDesc(finalDesc);
      setVideoDoubanId(newDetail.douban_id || 0);
      // newSource 已经是完整格式
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setSourceProxyMode(newDetail.proxyMode || false); // 从 detail 数据中读取代理模式
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

  /**
   * 智能过滤弹幕源：优先匹配年份和标题完全相同的源
   * @param animes 所有搜索到的弹幕源
   * @param videoTitle 视频标题
   * @param videoYear 视频年份（如 "2024"）
   * @returns 过滤后的弹幕源列表
   */
  const filterDanmakuSources = (
    animes: DanmakuAnime[],
    videoTitle: string,
    videoYear?: string
  ): DanmakuAnime[] => {
    if (animes.length <= 1) return animes;

    // 标准化标题：移除空格、全角转半角
    const normalizeTitle = (title: string): string => {
      return title
        .replace(/\s+/g, '')
        .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .toLowerCase();
    };

    // 从日期字符串中提取年份（如 "2024-01" -> "2024"）
    const extractYear = (dateStr?: string): string | null => {
      if (!dateStr) return null;
      const match = dateStr.match(/^(\d{4})/);
      return match ? match[1] : null;
    };

    const normalizedVideoTitle = normalizeTitle(videoTitle);

    // 第一步：尝试同时匹配年份和标题
    if (videoYear) {
      const exactMatches = animes.filter((anime) => {
        const animeYear = extractYear(anime.startDate);
        const normalizedAnimeTitle = normalizeTitle(anime.animeTitle);
        return animeYear === videoYear && normalizedAnimeTitle === normalizedVideoTitle;
      });

      if (exactMatches.length > 0) {
        console.log(`[弹幕匹配] 找到 ${exactMatches.length} 个年份和标题完全匹配的源`);
        return exactMatches;
      }
    }

    // 第二步：如果没有完全匹配，尝试只匹配标题
    const titleMatches = animes.filter((anime) => {
      const normalizedAnimeTitle = normalizeTitle(anime.animeTitle);
      return normalizedAnimeTitle === normalizedVideoTitle;
    });

    if (titleMatches.length > 0) {
      console.log(`[弹幕匹配] 找到 ${titleMatches.length} 个标题完全匹配的源`);
      return titleMatches;
    }

    // 第三步：如果只匹配年份
    if (videoYear) {
      const yearMatches = animes.filter((anime) => {
        const animeYear = extractYear(anime.startDate);
        return animeYear === videoYear;
      });

      if (yearMatches.length > 0) {
        console.log(`[弹幕匹配] 找到 ${yearMatches.length} 个年份匹配的源`);
        return yearMatches;
      }
    }

    // 如果都没有匹配，返回所有源
    console.log('[弹幕匹配] 未找到精确匹配，返回所有源');
    return animes;
  };

  // 匹配弹幕集数：优先根据集数标题中的数字匹配，降级到索引匹配
  const matchDanmakuEpisode = (
    currentEpisodeIndex: number,
    danmakuEpisodes: Array<{ episodeId: number; episodeTitle: string }>,
    videoEpisodeTitle?: string
  ) => {
    if (!danmakuEpisodes.length) return null;

    const extractEpisodeNumber = (title: string): number | null => {
      if (!title) return null;

      // 优先匹配 Emby 格式：S01E01, S02E09 等
      const embyMatch = title.match(/[Ss]\d+[Ee](\d+)/);
      if (embyMatch) {
        return parseInt(embyMatch[1], 10);
      }

      // 降级到原本的策略：纯数字或"第X集/话"格式
      const match = title.match(/^(\d+)$|第?\s*(\d+)\s*[集话話]?/);
      return match ? parseInt(match[1] || match[2], 10) : null;
    };

    if (videoEpisodeTitle) {
      const episodeNum = extractEpisodeNumber(videoEpisodeTitle);
      if (episodeNum !== null) {
        for (const ep of danmakuEpisodes) {
          const danmakuNum = extractEpisodeNumber(ep.episodeTitle);
          if (danmakuNum === episodeNum) {
            console.log(`[弹幕匹配] 根据集数标题匹配: ${videoEpisodeTitle} -> ${ep.episodeTitle}`);
            return ep;
          }
        }
      }
    }

    const index = Math.min(currentEpisodeIndex, danmakuEpisodes.length - 1);
    console.log(`[弹幕匹配] 降级到索引匹配: 索引 ${currentEpisodeIndex} -> ${danmakuEpisodes[index].episodeTitle}`);
    return danmakuEpisodes[index];
  };

  // 加载弹幕到播放器
  const loadDanmaku = async (episodeId: number, metadata?: {
    animeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
    searchKeyword?: string;
    danmakuCount?: number;
  }) => {
    if (!danmakuPluginRef.current) {
      console.warn('弹幕插件未初始化');
      return;
    }

    // 防止重复加载同一个 episodeId
    if (loadingDanmakuEpisodeIdRef.current === episodeId) {
      console.log(`[弹幕加载] 跳过重复加载: episodeId=${episodeId}`);
      return;
    }

    loadingDanmakuEpisodeIdRef.current = episodeId;
    setDanmakuLoading(true);

    try {
      // 先清空当前弹幕（使用 reset 方法，不触发显示/隐藏事件）
      danmakuPluginRef.current.reset();
      // 强制清空屏幕上的弹幕
      danmakuPluginRef.current.config({ danmuku: [] });
      danmakuPluginRef.current.load();
      setDanmakuCount(0);

      // 获取弹幕数据（使用 title + episodeIndex 缓存）
      const title = videoTitleRef.current;
      const episodeIndex = currentEpisodeIndex;

      console.log(`[弹幕加载] episodeId=${episodeId}, title="${title}", episodeIndex=${episodeIndex}`);

      const comments = await getDanmakuById(episodeId, title, episodeIndex, metadata);

      if (comments.length === 0) {
        console.warn('未获取到弹幕数据');
        setDanmakuLoading(false);
        loadingDanmakuEpisodeIdRef.current = null;
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

      // 应用弹幕数量限制
      const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
      let calculatedOriginalCount = 0;
      if (maxCount > 0 && danmakuData.length > maxCount) {
        const originalCount = danmakuData.length;
        const step = danmakuData.length / maxCount;
        const limitedData = [];
        for (let i = 0; i < maxCount; i++) {
          limitedData.push(danmakuData[Math.floor(i * step)]);
        }
        danmakuData = limitedData;
        calculatedOriginalCount = originalCount;
        setDanmakuOriginalCount(originalCount);
        console.log(`弹幕数量限制: 原始 ${originalCount} 条，限制到 ${danmakuData.length} 条`);
      } else {
        setDanmakuOriginalCount(0);
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

      // 根据保存的显示状态来决定显示或隐藏弹幕
      const savedDisplayState = loadDanmakuDisplayState();
      if (savedDisplayState === false) {
        danmakuPluginRef.current.hide();
      } else {
        danmakuPluginRef.current.show();
      }

      setDanmakuCount(danmakuData.length);
      console.log(`弹幕加载成功，共 ${danmakuData.length} 条`);

      // 更新当前选择状态，包含弹幕数量
      if (metadata) {
        setCurrentDanmakuSelection({
          animeId: metadata.animeId || 0,
          episodeId: episodeId,
          animeTitle: metadata.animeTitle || '',
          episodeTitle: metadata.episodeTitle || '',
          searchKeyword: metadata.searchKeyword,
          danmakuCount: danmakuData.length,
          danmakuOriginalCount: calculatedOriginalCount > 0 ? calculatedOriginalCount : undefined,
        });
      }

      // 延迟一下让用户看到弹幕数量
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      console.error('加载弹幕失败:', error);
      setDanmakuCount(0);
    } finally {
      setDanmakuLoading(false);
      loadingDanmakuEpisodeIdRef.current = null;
    }
  };

  // 预加载下一集弹幕（完全复制 loadDanmakuForCurrentEpisode 的逻辑）
  const preloadNextEpisodeDanmaku = async () => {
    try {
      if (isDirectPlay) return;
      const disableAutoLoad = localStorage.getItem('disableAutoLoadDanmaku') === 'true';
      if (disableAutoLoad) return;

      const title = videoTitleRef.current;
      if (!title) {
        return;
      }

      const currentIdx = currentEpisodeIndexRef.current;
      const nextEpisodeIndex = currentIdx + 1;

      // 1. 检查是否有下一集
      const episodes = detailRef.current?.episodes;
      if (!episodes || nextEpisodeIndex >= episodes.length) {
        return;
      }

      // 2. 检查缓存是否已存在
      const cachedData = await getDanmakuFromCache(title, nextEpisodeIndex);
      if (cachedData && cachedData.comments.length > 0) {
        return;
      }

      // 3. 检查是否有手动选择的剧集 ID
      const manualEpisodeId = getManualDanmakuSelection(title, nextEpisodeIndex);
      if (manualEpisodeId) {
        try {
          await getDanmakuById(manualEpisodeId, title, nextEpisodeIndex);
          return;
        } catch (error) {
          // 继续执行后续逻辑
        }
      }

      // 4. 尝试使用保存的动漫ID自动匹配剧集
      const savedAnimeId = getDanmakuAnimeId(title);
      if (savedAnimeId) {
        try {
          const episodesResult = await getEpisodes(savedAnimeId);

          if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
            const nextVideoEpTitle = detailRef.current?.episodes_titles?.[nextEpisodeIndex];
            const episode = matchDanmakuEpisode(nextEpisodeIndex, episodesResult.bangumi.episodes, nextVideoEpTitle);

            if (episode) {
              await getDanmakuById(
                episode.episodeId,
                title,
                nextEpisodeIndex,
                {
                  animeId: savedAnimeId,
                  animeTitle: episodesResult.bangumi.animeTitle,
                  episodeTitle: episode.episodeTitle,
                }
              );
              return;
            }
          }
        } catch (error) {
          // 继续执行后续逻辑
        }
      }

      // 5. 执行自动搜索弹幕
      const savedKeyword = getDanmakuSearchKeyword(title);
      const searchKeyword = savedKeyword || title;

      const searchResult = await searchAnime(searchKeyword);
      if (!searchResult.success || searchResult.animes.length === 0) {
        return;
      }

      // 应用智能过滤
      const videoYear = detailRef.current?.year;
      const filteredAnimes = filterDanmakuSources(searchResult.animes, title, videoYear);

      if (filteredAnimes.length === 0) {
        return;
      }

      // 检查是否有记忆的选择
      let selectedAnime = filteredAnimes[0];
      if (filteredAnimes.length > 1) {
        const rememberedIndex = getDanmakuSourceIndex(title);
        if (rememberedIndex !== null && rememberedIndex < filteredAnimes.length) {
          selectedAnime = filteredAnimes[rememberedIndex];
        }
      }

      // 获取剧集列表并匹配
      const episodesResult = await getEpisodes(selectedAnime.animeId);
      if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
        const nextVideoEpTitle = detailRef.current?.episodes_titles?.[nextEpisodeIndex];
        const episode = matchDanmakuEpisode(nextEpisodeIndex, episodesResult.bangumi.episodes, nextVideoEpTitle);

        if (episode) {
          await getDanmakuById(
            episode.episodeId,
            title,
            nextEpisodeIndex,
            {
              animeId: selectedAnime.animeId,
              animeTitle: selectedAnime.animeTitle,
              episodeTitle: episode.episodeTitle,
              searchKeyword: searchKeyword,
            }
          );
        }
      }
    } catch (error) {
      // 静默处理失败
    }
  };

  // 处理上传弹幕
  const handleUploadDanmaku = async (comments: DanmakuComment[]) => {
    setDanmakuLoading(true);

    try {
      // 缓存到IndexedDB
      const title = videoTitleRef.current;
      const episodeIndex = currentEpisodeIndexRef.current;
      if (title) {
        const { saveDanmakuToCache } = await import('@/lib/danmaku/cache');
        await saveDanmakuToCache(title, episodeIndex, comments);
      }

      // 转换弹幕格式
      let danmakuData = convertDanmakuFormat(comments);

      // 应用过滤规则
      const filterConfig = danmakuFilterConfigRef.current;
      if (filterConfig && filterConfig.rules.length > 0) {
        danmakuData = danmakuData.filter((danmu) => {
          for (const rule of filterConfig.rules) {
            if (!rule.enabled) continue;
            try {
              if (rule.type === 'normal') {
                if (danmu.text.includes(rule.keyword)) return false;
              } else if (rule.type === 'regex') {
                if (new RegExp(rule.keyword).test(danmu.text)) return false;
              }
            } catch (e) {
              console.error('弹幕过滤规则错误:', e);
            }
          }
          return true;
        });
      }

      // 应用弹幕数量限制
      const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
      if (maxCount > 0 && danmakuData.length > maxCount) {
        const originalCount = danmakuData.length;
        const step = danmakuData.length / maxCount;
        const limitedData = [];
        for (let i = 0; i < maxCount; i++) {
          limitedData.push(danmakuData[Math.floor(i * step)]);
        }
        danmakuData = limitedData;
        setDanmakuOriginalCount(originalCount);
        console.log(`弹幕数量限制: 原始 ${originalCount} 条，限制到 ${danmakuData.length} 条`);
      } else {
        setDanmakuOriginalCount(0);
      }

      // 加载弹幕到播放器（使用 reset 方法清空，不触发显示/隐藏事件）
      if (danmakuPluginRef.current) {
        danmakuPluginRef.current.reset();

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

        // 触发自定义事件通知热力图更新
        if (artPlayerRef.current) {
          artPlayerRef.current.emit('danmaku:loaded');
        }

        // 根据保存的显示状态来决定显示或隐藏弹幕
        const savedDisplayState = loadDanmakuDisplayState();
        if (savedDisplayState === false) {
          danmakuPluginRef.current.hide();
        } else {
          danmakuPluginRef.current.show();
        }
      }

      setDanmakuCount(danmakuData.length);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = `上传成功，共 ${danmakuData.length} 条弹幕`;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      console.error('上传弹幕失败:', error);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '弹幕加载失败';
      }
    } finally {
      setDanmakuLoading(false);
    }
  };

  // 处理弹幕选择
  const handleDanmakuSelect = async (selection: DanmakuSelection, isManual = false) => {
    console.log(`[弹幕选择] isManual=${isManual}, selection:`, selection);
    setCurrentDanmakuSelection(selection);

    // 只有手动选择时才保存到 sessionStorage
    if (isManual) {
      const title = videoTitleRef.current;
      const episodeIndex = currentEpisodeIndexRef.current;
      if (title && episodeIndex >= 0) {
        saveManualDanmakuSelection(title, episodeIndex, selection.episodeId);

        // 保存用户手动选择的动漫ID（用于换集时自动匹配）
        saveDanmakuAnimeId(title, selection.animeId);

        // 保存搜索关键词（如果有的话）
        if (selection.searchKeyword) {
          saveDanmakuSearchKeyword(title, selection.searchKeyword);
          console.log(`[弹幕记忆] 保存手动搜索关键词: ${selection.searchKeyword}`);
        }
      }
    }

    // 加载弹幕，传递元信息
    await loadDanmaku(selection.episodeId, {
      animeId: selection.animeId,
      animeTitle: selection.animeTitle,
      episodeTitle: selection.episodeTitle,
      searchKeyword: selection.searchKeyword,
      danmakuCount: selection.danmakuCount,
    });
  };

  // 处理用户选择弹幕源
  const handleDanmakuSourceSelect = async (selectedAnime: DanmakuAnime, selectedIndex?: number, isManualSearch = false) => {
    setShowDanmakuSourceSelector(false);

    try {
      const title = videoTitleRef.current;
      console.log('[弹幕] 用户选择弹幕源 - 视频:', title, '弹幕源:', selectedAnime.animeTitle);

      // 如果提供了下标，保存到 sessionStorage
      if (selectedIndex !== undefined && title) {
        saveDanmakuSourceIndex(title, selectedIndex);
      }

      // 获取剧集列表
      const episodesResult = await getEpisodes(selectedAnime.animeId);

      if (
        episodesResult.success &&
        episodesResult.bangumi.episodes.length > 0
      ) {
        // 根据当前集数选择对应的弹幕
        const currentEp = currentEpisodeIndexRef.current;
        const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
        const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

        if (episode) {
          const selection: DanmakuSelection = {
            animeId: selectedAnime.animeId,
            episodeId: episode.episodeId,
            animeTitle: selectedAnime.animeTitle,
            episodeTitle: episode.episodeTitle,
          };

          // 设置剧集列表
          setDanmakuEpisodesList(episodesResult.bangumi.episodes);

          console.log('用户选择弹幕源:', selection);

          // 通过统一的 handleDanmakuSelect 处理弹幕加载
          // 只有从弹幕面板手动搜索选择时才标记为手动选择
          await handleDanmakuSelect(selection, isManualSearch);
        }
      } else {
        console.warn('未找到剧集信息');
      }
    } catch (error) {
      console.error('加载弹幕失败:', error);
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
        // 应用智能过滤：优先匹配年份和标题
        const videoYear = detailRef.current?.year;
        const filteredAnimes = filterDanmakuSources(
          searchResult.animes,
          title,
          videoYear
        );

        // 如果有多个匹配结果，让用户选择
        if (filteredAnimes.length > 1) {
          console.log(`[弹幕] 找到 ${filteredAnimes.length} 个弹幕源`);
          setDanmakuMatches(filteredAnimes);
          setShowDanmakuSourceSelector(true);
          setDanmakuLoading(false);
          return;
        }

        // 只有一个结果，直接使用
        const anime = filteredAnimes[0];
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
    if (isDirectPlay) return;
    const disableAutoLoad = localStorage.getItem('disableAutoLoadDanmaku') === 'true';
    if (disableAutoLoad) return;

    const title = videoTitleRef.current;
    if (!title) {
      console.warn('视频标题为空，无法自动搜索弹幕');
      return;
    }

    const currentEpisodeIndex = currentEpisodeIndexRef.current;
    console.log('[弹幕] 开始加载弹幕 - 视频标题:', title, '集数:', currentEpisodeIndex);

    // 先尝试从 IndexedDB 缓存加载
    try {
      const cachedData = await getDanmakuFromCache(title, currentEpisodeIndex);
      if (cachedData && cachedData.comments.length > 0) {
        console.log(`[弹幕] 使用缓存: title="${title}", episodeIndex=${currentEpisodeIndex}, 数量=${cachedData.comments.length}`);

        // 直接加载缓存的弹幕，不需要调用 API
        if (!danmakuPluginRef.current) {
          console.warn('弹幕插件未初始化');
          return;
        }

        setDanmakuLoading(true);

        // 转换弹幕格式
        let danmakuData = convertDanmakuFormat(cachedData.comments);

        // 手动应用过滤规则
        const filterConfig = danmakuFilterConfigRef.current;
        if (filterConfig && filterConfig.rules.length > 0) {
          const originalCount = danmakuData.length;
          danmakuData = danmakuData.filter((danmu) => {
            for (const rule of filterConfig.rules) {
              if (!rule.enabled) continue;
              try {
                if (rule.type === 'normal') {
                  if (danmu.text.includes(rule.keyword)) {
                    return false;
                  }
                } else if (rule.type === 'regex') {
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

        // 应用弹幕数量限制
        const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
        let calculatedOriginalCount = 0;
        if (maxCount > 0 && danmakuData.length > maxCount) {
          const originalCount = danmakuData.length;
          const step = danmakuData.length / maxCount;
          const limitedData = [];
          for (let i = 0; i < maxCount; i++) {
            limitedData.push(danmakuData[Math.floor(i * step)]);
          }
          danmakuData = limitedData;
          calculatedOriginalCount = originalCount;
          setDanmakuOriginalCount(originalCount);
          console.log(`弹幕数量限制: 原始 ${originalCount} 条，限制到 ${danmakuData.length} 条`);
        } else {
          // 没有应用限制，不显示原始数量
          setDanmakuOriginalCount(0);
        }

        // 加载弹幕到插件
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

        // 触发自定义事件通知热力图更新
        if (artPlayerRef.current) {
          artPlayerRef.current.emit('danmaku:loaded');
        }

        // 根据保存的显示状态来决定显示或隐藏弹幕
        const savedDisplayState = loadDanmakuDisplayState();
        if (savedDisplayState === false) {
          danmakuPluginRef.current.hide();
        } else {
          danmakuPluginRef.current.show();
        }

        setDanmakuCount(danmakuData.length);
        console.log(`[弹幕] 缓存加载成功，共 ${danmakuData.length} 条`);

        // 更新当前选择状态（使用实时计算的数量）
        if (cachedData.metadata) {
          setCurrentDanmakuSelection({
            animeId: cachedData.metadata.animeId || 0,
            episodeId: cachedData.metadata.episodeId || 0,
            animeTitle: cachedData.metadata.animeTitle || '',
            episodeTitle: cachedData.metadata.episodeTitle || '',
            searchKeyword: cachedData.metadata.searchKeyword,
            danmakuCount: danmakuData.length,
            danmakuOriginalCount: calculatedOriginalCount > 0 ? calculatedOriginalCount : undefined,
          });
        }

        // 延迟一下让用户看到弹幕数量
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setDanmakuLoading(false);

        return; // 使用缓存成功，直接返回
      }
    } catch (error) {
      console.error('[弹幕] 读取缓存失败:', error);
    }

    // 没有缓存，执行自动搜索弹幕
    console.log('[弹幕] 缓存未命中，开始搜索');
    setDanmakuLoading(true);

    // 优先使用保存的搜索关键词，否则使用视频标题
    const savedKeyword = getDanmakuSearchKeyword(title);
    const searchKeyword = savedKeyword || title;
    console.log(`[弹幕] 搜索关键词: ${searchKeyword}${savedKeyword ? ' (使用保存的关键词)' : ' (使用视频标题)'}`);

    try {
      const searchResult = await searchAnime(searchKeyword);

      if (searchResult.success && searchResult.animes.length > 0) {
        // 应用智能过滤：优先匹配年份和标题
        const videoYear = detailRef.current?.year;
        const filteredAnimes = filterDanmakuSources(
          searchResult.animes,
          title,
          videoYear
        );

        // 如果有多个匹配结果，让用户选择
        if (filteredAnimes.length > 1) {
          console.log(`找到 ${filteredAnimes.length} 个弹幕源，等待用户选择`);
          setDanmakuMatches(filteredAnimes);
          setCurrentSearchKeyword(searchKeyword); // 保存当前搜索关键词
          setShowDanmakuSourceSelector(true);
          setDanmakuLoading(false);
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = `找到 ${filteredAnimes.length} 个弹幕源，请选择`;
          }
          return;
        }

        // 只有一个结果，直接使用
        const anime = filteredAnimes[0];

        // 获取剧集列表
        const episodesResult = await getEpisodes(anime.animeId);

        if (
          episodesResult.success &&
          episodesResult.bangumi.episodes.length > 0
        ) {
          // 根据当前集数选择对应的弹幕
          const currentEp = currentEpisodeIndexRef.current;
          const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
          const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

          if (episode) {
            const selection: DanmakuSelection = {
              animeId: anime.animeId,
              episodeId: episode.episodeId,
              animeTitle: anime.animeTitle,
              episodeTitle: episode.episodeTitle,
            };

            // 设置剧集列表
            setDanmakuEpisodesList(episodesResult.bangumi.episodes);

            console.log('自动搜索弹幕成功:', selection);

            // 通过统一的 handleDanmakuSelect 处理弹幕加载
            await handleDanmakuSelect(selection);
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
          year: detailRef.current?.year || 'unknown',
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
          is_completed: getSeriesStatus(detailRef.current) === 'completed',
          vod_remarks: detailRef.current?.vod_remarks,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  // 纠错成功后的回调
  const handleCorrectSuccess = () => {
    if (!detail || detail.source !== 'xiaoya') return;

    // 从 localStorage 读取纠错信息
    const correction = getXiaoyaCorrection(detail.source, detail.id);
    if (correction) {
      console.log('应用纠错信息:', correction);

      // 只更新显示相关的状态，不更新 detail（避免触发其他 useEffect）
      if (correction.title) {
        setVideoTitle(correction.title);
      }
      if (correction.posterPath) {
        const fullPosterUrl = processImageUrl(getTMDBImageUrl(correction.posterPath));
        setVideoCover(fullPosterUrl);
      }
      if (correction.overview) {
        setCorrectedDesc(correction.overview);
      }
      if (correction.doubanId) {
        const doubanIdNum = typeof correction.doubanId === 'string'
          ? parseInt(correction.doubanId, 10)
          : correction.doubanId;
        setVideoDoubanId(doubanIdNum);
      }

      // 更新 detailRef，这样其他地方使用 detailRef 时能获取到最新信息
      if (detailRef.current) {
        detailRef.current = applyCorrection(detailRef.current, correction);
      }

      // 更新 availableSources 中的小雅源信息
      setAvailableSources(prevSources => applyCorrectionsToSources(prevSources));

      console.log('已应用纠错信息');
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

    // openlist 和 emby 源的剧集是懒加载的，如果 episodes 为空则跳过检查
    if ((currentSource === 'openlist' || currentSource === 'emby' || detail?.source === 'openlist' || detail?.source === 'emby') && (!detail || !detail.episodes || detail.episodes.length === 0)) {
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
      artPlayerRef.current.title = `${videoTitle} - ${playerEpisodeLabel}`;
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
    // 异步初始化播放器
    const initPlayer = async () => {
      try {
        // 先清理旧播放器实例
        if (artPlayerRef.current) {
          await cleanupPlayer();
        }

        // iOS需要等待DOM完全清理
        await new Promise(resolve => setTimeout(resolve, 100));

        // 双重检查：如果旧播放器仍然存在，再次清理
        if (artPlayerRef.current) {
          console.warn('旧播放器仍存在，再次清理');
          await cleanupPlayer();
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 再次确保容器为空
        if (artRef.current) {
          artRef.current.innerHTML = '';
        }

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

        // 获取当前集的字幕
        const currentSubtitles = detailRef.current?.subtitles?.[currentEpisodeIndex] || [];
        const savedSubtitleSize = typeof window !== 'undefined' ? localStorage.getItem('subtitleSize') || '2em' : '2em';

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
        screenshot: true,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: !isIOS,  // iOS 禁用原生全屏按钮，避免触发系统播放器
        fullscreenWeb: true,  // 保留网页全屏按钮（所有平台）
        ...(currentSubtitles.length > 0 ? {
          subtitle: {
            url: currentSubtitles[0].url,
            type: 'vtt',
            style: {
              color: '#fff',
              fontSize: savedSubtitleSize,
            },
            encoding: 'utf-8',
          }
        } : {}),
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
        ...(videoQualities.length > 0 ? {
          quality: videoQualities.map((q, index) => ({
            default: index === 0,
            html: q.name,
            url: q.url,
          })),
        } : {}),
        moreVideoAttr: {
          playsInline: true,
          'webkit-playsinline': 'true',
          referrerpolicy: 'no-referrer',
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

            // 从localStorage读取缓冲策略
            const bufferStrategy = typeof window !== 'undefined'
              ? localStorage.getItem('bufferStrategy') || 'medium'
              : 'medium';

            // 根据缓冲策略配置不同的缓冲参数
            const getBufferConfig = (strategy: string) => {
              switch (strategy) {
                case 'low':
                  return {
                    maxBufferLength: 15,
                    backBufferLength: 15,
                    maxBufferSize: 30 * 1000 * 1000, // ~30MB
                  };
                case 'medium':
                  return {
                    maxBufferLength: 30,
                    backBufferLength: 30,
                    maxBufferSize: 60 * 1000 * 1000, // ~60MB
                  };
                case 'high':
                  return {
                    maxBufferLength: 60,
                    backBufferLength: 40,
                    maxBufferSize: 120 * 1000 * 1000, // ~120MB
                  };
                case 'ultra':
                  return {
                    maxBufferLength: 120,
                    backBufferLength: 60,
                    maxBufferSize: 240 * 1000 * 1000, // ~240MB
                  };
                default:
                  return {
                    maxBufferLength: 30,
                    backBufferLength: 30,
                    maxBufferSize: 60 * 1000 * 1000,
                  };
              }
            };

            const bufferConfig = getBufferConfig(bufferStrategy);

            const hls = new Hls({
              debug: false, // 关闭日志
              enableWorker: true, // WebWorker 解码，降低主线程压力
              lowLatencyMode: true, // 开启低延迟 LL-HLS

              /* 缓冲/内存相关 - 根据用户设置的缓冲策略动态调整 */
              maxBufferLength: bufferConfig.maxBufferLength, // 前向缓冲长度
              backBufferLength: bufferConfig.backBufferLength, // 已播放内容保留长度
              maxBufferSize: bufferConfig.maxBufferSize, // 最大缓冲大小

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

            // 监听Manifest加载完成事件，启动xiaoya链接定时刷新
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log('[HLS] Manifest解析完成');

              // 只在首次加载时启动定时器（后续刷新会在refreshXiaoyaUrl中启动）
              if (isInitialLoadRef.current && currentXiaoyaUrlRef.current && url.includes('.m3u8')) {
                isInitialLoadRef.current = false; // 标记已完成首次加载
                startRefreshTimer(hls, video);
              }
            });

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    // 检查是否是 manifest 加载错误（通常是 403/404/CORS 错误）
                    if (data.details === 'manifestLoadError') {
                      console.log('Manifest 加载失败：可能是 403/404 或 CORS 错误');

                      const statusCode = data.response?.code || data.response?.status;

                      // 如果是403且是xiaoya源的m3u8，尝试自动刷新
                      if (statusCode === 403 && currentXiaoyaUrlRef.current) {
                        const isM3u8 = url.includes('.m3u8') || url.includes('m3u8');
                        if (isM3u8) {
                          console.log('[HLS错误] 检测到403，尝试刷新链接');
                          refreshXiaoyaUrl(hls, video, false);
                          return; // 不执行后续的错误处理
                        }
                      }

                      // 原有的错误处理逻辑
                      hls.destroy();
                      if (statusCode === 403) {
                        setVideoError('访问被拒绝 (403)');
                      } else if (statusCode === 404) {
                        setVideoError('视频不存在 (404)');
                      } else if (statusCode) {
                        setVideoError(`HTTP ${statusCode} 错误`);
                      } else {
                        // CORS 错误或其他网络错误
                        setVideoError('无法访问视频源（可能是跨域限制或访问被拒绝）');
                      }
                      return;
                    }
                    // 检查其他 HTTP 错误状态码
                    {
                      const statusCode = data.response?.code || data.response?.status;
                      if (statusCode && statusCode >= 400) {
                        console.log(`HTTP ${statusCode} 错误`);
                        hls.destroy();
                        setVideoError(`HTTP ${statusCode} 错误`);
                        return;
                      }
                    }
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
                    setVideoError('视频加载错误');
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
            heatmap: false, // 禁用 artplayer 自带热力图，使用自定义热力图
            // 主题
            theme: 'dark',
            // 根据保存的显示状态设置初始可见性
            visible: danmakuDisplayStateRef.current,
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
          // 热力图开关（仅在未禁用时显示）
          ...(!danmakuHeatmapDisabledRef.current ? [{
            name: '弹幕热力',
            html: '弹幕热力',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" fill="#ffffff"/></svg>',
            switch: danmakuHeatmapEnabledRef.current,
            onSwitch: function (item: any) {
              const newVal = !item.switch;
              try {
                localStorage.setItem('danmaku_heatmap_enabled', String(newVal));
                setDanmakuHeatmapEnabled(newVal);
                console.log('弹幕热力已', newVal ? '开启' : '关闭');
              } catch (err) {
                console.error('切换弹幕热力失败:', err);
              }
              return newVal;
            },
          }] : []),
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
            name: '跳过配置',
            html: '跳过配置',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0 && skipConfigRef.current.outro_time === 0
                ? '设置跳过配置'
                : `片头: ${formatTime(skipConfigRef.current.intro_time)} | 片尾: ${formatTime(Math.abs(skipConfigRef.current.outro_time))}`,
            onClick: async function () {
              const player = artPlayerRef.current;
              if (player) {
                // 如果处于全屏状态，先退出全屏
                if (player.fullscreen) {
                  player.fullscreen = false;
                  // 等待全屏退出动画完成
                  await new Promise(resolve => setTimeout(resolve, 300));
                }

                // 使用 ArtPlayer 的 prompt 功能创建输入弹窗
                const currentIntro = skipConfigRef.current.intro_time || 0;
                const currentOutro = Math.abs(skipConfigRef.current.outro_time) || 0;

                // 创建一个自定义的提示框
                const container = document.createElement('div');
                container.style.cssText = `
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%);
                  background: rgba(0, 0, 0, 0.9);
                  padding: 20px;
                  border-radius: 8px;
                  z-index: 9999;
                  min-width: 300px;
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                `;

                container.innerHTML = `
                  <div style="color: white; margin-bottom: 15px; font-size: 16px; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 10px;">
                    跳过配置
                  </div>
                  <div style="color: #aaa; font-size: 13px; margin-bottom: 15px; line-height: 1.5;">
                    设置片头片尾跳过时间，到达时间自动跳过
                  </div>
                  <div style="margin-bottom: 10px;">
                    <label style="color: white; display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">
                      片头时间 (秒)
                      <span style="color: #888; font-size: 12px; font-weight: normal; margin-left: 8px;">从视频开始跳过的时长</span>
                    </label>
                    <div style="display: flex; gap: 8px;">
                      <input id="intro-input" type="number" min="0" step="1" value="${currentIntro}" placeholder="如: 90"
                             style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; font-size: 14px;" />
                      <button id="set-intro-btn" style="padding: 8px 12px; border-radius: 4px; border: none; background: #007bff; color: white; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;">
                          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                          <path d="M12 6v6l4 4" stroke="white" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        当前时间
                      </button>
                    </div>
                  </div>
                  <div style="margin-bottom: 15px;">
                    <label style="color: white; display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">
                      片尾时间 (秒)
                      <span style="color: #888; font-size: 12px; font-weight: normal; margin-left: 8px;">从视频结尾向前跳过的时长</span>
                    </label>
                    <div style="display: flex; gap: 8px;">
                      <input id="outro-input" type="number" min="0" step="1" value="${currentOutro}" placeholder="如: 120"
                             style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; font-size: 14px;" />
                      <button id="set-outro-btn" style="padding: 8px 12px; border-radius: 4px; border: none; background: #007bff; color: white; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;">
                          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                          <path d="M12 6v6l4 4" stroke="white" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        当前时间
                      </button>
                    </div>
                  </div>
                  <div style="background: rgba(0, 123, 255, 0.1); border-left: 3px solid #007bff; padding: 10px; margin-bottom: 15px; border-radius: 4px;">
                    <div style="color: #88c0ff; font-size: 12px; line-height: 1.6;">
                      <div style="margin-bottom: 4px;">💡 <strong>提示：</strong></div>
                      <div>• 点击"当前时间"可快速设置为播放位置</div>
                      <div>• 片头90秒表示跳过前1分30秒</div>
                      <div>• 片尾120秒表示跳过最后2分钟</div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 10px; justify-content: flex-end; border-top: 1px solid #444; padding-top: 15px;">
                    <button id="cancel-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #444; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#555'" onmouseout="this.style.background='#444'">取消</button>
                    <button id="clear-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #d9534f; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#c9302c'" onmouseout="this.style.background='#d9534f'">清除</button>
                    <button id="confirm-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #5cb85c; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#4cae4c'" onmouseout="this.style.background='#5cb85c'">确定</button>
                  </div>
                `;

                document.body.appendChild(container);

                const introInput = container.querySelector('#intro-input') as HTMLInputElement;
                const outroInput = container.querySelector('#outro-input') as HTMLInputElement;
                const setIntroBtn = container.querySelector('#set-intro-btn');
                const setOutroBtn = container.querySelector('#set-outro-btn');
                const cancelBtn = container.querySelector('#cancel-btn');
                const clearBtn = container.querySelector('#clear-btn');
                const confirmBtn = container.querySelector('#confirm-btn');

                const cleanup = () => {
                  document.body.removeChild(container);
                };

                // 设置片头为当前时间
                setIntroBtn?.addEventListener('click', () => {
                  const currentTime = player.currentTime || 0;
                  if (currentTime > 0) {
                    introInput.value = Math.floor(currentTime).toString();
                  }
                });

                // 设置片尾为当前时间到结束的时长
                setOutroBtn?.addEventListener('click', () => {
                  if (player.duration && player.currentTime) {
                    const outroTime = player.duration - player.currentTime;
                    if (outroTime > 0) {
                      outroInput.value = Math.floor(outroTime).toString();
                    }
                  }
                });

                cancelBtn?.addEventListener('click', cleanup);

                clearBtn?.addEventListener('click', () => {
                  handleSkipConfigChange({
                    enable: false,
                    intro_time: 0,
                    outro_time: 0,
                  });
                  cleanup();
                });

                confirmBtn?.addEventListener('click', () => {
                  const introTime = parseFloat(introInput.value) || 0;
                  const outroTime = parseFloat(outroInput.value) || 0;

                  const newConfig = {
                    ...skipConfigRef.current,
                    intro_time: introTime,
                    outro_time: outroTime > 0 ? -outroTime : 0,
                  };

                  handleSkipConfigChange(newConfig);
                  cleanup();
                });

                // 支持 Enter 键确认
                const handleEnter = (e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    confirmBtn?.dispatchEvent(new Event('click'));
                  } else if (e.key === 'Escape') {
                    cancelBtn?.dispatchEvent(new Event('click'));
                  }
                };

                introInput.addEventListener('keydown', handleEnter);
                outroInput.addEventListener('keydown', handleEnter);
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
              const isInNativeFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);

              // 如果已经在原生全屏状态，退出原生全屏
              if (isInNativeFullscreen) {
                const exitFullscreen = (document as any).exitFullscreen ||
                                      (document as any).webkitExitFullscreen ||
                                      (document as any).mozCancelFullScreen ||
                                      (document as any).msExitFullscreen;
                if (exitFullscreen) {
                  try {
                    const result = exitFullscreen.call(document);
                    if (result && typeof result.catch === 'function') {
                      result.catch((err: Error) => console.error('退出全屏失败:', err));
                    }
                  } catch (err) {
                    console.error('退出全屏失败:', err);
                  }
                }
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

        // 应用进度条图标配置 - 尽早执行
        const applyProgressThumbConfig = () => {
          try {
            const config = (window as any).RUNTIME_CONFIG;

            if (!config || config.PROGRESS_THUMB_TYPE === 'default') {
              // 使用默认样式，移除自定义样式
              const oldStyle = document.getElementById('custom-progress-thumb-style');
              if (oldStyle) oldStyle.remove();
              return;
            }

            let thumbUrl = '';
            let thumbColor = '#22c55e'; // 默认绿色

            if (config.PROGRESS_THUMB_TYPE === 'preset' && config.PROGRESS_THUMB_PRESET_ID) {
              const presetConfig: Record<string, { url: string; color: string }> = {
                renako: { url: '/icons/q/renako.png', color: '#ec4899' }, // 粉色
                irena: { url: '/icons/q/irena.png', color: '#f8fafc' }, // 雪白色
                emilia: { url: '/icons/q/emilia.png', color: '#f8fafc' }, // 雪白色
              };
              const preset = presetConfig[config.PROGRESS_THUMB_PRESET_ID];
              if (preset) {
                thumbUrl = preset.url;
                thumbColor = preset.color;
              }
            } else if (config.PROGRESS_THUMB_TYPE === 'custom' && config.PROGRESS_THUMB_CUSTOM_URL) {
              thumbUrl = config.PROGRESS_THUMB_CUSTOM_URL;
            }

            // 修改 ArtPlayer 的主题色
            if (artPlayerRef.current) {
              artPlayerRef.current.theme = thumbColor;
            }

            if (thumbUrl) {
              // 根据预设ID确定尺寸
              let width = '30px';
              let height = '30px';
              let marginLeft = '-15px';

              // renako 图标特殊处理（288x404比例，放大1.25倍）
              if (config.PROGRESS_THUMB_TYPE === 'preset' && config.PROGRESS_THUMB_PRESET_ID === 'renako') {
                width = '26.875px'; // 21.5 * 1.25
                height = '37.5px'; // 30 * 1.25
                marginLeft = '-13.4375px'; // 10.75 * 1.25
              }

              // 动态设置背景图片
              const style = document.createElement('style');
              style.id = 'custom-progress-thumb-style';
              style.textContent = `
                /* 替换默认的进度条圆点为自定义图标 */
                .art-video-player .art-progress-indicator {
                  width: ${width} !important;
                  height: ${height} !important;
                  background-image: url('${thumbUrl}') !important;
                  background-size: contain !important;
                  background-repeat: no-repeat !important;
                  background-position: center !important;
                  background-color: transparent !important;
                  border-radius: 0 !important;
                  margin-left: ${marginLeft} !important;
                }
              `;

              // 移除旧样式
              const oldStyle = document.getElementById('custom-progress-thumb-style');
              if (oldStyle) oldStyle.remove();

              document.head.appendChild(style);
            }
          } catch (error) {
            console.error('[进度条图标] 应用配置失败:', error);
          }
        };

        applyProgressThumbConfig();

        // 添加字幕切换功能
        const currentSubtitles = detailRef.current?.subtitles?.[currentEpisodeIndex] || [];
        if (currentSubtitles.length > 0 && artPlayerRef.current) {
          const subtitleOptions = [
            {
              html: '关闭',
              url: '',
            },
            ...currentSubtitles.map((sub: any) => ({
              html: sub.label,
              url: sub.url,
            })),
          ];

          artPlayerRef.current.setting.add({
            html: '字幕',
            selector: subtitleOptions,
            onSelect: function (item: any) {
              if (artPlayerRef.current) {
                if (item.url === '') {
                  // 关闭字幕
                  artPlayerRef.current.subtitle.show = false;
                } else {
                  // 切换字幕
                  artPlayerRef.current.subtitle.switch(item.url, {
                    name: item.html,
                  });
                  artPlayerRef.current.subtitle.show = true;
                }
              }
              return item.html;
            },
          });
        }

        // 添加字幕大小设置
        if (artPlayerRef.current) {
          const savedSubtitleSize = typeof window !== 'undefined' ? localStorage.getItem('subtitleSize') || '2em' : '2em';
          const defaultOption = savedSubtitleSize === '1em' ? '小' : savedSubtitleSize === '3em' ? '大' : savedSubtitleSize === '4em' ? '超大' : '中';

          artPlayerRef.current.setting.add({
            html: '字幕大小',
            selector: [
              { html: '小', size: '1em' },
              { html: '中', size: '2em' },
              { html: '大', size: '3em' },
              { html: '超大', size: '4em' },
            ],
            onSelect: function (item: any) {
              if (artPlayerRef.current) {
                artPlayerRef.current.subtitle.style({
                  fontSize: item.size,
                });
                // 保存到 localStorage
                if (typeof window !== 'undefined') {
                  localStorage.setItem('subtitleSize', item.size);
                }
              }
              return item.html;
            },
            default: defaultOption,
          });
        }

        // 控制截图按钮在小屏幕竖屏时隐藏
        const updateScreenshotVisibility = () => {
          const screenshotBtn = document.querySelector('.art-control-screenshot') as HTMLElement;
          if (screenshotBtn) {
            const isPortrait = window.innerHeight > window.innerWidth;
            const isSmallScreen = window.innerWidth < 768;
            screenshotBtn.style.display = (isPortrait && isSmallScreen) ? 'none' : '';
          }
        };
        updateScreenshotVisibility();
        window.addEventListener('resize', updateScreenshotVisibility);
        artPlayerRef.current.on('fullscreen', updateScreenshotVisibility);
        artPlayerRef.current.on('fullscreenWeb', updateScreenshotVisibility);

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

          // 自动搜索并加载弹幕
          await autoSearchDanmaku();

          
          if (artPlayerRef.current) {
            // 监听弹幕显示/隐藏事件，保存开关状态到 localStorage
            artPlayerRef.current.on('artplayerPluginDanmuku:show', () => {
              danmakuDisplayStateRef.current = true;
              saveDanmakuDisplayState(true);
            });

            artPlayerRef.current.on('artplayerPluginDanmuku:hide', () => {
              danmakuDisplayStateRef.current = false;
              saveDanmakuDisplayState(false);
            });
          }

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

      // 监听网页全屏事件，控制导航栏显示隐藏
      artPlayerRef.current.on('fullscreenWeb', (isFullscreen: boolean) => {
        console.log('网页全屏状态变化:', isFullscreen);
        setIsWebFullscreen(isFullscreen);
      });

      // 添加自定义热力图到播放器控制层
      if (!danmakuHeatmapDisabledRef.current) {
        artPlayerRef.current.controls.add({
          name: 'custom-heatmap',
          position: 'top',
          html: '<canvas id="custom-heatmap-canvas" style="width: 100%; height: 100%; display: block;"></canvas>',
          style: {
            position: 'absolute',
            bottom: '5px',
            left: '0',
            height: '60px',
            pointerEvents: 'none',
            zIndex: '30',
            display: danmakuHeatmapEnabledRef.current ? 'block' : 'none',
          },
          mounted: ($el: HTMLElement) => {
            const canvas = $el.querySelector('#custom-heatmap-canvas') as HTMLCanvasElement;
            if (!canvas) {
              return;
            }

            // 根据实际显示尺寸和设备像素比设置 canvas 分辨率
            const updateCanvasSize = () => {
              const rect = canvas.getBoundingClientRect();
              const dpr = window.devicePixelRatio || 1;
              const newWidth = Math.round(rect.width * dpr);
              const newHeight = Math.round(rect.height * dpr);

              // 只在尺寸真正改变时才更新，避免闪烁
              if (canvas.width !== newWidth || canvas.height !== newHeight) {
                canvas.width = newWidth;
                canvas.height = newHeight;
                return true; // 返回 true 表示尺寸已更新
              }
              return false; // 返回 false 表示尺寸未变化
            };

            // 动态获取进度条的实际位置并调整热力图
            const adjustHeatmapPosition = () => {
              const progressBar = document.querySelector('.art-control-progress') as HTMLElement;

              if (!progressBar) {
                return;
              }

              if (!$el.parentElement) {
                return;
              }

              if (progressBar && $el.parentElement) {
                const rect = progressBar.getBoundingClientRect();
                const parentRect = $el.parentElement.getBoundingClientRect();

                // 调整热力图位置以完全匹配进度条
                $el.style.left = `${rect.left - parentRect.left}px`;
                $el.style.bottom = `${parentRect.bottom - rect.bottom + 5}px`;
                $el.style.width = `${rect.width}px`;

                // 更新 canvas 分辨率
                updateCanvasSize();
              }
            };

            // 初始调整
            setTimeout(adjustHeatmapPosition, 500);

            // 监听进度条尺寸变化
            const progressBar = document.querySelector('.art-control-progress') as HTMLElement;
            let progressResizeObserver: ResizeObserver | null = null;
            if (progressBar && typeof ResizeObserver !== 'undefined') {
              progressResizeObserver = new ResizeObserver(() => {
                adjustHeatmapPosition();
                // 进度条长度变化时也需要重新计算和绘制热力图
                setTimeout(updateHeatmapData, 100);
              });
              progressResizeObserver.observe(progressBar);
            }

            // 监听全屏状态变化
            if (artPlayerRef.current) {
              artPlayerRef.current.on('fullscreen', () => {
                setTimeout(adjustHeatmapPosition, 300);
              });

              artPlayerRef.current.on('fullscreenWeb', () => {
                setTimeout(adjustHeatmapPosition, 300);
              });
            }

            // 监听窗口大小变化
            const resizeHandler = () => {
              adjustHeatmapPosition();
            };
            window.addEventListener('resize', resizeHandler);

            let heatmapData: number[] = [];
            let isHovering = false;
            let hoverTime = 0;
            let tooltipEl: HTMLElement | null = null;

            // 监听热力图开关状态变化
            let lastEnabled = localStorage.getItem('danmaku_heatmap_enabled') === 'true';
            const updateVisibility = () => {
              const enabled = localStorage.getItem('danmaku_heatmap_enabled') === 'true';

              // 只在状态真正改变时才更新 DOM
              if (enabled !== lastEnabled) {
                $el.style.display = enabled ? 'block' : 'none';

                // 如果从关闭变为打开，重新调整位置和尺寸
                if (enabled) {
                  setTimeout(() => {
                    adjustHeatmapPosition();
                    drawHeatmap();
                  }, 50);
                }

                lastEnabled = enabled;
              }
            };

            // 定期检查开关状态
            const visibilityInterval = setInterval(updateVisibility, 500);

            // 计算热力图数据（按视频长度的5%分段，使热力图更平滑）
            const calculateHeatmapData = (danmakuList: any[], duration: number) => {
              if (!duration || duration <= 0 || danmakuList.length === 0) {
                return [];
              }

              // 按视频长度的5%分段，最少20段
              const segments = Math.max(20, Math.ceil(duration * 0.05));
              const segmentDuration = duration / segments;
              const heatData = new Array(segments).fill(0);

              danmakuList.forEach((danmaku: any) => {
                const segmentIndex = Math.floor(danmaku.time / segmentDuration);
                if (segmentIndex >= 0 && segmentIndex < segments) {
                  heatData[segmentIndex]++;
                }
              });

              const maxCount = Math.max(...heatData, 1);
              return heatData.map((count: number) => count / maxCount);
            };

            // 绘制热力图
            const drawHeatmap = () => {
              // 检查热力图是否启用（与初始状态逻辑保持一致）
              const storedValue = localStorage.getItem('danmaku_heatmap_enabled');
              const enabled = storedValue !== null ? storedValue === 'true' : true; // 默认开启
              if (!enabled) {
                // 热力图已关闭，跳过绘制
                return;
              }

              if (!artPlayerRef.current) {
                return;
              }

              if (heatmapData.length === 0) {
                return;
              }

              const ctx = canvas.getContext('2d');
              if (!ctx) {
                return;
              }

              const dpr = window.devicePixelRatio || 1;
              const width = canvas.width / dpr;
              const height = canvas.height / dpr;
              const duration = artPlayerRef.current.duration || 0;
              const currentTime = artPlayerRef.current.currentTime || 0;

              ctx.save();
              ctx.scale(dpr, dpr);
              ctx.clearRect(0, 0, width, height);

              const progressRatio = duration > 0 ? currentTime / duration : 0;
              const progressX = progressRatio * width;

              // 绘制未播放部分的曲线
              ctx.beginPath();
              ctx.moveTo(0, height);

              heatmapData.forEach((value: number, index: number) => {
                const x = (index / heatmapData.length) * width;
                const y = height - (value * height);

                if (index === 0) {
                  ctx.lineTo(x, y);
                } else {
                  // 使用二次贝塞尔曲线使线条平滑
                  const prevX = ((index - 1) / heatmapData.length) * width;
                  const prevY = height - (heatmapData[index - 1] * height);
                  const cpX = (prevX + x) / 2;
                  const cpY = (prevY + y) / 2;
                  ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
                  ctx.lineTo(x, y);
                }
              });

              ctx.lineTo(width, height);
              ctx.closePath();
              ctx.fillStyle = 'rgba(128, 128, 128, 0.3)';
              ctx.fill();

              // 绘制已播放部分的曲线（深色）
              if (progressRatio > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, progressX, height);
                ctx.clip();

                ctx.beginPath();
                ctx.moveTo(0, height);

                heatmapData.forEach((value: number, index: number) => {
                  const x = (index / heatmapData.length) * width;
                  const y = height - (value * height);

                  if (index === 0) {
                    ctx.lineTo(x, y);
                  } else {
                    const prevX = ((index - 1) / heatmapData.length) * width;
                    const prevY = height - (heatmapData[index - 1] * height);
                    const cpX = (prevX + x) / 2;
                    const cpY = (prevY + y) / 2;
                    ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
                    ctx.lineTo(x, y);
                  }
                });

                ctx.lineTo(width, height);
                ctx.closePath();
                ctx.fillStyle = 'rgba(128, 128, 128, 0.6)';
                ctx.fill();

                ctx.restore();
              }

              ctx.restore();
            };

            // 格式化时间
            const formatTime = (seconds: number): string => {
              const h = Math.floor(seconds / 3600);
              const m = Math.floor((seconds % 3600) / 60);
              const s = Math.floor(seconds % 60);

              if (h > 0) {
                return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
              }
              return `${m}:${s.toString().padStart(2, '0')}`;
            };

            // 获取弹幕密度
            const getDensity = (time: number): string => {
              if (heatmapData.length === 0 || !artPlayerRef.current) return '';
              const duration = artPlayerRef.current.duration || 0;
              if (duration <= 0) return '';

              // 按视频长度的5%分段
              const segments = Math.max(20, Math.ceil(duration * 0.05));
              const segmentDuration = duration / segments;
              const segmentIndex = Math.floor(time / segmentDuration);

              if (segmentIndex >= 0 && segmentIndex < heatmapData.length) {
                const density = heatmapData[segmentIndex];
                if (density < 0.2) return '低';
                if (density < 0.5) return '中';
                if (density < 0.8) return '高';
                return '极高';
              }
              return '';
            };

            // 鼠标移动事件
            canvas.addEventListener('mousemove', (e: MouseEvent) => {
              if (!artPlayerRef.current) return;

              const rect = canvas.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const percentage = x / rect.width;
              const duration = artPlayerRef.current.duration || 0;
              hoverTime = percentage * duration;
              isHovering = true;

              // 创建或更新提示框
              if (!tooltipEl) {
                tooltipEl = document.createElement('div');
                tooltipEl.style.cssText = `
                  position: absolute;
                  bottom: 100%;
                  transform: translateX(-50%);
                  margin-bottom: 8px;
                  padding: 4px 8px;
                  background: rgba(0, 0, 0, 0.8);
                  color: white;
                  font-size: 12px;
                  border-radius: 4px;
                  white-space: nowrap;
                  pointer-events: none;
                  z-index: 30;
                `;
                $el.appendChild(tooltipEl);
              }

              tooltipEl.textContent = `${formatTime(hoverTime)} - 弹幕密度: ${getDensity(hoverTime)}`;
              tooltipEl.style.left = `${percentage * 100}%`;
              tooltipEl.style.display = 'block';
            });

            // 鼠标离开事件
            canvas.addEventListener('mouseleave', () => {
              isHovering = false;
              if (tooltipEl) {
                tooltipEl.style.display = 'none';
              }
            });

            // 点击跳转
            canvas.addEventListener('click', (e: MouseEvent) => {
              if (!artPlayerRef.current) return;

              const rect = canvas.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const percentage = x / rect.width;
              const duration = artPlayerRef.current.duration || 0;
              const time = percentage * duration;

              artPlayerRef.current.currentTime = time;
            });

            // 监听时间更新
            artPlayerRef.current.on('video:timeupdate', drawHeatmap);

            // 监听弹幕数据更新
            const updateHeatmapData = () => {
              if (!artPlayerRef.current) {
                return;
              }

              if (!danmakuPluginRef.current) {
                return;
              }

              const duration = artPlayerRef.current.duration || 0;

              // 直接从弹幕插件获取弹幕数据
              const danmakuList = danmakuPluginRef.current.option?.danmuku || [];

              if (danmakuList.length > 0 && duration > 0) {
                heatmapData = calculateHeatmapData(danmakuList, duration);
                // 立即绘制热力图
                drawHeatmap();
                // 强制再次绘制，确保显示
                setTimeout(drawHeatmap, 100);
              }
            };

            artPlayerRef.current.on('video:loadedmetadata', updateHeatmapData);

            // 监听弹幕加载完成事件
            artPlayerRef.current.on('danmaku:loaded', () => {
              updateHeatmapData();
            });

            // 监听弹幕插件的配置变化
            if (danmakuPluginRef.current) {
              const originalConfig = danmakuPluginRef.current.config;
              danmakuPluginRef.current.config = function(...args: any[]) {
                const result = originalConfig.apply(this, args);
                setTimeout(updateHeatmapData, 100);
                return result;
              };
            }

            // 使用轮询机制等待弹幕插件准备好（替代固定延迟）
            let pollAttempts = 0;
            const maxPollAttempts = 120; // 最多尝试 120 次（60 秒）
            const pollInterval = 500; // 每 500ms 检查一次

            const pollForDanmakuPlugin = () => {
              if (danmakuPluginRef.current && danmakuPluginRef.current.option?.danmuku) {
                // 弹幕插件已准备好且有数据
                updateHeatmapData();
                return; // 成功，停止轮询
              }

              pollAttempts++;
              if (pollAttempts < maxPollAttempts) {
                // 继续轮询
                setTimeout(pollForDanmakuPlugin, pollInterval);
              }
            };

            // 开始轮询
            setTimeout(pollForDanmakuPlugin, 500);

            // 清理
            return () => {
              clearInterval(visibilityInterval);
              window.removeEventListener('resize', resizeHandler);
              if (progressResizeObserver) {
                progressResizeObserver.disconnect();
              }
              if (tooltipEl && tooltipEl.parentNode) {
                tooltipEl.parentNode.removeChild(tooltipEl);
              }
            };
          },
        });
      }

      // 添加全屏快进快退按钮
      artPlayerRef.current.layers.add({
        name: 'seek-buttons',
        html: `
          <div class="seek-buttons-container" style="display: none;">
            <button class="seek-button seek-backward" style="position: fixed; left: 20px; top: 40%; transform: translateY(-50%); width: 48px; height: 48px; background: rgba(0,0,0,0.7); border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999; transition: opacity 0.2s;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" fill="white"/>
              </svg>
            </button>
            <button class="seek-button seek-forward" style="position: fixed; right: 20px; top: 40%; transform: translateY(-50%); width: 48px; height: 48px; background: rgba(0,0,0,0.7); border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999; transition: opacity 0.2s;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" fill="white"/>
              </svg>
            </button>
          </div>
        `,
        mounted: ($el: HTMLElement) => {
          const container = $el.querySelector('.seek-buttons-container') as HTMLElement;
          const backwardBtn = $el.querySelector('.seek-backward') as HTMLElement;
          const forwardBtn = $el.querySelector('.seek-forward') as HTMLElement;

          // 快退5秒
          backwardBtn.onclick = () => {
            if (artPlayerRef.current) {
              artPlayerRef.current.currentTime = Math.max(0, artPlayerRef.current.currentTime - 5);
            }
          };

          // 快进5秒
          forwardBtn.onclick = () => {
            if (artPlayerRef.current) {
              artPlayerRef.current.currentTime = Math.min(artPlayerRef.current.duration, artPlayerRef.current.currentTime + 5);
            }
          };

          // 监听全屏状态变化
          const updateVisibility = () => {
            const isFullscreen = artPlayerRef.current?.fullscreen || artPlayerRef.current?.fullscreenWeb || !!document.fullscreenElement;
            const isMobile = Math.min(window.innerWidth, window.innerHeight) < 768;
            const controlsVisible = !artPlayerRef.current?.template?.$player?.classList.contains('art-hide-cursor');

            if (container) {
              const shouldShow = isFullscreen && isMobile && controlsVisible;
              container.style.display = shouldShow ? 'block' : 'none';
            }
          };

          artPlayerRef.current.on('fullscreen', updateVisibility);
          artPlayerRef.current.on('fullscreenWeb', updateVisibility);
          document.addEventListener('fullscreenchange', updateVisibility);
          window.addEventListener('resize', updateVisibility);

          // 监听鼠标移动和视频事件来检测控件显示/隐藏
          artPlayerRef.current.on('video:timeupdate', updateVisibility);
          if (artPlayerRef.current.template?.$player) {
            const observer = new MutationObserver(updateVisibility);
            observer.observe(artPlayerRef.current.template.$player, {
              attributes: true,
              attributeFilter: ['class']
            });
          }

          updateVisibility();
        },
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
        setVideoError(null);
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

        // 下集预缓冲逻辑
        const nextEpisodePreCacheEnabled = typeof window !== 'undefined'
          ? localStorage.getItem('nextEpisodePreCache') === 'true'
          : false;

        if (nextEpisodePreCacheEnabled) {
          const currentTime = artPlayerRef.current?.currentTime || 0;
          const duration = artPlayerRef.current?.duration || 0;
          const progress = duration > 0 ? currentTime / duration : 0;

          // 检查是否已经到达90%播放进度
          if (duration > 0 && progress >= 0.9 && !nextEpisodePreCacheTriggeredRef.current) {
            // 标记已触发，防止重复执行
            nextEpisodePreCacheTriggeredRef.current = true;

            // 获取下一集信息
            const currentIdx = currentEpisodeIndexRef.current;
            const episodes = detailRef.current?.episodes;

            if (!episodes || currentIdx >= episodes.length - 1) {
              return;
            }

            const nextEpisodeIndex = currentIdx + 1;
            const nextEpisodeUrl = episodes[nextEpisodeIndex];

            if (!nextEpisodeUrl) {
              return;
            }

            // 使用 fetch 预加载资源，利用浏览器缓存
            const preloadNextEpisode = async () => {
              try {
                // 判断是否是m3u8流
                if (nextEpisodeUrl.includes('.m3u8') || nextEpisodeUrl.includes('m3u8')) {
                  // 1. 先fetch m3u8文件
                  const m3u8Response = await fetch(nextEpisodeUrl);
                  const m3u8Text = await m3u8Response.text();

                  // 2. 解析m3u8，提取ts分片URL
                  const lines = m3u8Text.split('\n');
                  const tsUrls: string[] = [];
                  const baseUrl = nextEpisodeUrl.substring(0, nextEpisodeUrl.lastIndexOf('/') + 1);

                  for (const line of lines) {
                    const trimmedLine = line.trim();
                    // 跳过注释和空行
                    if (!trimmedLine || trimmedLine.startsWith('#')) {
                      continue;
                    }
                    // 构建完整的ts URL
                    const tsUrl = trimmedLine.startsWith('http')
                      ? trimmedLine
                      : baseUrl + trimmedLine;
                    tsUrls.push(tsUrl);
                  }

                  // 3. 预加载前20个ts分片
                  const maxFragmentsToPreload = Math.min(20, tsUrls.length);

                  for (let i = 0; i < maxFragmentsToPreload; i++) {
                    try {
                      await fetch(tsUrls[i]);
                    } catch (err) {
                      // 静默处理分片加载失败
                    }
                  }
                }
              } catch (error) {
                // 静默处理预缓冲失败
              }
            };

            // 异步执行预缓冲
            preloadNextEpisode();
          }
        }

        // 下集弹幕预加载逻辑
        const nextEpisodeDanmakuPreloadEnabled = typeof window !== 'undefined'
          ? localStorage.getItem('nextEpisodeDanmakuPreload') === 'true'
          : false;

        if (nextEpisodeDanmakuPreloadEnabled) {
          const currentTime = artPlayerRef.current?.currentTime || 0;
          const duration = artPlayerRef.current?.duration || 0;
          const progress = duration > 0 ? currentTime / duration : 0;

          // 检查是否已经到达90%播放进度
          if (duration > 0 && progress >= 0.9 && !nextEpisodeDanmakuPreloadTriggeredRef.current) {
            // 标记已触发，防止重复执行
            nextEpisodeDanmakuPreloadTriggeredRef.current = true;

            // 异步执行弹幕预加载
            preloadNextEpisodeDanmaku();
          }
        }
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
  }, [videoUrl, loading, blockAdEnabled]);

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
      <PageLayout activePath='/play' hideNavigation={isWebFullscreen}>
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
      <PageLayout activePath='/play' hideNavigation={isWebFullscreen}>
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
    <PageLayout activePath='/play' hideNavigation={isWebFullscreen}>
      {/* TMDB背景图 */}
      {tmdbBackdrop && (
        <div
          className='fixed inset-0 z-0'
          style={{
            backgroundImage: `url(${tmdbBackdrop})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'blur(5px) brightness(0.7)',
          }}
        />
      )}
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
                    onClick={() => handleDanmakuSourceSelect(anime, index)}
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

      <div className='relative z-10 flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片标题 */}
        <div className='py-1'>
          <h1 className={`text-xl font-semibold flex items-center gap-2 flex-wrap ${tmdbBackdrop ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
            <span>
              {videoTitle || '影片标题'}
              {shouldShowEpisodeLabel && (
                <span className={tmdbBackdrop ? 'text-white opacity-80' : 'text-gray-500 dark:text-gray-400'}>
                  {` > ${episodeLabel}`}
                </span>
              )}
            </span>
            {/* 完结状态标识 */}
            {detail && totalEpisodes > 1 && (() => {
              const status = getSeriesStatus(detail);
              if (status === 'unknown') return null;

              return (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    status === 'completed'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}
                >
                  {status === 'completed' ? '已完结' : '连载中'}
                </span>
              );
            })()}
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
                {(isVideoLoading || videoError) && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      {videoError ? (
                        // 错误显示
                        <>
                          {/* 错误图标 */}
                          <div className='relative mb-8'>
                            <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-rose-600 rounded-2xl shadow-2xl flex items-center justify-center'>
                              <div className='text-white text-4xl'>⚠️</div>
                            </div>
                          </div>

                          {/* 错误消息 */}
                          <div className='space-y-4'>
                            <p className='text-xl font-semibold text-white'>
                              播放失败
                            </p>
                            <p className='text-base text-gray-300'>
                              {videoError}
                            </p>
                            <button
                              onClick={() => {
                                setVideoError(null);
                                setIsVideoLoading(true);
                                // 重新加载视频
                                if (artPlayerRef.current) {
                                  artPlayerRef.current.url = videoUrl;
                                }
                              }}
                              className='mt-4 px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all duration-200'
                            >
                              重试
                            </button>
                          </div>
                        </>
                      ) : (
                        // 加载显示
                        <>
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
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* 链接刷新提示 */}
                {isRefreshingUrl && (
                  <div className='absolute inset-0 flex items-center justify-center bg-black/50 z-50 pointer-events-none'>
                    <div className='bg-black/80 text-white px-6 py-3 rounded-lg flex items-center gap-3 backdrop-blur-sm border border-green-500/30'>
                      <svg className='animate-spin h-5 w-5' viewBox='0 0 24 24'>
                        <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' fill='none'/>
                        <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'/>
                      </svg>
                      <span>正在刷新链接...</span>
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
                          {danmakuOriginalCount > 0
                            ? `已加载 ${danmakuCount} 条弹幕（原始 ${danmakuOriginalCount} 条）`
                            : `已加载 ${danmakuCount} 条弹幕`
                          }
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
                <div className='mt-3 px-2 lg:flex-shrink-0'>
                  <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 border border-gray-200/50 dark:border-gray-700/50 w-full lg:w-auto overflow-x-auto'>
                    <div className='flex gap-1.5 flex-nowrap lg:flex-wrap items-center'>
                      <div className='flex gap-1.5 flex-nowrap lg:flex-wrap lg:justify-end lg:flex-1'>
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

                        {/* 复制视频链接按钮 */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果当前是代理播放模式，使用原始 URL；否则使用当前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL（与外部播放器逻辑一致）
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;

                            // 如果链接是相对路径，补充完整的 base URL
                            let finalUrl = proxyUrl;
                            if (proxyUrl && !proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
                              finalUrl = `${window.location.origin}${proxyUrl.startsWith('/') ? '' : '/'}${proxyUrl}`;
                            }

                            // 复制到剪贴板
                            navigator.clipboard.writeText(finalUrl).then(() => {
                              setToast({
                                message: '视频链接已复制到剪贴板',
                                type: 'success',
                                onClose: () => setToast(null),
                              });
                            }).catch((err) => {
                              console.error('复制失败:', err);
                              setToast({
                                message: '复制失败，请重试',
                                type: 'error',
                                onClose: () => setToast(null),
                              });
                            });
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-blue-400 flex-shrink-0'
                          title='复制视频链接'
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
                              d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                            />
                          </svg>
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-white'>
                            复制链接
                          </span>
                        </button>

                        {/* App打开 */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 获取当前浏览器URL去除域名部分，并去除开头的/
                            const currentPath = (window.location.pathname + window.location.search).replace(/^\//, '');
                            // 打开moontvplus协议
                            window.open(`moontvplus://${currentPath}`, '_blank');
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-blue-600 dark:border-blue-700 flex-shrink-0'
                          title='App打开'
                        >
                          <svg
                            className='w-4 h-4 flex-shrink-0 text-white'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth={2}
                              d='M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z'
                            />
                          </svg>
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-white'>
                            App打开
                          </span>
                        </button>

                        {/* PotPlayer */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果当前是代理播放模式，使用原始 URL；否则使用当前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;
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
                          // 如果当前是代理播放模式，使用原始 URL；否则使用当前 videoUrl
                          let urlToUse = videoUrl;
                          if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                            urlToUse = detail.episodes[currentEpisodeIndex];
                          }
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : urlToUse;
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
                          // 如果当前是代理播放模式，使用原始 URL；否则使用当前 videoUrl
                          let urlToUse = videoUrl;
                          if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                            urlToUse = detail.episodes[currentEpisodeIndex];
                          }
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : urlToUse;
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
                          // 如果当前是代理播放模式，使用原始 URL；否则使用当前 videoUrl
                          let urlToUse = videoUrl;
                          if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                            urlToUse = detail.episodes[currentEpisodeIndex];
                          }
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : urlToUse;
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
                          // 如果当前是代理播放模式，使用原始 URL；否则使用当前 videoUrl
                          let urlToUse = videoUrl;
                          if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                            urlToUse = detail.episodes[currentEpisodeIndex];
                          }
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : urlToUse;
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
                          // 如果当前是代理播放模式，使用原始 URL；否则使用当前 videoUrl
                          let urlToUse = videoUrl;
                          if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                            urlToUse = detail.episodes[currentEpisodeIndex];
                          }
                          // 使用代理 URL
                          const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                          const proxyUrl = externalPlayerAdBlock
                            ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                            : urlToUse;
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
              className={`relative z-10 h-[350px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
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
                backgroundSourcesLoading={backgroundSourcesLoading}
                precomputedVideoInfo={precomputedVideoInfo}
                onDanmakuSelect={(selection) => handleDanmakuSelect(selection, true)}
                currentDanmakuSelection={currentDanmakuSelection}
                onUploadDanmaku={handleUploadDanmaku}
                episodeFilterConfig={episodeFilterConfig}
                onFilterConfigUpdate={setEpisodeFilterConfig}
                onShowToast={(message, type) => {
                  setToast({ message, type, onClose: () => setToast(null) });
                }}
              />
            </div>
          </div>
        </div>

        {!isDirectPlay && (
          <>
            {/* 详情展示 */}
            <div className='grid grid-cols-1 md:grid-cols-5 lg:grid-cols-6 gap-4'>
              {/* 文字区 */}
              <div className='md:col-span-4 lg:col-span-5'>
                <div className='p-6 flex flex-col min-h-0'>
                  {/* 标题 */}
                  <h1 className={`text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full flex-wrap gap-2 ${tmdbBackdrop ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
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
                    {/* 网盘搜索按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPansouDialog(true);
                      }}
                      className='flex-shrink-0 hover:opacity-80 transition-opacity'
                      title='搜索网盘资源'
                    >
                      <Cloud className='h-6 w-6 text-gray-700 dark:text-gray-300' />
                    </button>
                    {/* AI问片按钮 */}
                    {aiEnabled && detail && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAIChat(true);
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title='AI问片'
                      >
                        <Sparkles className='h-6 w-6 text-gray-700 dark:text-gray-300' />
                      </button>
                    )}
                    {/* 详情按钮 */}
                    {detail && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDetailPanel(true);
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity px-2 py-1 text-base font-medium text-gray-700 dark:text-gray-300'
                        title='详情'
                      >
                        详
                      </button>
                    )}
                    {/* 纠错按钮 - 仅小雅源显示 */}
                    {detail && detail.source === 'xiaoya' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowCorrectDialog(true);
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title='纠错'
                      >
                        <AlertCircle className='h-6 w-6 text-gray-700 dark:text-gray-300' />
                      </button>
                    )}
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
                  <div className={`flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0 ${tmdbBackdrop ? 'text-white' : ''}`}>
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
                      <span className={`border px-2 py-[1px] rounded ${
                        detail.source === 'xiaoya' ? 'border-blue-500' : detail.source === 'openlist' || detail.source === 'emby' || detail.source?.startsWith('emby_') ? 'border-yellow-500' : 'border-gray-500/60'
                      }`}>
                        {detail.source_name}
                      </span>
                    )}
                    {detail?.type_name && <span>{detail.type_name}</span>}
                  </div>
                  {/* 剧情简介 */}
                  {(doubanCardSubtitle || correctedDesc || detail?.desc) && (
                    <div
                      className={`mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide ${tmdbBackdrop ? 'text-white' : ''}`}
                      style={{ whiteSpace: 'pre-line' }}
                    >
                      {/* card_subtitle 在前，desc 在后 */}
                      {doubanCardSubtitle && (
                        <div className='mb-3 pb-3 border-b border-gray-300 dark:border-gray-700'>
                          {doubanCardSubtitle}
                        </div>
                      )}
                      {correctedDesc || detail?.desc}
                    </div>
                  )}
                </div>
              </div>

              {/* 封面展示 */}
              <div className='hidden md:block md:col-span-1 md:order-first'>
                <div className='pl-0 py-4 pr-6 max-w-sm mx-auto'>
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

            {/* 推荐区域 */}
            <SmartRecommendations
              doubanId={videoDoubanId !== 0 ? videoDoubanId : undefined}
              videoTitle={videoTitle}
            />

            {/* 豆瓣评论区域 */}
            {videoDoubanId !== 0 && enableComments && (
              <div className='mt-6 -mx-3 md:mx-0 md:px-4'>
                <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden'>
                  {/* 标题 */}
                  <div className='px-3 md:px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
                    <h3 className='text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2'>
                      <svg className='w-5 h-5' fill='currentColor' viewBox='0 0 24 24'>
                        <path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/>
                      </svg>
                      豆瓣评论
                    </h3>
                  </div>

                  {/* 评论内容 */}
                  <div className='p-3 md:p-6'>
                    <DoubanComments doubanId={videoDoubanId} />
                  </div>
                </div>
              </div>
            )}
          </>
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

      {/* 网盘搜索弹窗 */}
      {showPansouDialog && (
        <div
          className='fixed inset-0 z-[10000] flex items-center justify-center bg-black/50'
          onClick={() => setShowPansouDialog(false)}
        >
          <div
            className='relative w-full max-w-4xl max-h-[80vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-lg shadow-xl m-4'
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className='sticky top-0 z-10 flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'>
              <h2 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                搜索网盘资源: {detail?.title || ''}
              </h2>
              <button
                onClick={() => setShowPansouDialog(false)}
                className='p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors'
              >
                <X className='h-5 w-5 text-gray-600 dark:text-gray-400' />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className='p-4'>
              <PansouSearch
                keyword={detail?.title || ''}
                triggerSearch={showPansouDialog}
              />
            </div>
          </div>
        </div>
      )}

      {/* AI问片面板 */}
      {aiEnabled && detail && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          context={{
            title: detail.title,
            year: detail.year,
            douban_id: videoDoubanId !== 0 ? videoDoubanId : undefined,
            currentEpisode: currentEpisodeIndex + 1,
          }}
          welcomeMessage={aiDefaultMessageWithVideo ? aiDefaultMessageWithVideo.replace('{title}', detail.title || '') : `想了解《${detail.title}》的更多信息吗？我可以帮你查询剧情、演员、评价等。`}
        />
      )}

      {/* 纠错弹窗 - 仅小雅源显示 */}
      {detail && detail.source === 'xiaoya' && (
        <CorrectDialog
          isOpen={showCorrectDialog}
          onClose={() => setShowCorrectDialog(false)}
          videoKey={`${detail.source}_${detail.id}`}
          currentTitle={detail.title}
          currentVideo={{
            tmdbId: detail.tmdb_id,
            doubanId: detail.douban_id ? String(detail.douban_id) : undefined,
            poster: detail.poster,
            releaseDate: detail.year,
            overview: detail.desc,
            voteAverage: detail.rating,
            mediaType: detail.type_name === '电影' ? 'movie' : 'tv',
          }}
          source="xiaoya"
          onCorrect={() => {
            // 纠错成功后的回调
            handleCorrectSuccess();
          }}
        />
      )}

      {/* 详情面板 */}
      {detail && (
        <DetailPanel
          isOpen={showDetailPanel}
          onClose={() => setShowDetailPanel(false)}
          title={detail.title}
          poster={detail.poster}
          doubanId={
            // 特殊源使用 tmdb，其他使用 cms（通过 doubanId）
            // 如果有豆瓣ID且不为0，传入doubanId
            detail.source === 'openlist' ||
            detail.source?.startsWith('emby') ||
            detail.source === 'xiaoya'
              ? undefined
              : detail.douban_id && detail.douban_id !== 0
              ? detail.douban_id
              : undefined
          }
          tmdbId={
            // 特殊源使用 tmdb
            detail.source === 'openlist' ||
            detail.source?.startsWith('emby') ||
            detail.source === 'xiaoya'
              ? detail.tmdb_id
              : undefined
          }
          type={detail.type_name === '电影' ? 'movie' : 'tv'}
          cmsData={
            // 非特殊源使用 cms 数据
            // 但如果有豆瓣ID且不为0，则不传入cmsData，优先使用豆瓣数据
            detail.source !== 'openlist' &&
            !detail.source?.startsWith('emby') &&
            detail.source !== 'xiaoya' &&
            !(detail.douban_id && detail.douban_id !== 0)
              ? {
                  desc: detail.desc,
                  episodes: detail.episodes,
                  episodes_titles: detail.episodes_titles,
                }
              : undefined
          }
          sourceId={detail.id}
          source={detail.source}
        />
      )}
    </PageLayout>
  );
}

// 从 localStorage 读取小雅源的纠错信息
const getXiaoyaCorrection = (source: string, id: string) => {
  try {
    const storageKey = `xiaoya_correction_${source}_${id}`;
    const correctionJson = localStorage.getItem(storageKey);
    if (correctionJson) {
      return JSON.parse(correctionJson);
    }
  } catch (error) {
    console.error('读取纠错信息失败:', error);
  }
  return null;
};

// 应用纠错信息到 detail 对象
const applyCorrection = (detail: SearchResult, correction: any): SearchResult => {
  return {
    ...detail,
    title: correction.title || detail.title,
    poster: correction.posterPath ? processImageUrl(getTMDBImageUrl(correction.posterPath)) : detail.poster,
    year: correction.releaseDate || detail.year,
    desc: correction.overview || detail.desc,
    rating: correction.voteAverage || detail.rating,
    tmdb_id: correction.tmdbId || detail.tmdb_id,
    douban_id: correction.doubanId ? (typeof correction.doubanId === 'string' ? parseInt(correction.doubanId, 10) : correction.doubanId) : detail.douban_id,
    type_name: correction.mediaType === 'movie' ? '电影' : (correction.mediaType === 'tv' ? '电视剧' : detail.type_name),
  };
};

// 批量应用纠错信息到源列表
const applyCorrectionsToSources = (sources: SearchResult[]): SearchResult[] => {
  return sources.map(source => {
    if (source.source === 'xiaoya') {
      const correction = getXiaoyaCorrection(source.source, source.id);
      if (correction) {
        return applyCorrection(source, correction);
      }
    }
    return source;
  });
};

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
