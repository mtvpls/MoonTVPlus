'use client';

import {
  ChevronLeft,
  ChevronRight,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getDoubanDetail } from '@/lib/douban.client';
import {
  type TMDBItem,
  getGenreNames,
  getTMDBImageUrl,
} from '@/lib/tmdb.client';
import { processImageUrl } from '@/lib/utils';

interface BannerCarouselProps {
  autoPlayInterval?: number; // 自动播放间隔（毫秒）
  delayLoad?: boolean; // 是否延迟加载（等页面加载完毕后再加载）
}

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
}: BannerCarouselProps) {
  const router = useRouter();
  const [items, setItems] = useState<BannerItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldLoad, setShouldLoad] = useState(!delayLoad); // 是否应该开始加载数据
  const [isPaused, setIsPaused] = useState(false);
  const [skipNextAutoPlay, setSkipNextAutoPlay] = useState(false); // 跳过下一次自动播放
  const [isYouTubeAccessible, setIsYouTubeAccessible] = useState(false); // YouTube连通性（默认false，检查后再决定）
  const [enableTrailers, setEnableTrailers] = useState(false); // 是否启用预告片（默认关闭）
  const [dataSource, setDataSource] = useState<string>(''); // 当前数据源
  const [trailersLoaded, setTrailersLoaded] = useState(false); // 预告片是否已加载
  const [isMuted, setIsMuted] = useState(true); // 视频是否静音（默认静音）
  const videoRef = useRef<HTMLVideoElement>(null); // 视频元素引用
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map()); // 所有视频元素的引用
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const isManualChange = useRef(false); // 标记是否为手动切换

  // LocalStorage 缓存配置
  const LOCALSTORAGE_DURATION = 24 * 60 * 60 * 1000; // 1天

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

  // 获取图片URL（处理TX完整URL和TMDB路径）
  const getImageUrl = (path: string | null) => {
    if (!path) return '';
    // 如果是完整URL（TX数据源或豆瓣），使用processImageUrl统一处理
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return processImageUrl(path);
    }
    // 否则使用TMDB的URL拼接，并通过processImageUrl处理
    return processImageUrl(getTMDBImageUrl(path, 'original'));
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
  }, []);

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
                }),
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
          }),
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
    if (!items.length || isPaused) return;

    const timer = setInterval(() => {
      // 如果设置了跳过标志，跳过这一次自动播放
      if (skipNextAutoPlay) {
        setSkipNextAutoPlay(false);
        return;
      }

      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, autoPlayInterval);

    return () => clearInterval(timer);
  }, [items.length, isPaused, autoPlayInterval, skipNextAutoPlay]);

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
      <div className='relative w-full h-[200px] sm:h-[300px] md:h-[400px] lg:h-[500px] bg-gradient-to-b from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 overflow-hidden flex items-center justify-center'>
        <Image
          src='/logo.png'
          alt='MoonTVPlus'
          width={120}
          height={120}
          className='opacity-50'
          priority
        />
      </div>
    );
  }

  if (!items.length) {
    return null;
  }

  const currentItem = items[currentIndex];

  return (
    <div
      className='relative w-full h-[200px] sm:h-[300px] md:h-[400px] lg:h-[500px] overflow-hidden group'
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={() => {
        // 移动端点击整个轮播图跳转
        if (window.innerWidth < 768) {
          handlePlay(currentItem.title);
        }
      }}
    >
      {/* 背景图片或视频 */}
      <div className='absolute inset-0'>
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`absolute inset-0 transition-opacity duration-1000 ${
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
              <Image
                src={getImageUrl(item.backdrop_path || item.poster_path)}
                alt={item.title}
                fill
                className='object-cover'
                priority={index === 0}
                sizes='100vw'
              />
            )}
            {/* 渐变遮罩 */}
            <div className='absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent'></div>
            <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent'></div>
          </div>
        ))}
      </div>

      {/* 内容信息 */}
      <div className='absolute inset-0 flex items-end p-8 md:p-12 pointer-events-none'>
        <div className='max-w-2xl space-y-4'>
          <h2 className='text-3xl md:text-5xl font-bold text-white drop-shadow-lg'>
            {currentItem.title}
          </h2>

          <div className='flex items-center gap-2 md:gap-3 text-sm md:text-base text-white/90 flex-wrap'>
            {currentItem.vote_average > 0 && (
              <span className='px-2 py-1 bg-yellow-500 text-black font-semibold rounded'>
                {currentItem.vote_average.toFixed(1)}
              </span>
            )}
            {/* 显示标签：优先TX的tags，其次豆瓣的genres，最后TMDB的genre_ids */}
            {currentItem.tags && currentItem.tags.length > 0
              ? currentItem.tags.slice(0, 3).map((tag, index) => (
                  <span
                    key={index}
                    className='px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-sm'
                  >
                    {tag}
                  </span>
                ))
              : currentItem.genres &&
                  Array.isArray(currentItem.genres) &&
                  currentItem.genres.length > 0
                ? /* 显示豆瓣数据源的标签 */
                  currentItem.genres.slice(0, 3).map((genre, index) => (
                    <span
                      key={index}
                      className='px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-sm'
                    >
                      {genre}
                    </span>
                  ))
                : /* 显示TMDB数据源的类型标签 */
                  getGenreNames(currentItem.genre_ids, 3).map((genre) => (
                    <span
                      key={genre}
                      className='px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-sm'
                    >
                      {genre}
                    </span>
                  ))}
            {currentItem.release_date && (
              <span>{currentItem.release_date}</span>
            )}
          </div>

          {/* PC端播放按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePlay(currentItem.title);
            }}
            className='hidden md:flex items-center gap-2 px-6 py-3 bg-gray-500/30 hover:bg-gray-500/50 backdrop-blur-sm text-white font-semibold rounded-lg transition-all pointer-events-auto'
          >
            <Play className='w-5 h-5 fill-white' />
            立即播放
          </button>

          {currentItem.overview && (
            <p className='text-sm md:text-base text-white/80 line-clamp-3 drop-shadow-md'>
              {currentItem.overview}
            </p>
          )}
        </div>
      </div>

      {/* 左右切换按钮 - 只在桌面端显示 */}
      <button
        onClick={goToPrevious}
        className='hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/30 hover:bg-black/60 text-white rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300'
        aria-label='上一张'
      >
        <ChevronLeft className='w-8 h-8' />
      </button>
      <button
        onClick={goToNext}
        className='hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/30 hover:bg-black/60 text-white rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300'
        aria-label='下一张'
      >
        <ChevronRight className='w-8 h-8' />
      </button>

      {/* 音量控制按钮 - 只在有豆瓣预告片时显示 */}
      {currentItem.trailer_url && enableTrailers && (
        <button
          onClick={toggleMute}
          className='absolute top-2 right-2 md:top-4 md:right-4 w-8 h-8 md:w-10 md:h-10 bg-black/30 hover:bg-black/60 text-white rounded-full flex items-center justify-center transition-all duration-300 z-10'
          aria-label={isMuted ? '开启声音' : '关闭声音'}
        >
          {isMuted ? (
            <VolumeX className='w-4 h-4 md:w-5 md:h-5' />
          ) : (
            <Volume2 className='w-4 h-4 md:w-5 md:h-5' />
          )}
        </button>
      )}

      {/* 指示器 */}
      <div className='absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2'>
        {items.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentIndex
                ? 'w-8 bg-white'
                : 'w-1.5 bg-white/50 hover:bg-white/80'
            }`}
            aria-label={`跳转到第 ${index + 1} 张`}
          />
        ))}
      </div>
    </div>
  );
}
