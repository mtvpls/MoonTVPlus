/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import { ChevronUp, Loader2, Search } from 'lucide-react';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { isAnimeCategoryText } from '@/lib/anime-keyword-expr';
import { ApiSite } from '@/lib/config';
import { appendSpecialSourceParam } from '@/lib/special-source.client';
import { SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface Category {
  id: string;
  name: string;
}

type ViewMode = 'browse' | 'search';

// 观影前保存的浏览快照，返回后恢复到上一步操作位置
const SOURCE_SEARCH_STATE_KEY = 'source_search_state';

interface SourceSearchSnapshot {
  apiSites: ApiSite[];
  selectedSource: string;
  categories: Category[];
  selectedCategory: string;
  videos: SearchResult[];
  currentPage: number;
  hasMore: boolean;
  viewMode: ViewMode;
  searchKeyword: string;
  searchInputValue: string;
  scrollTop: number;
}

// 实际滚动容器是 document.body，这里同时兼容 documentElement
const getPageScrollTop = () =>
  document.body.scrollTop || document.documentElement.scrollTop || 0;

const scrollPageTo = (top: number) => {
  document.body.scrollTop = top;
  document.documentElement.scrollTop = top;
};

// 恢复动作需要在绘制前完成，避免闪现顶部；SSR 下退化为 useEffect
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

// 读取并消费快照：只在观影返回后恢复一次
const consumeSnapshot = (): SourceSearchSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SOURCE_SEARCH_STATE_KEY);
    sessionStorage.removeItem(SOURCE_SEARCH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SourceSearchSnapshot;
    if (
      !parsed?.selectedSource ||
      !Array.isArray(parsed.apiSites) ||
      !Array.isArray(parsed.categories) ||
      !Array.isArray(parsed.videos) ||
      parsed.videos.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

function SourceSearchPageClient() {
  const [apiSites, setApiSites] = useState<ApiSite[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [videos, setVideos] = useState<SearchResult[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [searchInputValue, setSearchInputValue] = useState<string>('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 快照读取完成前不发请求，避免覆盖恢复的数据
  const [restoreChecked, setRestoreChecked] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<SourceSearchSnapshot | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  // 恢复时需要跳过一次「拉取分类」和「拉取列表」
  const skipCategoryFetchRef = useRef(false);
  const skipVideoFetchRef = useRef(false);

  // 读取观影前保存的快照，恢复到上一步操作位置
  useIsomorphicLayoutEffect(() => {
    const snapshot = consumeSnapshot();
    if (snapshot) {
      skipCategoryFetchRef.current = true;
      skipVideoFetchRef.current = true;
      pendingScrollTopRef.current = snapshot.scrollTop;
      setApiSites(snapshot.apiSites);
      setSelectedSource(snapshot.selectedSource);
      setCategories(snapshot.categories);
      setSelectedCategory(snapshot.selectedCategory);
      setVideos(snapshot.videos);
      setCurrentPage(snapshot.currentPage);
      setHasMore(snapshot.hasMore);
      setViewMode(snapshot.viewMode);
      setSearchKeyword(snapshot.searchKeyword);
      setSearchInputValue(snapshot.searchInputValue);
    }
    setRestoreChecked(true);
  }, []);

  // 列表渲染完成后再恢复滚动位置
  useIsomorphicLayoutEffect(() => {
    const target = pendingScrollTopRef.current;
    if (target == null || videos.length === 0) return;

    pendingScrollTopRef.current = null;
    scrollPageTo(target);
    const rafId = requestAnimationFrame(() => scrollPageTo(target));
    return () => cancelAnimationFrame(rafId);
  }, [videos]);

  // 镜像最新状态，供跳转播放页前保存快照
  useEffect(() => {
    snapshotRef.current = {
      apiSites,
      selectedSource,
      categories,
      selectedCategory,
      videos,
      // 当前页还在请求中，回退一页以便返回后重新拉取，避免缺页
      currentPage: isLoadingVideos && currentPage > 1 ? currentPage - 1 : currentPage,
      hasMore,
      viewMode,
      searchKeyword,
      searchInputValue,
      scrollTop: 0,
    };
  }, [
    apiSites,
    selectedSource,
    categories,
    selectedCategory,
    videos,
    currentPage,
    hasMore,
    viewMode,
    searchKeyword,
    searchInputValue,
    isLoadingVideos,
  ]);

  // 跳转播放页前保存当前浏览位置
  const saveSnapshot = useCallback(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot || snapshot.videos.length === 0) return;
    try {
      sessionStorage.setItem(
        SOURCE_SEARCH_STATE_KEY,
        JSON.stringify({ ...snapshot, scrollTop: getPageScrollTop() })
      );
    } catch {
      // 忽略 sessionStorage 写入失败（如超出配额）
    }
  }, []);

  // 加载用户可用的视频源
  useEffect(() => {
    if (!restoreChecked) return;

    const fetchApiSites = async () => {
      setIsLoadingSources(true);
      try {
        const response = await fetch(appendSpecialSourceParam('/api/source-search/sources'));
        const data = await response.json();
        if (data.sources && Array.isArray(data.sources)) {
          setApiSites(data.sources);
          // 默认选择第一个源（恢复的源仍可用时保持不变）
          if (data.sources.length > 0) {
            setSelectedSource((prev) =>
              prev && data.sources.some((site: ApiSite) => site.key === prev)
                ? prev
                : data.sources[0].key
            );
          }
        }
      } catch (error) {
        console.error('Failed to load API sources:', error);
      } finally {
        setIsLoadingSources(false);
      }
    };

    fetchApiSites();
  }, [restoreChecked]);

  // 当选择的源变化时，加载分类列表
  useEffect(() => {
    if (!restoreChecked || !selectedSource) return;

    // 恢复场景下分类与列表都来自快照，无需重新拉取
    if (skipCategoryFetchRef.current) {
      skipCategoryFetchRef.current = false;
      return;
    }

    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      setCategories([]);
      setSelectedCategory('');
      setVideos([]);
      setCurrentPage(1);
      setHasMore(true);
      try {
        const response = await fetch(
          appendSpecialSourceParam(`/api/source-search/categories?source=${encodeURIComponent(selectedSource)}`)
        );
        const data = await response.json();
        if (data.categories && Array.isArray(data.categories)) {
          setCategories(data.categories);
          // 默认选择第一个分类
          if (data.categories.length > 0) {
            setSelectedCategory(data.categories[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to load categories:', error);
      } finally {
        setIsLoadingCategories(false);
      }
    };

    fetchCategories();
  }, [restoreChecked, selectedSource]);

  // 当选择的分类或页码变化时，加载视频列表（浏览模式）
  useEffect(() => {
    if (!restoreChecked || viewMode !== 'browse' || !selectedSource || !selectedCategory)
      return;

    // 恢复场景下列表已来自快照，跳过本次请求
    if (skipVideoFetchRef.current) {
      skipVideoFetchRef.current = false;
      return;
    }

    const fetchVideos = async () => {
      setIsLoadingVideos(true);
      try {
        const response = await fetch(
          appendSpecialSourceParam(`/api/source-search/videos?source=${encodeURIComponent(selectedSource)}&categoryId=${encodeURIComponent(selectedCategory)}&page=${currentPage}`)
        );
        const data = await response.json();
        if (data.results && Array.isArray(data.results)) {
          if (currentPage === 1) {
            setVideos(data.results);
          } else {
            setVideos((prev) => [...prev, ...data.results]);
          }
          setHasMore(data.page < data.pageCount);
        }
      } catch (error) {
        console.error('Failed to load videos:', error);
      } finally {
        setIsLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [restoreChecked, selectedSource, selectedCategory, currentPage, viewMode]);

  // 当搜索关键词或页码变化时，执行搜索（搜索模式）
  useEffect(() => {
    if (!restoreChecked || viewMode !== 'search' || !selectedSource || !searchKeyword)
      return;

    // 恢复场景下列表已来自快照，跳过本次请求
    if (skipVideoFetchRef.current) {
      skipVideoFetchRef.current = false;
      return;
    }

    const searchVideos = async () => {
      setIsLoadingVideos(true);
      try {
        const response = await fetch(
          appendSpecialSourceParam(`/api/source-search/search?source=${encodeURIComponent(selectedSource)}&keyword=${encodeURIComponent(searchKeyword)}&page=${currentPage}`)
        );
        const data = await response.json();
        if (data.results && Array.isArray(data.results)) {
          if (currentPage === 1) {
            setVideos(data.results);
          } else {
            setVideos((prev) => [...prev, ...data.results]);
          }
          setHasMore(data.page < data.pageCount);
        }
      } catch (error) {
        console.error('Failed to search videos:', error);
      } finally {
        setIsLoadingVideos(false);
      }
    };

    searchVideos();
  }, [restoreChecked, selectedSource, searchKeyword, currentPage, viewMode]);

  // 切换分类时，重置到第一页
  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    setCurrentPage(1);
    setVideos([]);
    setHasMore(true);
  };

  // 处理搜索提交
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInputValue.trim()) {
      setSearchKeyword(searchInputValue.trim());
      setViewMode('search');
      setCurrentPage(1);
      setVideos([]);
      setHasMore(true);
    }
  };

  // 切换回浏览模式
  const handleBackToBrowse = () => {
    setViewMode('browse');
    setSearchKeyword('');
    setSearchInputValue('');
    setCurrentPage(1);
    setVideos([]);
    setHasMore(true);
  };

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && hasMore && !isLoadingVideos) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoadingVideos]);

  // 滚动超过一屏后显示置顶按钮
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(getPageScrollTop() > 300);
    };

    handleScroll();
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.body.removeEventListener('scroll', handleScroll);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 返回顶部
  const scrollToTop = () => {
    try {
      document.body.scrollTo({ top: 0, behavior: 'smooth' });
      document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      scrollPageTo(0);
    }
  };

  return (
    <PageLayout activePath='/source-search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 页面标题 */}
        <div className='mb-6'>
          <h1 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
            源站寻片
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
            根据可用视频源浏览分类内容
          </p>
        </div>

        {/* 源选择和分类选择 */}
        <div className='max-w-4xl mx-auto mb-8 space-y-6'>
          {/* 源选择 CapsuleSwitch */}
          <div className='relative'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
              选择视频源
            </label>
            {isLoadingSources && apiSites.length === 0 ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <Loader2 className='h-5 w-5 animate-spin text-gray-400' />
                <span className='ml-2 text-sm text-gray-500 dark:text-gray-400'>
                  加载视频源中...
                </span>
              </div>
            ) : apiSites.length === 0 ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  暂无可用源
                </span>
              </div>
            ) : (
              <div className='flex justify-center'>
                <CapsuleSwitch
                  options={apiSites.map((site) => ({
                    label: site.name,
                    value: site.key,
                  }))}
                  active={selectedSource}
                  onChange={(value) => {
                    setSelectedSource(value);
                    handleBackToBrowse();
                  }}
                />
              </div>
            )}
          </div>

          {/* 搜索框 */}
          {selectedSource && (
            <div className='relative'>
              <form onSubmit={handleSearch}>
                <div className='relative'>
                  <input
                    type='text'
                    value={searchInputValue}
                    onChange={(e) => setSearchInputValue(e.target.value)}
                    placeholder='搜索视频...'
                    className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-4 pr-12 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:focus:bg-gray-700 dark:border-gray-700'
                  />
                  <button
                    type='submit'
                    className='absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors'
                  >
                    <Search size={20} />
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 搜索结果提示和返回按钮 */}
          {viewMode === 'search' && searchKeyword && (
            <div className='flex items-center justify-between bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/50 rounded-lg px-4 py-3'>
              <span className='text-sm text-gray-700 dark:text-gray-300'>
                搜索结果: <span className='font-medium'>{searchKeyword}</span>
              </span>
              <button
                onClick={handleBackToBrowse}
                className='text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium'
              >
                返回分类浏览
              </button>
            </div>
          )}

          {/* 分类选择 CapsuleSwitch */}
          {selectedSource && viewMode === 'browse' && (
            <div className='relative'>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
                选择分类
              </label>
              {isLoadingCategories && categories.length === 0 ? (
                <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                  <Loader2 className='h-5 w-5 animate-spin text-gray-400' />
                  <span className='ml-2 text-sm text-gray-500 dark:text-gray-400'>
                    加载分类中...
                  </span>
                </div>
              ) : categories.length === 0 ? (
                <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                  <span className='text-sm text-gray-500 dark:text-gray-400'>
                    暂无分类
                  </span>
                </div>
              ) : (
                <div className='flex justify-center'>
                  <CapsuleSwitch
                    options={categories.map((category) => ({
                      label: category.name,
                      value: category.id,
                    }))}
                    active={selectedCategory}
                    onChange={handleCategoryChange}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* 视频列表 */}
        {selectedSource && (viewMode === 'search' ? searchKeyword : selectedCategory) && (
          <div className='max-w-[95%] mx-auto mt-8'>
            <div className='mb-4'>
              <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                视频列表
              </h2>
            </div>

            {isLoadingVideos && currentPage === 1 ? (
              <div className='flex justify-center items-center h-40'>
                <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500'></div>
              </div>
            ) : videos.length === 0 ? (
              <div className='text-center text-gray-500 py-8 dark:text-gray-400'>
                暂无视频
              </div>
            ) : (
              <>
                <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                  {videos.map((item) => (
                    <div
                      key={`${item.source}-${item.id}`}
                      className='w-full'
                    >
                      <VideoCard
                        id={item.id}
                        title={item.title}
                        poster={item.poster}
                        episodes={item.episodes.length}
                        source={item.source}
                        source_name={item.source_name}
                        douban_id={item.douban_id}
                        year={item.year}
                        from='source-search'
                        type={item.episodes.length > 1 ? 'tv' : 'movie'}
                        isAnime={isAnimeCategoryText(
                          item.type_name,
                          item.class
                        )}
                        typeName={item.type_name || item.class}
                        cmsData={{
                          desc: item.desc,
                          episodes: item.episodes,
                          episodes_titles: item.episodes_titles,
                        }}
                        onBeforeNavigate={saveSnapshot}
                      />
                    </div>
                  ))}
                </div>

                {/* Infinite scroll trigger */}
                <div ref={loadMoreRef} className='flex justify-center items-center py-8'>
                  {isLoadingVideos && (
                    <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500'></div>
                  )}
                  {!hasMore && videos.length > 0 && (
                    <span className='text-sm text-gray-500 dark:text-gray-400'>
                      没有更多了
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 置顶（返回顶部）悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function SourceSearchPage() {
  return (
    <Suspense>
      <SourceSearchPageClient />
    </Suspense>
  );
}
