/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps,@typescript-eslint/no-empty-function */

import { ExternalLink, Heart, Info, Link, PlayCircleIcon, Radio, Sparkles, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { processImageUrl } from '@/lib/utils';
import { useLongPress } from '@/hooks/useLongPress';

import AIChatPanel from '@/components/AIChatPanel';
import DetailPanel from '@/components/DetailPanel';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import ImageViewer from '@/components/ImageViewer';
import MobileActionSheet from '@/components/MobileActionSheet';

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban' | 'tmdb' | 'source-search';
  currentEpisode?: number;
  douban_id?: number;
  tmdb_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
  origin?: 'vod' | 'live';
  releaseDate?: string; // 上映日期，格式：YYYY-MM-DD
  isUpcoming?: boolean; // 是否为即将上映
  seasonNumber?: number; // 季度编号
  seasonName?: string; // 季度名称
  orientation?: 'vertical' | 'horizontal'; // 卡片方向
  playTime?: number; // 当前播放时间（秒）
  totalTime?: number; // 总时长（秒）
  cmsData?: {
    desc?: string;
    episodes?: string[];
    episodes_titles?: string[];
  };
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
  setDoubanId: (id?: number) => void;
};

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(function VideoCard(
  {
    id,
    title = '',
    query = '',
    poster = '',
    episodes,
    source,
    source_name,
    source_names,
    progress = 0,
    year,
    from,
    currentEpisode,
    douban_id,
    tmdb_id,
    onDelete,
    rate,
    type = '',
    isBangumi = false,
    isAggregate = false,
    origin = 'vod',
    releaseDate,
    isUpcoming = false,
    seasonNumber,
    seasonName,
    orientation = 'vertical',
    playTime,
    totalTime,
    cmsData,
  }: VideoCardProps,
  ref
) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [searchFavorited, setSearchFavorited] = useState<boolean | null>(null); // 搜索结果的收藏状态
  const [showAIChat, setShowAIChat] = useState(false);
  const [isAIStreaming, setIsAIStreaming] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDefaultMessageWithVideo, setAiDefaultMessageWithVideo] = useState('');
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [showUpcomingInfo, setShowUpcomingInfo] = useState(false); // 控制即将上映倒计时的显示

  // 检查AI功能是否启用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.AI_ENABLED &&
        (window as any).RUNTIME_CONFIG?.AI_ENABLE_VIDEOCARD_ENTRY;
      setAiEnabled(enabled);

      // 加载AI默认消息配置
      const defaultMsg = (window as any).RUNTIME_CONFIG?.AI_DEFAULT_MESSAGE_WITH_VIDEO;
      if (defaultMsg) {
        setAiDefaultMessageWithVideo(defaultMsg);
      }
    }
  }, []);

  // 可外部修改的可控字段
  const [dynamicEpisodes, setDynamicEpisodes] = useState<number | undefined>(
    episodes
  );
  const [dynamicSourceNames, setDynamicSourceNames] = useState<string[] | undefined>(
    source_names
  );
  const [dynamicDoubanId, setDynamicDoubanId] = useState<number | undefined>(
    douban_id
  );

  useEffect(() => {
    setDynamicEpisodes(episodes);
  }, [episodes]);

  useEffect(() => {
    setDynamicSourceNames(source_names);
  }, [source_names]);

  useEffect(() => {
    setDynamicDoubanId(douban_id);
  }, [douban_id]);

  useImperativeHandle(ref, () => ({
    setEpisodes: (eps?: number) => setDynamicEpisodes(eps),
    setSourceNames: (names?: string[]) => setDynamicSourceNames(names),
    setDoubanId: (id?: number) => setDynamicDoubanId(id),
  }));

  const actualTitle = title;
  const actualPoster = poster;
  const actualSource = source;
  const actualId = id;
  const actualDoubanId = dynamicDoubanId;
  const actualEpisodes = dynamicEpisodes;
  const actualYear = year;
  const actualQuery = query || '';
  const actualSearchType = type;
  const isDirectPlaySource = actualSource === 'directplay';
  const displayYear = useMemo(() => {
    if (!actualYear) return '';
    const normalized = actualYear.trim();
    if (!normalized || normalized === 'unknown') return '';
    const digits = normalized.replace(/\D/g, '');
    if (!digits) return normalized;
    return digits.slice(-2).padStart(2, '0');
  }, [actualYear]);

  // 获取收藏状态（搜索结果页面不检查）
  useEffect(() => {
    if (from === 'douban' || from === 'search' || !actualSource || !actualId) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setFavorited(fav);
      } catch (err) {
        throw new Error('检查收藏状态失败');
      }
    };

    fetchFavoriteStatus();

    // 监听收藏状态更新事件
    const storageKey = generateStorageKey(actualSource, actualId);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        // 检查当前项目是否在新的收藏列表中
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      }
    );

    return unsubscribe;
  }, [from, actualSource, actualId]);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from === 'douban' || !actualSource || !actualId) return;

      try {
        // 确定当前收藏状态
        const currentFavorited = from === 'search' ? searchFavorited : favorited;

        if (currentFavorited) {
          // 如果已收藏，删除收藏
          await deleteFavorite(actualSource, actualId);
          if (from === 'search') {
            setSearchFavorited(false);
          } else {
            setFavorited(false);
          }
        } else {
          // 如果未收藏，添加收藏
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
          if (from === 'search') {
            setSearchFavorited(true);
          } else {
            setFavorited(true);
          }
        }
      } catch (err) {
        throw new Error('切换收藏状态失败');
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      favorited,
      searchFavorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        throw new Error('删除播放记录失败');
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  const handleClick = useCallback(() => {
    // 即将上映的电影：单击显示上映倒计时提示，不跳转
    if (isUpcoming) {
      setShowUpcomingInfo(true);
      // 2秒后自动隐藏
      setTimeout(() => {
        setShowUpcomingInfo(false);
      }, 2000);
      return;
    }

    if (origin === 'live' && actualSource && actualId) {
      // 直播内容跳转到直播页面
      const url = `/live?source=${actualSource.replace('live_', '')}&id=${actualId.replace('live_', '')}`;
      router.push(url);
    } else if (from === 'douban' || from === 'tmdb' || (isAggregate && !actualSource && !actualId)) {
      // 检测当前是否在 play 页面
      const isCurrentlyOnPlayPage = typeof window !== 'undefined' && window.location.pathname === '/play';

      let url = `/play?title=${encodeURIComponent(actualTitle.trim())}${actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}${isAggregate ? '&prefer=true' : ''}${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''}`;

      if (isCurrentlyOnPlayPage) {
        // 在 play 页面内，添加 _reload 参数强制刷新
        url += `&_reload=${Date.now()}`;
        window.location.href = url;
      } else {
        // 不在 play 页面，正常跳转
        router.push(url);
      }
    } else if (actualSource && actualId) {
      // 检测当前是否在 play 页面
      const isCurrentlyOnPlayPage = typeof window !== 'undefined' && window.location.pathname === '/play';

      let url = `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
        actualTitle
      )}${actualYear ? `&year=${actualYear}` : ''}${isAggregate ? '&prefer=true' : ''
        }${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;

      if (isCurrentlyOnPlayPage) {
        // 在 play 页面内，添加 _reload 参数强制刷新
        url += `&_reload=${Date.now()}`;
        window.location.href = url;
      } else {
        // 不在 play 页面，正常跳转
        router.push(url);
      }
    }
  }, [
    isUpcoming,
    origin,
    from,
    actualSource,
    actualId,
    router,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  // 新标签页播放处理函数
  const handlePlayInNewTab = useCallback(() => {
    // 即将上映的电影不跳转
    if (isUpcoming) {
      return;
    }

    if (origin === 'live' && actualSource && actualId) {
      // 直播内容跳转到直播页面
      const url = `/live?source=${actualSource.replace('live_', '')}&id=${actualId.replace('live_', '')}`;
      window.open(url, '_blank');
    } else if (from === 'douban' || from === 'tmdb' || (isAggregate && !actualSource && !actualId)) {
      const url = `/play?title=${encodeURIComponent(actualTitle.trim())}${actualYear ? `&year=${actualYear}` : ''}${actualSearchType ? `&stype=${actualSearchType}` : ''}${isAggregate ? '&prefer=true' : ''}${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''}`;
      window.open(url, '_blank');
    } else if (actualSource && actualId) {
      const url = `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
        actualTitle
      )}${actualYear ? `&year=${actualYear}` : ''}${isAggregate ? '&prefer=true' : ''
        }${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;
      window.open(url, '_blank');
    }
  }, [
    isUpcoming,
    origin,
    from,
    actualSource,
    actualId,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  // 检查搜索结果的收藏状态
  const checkSearchFavoriteStatus = useCallback(async () => {
    if (from === 'search' && !isAggregate && actualSource && actualId && searchFavorited === null) {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setSearchFavorited(fav);
      } catch (err) {
        setSearchFavorited(false);
      }
    }
  }, [from, isAggregate, actualSource, actualId, searchFavorited]);

  // 长按操作
  const handleLongPress = useCallback(() => {
    if (!showMobileActions) { // 防止重复触发
      // 立即显示菜单，避免等待数据加载导致动画卡顿
      setShowMobileActions(true);

      // 异步检查收藏状态，不阻塞菜单显示
      if (from === 'search' && !isAggregate && actualSource && actualId && searchFavorited === null) {
        checkSearchFavoriteStatus();
      }
    }
  }, [showMobileActions, from, isAggregate, actualSource, actualId, searchFavorited, checkSearchFavoriteStatus]);

  // 长按手势hook
  const longPressProps = useLongPress({
    onLongPress: handleLongPress,
    onClick: handleClick, // 保持点击播放功能
    longPressDelay: 500,
  });

  // 计算距离上映的天数（使用本地时区）
  const daysUntilRelease = useMemo(() => {
    if (!isUpcoming || !releaseDate) return null;

    // 获取今天的本地日期（午夜）
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 将日期字符串解析为本地时区的日期对象
    // 使用 'YYYY-MM-DD' 格式直接构造，避免 UTC 解析问题
    const [releaseYear, releaseMonth, releaseDay] = releaseDate.split('-').map(Number);
    const release = new Date(releaseYear, releaseMonth - 1, releaseDay);

    const [todayYear, todayMonth, todayDay] = todayStr.split('-').map(Number);
    const todayDate = new Date(todayYear, todayMonth - 1, todayDay);

    const diffTime = release.getTime() - todayDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }, [isUpcoming, releaseDate]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: false,
        showRating: false,
        showYear: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
        showYear: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true, // 移动端菜单中需要显示收藏选项
        showCheckCircle: false,
        showDoubanLink: true, // 移动端菜单中显示豆瓣链接
        showRating: !!rate,
        showYear: true,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: !isUpcoming, // 即将上映不显示播放按钮
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: !!rate,
        showYear: false,
      },
      tmdb: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: !isUpcoming, // 即将上映不显示播放按钮
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: !!rate,
        showYear: false,
      },
      'source-search': {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
        showYear: true,
      },
    };
    return configs[from] || configs.search;
  }, [from, isAggregate, douban_id, rate, isUpcoming]);

  // 移动端操作菜单配置
  const mobileActions = useMemo(() => {
    const actions = [];

    // 播放操作
    if (config.showPlayButton) {
      actions.push({
        id: 'play',
        label: origin === 'live' ? '观看直播' : '播放',
        icon: <PlayCircleIcon size={20} />,
        onClick: handleClick,
        color: 'primary' as const,
      });

      // 新标签页播放
      actions.push({
        id: 'play-new-tab',
        label: origin === 'live' ? '新标签页观看' : '新标签页播放',
        icon: <ExternalLink size={20} />,
        onClick: handlePlayInNewTab,
        color: 'default' as const,
      });
    }

    // 聚合源信息 - 直接在菜单中展示，不需要单独的操作项

    // 收藏/取消收藏操作
    if (config.showHeart && from !== 'douban' && from !== 'tmdb' && actualSource && actualId) {
      const currentFavorited = from === 'search' ? searchFavorited : favorited;

      if (from === 'search') {
        // 搜索结果：根据加载状态显示不同的选项
        if (searchFavorited !== null) {
          // 已加载完成，显示实际的收藏状态
          actions.push({
            id: 'favorite',
            label: currentFavorited ? '取消收藏' : '添加收藏',
            icon: currentFavorited ? (
              <Heart size={20} className="fill-red-600 stroke-red-600" />
            ) : (
              <Heart size={20} className="fill-transparent stroke-red-500" />
            ),
            onClick: () => {
              const mockEvent = {
                preventDefault: () => { },
                stopPropagation: () => { },
              } as React.MouseEvent;
              handleToggleFavorite(mockEvent);
            },
            color: currentFavorited ? ('danger' as const) : ('default' as const),
          });
        } else {
          // 正在加载中，显示占位项
          actions.push({
            id: 'favorite-loading',
            label: '收藏加载中...',
            icon: <Heart size={20} />,
            onClick: () => { }, // 加载中时不响应点击
            disabled: true,
          });
        }
      } else {
        // 非搜索结果：直接显示收藏选项
        actions.push({
          id: 'favorite',
          label: currentFavorited ? '取消收藏' : '添加收藏',
          icon: currentFavorited ? (
            <Heart size={20} className="fill-red-600 stroke-red-600" />
          ) : (
            <Heart size={20} className="fill-transparent stroke-red-500" />
          ),
          onClick: () => {
            const mockEvent = {
              preventDefault: () => { },
              stopPropagation: () => { },
            } as React.MouseEvent;
            handleToggleFavorite(mockEvent);
          },
          color: currentFavorited ? ('danger' as const) : ('default' as const),
        });
      }
    }

    // 删除播放记录操作
    if (config.showCheckCircle && from === 'playrecord' && actualSource && actualId) {
      actions.push({
        id: 'delete',
        label: '删除记录',
        icon: <Trash2 size={20} />,
        onClick: () => {
          const mockEvent = {
            preventDefault: () => { },
            stopPropagation: () => { },
          } as React.MouseEvent;
          handleDeleteRecord(mockEvent);
        },
        color: 'danger' as const,
      });
    }

    // 豆瓣链接操作
    if (config.showDoubanLink && actualDoubanId && actualDoubanId !== 0) {
      actions.push({
        id: 'douban',
        label: isBangumi ? 'Bangumi 详情' : '豆瓣详情',
        icon: <Link size={20} />,
        onClick: () => {
          const url = isBangumi
            ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
            : `https://movie.douban.com/subject/${actualDoubanId.toString()}`;
          window.open(url, '_blank', 'noopener,noreferrer');
        },
        color: 'default' as const,
      });
    }

    // 详情页面按钮
    actions.push({
      id: 'detail',
      label: '详情',
      icon: <Info size={20} />,
      onClick: () => {
        setShowMobileActions(false);
        // 延迟打开 DetailPanel，确保 MobileActionSheet 完全清理完成
        setTimeout(() => {
          setShowDetailPanel(true);
        }, 250);
      },
      color: 'default' as const,
    });

    // AI问片功能
    if (aiEnabled && actualTitle) {
      actions.push({
        id: 'ai-chat',
        label: 'AI问片',
        icon: <Sparkles size={20} />,
        onClick: () => {
          setShowMobileActions(false);
          // 延迟打开 AIChatPanel，确保 MobileActionSheet 完全清理完成
          setTimeout(() => {
            setShowAIChat(true);
          }, 250);
        },
        color: 'default' as const,
      });
    }

    return actions;
  }, [
    config,
    from,
    actualSource,
    actualId,
    favorited,
    searchFavorited,
    actualDoubanId,
    isBangumi,
    isAggregate,
    dynamicSourceNames,
    handleClick,
    handleToggleFavorite,
    handleDeleteRecord,
    handlePlayInNewTab,
    aiEnabled,
    actualTitle,
  ]);

  return (
    <>
      <div
        className={`group relative w-full rounded-lg bg-transparent transition-all duration-300 ease-in-out hover:scale-[1.05] hover:z-[500] ${isUpcoming ? 'cursor-default' : 'cursor-pointer'} ${
          showUpcomingInfo ? 'scale-[1.05] z-[500]' : ''
        }`}
        onClick={handleClick}
        {...longPressProps}
        style={{
          // 禁用所有默认的长按和选择效果
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          // 禁用右键菜单和长按菜单
          pointerEvents: 'auto',
        } as React.CSSProperties}
        onContextMenu={(e) => {
          // 阻止默认右键菜单
          e.preventDefault();
          e.stopPropagation();

          // 右键弹出操作菜单
          setShowMobileActions(true);

          // 异步检查收藏状态，不阻塞菜单显示
          if (from === 'search' && !isAggregate && actualSource && actualId && searchFavorited === null) {
            checkSearchFavoriteStatus();
          }

          return false;
        }}

        onDragStart={(e) => {
          // 阻止拖拽
          e.preventDefault();
          return false;
        }}
      >
        {/* 海报容器 */}
        <div
          className={`relative overflow-hidden rounded-lg ${origin === 'live' ? 'ring-1 ring-gray-300/80 dark:ring-gray-600/80' : ''} ${
            orientation === 'horizontal'
              ? 'aspect-[3/2]'
              : 'aspect-[2/3]'
          }`}
          style={{
            WebkitUserSelect: 'none',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
          } as React.CSSProperties}
          onContextMenu={(e) => {
            e.preventDefault();
            return false;
          }}
        >
          {/* 骨架屏 */}
          {!isLoading && !isDirectPlaySource && <ImagePlaceholder aspectRatio={orientation === 'horizontal' ? 'aspect-[3/2]' : 'aspect-[2/3]'} />}
          {isDirectPlaySource ? (
            <div className='absolute inset-0 flex items-center justify-center bg-gray-200/80 dark:bg-gray-700/80'>
              <Link className='w-8 h-8 text-blue-500' />
            </div>
          ) : (
            <Image
              src={processImageUrl(actualPoster)}
              alt={actualTitle}
              fill
              className={origin === 'live' ? 'object-contain' : orientation === 'horizontal' ? 'object-cover object-center' : 'object-cover'}
              referrerPolicy='no-referrer'
              loading='lazy'
              onLoadingComplete={() => setIsLoading(true)}
              onClick={(e) => {
                e.stopPropagation();
                setShowImageViewer(true);
              }}
              onError={(e) => {
                // 图片加载失败时的重试机制
                const img = e.target as HTMLImageElement;
                if (!img.dataset.retried) {
                  img.dataset.retried = 'true';
                  setTimeout(() => {
                    img.src = processImageUrl(actualPoster);
                  }, 2000);
                }
              }}
              style={{
                // 禁用图片的默认长按效果
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
                pointerEvents: 'auto', // 改为auto以响应点击事件
                cursor: 'pointer', // 添加指针样式
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
              onDragStart={(e) => {
                e.preventDefault();
                return false;
              }}
            />
          )}

          {/* 悬浮遮罩 */}
          <div
            className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity duration-300 ease-in-out opacity-0 group-hover:opacity-100'
            style={{
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
            } as React.CSSProperties}
            onContextMenu={(e) => {
              e.preventDefault();
              return false;
            }}
          />

          {/* 播放按钮或上映倒计时 */}
          {isUpcoming && daysUntilRelease !== null ? (
            <div
              data-button="true"
              className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-in-out ${
                showUpcomingInfo ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
              }`}
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='bg-black/70 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-xs md:text-sm font-medium shadow-lg'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
              >
                {daysUntilRelease > 0
                  ? `${daysUntilRelease}天后上映`
                  : daysUntilRelease === 0
                    ? '今日上映'
                    : '已上映'}
              </div>
            </div>
          ) : config.showPlayButton && (
            <div
              data-button="true"
              className='absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 ease-in-out delay-75 group-hover:opacity-100 group-hover:scale-100'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <PlayCircleIcon
                size={50}
                strokeWidth={0.8}
                className='text-white fill-transparent transition-all duration-300 ease-out hover:fill-green-500 hover:scale-[1.1]'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              />
            </div>
          )}

          {/* 操作按钮 - 继续观看不显示桌面端悬停按钮 */}
          {(config.showHeart || config.showCheckCircle) && from !== 'playrecord' && (
            <div
              data-button="true"
              className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out sm:group-hover:opacity-100 sm:group-hover:translate-y-0'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              {config.showCheckCircle && (
                <Trash2
                  onClick={handleDeleteRecord}
                  size={20}
                  className='text-white transition-all duration-300 ease-out hover:stroke-red-500 hover:scale-[1.1]'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              )}
              {config.showHeart && from !== 'search' && (
                <Heart
                  onClick={handleToggleFavorite}
                  size={20}
                  className={`transition-all duration-300 ease-out ${favorited
                    ? 'fill-red-600 stroke-red-600'
                    : 'fill-transparent stroke-white hover:stroke-red-400'
                    } hover:scale-[1.1]`}
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              )}
            </div>
          )}


          {/* 季度徽章 */}
          {seasonNumber && (
            <div
              className="absolute top-2 left-2 bg-blue-500/80 text-white text-xs font-medium px-2 py-1 rounded backdrop-blur-sm shadow-sm transition-all duration-300 ease-out group-hover:opacity-90"
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
              title={seasonName || `第${seasonNumber}季`}
            >
              S{seasonNumber}
            </div>
          )}

          {/* 徽章 */}
          {config.showRating && rate && (
            <div
              className='absolute top-2 right-2 bg-pink-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all duration-300 ease-out group-hover:scale-110'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              {rate}
            </div>
          )}

          {actualEpisodes && actualEpisodes > 1 && orientation === 'vertical' && (
            <div
              className='absolute top-1 right-1 sm:top-2 sm:right-2 flex flex-col gap-0.5 sm:gap-1.5'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              {/* 集数显示 */}
              <div
                className='bg-black/60 text-white text-[9px] sm:text-xs font-medium px-2 sm:px-3 py-0.5 sm:py-1 rounded-full shadow-md transition-all duration-300 ease-out group-hover:scale-110 backdrop-blur-sm flex items-center justify-center'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                共{actualEpisodes}集
              </div>

              {/* 年份显示 */}
              {displayYear && (
                <div
                  className='bg-black/60 text-white text-[9px] sm:text-xs font-medium px-2 sm:px-3 py-0.5 sm:py-1 rounded-full shadow-md transition-all duration-300 ease-out group-hover:scale-110 backdrop-blur-sm flex items-center justify-center'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {displayYear}年
                </div>
              )}
            </div>
          )}

          {/* 竖向模式：来源名称显示在海报右下角 */}
          {orientation === 'vertical' && config.showSourceName && source_name && !cmsData && (
            <div
              className='absolute bottom-1 right-1 sm:bottom-2 sm:right-2'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <span
                className={`inline-block border rounded px-1 py-0.5 text-[8px] text-white/90 bg-black/60 ${
                  actualSource === 'xiaoya' ? 'border-blue-500' : actualSource === 'openlist' || actualSource === 'emby' || actualSource?.startsWith('emby_') ? 'border-yellow-500' : origin === 'live' ? 'border-red-500' : 'border-white/60'
                }`}
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {origin === 'live' && (
                  <Radio size={8} className="inline-block text-white/90 mr-0.5" />
                )}
                {source_name}
              </span>
            </div>
          )}

          {/* 豆瓣链接 */}
          {config.showDoubanLink && actualDoubanId && actualDoubanId !== 0 && (
            <a
              href={
                isBangumi
                  ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
                  : `https://movie.douban.com/subject/${actualDoubanId.toString()}`
              }
              target='_blank'
              rel='noopener noreferrer'
              onClick={(e) => e.stopPropagation()}
              className='absolute top-2 left-2 opacity-0 -translate-x-2 transition-all duration-300 ease-in-out delay-100 sm:group-hover:opacity-100 sm:group-hover:translate-x-0'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='bg-green-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <Link
                  size={16}
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                    pointerEvents: 'none',
                  } as React.CSSProperties}
                />
              </div>
            </a>
          )}

          {/* 聚合播放源指示器 */}
          {isAggregate && dynamicSourceNames && dynamicSourceNames.length > 0 && (() => {
            const uniqueSources = Array.from(new Set(dynamicSourceNames));
            const sourceCount = uniqueSources.length;

            return (
              <div
                className='absolute bottom-2 right-2 opacity-0 transition-all duration-300 ease-in-out delay-75 sm:group-hover:opacity-100'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <div
                  className='relative group/sources'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                >
                  <div
                    className='bg-gray-700 text-white text-xs font-bold w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shadow-md hover:bg-gray-600 hover:scale-[1.1] transition-all duration-300 ease-out cursor-pointer'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  >
                    {sourceCount}
                  </div>

                  {/* 播放源详情悬浮框 */}
                  {(() => {
                    // 优先显示的播放源（常见的主流平台）
                    const prioritySources = ['爱奇艺', '腾讯视频', '优酷', '芒果TV', '哔哩哔哩', 'Netflix', 'Disney+'];

                    // 按优先级排序播放源
                    const sortedSources = uniqueSources.sort((a, b) => {
                      const aIndex = prioritySources.indexOf(a);
                      const bIndex = prioritySources.indexOf(b);
                      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                      if (aIndex !== -1) return -1;
                      if (bIndex !== -1) return 1;
                      return a.localeCompare(b);
                    });

                    const maxDisplayCount = 6; // 最多显示6个
                    const displaySources = sortedSources.slice(0, maxDisplayCount);
                    const hasMore = sortedSources.length > maxDisplayCount;
                    const remainingCount = sortedSources.length - maxDisplayCount;

                    return (
                      <div
                        className='absolute bottom-full mb-2 opacity-0 invisible group-hover/sources:opacity-100 group-hover/sources:visible transition-all duration-200 ease-out delay-100 pointer-events-none z-50 right-0 sm:right-0 -translate-x-0 sm:translate-x-0'
                        style={{
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          return false;
                        }}
                      >
                        <div
                          className='bg-gray-800/90 backdrop-blur-sm text-white text-xs sm:text-xs rounded-lg shadow-xl border border-white/10 p-1.5 sm:p-2 min-w-[100px] sm:min-w-[120px] max-w-[140px] sm:max-w-[200px] overflow-hidden'
                          style={{
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                          } as React.CSSProperties}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            return false;
                          }}
                        >
                          {/* 单列布局 */}
                          <div className='space-y-0.5 sm:space-y-1'>
                            {displaySources.map((sourceName, index) => (
                              <div key={index} className='flex items-center gap-1 sm:gap-1.5'>
                                <div className='w-0.5 h-0.5 sm:w-1 sm:h-1 bg-blue-400 rounded-full flex-shrink-0'></div>
                                <span className='truncate text-[10px] sm:text-xs leading-tight' title={sourceName}>
                                  {sourceName}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* 显示更多提示 */}
                          {hasMore && (
                            <div className='mt-1 sm:mt-2 pt-1 sm:pt-1.5 border-t border-gray-700/50'>
                              <div className='flex items-center justify-center text-gray-400'>
                                <span className='text-[10px] sm:text-xs font-medium'>+{remainingCount} 播放源</span>
                              </div>
                            </div>
                          )}

                          {/* 小箭头 */}
                          <div className='absolute top-full right-2 sm:right-3 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px] border-transparent border-t-gray-800/90'></div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* 横向模式：标题和进度条在海报上 */}
          {orientation === 'horizontal' && (
            <>
              {/* 顶部渐变遮罩 - 用于标题背景 */}
              <div
                className='absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent pt-2 pb-8 px-2'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {/* 标题 */}
                <div
                  className='mb-1'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                >
                  <span
                    className='block text-sm font-bold truncate text-white'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                    title={actualTitle}
                  >
                    {actualTitle}
                  </span>
                </div>

                {/* 集数信息 - 只有超过1集时才显示 */}
                {currentEpisode && actualEpisodes && actualEpisodes > 1 && (
                  <div
                    className='text-xs text-white/90'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  >
                    第{currentEpisode}集 · 共{actualEpisodes}集
                  </div>
                )}
              </div>

              {/* 底部渐变遮罩 - 用于进度条背景 */}
              <div
                className='absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-8 pb-2 px-2'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {/* 进度条 */}
                {config.showProgress && progress !== undefined && origin !== 'live' && (
                  <div
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                  >
                    {/* 来源和时长显示 - 在进度条上方 */}
                    <div className='flex items-center justify-between mb-1'>
                      {/* 时长显示 - 左侧 */}
                      {from === 'playrecord' && playTime !== undefined && totalTime !== undefined && (
                        <div
                          className='text-[10px] text-white/80'
                          style={{
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                          } as React.CSSProperties}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            return false;
                          }}
                        >
                          {(() => {
                            const formatTime = (seconds: number) => {
                              const mins = Math.floor(seconds / 60);
                              const secs = Math.floor(seconds % 60);
                              // 0分钟时不显示分钟
                              if (mins === 0) {
                                return `${secs}秒`;
                              }
                              return `${mins}分${secs}秒`;
                            };
                            return formatTime(playTime);
                          })()}
                        </div>
                      )}

                      {/* 来源 - 右侧 */}
                      {config.showSourceName && source_name && !cmsData && (
                        <span
                          className={`inline-block border rounded px-1 py-0.5 text-[8px] text-white/90 bg-black/30 backdrop-blur-sm ${
                            actualSource === 'xiaoya' ? 'border-blue-500' : actualSource === 'openlist' || actualSource === 'emby' || actualSource?.startsWith('emby_') ? 'border-yellow-500' : 'border-white/60'
                          }`}
                          style={{
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                          } as React.CSSProperties}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            return false;
                          }}
                        >
                          {source_name}
                        </span>
                      )}
                    </div>
                    <div
                      className='h-1 w-full bg-white/20 rounded-full overflow-hidden'
                      style={{
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        return false;
                      }}
                    >
                      <div
                        className='h-full bg-white transition-all duration-500 ease-out'
                        style={{
                          width: `${progress}%`,
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          return false;
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* 直播时只显示来源 */}
                {origin === 'live' && config.showSourceName && source_name && !cmsData && (
                  <div className='flex items-center justify-end'>
                    <span
                      className={`inline-block border rounded px-1 py-0.5 text-[8px] text-white/90 bg-black/30 backdrop-blur-sm ${
                        origin === 'live' ? 'border-red-500' : actualSource === 'openlist' || actualSource === 'emby' || actualSource?.startsWith('emby_') ? 'border-yellow-500' : 'border-white/60'
                      }`}
                      style={{
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        return false;
                      }}
                    >
                      <Radio size={8} className="inline-block text-white/90 mr-0.5" />
                      {source_name}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 竖向模式：进度条和标题在海报下方 */}
        {orientation === 'vertical' && (
          <>
            {/* 进度条 */}
            {config.showProgress && progress !== undefined && (
              <div
                className='mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <div
                  className='h-full bg-green-500 transition-all duration-500 ease-out'
                  style={{
                    width: `${progress}%`,
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              </div>
            )}

            {/* 标题 */}
            <div
              className='mt-2 text-center'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='relative'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
              >
                <span
                  className='block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:group-hover:text-green-400 peer'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {actualTitle}
                </span>
                {/* 自定义 tooltip */}
                <div
                  className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {actualTitle}
                  <div
                    className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                  ></div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 操作菜单 - 支持右键和长按触发 */}
      <MobileActionSheet
        isOpen={showMobileActions}
        onClose={() => setShowMobileActions(false)}
        title={actualTitle}
        poster={processImageUrl(actualPoster)}
        actions={mobileActions}
        sources={isAggregate && dynamicSourceNames ? Array.from(new Set(dynamicSourceNames)) : undefined}
        isAggregate={isAggregate}
        sourceName={cmsData ? undefined : source_name}
        currentEpisode={currentEpisode}
        totalEpisodes={actualEpisodes}
        origin={origin}
        onPosterClick={() => {
          setShowImageViewer(true);
        }}
      />

      {/* AI问片面板 - 只在打开或正在流式响应时渲染 */}
      {aiEnabled && (showAIChat || isAIStreaming) && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          onStreamingChange={setIsAIStreaming}
          context={{
            title: actualTitle,
            year: actualYear,
            douban_id: actualDoubanId,
            tmdb_id,
            type: actualSearchType as 'movie' | 'tv',
            currentEpisode,
          }}
          welcomeMessage={aiDefaultMessageWithVideo ? aiDefaultMessageWithVideo.replace('{title}', actualTitle || '') : `想了解《${actualTitle}》的更多信息吗？我可以帮你查询剧情、演员、评价等。`}
        />
      )}

      {/* 详情面板 */}
      {showDetailPanel && (
        <DetailPanel
          isOpen={showDetailPanel}
          onClose={() => setShowDetailPanel(false)}
          title={actualTitle}
          poster={processImageUrl(actualPoster)}
          doubanId={actualDoubanId}
          bangumiId={isBangumi ? actualDoubanId : undefined}
          isBangumi={isBangumi}
          tmdbId={tmdb_id}
          type={actualSearchType as 'movie' | 'tv'}
          seasonNumber={seasonNumber}
          cmsData={cmsData}
          sourceId={id}
          source={source}
        />
      )}

      {/* 图片查看器 */}
      {showImageViewer && (
        <ImageViewer
          isOpen={showImageViewer}
          onClose={() => setShowImageViewer(false)}
          imageUrl={processImageUrl(actualPoster)}
          alt={actualTitle}
        />
      )}
    </>
  );
}

);

export default memo(VideoCard);
