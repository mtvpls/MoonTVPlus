'use client';

import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import dashboard from '@/components/home/HomeDashboard.module.css';

import { getDoubanDetail } from '@/lib/douban.client';
import {
  type TMDBItem,
  getGenreNames,
  getTMDBImageUrl,
} from '@/lib/tmdb.client';

import ProxyImage from '@/components/ProxyImage';

interface BannerCarouselProps {
  autoPlayInterval?: number; // 自动播放间隔（毫秒）
  delayLoad?: boolean; // 是否延迟加载（等页面加载完毕后再加载）
  variant?: 'full' | 'dashboard';
}

type HomeBannerHeightScale = '1' | '1.5' | '2';

const bannerHeightClassMap: Record<HomeBannerHeightScale, string> = {
  '1': 'h-[200px] sm:h-[300px] md:h-[400px] lg:h-[500px]',
  '1.5': 'h-[300px] sm:h-[450px] md:h-[600px] lg:h-[750px]',
  '2': 'h-[400px] sm:h-[600px] md:h-[800px] lg:h-[1000px]',
};

const getSavedBannerHeightScale = (): HomeBannerHeightScale => {
  if (typeof window === 'undefined') return '1';

  const saved = localStorage.getItem('homeBannerHeightScale');
  return saved === '1.5' || saved === '2' ? saved : '1';
};

// 扩展TMDBItem类型以支持TX数据源的额外字段
interface BannerItem extends TMDBItem {
  subtitle?: string; // TX数据源的子标题
  tags?: string[]; // TX数据源的标签
  trailer_url?: string | null; // 豆瓣预告片直链
  genres?: string[]; // 豆瓣数据源的类型标签
}

export default function BannerCarousel({
  autoPlayInterval = 5000,
  delayLoad = false,
  variant = 'full',
}: BannerCarouselProps) {
  const router = useRouter();
  const [items, setItems] = useState<BannerItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldLoad, setShouldLoad] = useState(!delayLoad); // 是否应该开始加载数据
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [skipNextAutoPlay, setSkipNextAutoPlay] = useState(false); // 跳过下一次自动播放
  const [isYouTubeAccessible, setIsYouTubeAccessible] = useState(false); // YouTube连通性（默认false，检查后再决定）
  const [enableTrailers, setEnableTrailers] = useState(false); // 是否启用预告片（默认关闭）
  const [dataSource, setDataSource] = useState<string>(''); // 当前数据源
  const [trailersLoaded, setTrailersLoaded] = useState(false); // 预告片是否已加载
  const [isMuted, setIsMuted] = useState(true); // 视频是否静音（默认静音）
  const [bannerHeightScale, setBannerHeightScale] =
    useState<HomeBannerHeightScale>('1'); // 轮播图高度倍率
  const [viewportWidth, setViewportWidth] = useState(0);
  const isMobileView = viewportWidth > 0 && viewportWidth < 768;
  const [mobileTitleFontSize, setMobileTitleFontSize] = useState(30);
  const videoRef = useRef<HTMLVideoElement>(null); // 视频元素引用
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map()); // 所有视频元素的引用
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleTextRef = useRef<HTMLSpanElement>(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const isManualChange = useRef(false); // 标记是否为手动切换

  // LocalStorage 缓存配置
  const LOCALSTORAGE_DURATION = 24 * 60 * 60 * 1000; // 1天
  const currentTitle = items[currentIndex]?.title || '';

  // 根据数据源获取缓存key
  const getLocalStorageKey = (source: string) => {
    return `banner_trending_cache_${source}`;
  };

  // 跳转到播放页面
  const handlePlay = (title: string) => {
    router.push(`/play?title=${encodeURIComponent(title)}`);
  };

  // 切换音量
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);

    // 直接更新当前视频元素的静音状态
    const currentVideo = videoRefs.current.get(currentIndex);
    if (currentVideo) {
      currentVideo.muted = newMutedState;
    }
  };

  // 获取图片原始URL（处理TX完整URL和TMDB路径）
  const getImageUrl = (path: string | null) => {
    if (!path) return '';
    // 如果是完整URL（TX数据源或豆瓣），直接返回原始地址
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    // 否则使用TMDB的URL拼接原始地址
    return getTMDBImageUrl(path, 'original');
  };

  // 获取视频URL（处理豆瓣视频代理）
  const getVideoUrl = (url: string | null) => {
    if (!url) return null;
    // 豆瓣视频直接使用服务器代理
    if (url.includes('doubanio.com')) {
      return `/api/video-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // 读取本地设置
  useEffect(() => {
    const setting = localStorage.getItem('enableTrailers');
    if (setting !== null) {
      setEnableTrailers(setting === 'true');
    }

    setBannerHeightScale(getSavedBannerHeightScale());

    const handleHomeModulesUpdated = () => {
      setBannerHeightScale(getSavedBannerHeightScale());
    };

    window.addEventListener('homeModulesUpdated', handleHomeModulesUpdated);
    return () => {
      window.removeEventListener(
        'homeModulesUpdated',
        handleHomeModulesUpdated
      );
    };
  }, []);

  // 尊重系统减少动态效果设置，仍允许用户手动切换推荐。
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => setIsPaused(mediaQuery.matches);
    syncMotionPreference();
    mediaQuery.addEventListener('change', syncMotionPreference);
    return () => mediaQuery.removeEventListener('change', syncMotionPreference);
  }, []);

  // 记录实际宽度，手机旋转或窗口缩窄时也重新计算长片名字号。
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  // 手机界面且轮播图高度为 1x 时，仅在标题超过一行时自动缩小字号，不改变布局位置
  useLayoutEffect(() => {
    const titleElement = titleRef.current;
    const titleTextElement = titleTextRef.current;
    if (!titleElement || !titleTextElement) return;

    if (variant === 'dashboard' || bannerHeightScale !== '1' || !isMobileView) {
      titleElement.style.fontSize = '';
      setMobileTitleFontSize(30);
      return;
    }

    const maxFontSize = 30;
    const minFontSize = 12;
    let nextFontSize = maxFontSize;

    titleElement.style.fontSize = `${nextFontSize}px`;

    while (
      nextFontSize > minFontSize &&
      titleTextElement.getClientRects().length > 1
    ) {
      nextFontSize -= 1;
      titleElement.style.fontSize = `${nextFontSize}px`;
    }

    titleElement.style.fontSize = `${nextFontSize}px`;
    setMobileTitleFontSize(nextFontSize);

    return undefined;
  }, [bannerHeightScale, currentTitle, isMobileView, viewportWidth, variant]);

  // 延迟加载：等待页面加载完毕后再开始加载轮播图数据
  useEffect(() => {
    if (!delayLoad) return;

    // 页面加载完毕后再开始加载
    if (document.readyState === 'complete') {
      setShouldLoad(true);
    } else {
      const handleLoad = () => {
        setShouldLoad(true);
      };
      window.addEventListener('load', handleLoad);
      return () => window.removeEventListener('load', handleLoad);
    }
  }, [delayLoad]);

  // 检测YouTube连通性 - 仅在启用预告片且数据源为TMDB时检测
  useEffect(() => {
    // 如果未启用预告片或数据源不是TMDB，不进行检测
    if (!enableTrailers || dataSource !== 'TMDB') {
      setIsYouTubeAccessible(false);
      return;
    }

    const checkYouTubeAccess = () => {
      const img = document.createElement('img');
      const timeout = setTimeout(() => {
        img.src = '';
        setIsYouTubeAccessible(false);
      }, 3000);

      img.onload = () => {
        clearTimeout(timeout);
        setIsYouTubeAccessible(true);
      };

      img.onerror = () => {
        clearTimeout(timeout);
        setIsYouTubeAccessible(false);
      };

      // 添加随机查询参数避免缓存
      img.src = `https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg?t=${Date.now()}`;
    };

    checkYouTubeAccess();
  }, [enableTrailers, dataSource]);

  // 获取热门内容
  useEffect(() => {
    // 如果不应该加载，直接返回
    if (!shouldLoad) return;

    const fetchTrending = async () => {
      try {
        // 先尝试从所有可能的数据源缓存中读取，找到最新的缓存
        const sources = ['TMDB', 'TX', 'Douban'];
        let cachedData = null;
        let validSource = null;
        let cacheExpired = false;
        let latestTimestamp = 0;

        // 遍历所有数据源，找到最新的缓存
        for (const source of sources) {
          const cacheKey = getLocalStorageKey(source);
          const cached = localStorage.getItem(cacheKey);

          if (cached) {
            try {
              const { data, timestamp } = JSON.parse(cached);

              // 选择时间戳最新的缓存
              if (timestamp > latestTimestamp) {
                cachedData = data;
                validSource = source;
                latestTimestamp = timestamp;
                cacheExpired = Date.now() - timestamp > LOCALSTORAGE_DURATION;
              }
            } catch (e) {
              console.error('解析缓存数据失败:', e);
            }
          }
        }

        // 乐观缓存：如果有缓存（无论是否过期），先显示缓存数据
        if (cachedData) {
          setItems(cachedData);
          setDataSource(validSource || ''); // 设置数据源
          setIsLoading(false);
          setTrailersLoaded(false); // 重置预告片加载状态
        }

        // 如果缓存过期或没有缓存，后台更新数据
        if (!cachedData || cacheExpired) {
          const response = await fetch('/api/tmdb/trending');
          const result = await response.json();

          if (result.code === 200 && result.list.length > 0) {
            const newDataSource = result.source || 'TMDB'; // 获取数据源标识
            const cacheKey = getLocalStorageKey(newDataSource);

            setItems(result.list);
            setDataSource(newDataSource); // 设置数据源
            setTrailersLoaded(false); // 重置预告片加载状态

            // 保存到 localStorage（使用数据源特定的key）
            try {
              localStorage.setItem(
                cacheKey,
                JSON.stringify({
                  data: result.list,
                  timestamp: Date.now(),
                })
              );
            } catch (e) {
              // localStorage 可能已满，忽略错误
              console.error('保存到 localStorage 失败:', e);
            }
          }
        }
      } catch (error) {
        console.error('获取热门内容失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrending();
  }, [shouldLoad]);

  // 前端获取豆瓣预告片
  useEffect(() => {
    // 只有在启用预告片、数据源是豆瓣、有数据且未加载预告片时才执行
    if (
      !enableTrailers ||
      dataSource !== 'Douban' ||
      items.length === 0 ||
      trailersLoaded
    ) {
      return;
    }

    const fetchDoubanTrailers = async () => {
      try {
        // 为每个项目获取预告片
        const itemsWithTrailers = await Promise.all(
          items.map(async (item) => {
            try {
              // 使用统一的豆瓣详情获取函数（会根据用户配置的代理设置自动选择请求方式）
              const detail = await getDoubanDetail(item.id.toString());

              // 获取预告片链接（取第一个）
              const trailerUrl =
                detail.trailers && detail.trailers.length > 0
                  ? detail.trailers[0].video_url
                  : null;

              return {
                ...item,
                trailer_url: trailerUrl,
              };
            } catch (error) {
              console.error(`获取豆瓣电影 ${item.id} 预告片失败:`, error);
              return item;
            }
          })
        );

        setItems(itemsWithTrailers);
        setTrailersLoaded(true);
      } catch (error) {
        console.error('获取豆瓣预告片失败:', error);
      }
    };

    fetchDoubanTrailers();
  }, [enableTrailers, dataSource, items.length, trailersLoaded]);

  // 切换轮播图时重置静音状态
  useEffect(() => {
    setIsMuted(true);
  }, [currentIndex]);

  // 控制视频播放/暂停和静音状态
  useEffect(() => {
    // 遍历所有视频元素
    videoRefs.current.forEach((video, index) => {
      if (index === currentIndex) {
        // 当前显示的视频：播放并设置静音状态
        video.muted = isMuted;
        video.play().catch(() => {
          // 忽略自动播放失败的错误
        });
      } else {
        // 非当前显示的视频：暂停
        video.pause();
      }
    });
  }, [currentIndex, isMuted]);

  // 自动播放
  useEffect(() => {
    if (items.length < 2 || isPaused || isHovered || isFocusWithin) return;

    const timer = setInterval(() => {
      // 如果设置了跳过标志，跳过这一次自动播放
      if (skipNextAutoPlay) {
        setSkipNextAutoPlay(false);
        return;
      }

      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, autoPlayInterval);

    return () => clearInterval(timer);
  }, [
    items.length,
    isPaused,
    isHovered,
    isFocusWithin,
    autoPlayInterval,
    skipNextAutoPlay,
  ]);

  const goToPrevious = useCallback(() => {
    isManualChange.current = true;
    setSkipNextAutoPlay(true);
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
    setTimeout(() => {
      isManualChange.current = false;
    }, 100);
  }, [items.length]);

  const goToNext = useCallback(() => {
    isManualChange.current = true;
    setSkipNextAutoPlay(true);
    setCurrentIndex((prev) => (prev + 1) % items.length);
    setTimeout(() => {
      isManualChange.current = false;
    }, 100);
  }, [items.length]);

  const goToSlide = useCallback((index: number) => {
    isManualChange.current = true;
    setSkipNextAutoPlay(true);
    setCurrentIndex(index);
    setTimeout(() => {
      isManualChange.current = false;
    }, 100);
  }, []);

  // 触摸事件处理
  const handleTouchStart = (e: React.TouchEvent) => {
    // 防止在手动切换过程中触发
    if (isManualChange.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = 0; // 重置结束位置
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // 防止在手动切换过程中触发
    if (isManualChange.current) return;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    // 防止在手动切换过程中触发
    if (isManualChange.current) return;
    if (!touchStartX.current) return;

    // 如果有滑动，则执行滑动逻辑
    if (touchEndX.current !== 0) {
      const distance = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 50; // 最小滑动距离

      if (Math.abs(distance) > minSwipeDistance) {
        if (distance > 0) {
          // 向左滑动，显示下一张
          goToNext();
        } else {
          // 向右滑动，显示上一张
          goToPrevious();
        }
      }
    }

    // 重置
    touchStartX.current = 0;
    touchEndX.current = 0;
  };

  if (isLoading || !shouldLoad) {
    return (
      <div
        className={`relative flex w-full items-center justify-center overflow-hidden bg-[#07182b] ${
          variant === 'dashboard'
            ? dashboard.banner
            : bannerHeightClassMap[bannerHeightScale]
        }`}
        style={
          variant === 'dashboard'
            ? ({
                '--banner-scale': Number(bannerHeightScale),
              } as React.CSSProperties)
            : undefined
        }
        role='status'
        aria-label='正在加载热门推荐'
      >
        <Image
          src='/logo.png'
          alt=''
          width={96}
          height={96}
          className='opacity-30'
          priority
        />
        <div
          className='absolute bottom-14 left-4 right-4 space-y-3 sm:left-6 md:bottom-20 md:left-8 lg:left-12'
          aria-hidden='true'
        >
          <div className='h-7 w-2/5 max-w-sm animate-pulse rounded-md bg-white/10 motion-reduce:animate-none md:h-12' />
          <div className='h-4 w-3/5 max-w-lg animate-pulse rounded bg-white/10 motion-reduce:animate-none' />
        </div>
      </div>
    );
  }

  if (!items.length) {
    return null;
  }

  const currentItem = items[currentIndex];
  const currentTags = currentItem.tags?.length
    ? currentItem.tags
    : Array.isArray(currentItem.genres) && currentItem.genres.length > 0
    ? currentItem.genres
    : getGenreNames(currentItem.genre_ids, 3);
  const description = currentItem.overview || currentItem.subtitle;

  return (
    <div
      className={`group relative w-full overflow-hidden bg-[#07182b] ${
        variant === 'dashboard'
          ? dashboard.banner
          : `rounded-2xl ${bannerHeightClassMap[bannerHeightScale]}`
      }`}
      data-banner-variant={variant}
      style={
        variant === 'dashboard'
          ? ({
              '--banner-scale': Number(bannerHeightScale),
            } as React.CSSProperties)
          : undefined
      }
      role='region'
      aria-roledescription='轮播图'
      aria-label='热门推荐'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocusWithin(false);
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={(event) => {
        // 控制按钮不触发移动端整幅封面的播放跳转。
        if ((event.target as Element).closest('button, a')) return;
        if (variant === 'dashboard' || window.innerWidth < 768) {
          handlePlay(currentItem.title);
        }
      }}
    >
      {/* 背景图片或视频 */}
      <div className='absolute inset-0'>
        {items.map((item, index) => (
          <div
            key={item.id}
            aria-hidden={index !== currentIndex}
            className={`absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none ${
              index === currentIndex ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {item.trailer_url && enableTrailers ? (
              /* 显示豆瓣直链视频 */
              <div className='absolute inset-0 overflow-hidden'>
                <video
                  ref={(el) => {
                    if (el) {
                      videoRefs.current.set(index, el);
                    } else {
                      videoRefs.current.delete(index);
                    }
                  }}
                  src={getVideoUrl(item.trailer_url) || undefined}
                  className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 min-w-full min-h-full w-auto h-auto object-cover'
                  muted={isMuted}
                  loop
                  playsInline
                  preload='metadata'
                />
              </div>
            ) : item.video_key && isYouTubeAccessible && enableTrailers ? (
              /* 显示YouTube视频 */
              <div className='absolute inset-0 overflow-hidden'>
                <iframe
                  title={`${item.title}预告片`}
                  tabIndex={-1}
                  src={`https://www.youtube.com/embed/${item.video_key}?listType=playlist&autoplay=1&mute=1&controls=0&loop=1&playlist=${item.video_key}&modestbranding=1&rel=0&showinfo=0&vq=hd1080&hd=1&disablekb=1&fs=0&iv_load_policy=3`}
                  className='absolute top-1/2 left-1/2 pointer-events-none'
                  allow='autoplay; encrypted-media'
                  style={{
                    border: 'none',
                    width: '100vw',
                    height: '100vh',
                    minWidth: '100%',
                    minHeight: '100%',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              </div>
            ) : (
              /* 显示图片 */
              <ProxyImage
                originalSrc={getImageUrl(
                  item.backdrop_path || item.poster_path
                )}
                alt={item.title}
                className='absolute inset-0 w-full h-full object-cover'
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            )}
            {/* 渐变遮罩 */}
            {variant === 'dashboard' ? (
              <div className={dashboard.bannerOverlay} />
            ) : (
              <>
                <div className='absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent' />
                <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent' />
              </>
            )}
          </div>
        ))}
      </div>

      {variant === 'dashboard' ? (
        <div className={dashboard.bannerContent}>
          <div>
            <h2 className={dashboard.bannerTitle}>
              <button
                type='button'
                onClick={() => handlePlay(currentItem.title)}
                aria-label={`播放${currentItem.title}`}
              >
                {currentItem.title}
              </button>
            </h2>
            <div className={dashboard.bannerMeta}>
              {currentItem.vote_average > 0 && (
                <span
                  data-rating='true'
                  aria-label={`评分 ${currentItem.vote_average.toFixed(1)}`}
                >
                  {currentItem.vote_average.toFixed(1)}
                </span>
              )}
              {currentTags.slice(0, 2).map((tag, index) => (
                <span key={`${tag}-${index}`}>{tag}</span>
              ))}
              {currentItem.release_date && (
                <time dateTime={currentItem.release_date}>
                  {currentItem.release_date.slice(0, 4)}
                </time>
              )}
            </div>
            {description && (
              <p className={dashboard.bannerDescription}>{description}</p>
            )}
          </div>
        </div>
      ) : (
        <div className='pointer-events-none absolute inset-0 flex items-end p-4 pb-14 sm:p-6 sm:pb-16 md:p-8 md:pb-20 lg:p-12 lg:pb-24'>
          <div className='min-w-0 max-w-2xl space-y-2 md:space-y-3'>
            <h2
              ref={titleRef}
              className='line-clamp-2 text-3xl font-bold leading-tight tracking-tight text-white drop-shadow-lg md:text-4xl lg:text-5xl'
              style={
                isMobileView && bannerHeightScale === '1'
                  ? { fontSize: `${mobileTitleFontSize}px` }
                  : undefined
              }
            >
              <span ref={titleTextRef}>{currentItem.title}</span>
            </h2>

            <div className='flex min-w-0 items-center gap-2 overflow-hidden text-xs text-white/90 md:text-sm'>
              {currentItem.vote_average > 0 && (
                <span
                  className='shrink-0 rounded-md bg-amber-300 px-2 py-1 font-semibold tabular-nums text-slate-950'
                  aria-label={`评分 ${currentItem.vote_average.toFixed(1)}`}
                >
                  {currentItem.vote_average.toFixed(1)}
                </span>
              )}
              {/* 保留 TX 标签、豆瓣类型、TMDB 类型的原有优先级。 */}
              {currentTags.slice(0, 3).map((tag, index) => (
                <span
                  key={`${tag}-${index}`}
                  title={tag}
                  className='min-w-0 max-w-32 truncate rounded-md border border-white/15 bg-white/10 px-2 py-1'
                >
                  {tag}
                </span>
              ))}
              {currentItem.release_date && (
                <span className='hidden shrink-0 text-white/70 sm:inline'>
                  {currentItem.release_date}
                </span>
              )}
            </div>

            {description && (
              <p
                className={`max-w-xl text-sm leading-relaxed text-white/80 drop-shadow-md md:text-base ${
                  bannerHeightScale === '1'
                    ? 'hidden md:line-clamp-2'
                    : 'line-clamp-2'
                }`}
              >
                {description}
              </p>
            )}

            <button
              type='button'
              onClick={(event) => {
                event.stopPropagation();
                handlePlay(currentItem.title);
              }}
              className='pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none md:px-6'
              aria-label={`播放${currentItem.title}`}
            >
              <Play
                className='h-4 w-4 fill-current md:h-5 md:w-5'
                aria-hidden='true'
              />
              立即播放
            </button>
          </div>
        </div>
      )}

      {/* 左右切换按钮 */}
      <button
        onClick={goToPrevious}
        type='button'
        disabled={items.length < 2}
        className={
          variant === 'dashboard'
            ? `${dashboard.bannerArrow} ${dashboard.bannerPrevious}`
            : 'absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white opacity-0 transition-opacity duration-200 hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:invisible group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none md:flex'
        }
        aria-label='上一张'
      >
        <ChevronLeft className='w-8 h-8' />
      </button>
      <button
        onClick={goToNext}
        type='button'
        disabled={items.length < 2}
        className={
          variant === 'dashboard'
            ? `${dashboard.bannerArrow} ${dashboard.bannerNext}`
            : 'absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white opacity-0 transition-opacity duration-200 hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:invisible group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none md:flex'
        }
        aria-label='下一张'
      >
        <ChevronRight className='w-8 h-8' />
      </button>

      {/* 音量控制按钮 - 只在有豆瓣预告片时显示 */}
      {currentItem.trailer_url && enableTrailers && (
        <button
          onClick={toggleMute}
          type='button'
          className='absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none md:right-4 md:top-4'
          aria-label={isMuted ? '开启声音' : '关闭声音'}
        >
          {isMuted ? (
            <VolumeX className='w-4 h-4 md:w-5 md:h-5' />
          ) : (
            <Volume2 className='w-4 h-4 md:w-5 md:h-5' />
          )}
        </button>
      )}

      {/* 指示器保留足够的触摸区域；控制区点击不触发封面播放。 */}
      {items.length > 1 &&
        (variant === 'dashboard' ? (
          <div
            className={dashboard.bannerControls}
            onClick={(event) => event.stopPropagation()}
          >
            <div aria-label='选择推荐'>
              {items.map((item, index) => (
                <button
                  type='button'
                  key={`${item.id}-${index}`}
                  className={dashboard.bannerDot}
                  onClick={() => goToSlide(index)}
                  aria-label={`切换到${item.title}`}
                  aria-current={index === currentIndex ? 'true' : undefined}
                >
                  <span />
                </button>
              ))}
            </div>
            <button
              type='button'
              className={dashboard.bannerPause}
              onClick={() => setIsPaused((paused) => !paused)}
              aria-label={isPaused ? '继续自动轮播' : '暂停自动轮播'}
              aria-pressed={isPaused}
            >
              {isPaused ? (
                <Play aria-hidden='true' />
              ) : (
                <Pause aria-hidden='true' />
              )}
            </button>
          </div>
        ) : (
          <div
            className='absolute inset-x-4 bottom-1 flex min-w-0 items-center justify-between gap-3 sm:inset-x-6 sm:bottom-3 md:inset-x-8 lg:inset-x-12'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='flex min-w-0 items-center gap-3'>
              <span
                className='hidden shrink-0 text-xs font-medium tabular-nums tracking-widest text-white/70 sm:block'
                aria-hidden='true'
              >
                {String(currentIndex + 1).padStart(2, '0')} /{' '}
                {String(items.length).padStart(2, '0')}
              </span>
              <div
                className='flex min-w-0 items-center overflow-x-auto scrollbar-hide'
                aria-label='选择推荐'
              >
                {items.map((item, index) => (
                  <button
                    type='button'
                    key={`${item.id}-${index}`}
                    onClick={() => goToSlide(index)}
                    className='flex h-11 w-6 shrink-0 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white'
                    aria-label={`切换到${item.title}`}
                    aria-current={index === currentIndex ? 'true' : undefined}
                  >
                    <span
                      className={`h-1 w-4 rounded-full transition-opacity duration-200 motion-reduce:transition-none ${
                        index === currentIndex
                          ? 'bg-white'
                          : 'bg-white/35 hover:bg-white/70'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <button
              type='button'
              onClick={() => setIsPaused((paused) => !paused)}
              className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none'
              aria-label={isPaused ? '继续自动轮播' : '暂停自动轮播'}
              aria-pressed={isPaused}
            >
              {isPaused ? (
                <Play className='h-4 w-4' aria-hidden='true' />
              ) : (
                <Pause className='h-4 w-4' aria-hidden='true' />
              )}
            </button>
          </div>
        ))}
    </div>
  );
}
