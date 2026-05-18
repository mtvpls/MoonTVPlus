/* eslint-disable @next/next/no-img-element */

import { Link as LinkIcon, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { DanmakuComment,DanmakuSelection } from '@/lib/danmaku/types';
import { generateStorageKey, getCachedPlayRecordsSnapshot } from '@/lib/db.client';
import { isEpisodeHiddenByFilter } from '@/lib/episode-filter';
import { loadAllLocalEpisodeProgressRecords } from '@/lib/episode-progress';
import { isNetdiskSource } from '@/lib/netdisk/source';
import { EpisodeFilterConfig,SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

import DanmakuPanel from '@/components/DanmakuPanel';
import EpisodeFilterSettings from '@/components/EpisodeFilterSettings';
import ProxyImage from '@/components/ProxyImage';

// 定义视频信息类型
interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  bitrate: string; // 视频码率
  hasError?: boolean; // 添加错误状态标识
}

interface EpisodeSelectorProps {
  /** 总集数 */
  totalEpisodes: number;
  /** 剧集标题 */
  episodes_titles: string[];
  /** 每页显示多少集，默认 50 */
  episodesPerPage?: number;
  /** 当前选中的集数（1 开始） */
  value?: number;
  /** 用户点击选集后的回调 */
  onChange?: (episodeNumber: number) => void;
  /** 换源相关 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  episodeProgressContentKey?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 后台源加载状态 */
  backgroundSourcesLoading?: boolean;
  /** 预计算的测速结果，避免重复测速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
  /** 弹幕相关 */
  onDanmakuSelect?: (selection: DanmakuSelection) => void;
  currentDanmakuSelection?: DanmakuSelection | null;
  onUploadDanmaku?: (comments: DanmakuComment[]) => void;
  /** 观影室房员状态 - 禁用选集和换源，但保留弹幕 */
  isRoomMember?: boolean;
  /** 集数过滤配置 */
  episodeFilterConfig?: EpisodeFilterConfig | null;
  onFilterConfigUpdate?: (config: EpisodeFilterConfig) => void;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * 选集组件，支持分页、自动滚动聚焦当前分页标签，以及换源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  episodeProgressContentKey,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  backgroundSourcesLoading = false,
  precomputedVideoInfo,
  onDanmakuSelect,
  currentDanmakuSelection,
  onUploadDanmaku,
  isRoomMember = false,
  episodeFilterConfig = null,
  onFilterConfigUpdate,
  onShowToast,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 存储每个源的视频信息
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );
  // 存储正在重新测试的源
  const [retestingSources, setRetestingSources] = useState<Set<string>>(
    new Set()
  );
  // 标记初始测速是否已完成
  const [initialTestingCompleted, setInitialTestingCompleted] = useState(false);
  // 标记是否正在进行全部重测
  const [isRetestingAll, setIsRetestingAll] = useState(false);
  // 标记是否正在进行初始测速
  const [isInitialTesting, setIsInitialTesting] = useState(false);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<number>>(new Set());

  // 使用 ref 来避免闭包问题
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 同步状态到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !currentSource ||
      !currentId ||
      !episodeProgressContentKey
    ) {
      setWatchedEpisodes(new Set());
      return;
    }

    const readWatchedEpisodes = () => {
      const watched = new Set<number>();

      try {
        const records = getCachedPlayRecordsSnapshot();
        const record = records[generateStorageKey(currentSource, currentId)];
        if (record && record.index > 0 && record.play_time > 1) {
          watched.add(record.index);
        }
      } catch (error) {
        console.warn('[EpisodeSelector] Failed to read cached play records:', error);
      }

      try {
        const episodeRecords = loadAllLocalEpisodeProgressRecords(
          episodeProgressContentKey
        );

        for (const [episodeIndex, record] of Object.entries(episodeRecords)) {
          if (Number(record?.playTime) > 1) {
            const episodeNumber = Number(episodeIndex) + 1;
            if (episodeNumber >= 1 && episodeNumber <= totalEpisodes) {
              watched.add(episodeNumber);
            }
          }
        }
      } catch (error) {
        console.warn('[EpisodeSelector] Failed to read local episode progress:', error);
      }

      setWatchedEpisodes(watched);
    };

    readWatchedEpisodes();

    const handlePlayRecordsUpdated = () => {
      readWatchedEpisodes();
    };

    window.addEventListener('playRecordsUpdated', handlePlayRecordsUpdated as EventListener);
    window.addEventListener('storage', handlePlayRecordsUpdated);

    return () => {
      window.removeEventListener(
        'playRecordsUpdated',
        handlePlayRecordsUpdated as EventListener
      );
      window.removeEventListener('storage', handlePlayRecordsUpdated);
    };
  }, [currentSource, currentId, episodeProgressContentKey, totalEpisodes]);

  // 主要的 tab 状态：'danmaku' | 'episodes' | 'sources'
  // 默认显示选集选项卡，但如果是房员则显示弹幕
  const [activeTab, setActiveTab] = useState<'danmaku' | 'episodes' | 'sources'>(
    isRoomMember ? 'danmaku' : 'episodes'
  );

  // 当房员状态变化时，自动切换到弹幕选项卡
  useEffect(() => {
    if (isRoomMember && (activeTab === 'episodes' || activeTab === 'sources')) {
      setActiveTab('danmaku');
    }
  }, [isRoomMember, activeTab]);

  // 当前分页索引（0 开始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序显示
  const [descending, setDescending] = useState<boolean>(false);

  // 集数过滤设置弹窗状态
  const [showFilterSettings, setShowFilterSettings] = useState<boolean>(false);

  // 读取本地"优选和测速"开关，默认开启
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

  // 读取测速超时设置，默认4秒
  const [speedTestTimeout] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('speedTestTimeout');
      if (saved !== null) {
        return Number(saved);
      }
    }
    return 4000;
  });

  // 集数过滤逻辑
  const isEpisodeFiltered = useCallback(
    (episodeNumber: number): boolean => {
      if (!episodeFilterConfig || episodeFilterConfig.rules.length === 0) {
        return false;
      }

      // 获取集数标题
      const title = episodes_titles?.[episodeNumber - 1];
      if (!title) return false;
      return isEpisodeHiddenByFilter(title, episodeFilterConfig);
    },
    [episodeFilterConfig, episodes_titles]
  );

  // 根据 descending 状态计算实际显示的分页索引
  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  // 获取视频信息的函数 - 移除 attemptedSources 依赖避免不必要的重新创建
  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;

    // 使用 ref 获取最新的状态，避免闭包问题
    if (attemptedSourcesRef.current.has(sourceKey)) {
      return;
    }

    // 获取第一集的URL
    if (!source.episodes || source.episodes.length === 0) {
      return;
    }
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    // 标记为已尝试
    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl, speedTestTimeout);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch (error) {
      // 失败时保存错误状态
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          bitrate: '未知',
          hasError: true,
        })
      );
    }
  }, [speedTestTimeout]);

  // 重测所有源的函数
  const retestAllSources = useCallback(async () => {
    if (!availableSources || availableSources.length === 0) return;

    setIsRetestingAll(true);

    // 清空之前的测速结果
    setVideoInfoMap(new Map());
    setAttemptedSources(new Set());
    attemptedSourcesRef.current = new Set();
    videoInfoMapRef.current = new Map();

    // 筛选需要测速的源（排除 openlist/emby/xiaoya）
    const sourcesToTest = availableSources.filter((source) => {
      if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') {
        return false;
      }
      return true;
    });

    // 分批测速，每批最多5个
    const batchSize = 5;
    for (let i = 0; i < sourcesToTest.length; i += batchSize) {
      const batch = sourcesToTest.slice(i, i + batchSize);
      await Promise.all(batch.map(source => getVideoInfo(source)));
    }

    setIsRetestingAll(false);
  }, [availableSources, getVideoInfo]);

  // 当有预计算结果时，先合并到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      // 原子性地更新两个状态，避免时序问题
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) {
            newSet.add(key);
          }
        });
        return newSet;
      });

      // 同步更新 ref，确保 getVideoInfo 能立即看到更新
      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) {
          attemptedSourcesRef.current.add(key);
        }
      });
    }
  }, [precomputedVideoInfo]);

  // 当切换到换源tab并且有源数据时，异步获取视频信息 - 移除 attemptedSources 依赖避免循环触发
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 若关闭测速则直接退出
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      // 筛选出尚未测速的播放源，并排除不需要测速的源（openlist/emby/xiaoya）
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        // 跳过已测速的源
        if (attemptedSourcesRef.current.has(sourceKey)) return false;
        // 跳过不需要测速的源
        if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') return false;
        return true;
      });

      if (pendingSources.length === 0) return;

      // 标记开始初始测速
      setIsInitialTesting(true);

      const batchSize = Math.ceil(pendingSources.length / 2);

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }

      // 初始测速完成后，标记为已完成
      setIsInitialTesting(false);
      if (!initialTestingCompleted) {
        setInitialTestingCompleted(true);
      }
    };

    fetchVideoInfosInBatches();
    // 依赖项保持与之前一致
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled, initialTestingCompleted, currentSource]);

  // 监听后台加载完成，触发自动测速
  const prevBackgroundLoadingRef = useRef<boolean>(false);
  useEffect(() => {
    // 当后台加载从 true 变为 false 时（即加载完成）
    if (prevBackgroundLoadingRef.current && !backgroundSourcesLoading) {
      // 如果当前选项卡在换源位置，触发测速
      if (activeTab === 'sources' && optimizationEnabled) {
        // 筛选出尚未测速的播放源，并排除不需要测速的源（openlist/emby/xiaoya）
        const pendingSources = availableSources.filter((source) => {
          const sourceKey = `${source.source}-${source.id}`;
          // 跳过已测速的源
          if (attemptedSourcesRef.current.has(sourceKey)) return false;
          // 跳过不需要测速的源
          if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') return false;
          return true;
        });

        if (pendingSources.length > 0) {
          const batchSize = Math.ceil(pendingSources.length / 2);

          const fetchInBatches = async () => {
            for (let start = 0; start < pendingSources.length; start += batchSize) {
              const batch = pendingSources.slice(start, start + batchSize);
              await Promise.all(batch.map(getVideoInfo));
            }

            if (!initialTestingCompleted) {
              setInitialTestingCompleted(true);
            }
          };

          fetchInBatches();
        }
      }
    }

    // 更新前一次的加载状态
    prevBackgroundLoadingRef.current = backgroundSourcesLoading;
  }, [backgroundSourcesLoading, activeTab, availableSources, getVideoInfo, optimizationEnabled, initialTestingCompleted, currentSource]);

  // 升序分页标签
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 根据 descending 状态决定分页标签的排序和内容
  const categories = useMemo(() => {
    if (descending) {
      // 倒序时，label 也倒序显示
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 添加鼠标悬停状态管理
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);

  // 阻止页面竖向滚动
  const preventPageScroll = useCallback((e: WheelEvent) => {
    if (isCategoryHovered) {
      e.preventDefault();
    }
  }, [isCategoryHovered]);

  // 处理滚轮事件，实现横向滚动
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isCategoryHovered && categoryContainerRef.current) {
      e.preventDefault(); // 阻止默认的竖向滚动

      const container = categoryContainerRef.current;
      const scrollAmount = e.deltaY * 2; // 调整滚动速度

      // 根据滚轮方向进行横向滚动
      container.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  }, [isCategoryHovered]);

  // 添加全局wheel事件监听器
  useEffect(() => {
    if (isCategoryHovered) {
      // 鼠标悬停时阻止页面滚动
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      // 鼠标离开时恢复页面滚动
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    }

    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isCategoryHovered, preventPageScroll, handleWheel]);

  // 当分页切换时，将激活的分页标签滚动到视口中间
  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      // 手动计算滚动位置，只滚动分页标签容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 计算按钮相对于容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 计算目标滚动位置，使按钮居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滚动到目标位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [displayPage, pageCount]);

  // 处理换源tab点击，只在点击时才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        // 在倒序时，需要将显示索引转换为实际索引
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount]
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      if (episodeNumber + 1 === value) {
        return;
      }

      onChange?.(episodeNumber);
    },
    [onChange, value]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange]
  );

  // 解析网速字符串，转换为 KB/s 数值用于排序
  const parseSpeedToKBps = useCallback((speedStr: string): number => {
    if (!speedStr || speedStr === '未知' || speedStr === '测量中...') {
      return -1; // 无效速度返回 -1，排在最后
    }

    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    if (!match) {
      return -1;
    }

    const value = parseFloat(match[1]);
    const unit = match[2];

    // 统一转换为 KB/s
    return unit === 'MB/s' ? value * 1024 : value;
  }, []);

  // 重新测试单个源
  const handleRetestSource = useCallback(
    async (source: SearchResult, e: React.MouseEvent) => {
      e.stopPropagation(); // 阻止事件冒泡，避免触发换源
      const sourceKey = `${source.source}-${source.id}`;

      // 标记为正在测试
      setRetestingSources((prev) => new Set(prev).add(sourceKey));

      // 从已尝试列表中移除，允许重新测试
      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        newSet.delete(sourceKey);
        return newSet;
      });

      // 同步更新 ref
      attemptedSourcesRef.current.delete(sourceKey);

      // 执行测试
      try {
        await getVideoInfo(source);
      } finally {
        // 无论成功或失败，都移除测试标记
        setRetestingSources((prev) => {
          const newSet = new Set(prev);
          newSet.delete(sourceKey);
          return newSet;
        });
      }
    },
    [getVideoInfo]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  return (
    <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
      {/* 主要的 Tab 切换 - 无缝融入设计 */}
      <div className='flex mb-1 -mx-6 flex-shrink-0'>
        {/* 选集选项卡 - 仅在多集时显示 */}
        {totalEpisodes > 1 && (
          <div
            onClick={() => !isRoomMember && setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center transition-all duration-200 font-medium relative
              ${isRoomMember ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              ${activeTab === 'episodes'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            选集
            {isRoomMember && <span className="ml-1 text-xs">🔒</span>}
          </div>
        )}

        {/* 换源选项卡 */}
        <div
          onClick={() => !isRoomMember && handleSourceTabClick()}
          className={`flex-1 py-3 px-6 text-center transition-all duration-200 font-medium relative
            ${isRoomMember ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
            ${activeTab === 'sources'
              ? 'text-green-600 dark:text-green-400'
              : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          换源
          {isRoomMember && <span className="ml-1 text-xs">🔒</span>}
        </div>

        {/* 弹幕选项卡 */}
        <div
          onClick={() => setActiveTab('danmaku')}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
            ${activeTab === 'danmaku'
              ? 'text-green-600 dark:text-green-400'
              : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          弹幕
        </div>
      </div>

      {/* 弹幕 Tab 内容 */}
      {activeTab === 'danmaku' && onDanmakuSelect && (
        <div className='flex-1 min-h-0 overflow-hidden'>
          <DanmakuPanel
            videoTitle={videoTitle || ''}
            currentEpisodeIndex={value - 1}
            onDanmakuSelect={onDanmakuSelect}
            currentSelection={currentDanmakuSelection || null}
            onUploadDanmaku={onUploadDanmaku}
          />
        </div>
      )}

      {/* 选集 Tab 内容 */}
      {activeTab === 'episodes' && (
        <>
          {/* 分类标签 */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
            <div
              className='flex-1 overflow-x-auto'
              ref={categoryContainerRef}
              onMouseEnter={() => setIsCategoryHovered(true)}
              onMouseLeave={() => setIsCategoryHovered(false)}
            >
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center 
                        ${isActive
                          ? 'text-green-500 dark:text-green-400'
                          : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 向上/向下按钮 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => {
                // 切换集数排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
            {/* 集数屏蔽配置按钮 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => setShowFilterSettings(true)}
              title='集数屏蔽设置'
            >
              <Settings className='w-4 h-4' />
            </button>
          </div>

          {/* 集数网格 */}
          <div className='flex flex-wrap gap-3 overflow-y-auto flex-1 content-start pb-4'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
              // 过滤掉被屏蔽的集数，但保持原有索引
              return episodes
                .filter(episodeNumber => !isEpisodeFiltered(episodeNumber))
                .map((episodeNumber) => {
                  const isActive = episodeNumber === value;
                  const isWatched = watchedEpisodes.has(episodeNumber);
                  return (
                    <button
                      key={episodeNumber}
                      disabled={isActive}
                      onClick={() => handleEpisodeClick(episodeNumber - 1)}
                      className={`relative h-10 min-w-10 px-3 py-2 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap font-mono border
                        ${isActive
                          ? 'bg-green-500 text-white border-green-400 shadow-lg shadow-green-500/25 dark:bg-green-600'
                          : isWatched
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:scale-105 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/60 dark:hover:bg-emerald-900/30'
                            : 'bg-gray-200 text-gray-700 border-transparent hover:bg-gray-300 hover:scale-105 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                        } ${isActive ? 'cursor-default' : ''}`.trim()}
                      title={isWatched && !isActive ? '已观看过' : undefined}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      {isWatched && !isActive && (
                        <span className='absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400' />
                      )}
                      {(() => {
                        const title = episodes_titles?.[episodeNumber - 1];
                        if (!title) {
                          return episodeNumber;
                        }
                        // 如果是 OVA 格式，直接返回完整标题
                        if (title.match(/^OVA\s+\d+/i)) {
                          return title;
                        }
                        // 如果匹配 S01E01 格式，提取并返回
                        const sxxexxMatch = title.match(/[Ss](\d+)[Ee](\d{1,4}(?:\.\d+)?)/);
                        if (sxxexxMatch) {
                          const season = sxxexxMatch[1].padStart(2, '0');
                          const episode = sxxexxMatch[2];
                          return `S${season}E${episode}`;
                        }
                        // 如果匹配"第X集"、"第X话"、"X集"、"X话"格式，提取中间的数字（支持小数）
                        const match = title.match(/(?:第)?(\d+(?:\.\d+)?)(?:集|话)/);
                        if (match) {
                          return match[1];
                        }
                        return title;
                      })()}
                    </button>
                  );
                });
            })()}
          </div>
        </>
      )}

      {/* 换源 Tab 内容 */}
      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-2'>
          {/* 全部重测按钮 - 右上角 */}
          {!sourceSearchLoading && !sourceSearchError && availableSources.length > 0 && (
            <div className='flex justify-end mb-2 px-2 pb-2 border-b border-gray-300 dark:border-gray-700'>
              <button
                onClick={retestAllSources}
                disabled={isRetestingAll || retestingSources.size > 0 || isInitialTesting}
                className={`text-xs font-medium transition-colors ${
                  isRetestingAll || retestingSources.size > 0 || isInitialTesting
                    ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer'
                }`}
              >
                {isRetestingAll ? '重测中...' : isInitialTesting ? '测速中...' : '全部重测'}
              </button>
            </div>
          )}

          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📺</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暂无可用的换源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                {availableSources
                  .sort((a, b) => {
                    const aIsCurrent =
                      a.source?.toString() === currentSource?.toString() &&
                      a.id?.toString() === currentId?.toString();
                    const bIsCurrent =
                      b.source?.toString() === currentSource?.toString() &&
                      b.id?.toString() === currentId?.toString();

                    // 当前源始终置顶
                    if (aIsCurrent && !bIsCurrent) return -1;
                    if (!aIsCurrent && bIsCurrent) return 1;

                    // 如果初始测速已完成，按网速排序（快的在前）
                    if (initialTestingCompleted) {
                      const aKey = `${a.source}-${a.id}`;
                      const bKey = `${b.source}-${b.id}`;
                      const aInfo = videoInfoMap.get(aKey);
                      const bInfo = videoInfoMap.get(bKey);

                      const aSpeed = aInfo ? parseSpeedToKBps(aInfo.loadSpeed) : -1;
                      const bSpeed = bInfo ? parseSpeedToKBps(bInfo.loadSpeed) : -1;

                      // 速度快的排在前面（降序）
                      return bSpeed - aSpeed;
                    }

                    return 0;
                  })
                  .map((source, index) => {
                    const isCurrentSource =
                      source.source?.toString() === currentSource?.toString() &&
                      source.id?.toString() === currentId?.toString();
                    return (
                      <div
                        key={`${source.source}-${source.id}`}
                        onClick={() =>
                          !isCurrentSource && handleSourceClick(source)
                        }
                        className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                      ${isCurrentSource
                         ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                          : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                          }`.trim()}
                      >
                        {/* 封面 */}
                        <div className='flex-shrink-0 w-12 h-20 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden flex items-center justify-center'>
                          {source.source === 'directplay' ? (
                            <LinkIcon className='w-6 h-6 text-blue-500' />
                          ) : source.poster ? (
                            <ProxyImage
                              originalSrc={source.poster}
                              alt={source.title}
                              className='w-full h-full object-cover'
                              retryOnError={false}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                          ) : null}
                        </div>

                        {/* 信息区域 */}
                        <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                          {/* 标题和分辨率 - 顶部 */}
                          <div className='flex items-start justify-between gap-3 h-6'>
                            <div className='flex-1 min-w-0 relative group/title'>
                              <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                                {source.title}
                              </h3>
                              {/* 标题级别的 tooltip - 第一个元素不显示 */}
                              {index !== 0 && (
                                <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[500] pointer-events-none'>
                                  {source.title}
                                  <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                                </div>
                              )}
                            </div>
                            {(() => {
                              const sourceKey = `${source.source}-${source.id}`;
                              const videoInfo = videoInfoMap.get(sourceKey);

                              if (videoInfo && videoInfo.quality !== '未知') {
                                if (videoInfo.hasError) {
                                  return (
                                    <div className='bg-gray-500/10 dark:bg-gray-400/20 text-red-600 dark:text-red-400 px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center'>
                                      检测失败
                                    </div>
                                  );
                                } else {
                                  // 根据分辨率设置不同颜色：2K、4K为紫色，1080p、720p为绿色，其他为黄色
                                  const isUltraHigh = ['4K', '2K'].includes(
                                    videoInfo.quality
                                  );
                                  const isHigh = ['1080p', '720p'].includes(
                                    videoInfo.quality
                                  );
                                  const textColorClasses = isUltraHigh
                                    ? 'text-purple-600 dark:text-purple-400'
                                    : isHigh
                                      ? 'text-green-600 dark:text-green-400'
                                      : 'text-yellow-600 dark:text-yellow-400';

                                  return (
                                    <div
                                      className={`bg-gray-500/10 dark:bg-gray-400/20 ${textColorClasses} px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center`}
                                    >
                                      {videoInfo.quality}
                                    </div>
                                  );
                                }
                              }

                              return null;
                            })()}
                          </div>

                          {/* 源名称和集数信息 - 垂直居中 */}
                          <div className='flex items-center justify-between'>
                            <span className={`text-xs px-2 py-1 border rounded text-gray-700 dark:text-gray-300 ${
                              source.source === 'xiaoya' ? 'border-blue-500' : isNetdiskSource(source.source) ? 'border-purple-500' : source.source === 'openlist' || source.source === 'emby' || source.source?.startsWith('emby_')
                           ? 'border-yellow-500'
                                : 'border-gray-500/60'
                      }`}>
                              {source.source_name}
                            </span>
                            {source.episodes.length > 1 && (
                              <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                                {source.episodes.length} 集
                              </span>
                            )}
                          </div>

                          {/* 网络信息 - 底部 */}
                          <div className='flex items-end justify-between h-6'>
                            <div className='flex items-end gap-3'>
                              {(() => {
                                const sourceKey = `${source.source}-${source.id}`;
                                const videoInfo = videoInfoMap.get(sourceKey);
                                if (videoInfo) {
                                  if (!videoInfo.hasError) {
                                    return (
                                      <div className='flex items-end gap-3 text-xs'>
                                        <div className='text-green-600 dark:text-green-400 font-medium text-xs'>
                                          {videoInfo.loadSpeed}
                                        </div>
                                        <div className='text-orange-600 dark:text-orange-400 font-medium text-xs'>
                                          {videoInfo.pingTime}ms
                                        </div>
                                        {videoInfo.bitrate && videoInfo.bitrate !== '未知' && (
                                          <div className='text-purple-600 dark:text-purple-400 font-medium text-xs'>
                                            {videoInfo.bitrate}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  } else {
                                    return (
                                      <div className='text-red-500/90 dark:text-red-400 font-medium text-xs'>
                                        无测速数据
                                      </div>
                                    );
                                  }
                                }
                                return null;
                              })()}
                            </div>
                            {/* 重新测试按钮 */}
                            {(() => {
                              // 私人影库、Emby 和小雅不显示重新测试按钮
                              if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') {
                                return null;
                              }

                              const sourceKey = `${source.source}-${source.id}`;
                              const isTesting = retestingSources.has(sourceKey);
                              const videoInfo = videoInfoMap.get(sourceKey);

                              // 只有第一次测试完成后（有测速数据）才显示重新测试按钮
                              if (videoInfo) {
                                return (
                                  <button
                                    onClick={(e) => handleRetestSource(source, e)}
                                    disabled={isTesting}
                                    className={`text-xs font-medium transition-colors ${
                                      isTesting
                                        ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                        : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer'
                                    }`}
                                  >
                                    {isTesting ? '测试中...' : '重新测试'}
                                  </button>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                {/* 后台加载提示 */}
                {backgroundSourcesLoading && (
                  <div className='flex items-center justify-center py-6 border-t border-gray-300 dark:border-gray-700'>
                    <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                    <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                      正在加载更多播放源...
                    </span>
                  </div>
                )}
                <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
                  >
                    影片匹配有误？点击去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}

      {/* 集数过滤设置弹窗 */}
      <EpisodeFilterSettings
        isOpen={showFilterSettings}
        onClose={() => setShowFilterSettings(false)}
        onConfigUpdate={(config) => {
          onFilterConfigUpdate?.(config);
        }}
        onShowToast={onShowToast}
      />
    </div>
  );
};

export default EpisodeSelector;
