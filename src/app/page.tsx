/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';

import styles from './home.module.css';
import dashboard from '@/components/home/HomeDashboard.module.css';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { getTMDBImageUrl, TMDBItem } from '@/lib/tmdb.client';
import { DoubanItem } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import AIChatPanel from '@/components/AIChatPanel';
import BannerCarousel from '@/components/BannerCarousel';
import ContinueWatching from '@/components/ContinueWatching';
import FireworksCanvas from '@/components/FireworksCanvas';
import HomeAISearch from '@/components/home/HomeAISearch';
import HomeRecommendations from '@/components/home/HomeRecommendations';
import HttpWarningDialog from '@/components/HttpWarningDialog';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

// 首页模块配置接口
interface HomeModule {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
}

function HomeEmptyState({ message }: { message: string }) {
  return (
    <p className={styles.emptyState} role='status'>
      {message}
    </p>
  );
}

function HomeClient() {
  // 移除了 activeTab 状态，收藏夹功能已移到 UserMenu
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [hotDuanju, setHotDuanju] = useState<any[]>([]);
  const [upcomingContent, setUpcomingContent] = useState<TMDBItem[]>([]);
  const [bangumiCalendarData, setBangumiCalendarData] = useState<
    BangumiCalendarData[]
  >([]);
  const [loading, setLoading] = useState(true);
  const { announcement, announcementDisplayMode } = useSite();
  // 首页模块配置状态
  const [homeModules, setHomeModules] = useState<HomeModule[]>([
    { id: 'hotMovies', name: '热门电影', enabled: true, order: 0 },
    { id: 'hotDuanju', name: '热播短剧', enabled: true, order: 1 },
    { id: 'bangumiCalendar', name: '新番放送', enabled: true, order: 2 },
    { id: 'hotTvShows', name: '热门剧集', enabled: true, order: 3 },
    { id: 'hotVarietyShows', name: '热门综艺', enabled: true, order: 4 },
    { id: 'upcomingContent', name: '即将上映', enabled: true, order: 5 },
  ]);
  const [homeBannerEnabled, setHomeBannerEnabled] = useState(true);
  const [homeContinueWatchingEnabled, setHomeContinueWatchingEnabled] =
    useState(true);

  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [showHttpWarning, setShowHttpWarning] = useState(true);
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiRequest, setAiRequest] = useState<{ id: number; text: string }>();
  const aiRequestId = useRef(0);

  const askFromHome = (text: string) => {
    setAiRequest({ id: ++aiRequestId.current, text });
    setShowAIChat(true);
  };
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDefaultMessageNoVideo, setAiDefaultMessageNoVideo] = useState(
    '你好！我是MoonTVPlus的AI影视助手。想看什么电影或剧集？需要推荐吗？'
  );
  const loadHomeLayoutSettings = () => {
    if (typeof window === 'undefined') return;

    const savedHomeModules = localStorage.getItem('homeModules');
    if (savedHomeModules) {
      try {
        setHomeModules(JSON.parse(savedHomeModules));
      } catch (error) {
        console.error('解析首页模块配置失败:', error);
      }
    }

    const savedHomeBannerEnabled = localStorage.getItem('homeBannerEnabled');
    if (savedHomeBannerEnabled !== null) {
      setHomeBannerEnabled(savedHomeBannerEnabled === 'true');
    }

    const savedHomeContinueWatchingEnabled = localStorage.getItem(
      'homeContinueWatchingEnabled'
    );
    if (savedHomeContinueWatchingEnabled !== null) {
      setHomeContinueWatchingEnabled(
        savedHomeContinueWatchingEnabled === 'true'
      );
    }
  };

  // 加载首页模块配置
  useEffect(() => {
    loadHomeLayoutSettings();
  }, []);

  // 监听首页模块配置更新事件
  useEffect(() => {
    const handleHomeModulesUpdated = () => {
      loadHomeLayoutSettings();
    };

    window.addEventListener('homeModulesUpdated', handleHomeModulesUpdated);
    return () => {
      window.removeEventListener(
        'homeModulesUpdated',
        handleHomeModulesUpdated
      );
    };
  }, []);

  // 检查AI功能是否启用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.AI_ENABLED &&
        (window as any).RUNTIME_CONFIG?.AI_ENABLE_HOMEPAGE_ENTRY;
      setAiEnabled(enabled);

      // 加载AI默认消息配置
      const defaultMsg = (window as any).RUNTIME_CONFIG
        ?.AI_DEFAULT_MESSAGE_NO_VIDEO;
      if (defaultMsg) {
        setAiDefaultMessageNoVideo(defaultMsg);
      }
    }
  }, []);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      // 会话级标记：只在首次访问站点时弹出，导航切回首页不重复弹
      if (sessionStorage.getItem('announcementShown')) {
        return;
      }
      // 每次显示模式：每次新会话首次访问弹出一次
      if (announcementDisplayMode === 'every') {
        setShowAnnouncement(true);
        sessionStorage.setItem('announcementShown', '1');
        return;
      }
      // 单次显示模式：localStorage 记住已看过的公告文本，换公告则重新弹出
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcement, announcementDisplayMode]);

  useEffect(() => {
    const CACHE_DURATION = 60 * 60 * 1000; // 1小时

    const getCache = (key: string) => {
      try {
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        const { data, timestamp } = JSON.parse(cached);
        return { data, expired: Date.now() - timestamp > CACHE_DURATION };
      } catch {
        return null;
      }
    };

    const setCache = (key: string, data: any) => {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ data, timestamp: Date.now() })
        );
      } catch {
        // Ignore localStorage errors
      }
    };

    const moviesCache = getCache('homepage_movies');
    const tvShowsCache = getCache('homepage_tvshows');
    const varietyCache = getCache('homepage_variety');
    const bangumiCache = getCache('homepage_bangumi');
    const duanjuCache = getCache('homepage_duanju');
    const upcomingCache = getCache('homepage_upcoming');

    if (moviesCache?.data) setHotMovies(moviesCache.data);
    if (tvShowsCache?.data) setHotTvShows(tvShowsCache.data);
    if (varietyCache?.data) setHotVarietyShows(varietyCache.data);
    if (bangumiCache?.data) setBangumiCalendarData(bangumiCache.data);
    if (duanjuCache?.data) setHotDuanju(duanjuCache.data);
    if (upcomingCache?.data) setUpcomingContent(upcomingCache.data);

    const hasCache =
      moviesCache ||
      tvShowsCache ||
      varietyCache ||
      bangumiCache ||
      duanjuCache ||
      upcomingCache;
    if (hasCache) setLoading(false);

    const needsRefresh =
      !moviesCache ||
      moviesCache.expired ||
      !tvShowsCache ||
      tvShowsCache.expired ||
      !varietyCache ||
      varietyCache.expired ||
      !bangumiCache ||
      bangumiCache.expired ||
      !duanjuCache ||
      duanjuCache.expired ||
      !upcomingCache ||
      upcomingCache.expired;

    if (needsRefresh) {
      (async () => {
        try {
          const [
            moviesData,
            tvShowsData,
            varietyShowsData,
            bangumiCalendarData,
          ] = await Promise.all([
            getDoubanCategories({
              kind: 'movie',
              category: '热门',
              type: '全部',
            }).catch((error) => {
              console.error('获取热门电影数据失败:', error);
              return null;
            }),
            getDoubanCategories({
              kind: 'tv',
              category: 'tv',
              type: 'tv',
            }).catch((error) => {
              console.error('获取热门剧集数据失败:', error);
              return null;
            }),
            getDoubanCategories({
              kind: 'tv',
              category: 'show',
              type: 'show',
            }).catch((error) => {
              console.error('获取热门综艺数据失败:', error);
              return null;
            }),
            GetBangumiCalendarData().catch((error) => {
              console.error('获取新番放送数据失败:', error);
              return [];
            }),
          ]);

          if (moviesData?.code === 200) {
            setHotMovies(moviesData.list);
            if (moviesData.list && moviesData.list.length > 0) {
              setCache('homepage_movies', moviesData.list);
            }
          }
          if (tvShowsData?.code === 200) {
            setHotTvShows(tvShowsData.list);
            if (tvShowsData.list && tvShowsData.list.length > 0) {
              setCache('homepage_tvshows', tvShowsData.list);
            }
          }
          if (varietyShowsData?.code === 200) {
            setHotVarietyShows(varietyShowsData.list);
            if (varietyShowsData.list && varietyShowsData.list.length > 0) {
              setCache('homepage_variety', varietyShowsData.list);
            }
          }
          setBangumiCalendarData(bangumiCalendarData);
          if (bangumiCalendarData && bangumiCalendarData.length > 0) {
            setCache('homepage_bangumi', bangumiCalendarData);
          }

          try {
            const duanjuResponse = await fetch('/api/duanju/recommends');
            if (duanjuResponse.ok) {
              const duanjuResult = await duanjuResponse.json();
              if (
                duanjuResult.code === 200 &&
                duanjuResult.data &&
                duanjuResult.data.length > 0
              ) {
                setHotDuanju(duanjuResult.data);
                setCache('homepage_duanju', duanjuResult.data);
              }
            }
          } catch (error) {
            console.error('获取热播短剧数据失败:', error);
          }

          try {
            const response = await fetch('/api/tmdb/upcoming');
            if (response.ok) {
              const result = await response.json();
              if (
                result.code === 200 &&
                result.data &&
                result.data.length > 0
              ) {
                const sorted = [...result.data].sort((a, b) => {
                  const dateA = new Date(
                    a.release_date || '9999-12-31'
                  ).getTime();
                  const dateB = new Date(
                    b.release_date || '9999-12-31'
                  ).getTime();
                  return dateA - dateB;
                });
                setUpcomingContent(sorted);
                setCache('homepage_upcoming', sorted);
              }
            }
          } catch (error) {
            console.error('获取TMDB即将上映数据失败:', error);
          }

          setLoading(false);
        } catch (error) {
          console.error('获取推荐数据失败:', error);
          setLoading(false);
        }
      })();
    }
  }, []);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  // 渲染模块的函数
  const renderModule = (moduleId: string) => {
    switch (moduleId) {
      case 'hotMovies':
        return (
          <HomeRecommendations
            key='hotMovies'
            items={hotMovies}
            loading={loading}
          />
        );

      case 'hotDuanju':
        if (hotDuanju.length === 0) return null;
        return (
          <section
            key='hotDuanju'
            className={styles.section}
            aria-labelledby='home-duanju-title'
            aria-busy={loading}
          >
            <div className={styles.sectionHeader}>
              <h2 id='home-duanju-title' className={styles.sectionTitle}>
                热播短剧
              </h2>
              <Link href='/duanju' className={styles.moreLink}>
                查看更多
                <ChevronRight className='ml-1 h-4 w-4' aria-hidden='true' />
              </Link>
            </div>
            <div className={styles.row}>
              <ScrollableRow bottomPadding='pb-4 sm:pb-6'>
                {loading
                  ? Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className={styles.posterItem}>
                        <div
                          className={styles.skeletonPoster}
                          aria-hidden='true'
                        />
                        <div
                          className={styles.skeletonLine}
                          aria-hidden='true'
                        />
                      </div>
                    ))
                  : hotDuanju.map((duanju) => (
                      <div
                        key={duanju.id + duanju.source}
                        className={styles.posterItem}
                      >
                        <VideoCard
                          id={duanju.id}
                          source={duanju.source}
                          poster={duanju.poster}
                          title={duanju.title}
                          year={duanju.year}
                          type='tv'
                          from='search'
                          source_name={duanju.source_name}
                          episodes={duanju.episodes?.length}
                          douban_id={duanju.douban_id}
                          cmsData={{
                            desc: duanju.desc,
                            episodes: duanju.episodes,
                            episodes_titles: duanju.episodes_titles,
                          }}
                        />
                      </div>
                    ))}
              </ScrollableRow>
            </div>
          </section>
        );

      case 'bangumiCalendar':
        return (
          <section
            key='bangumiCalendar'
            className={styles.section}
            aria-labelledby='home-anime-title'
            aria-busy={loading}
          >
            <div className={styles.sectionHeader}>
              <h2 id='home-anime-title' className={styles.sectionTitle}>
                新番放送
              </h2>
              <Link href='/douban?type=anime' className={styles.moreLink}>
                查看更多
                <ChevronRight className='ml-1 h-4 w-4' aria-hidden='true' />
              </Link>
            </div>
            <div className={styles.row}>
              <ScrollableRow bottomPadding='pb-4 sm:pb-6'>
                {loading
                  ? Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className={styles.posterItem}>
                        <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                          <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                        </div>
                        <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                      </div>
                    ))
                  : (() => {
                      const today = new Date();
                      const weekdays = [
                        'Sun',
                        'Mon',
                        'Tue',
                        'Wed',
                        'Thu',
                        'Fri',
                        'Sat',
                      ];
                      const currentWeekday = weekdays[today.getDay()];
                      const todayAnimes =
                        bangumiCalendarData
                          .find((item) => item.weekday.en === currentWeekday)
                          ?.items.filter((anime) => anime.images) || [];

                      if (todayAnimes.length === 0) {
                        return (
                          <HomeEmptyState message='今天暂无新番更新，可以前往动漫片库浏览。' />
                        );
                      }

                      return todayAnimes.map((anime, index) => (
                        <div
                          key={`${anime.id}-${index}`}
                          className={styles.posterItem}
                        >
                          <VideoCard
                            from='douban'
                            title={anime.name_cn || anime.name}
                            poster={
                              anime.images?.large ||
                              anime.images?.common ||
                              anime.images?.medium ||
                              anime.images?.small ||
                              anime.images?.grid ||
                              ''
                            }
                            douban_id={anime.id}
                            rate={anime.rating?.score?.toFixed(1) || ''}
                            year={anime.air_date?.split('-')?.[0] || ''}
                            isBangumi={true}
                          />
                        </div>
                      ));
                    })()}
              </ScrollableRow>
            </div>
          </section>
        );

      case 'hotTvShows':
        return (
          <section
            key='hotTvShows'
            className={styles.section}
            aria-labelledby='home-tv-title'
            aria-busy={loading}
          >
            <div className={styles.sectionHeader}>
              <h2 id='home-tv-title' className={styles.sectionTitle}>
                热门剧集
              </h2>
              <Link href='/douban?type=tv' className={styles.moreLink}>
                查看更多
                <ChevronRight className='ml-1 h-4 w-4' aria-hidden='true' />
              </Link>
            </div>
            <div className={styles.row}>
              <ScrollableRow bottomPadding='pb-4 sm:pb-6'>
                {loading ? (
                  Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className={styles.posterItem}>
                      <div
                        className={styles.skeletonPoster}
                        aria-hidden='true'
                      />
                      <div className={styles.skeletonLine} aria-hidden='true' />
                    </div>
                  ))
                ) : hotTvShows.length === 0 ? (
                  <HomeEmptyState message='暂无剧集推荐，稍后再来看看。' />
                ) : (
                  hotTvShows.map((tvShow) => (
                    <div key={tvShow.id} className={styles.posterItem}>
                      <VideoCard
                        id={tvShow.id}
                        poster={tvShow.poster}
                        title={tvShow.title}
                        year={tvShow.year}
                        rate={tvShow.rate}
                        type='tv'
                        from='douban'
                        douban_id={tvShow.id ? parseInt(tvShow.id) : undefined}
                      />
                    </div>
                  ))
                )}
              </ScrollableRow>
            </div>
          </section>
        );

      case 'hotVarietyShows':
        return (
          <section
            key='hotVarietyShows'
            className={styles.section}
            aria-labelledby='home-variety-title'
            aria-busy={loading}
          >
            <div className={styles.sectionHeader}>
              <h2 id='home-variety-title' className={styles.sectionTitle}>
                热门综艺
              </h2>
              <Link href='/douban?type=show' className={styles.moreLink}>
                查看更多
                <ChevronRight className='ml-1 h-4 w-4' aria-hidden='true' />
              </Link>
            </div>
            <div className={styles.row}>
              <ScrollableRow bottomPadding='pb-4 sm:pb-6'>
                {loading ? (
                  Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className={styles.posterItem}>
                      <div
                        className={styles.skeletonPoster}
                        aria-hidden='true'
                      />
                      <div className={styles.skeletonLine} aria-hidden='true' />
                    </div>
                  ))
                ) : hotVarietyShows.length === 0 ? (
                  <HomeEmptyState message='暂无综艺推荐，稍后再来看看。' />
                ) : (
                  hotVarietyShows.map((varietyShow) => (
                    <div key={varietyShow.id} className={styles.posterItem}>
                      <VideoCard
                        id={varietyShow.id}
                        poster={varietyShow.poster}
                        title={varietyShow.title}
                        year={varietyShow.year}
                        rate={varietyShow.rate}
                        type='tv'
                        from='douban'
                        douban_id={
                          varietyShow.id ? parseInt(varietyShow.id) : undefined
                        }
                      />
                    </div>
                  ))
                )}
              </ScrollableRow>
            </div>
          </section>
        );

      case 'upcomingContent':
        if (upcomingContent.length === 0) return null;
        return (
          <section
            key='upcomingContent'
            className={styles.section}
            aria-labelledby='home-upcoming-title'
          >
            <div className={styles.sectionHeader}>
              <h2 id='home-upcoming-title' className={styles.sectionTitle}>
                即将上映
              </h2>
            </div>
            <div className={styles.row}>
              <ScrollableRow bottomPadding='pb-4 sm:pb-6'>
                {upcomingContent.map((item) => (
                  <div
                    key={`${item.media_type}-${item.id}`}
                    className={styles.posterItem}
                  >
                    <VideoCard
                      title={item.title}
                      poster={processImageUrl(
                        getTMDBImageUrl(item.poster_path)
                      )}
                      year={item.release_date?.split('-')?.[0] || ''}
                      rate={
                        item.vote_average && item.vote_average > 0
                          ? item.vote_average.toFixed(1)
                          : ''
                      }
                      type={item.media_type === 'tv' ? 'tv' : 'movie'}
                      from='douban'
                      tmdb_id={item.id}
                      releaseDate={item.release_date}
                      isUpcoming={true}
                    />
                  </div>
                ))}
              </ScrollableRow>
            </div>
          </section>
        );

      default:
        return null;
    }
  };

  return (
    <PageLayout>
      <FireworksCanvas />
      <div className={styles.page}>
        <h1 className='sr-only'>影视发现与 AI 对话搜索</h1>
        <div
          className={dashboard.topGrid}
          data-history={homeContinueWatchingEnabled}
          data-banner={homeBannerEnabled}
        >
          {homeContinueWatchingEnabled && (
            <ContinueWatching variant='dashboard' />
          )}
          <HomeAISearch
            enabled={Boolean(aiEnabled)}
            busy={aiStreaming}
            isChatOpen={showAIChat}
            onAsk={askFromHome}
            onOpenHistory={() => setShowAIChat(true)}
          />
          {homeBannerEnabled && (
            <div className={`home-hero-panel ${dashboard.heroPanel}`}>
              <BannerCarousel delayLoad={true} variant='dashboard' />
            </div>
          )}
        </div>

        <div className={`home-content ${styles.content}`}>
          {/* 保留观看记录开关，以及用户配置的模块顺序与可见性。 */}
          {homeModules
            .filter((module) => module.enabled)
            .sort((a, b) => a.order - b.order)
            .map((module) => renderModule(module.id))}
        </div>
      </div>

      {/* HTTP 环境警告弹窗 */}
      {showHttpWarning && (
        <HttpWarningDialog onClose={() => setShowHttpWarning(false)} />
      )}

      {/* AI问片面板 */}
      {aiEnabled && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          welcomeMessage={aiDefaultMessageNoVideo}
          initialRequest={aiRequest}
          onStreamingChange={setAiStreaming}
        />
      )}

      {/* 公告弹窗 */}
      {showAnnouncement && (
        <div className='fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'>
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3'>
              公告
            </h3>
            <div className='text-gray-700 dark:text-gray-300 mb-4 whitespace-pre-wrap'>
              {announcement}
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement || '')}
              className='w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
