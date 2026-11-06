/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import { ChevronUp, Globe, Loader2, Search, Tv } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { isAnimeCategoryText } from '@/lib/anime-keyword-expr';
import {
  CategoryNode,
  getChildCategories,
  getParentCategories,
  isHierarchicalCategories,
  pickDefaultSelection,
} from '@/lib/category-tree';
import { ApiSite } from '@/lib/config';
import { appendSpecialSourceParam } from '@/lib/special-source.client';
import { isTVBoxBridgeSource } from '@/lib/tvbox-bridge.shared';
import { SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

type Category = CategoryNode;

type ViewMode = 'browse' | 'search';
type SourceType = 'normal' | 'tvbox';

// 观影前保存的浏览快照，返回后恢复到上一步操作位置
const SOURCE_SEARCH_STATE_KEY = 'source_search_state';

interface SourceSearchSnapshot {
  sourceType?: SourceType;
  specialOnly?: boolean;
  apiSites: ApiSite[];
  selectedSource: string;
  categories: Category[];
  selectedParentCategory: string;
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
const consumeSnapshot = (
  key: string,
  specialOnly: boolean
): SourceSearchSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SourceSearchSnapshot;
    if (
      (parsed.specialOnly ?? false) !== specialOnly ||
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
  // special=1 表示这是从 /under 进入的特殊源版本：源列表只有特殊源
  const searchParams = useSearchParams();
  const isSpecialVersion = searchParams.get('special') === '1';
  const snapshotStorageKey = `${SOURCE_SEARCH_STATE_KEY}${
    isSpecialVersion ? '_special' : ''
  }`;
  const [sourceType, setSourceType] = useState<SourceType>('normal');
  const [error, setError] = useState<string | null>(null);
  const [apiSites, setApiSites] = useState<ApiSite[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedParentCategory, setSelectedParentCategory] =
    useState<string>('');
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
  // 视频源过滤：伸缩搜索框的展开状态与关键字
  const [sourceFilter, setSourceFilter] = useState('');
  const [isSourceFilterExpanded, setIsSourceFilterExpanded] = useState(false);
  const sourceFilterInputRef = useRef<HTMLInputElement>(null);
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
    const snapshot = consumeSnapshot(snapshotStorageKey, isSpecialVersion);
    if (snapshot) {
      skipCategoryFetchRef.current = true;
      skipVideoFetchRef.current = true;
      pendingScrollTopRef.current = snapshot.scrollTop;
      setSourceType(
        snapshot.sourceType ||
          (isTVBoxBridgeSource(snapshot.selectedSource) ? 'tvbox' : 'normal')
      );
      setApiSites(snapshot.apiSites);
      setSelectedSource(snapshot.selectedSource);
      setCategories(snapshot.categories);
      // 旧快照没有一级分类时，从已选分类反推
      setSelectedParentCategory(
        snapshot.selectedParentCategory ||
          snapshot.categories.find(
            (item) => item.id === snapshot.selectedCategory
          )?.pid ||
          ''
      );
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
      sourceType,
      specialOnly: isSpecialVersion,
      apiSites,
      selectedSource,
      categories,
      selectedParentCategory,
      selectedCategory,
      videos,
      // 当前页还在请求中，回退一页以便返回后重新拉取，避免缺页
      currentPage:
        isLoadingVideos && currentPage > 1 ? currentPage - 1 : currentPage,
      hasMore,
      viewMode,
      searchKeyword,
      searchInputValue,
      scrollTop: 0,
    };
  }, [
    sourceType,
    isSpecialVersion,
    apiSites,
    selectedSource,
    categories,
    selectedParentCategory,
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
        snapshotStorageKey,
        JSON.stringify({ ...snapshot, scrollTop: getPageScrollTop() })
      );
    } catch {
      // 忽略 sessionStorage 写入失败（如超出配额）
    }
  }, [snapshotStorageKey]);

  // 类型切换及离开页面时取消旧请求，防止旧列表覆盖当前选择。
  useEffect(() => {
    if (!restoreChecked) return;
    const controller = new AbortController();
    const fetchApiSites = async () => {
      setIsLoadingSources(true);
      setError(null);
      try {
        const response = await fetch(
          appendSpecialSourceParam(
            `/api/source-search/sources?type=${sourceType}`
          ),
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加载视频源失败');
        if (controller.signal.aborted) return;
        const sites = Array.isArray(data.sources) ? data.sources : [];
        setApiSites(sites);
        setSelectedSource((previous) =>
          sites.some((site: ApiSite) => site.key === previous)
            ? previous
            : sites[0]?.key || ''
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setApiSites([]);
        setSelectedSource('');
        setError(error instanceof Error ? error.message : '加载视频源失败');
      } finally {
        if (!controller.signal.aborted) setIsLoadingSources(false);
      }
    };
    fetchApiSites();
    return () => controller.abort();
  }, [restoreChecked, sourceType, isSpecialVersion]);

  useEffect(() => {
    if (!restoreChecked || !selectedSource) return;
    if (skipCategoryFetchRef.current) {
      skipCategoryFetchRef.current = false;
      return;
    }
    const controller = new AbortController();
    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      setIsLoadingVideos(false);
      setError(null);
      setCategories([]);
      setSelectedParentCategory('');
      setSelectedCategory('');
      setVideos([]);
      setCurrentPage(1);
      setHasMore(true);
      try {
        const response = await fetch(
          appendSpecialSourceParam(
            `/api/source-search/categories?source=${encodeURIComponent(
              selectedSource
            )}`
          ),
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加载分类失败');
        if (controller.signal.aborted) return;
        const list = Array.isArray(data.categories)
          ? (data.categories as Category[])
          : [];
        setCategories(list);
        const { parent, category } = pickDefaultSelection(list);
        setSelectedParentCategory(parent);
        setSelectedCategory(category);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : '加载分类失败');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingCategories(false);
      }
    };
    fetchCategories();
    return () => controller.abort();
  }, [restoreChecked, selectedSource, isSpecialVersion]);

  // 分类浏览和单站搜索共用分页加载流程。
  useEffect(() => {
    if (!restoreChecked || !selectedSource) return;
    if (viewMode === 'browse' ? !selectedCategory : !searchKeyword) return;
    if (skipVideoFetchRef.current) {
      skipVideoFetchRef.current = false;
      return;
    }
    const controller = new AbortController();
    const fetchVideos = async () => {
      setIsLoadingVideos(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          source: selectedSource,
          page: String(currentPage),
        });
        query.set(
          viewMode === 'browse' ? 'categoryId' : 'keyword',
          viewMode === 'browse' ? selectedCategory : searchKeyword
        );
        const response = await fetch(
          appendSpecialSourceParam(
            `/api/source-search/${
              viewMode === 'browse' ? 'videos' : 'search'
            }?${query}`
          ),
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加载视频失败');
        if (controller.signal.aborted) return;
        const results = Array.isArray(data.results) ? data.results : [];
        setVideos((previous) =>
          currentPage === 1 ? results : [...previous, ...results]
        );
        setHasMore(data.page < data.pageCount);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : '加载视频失败');
          setHasMore(false);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingVideos(false);
      }
    };
    fetchVideos();
    return () => controller.abort();
  }, [
    restoreChecked,
    selectedSource,
    selectedCategory,
    searchKeyword,
    currentPage,
    viewMode,
    isSpecialVersion,
  ]);

  const handleSourceTypeChange = (value: string) => {
    if (value === sourceType) return;
    skipCategoryFetchRef.current = false;
    skipVideoFetchRef.current = false;
    setSourceType(value as SourceType);
    setApiSites([]);
    setSelectedSource('');
    setCategories([]);
    setSelectedParentCategory('');
    setSelectedCategory('');
    setSourceFilter('');
    setIsLoadingSources(true);
    setIsLoadingCategories(false);
    setIsLoadingVideos(false);
    setError(null);
    handleBackToBrowse();
  };

  // 切换一级分类（类型）时，落到该类型下第一个子分类并重置到第一页
  const handleParentCategoryChange = (value: string) => {
    setSelectedParentCategory(value);
    setCurrentPage(1);
    setVideos([]);
    setHasMore(true);
    const children = getChildCategories(categories, value);
    setSelectedCategory(children.length > 0 ? children[0].id : value);
  };

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
  // 哨兵节点仅在列表非空时渲染；快照恢复不发请求、isLoadingVideos 不翻转，
  // 需要依赖列表出现才能（重新）挂载观察器
  const hasVideos = videos.length > 0;
  useEffect(() => {
    if (!hasVideos || !loadMoreRef.current) return;

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
  }, [hasVideos, hasMore, isLoadingVideos]);

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

  // 根据分类列表推导两级结构；平铺源回退为单行分类
  const isHierarchical = isHierarchicalCategories(categories);
  const parentCategories = isHierarchical
    ? getParentCategories(categories)
    : [];
  const subCategories =
    isHierarchical && selectedParentCategory
      ? getChildCategories(categories, selectedParentCategory)
      : [];
  // 按名称过滤视频源
  const sourceFilterKeyword = sourceFilter.trim().toLowerCase();
  const filteredApiSites = sourceFilterKeyword
    ? apiSites.filter((site) =>
        site.name.toLowerCase().includes(sourceFilterKeyword)
      )
    : apiSites;

  return (
    <PageLayout activePath='/source-search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 页面标题 */}
        <div className='mb-6'>
          <h1 className='flex items-center gap-2 text-2xl font-bold text-gray-800 dark:text-gray-200'>
            源站寻片
            {isSpecialVersion && (
              <span className='rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'>
                特殊源
              </span>
            )}
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
            {isSpecialVersion
              ? '仅浏览与搜索特殊源的内容'
              : '根据可用视频源浏览分类内容'}
          </p>
        </div>

        {/* 源选择和分类选择 */}
        <div className='max-w-4xl mx-auto mb-8 space-y-6'>
          {error && (
            <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
              {error}
            </p>
          )}
          {/* 源选择 CapsuleSwitch */}
          <div className='relative'>
            <div className='flex items-center justify-between gap-3 mb-3'>
              <div className='flex shrink-0 items-center gap-2'>
                <label className='block whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300'>
                  选择视频源
                </label>
                <div
                  className='flex items-center gap-1'
                  role='group'
                  aria-label='视频源类型'
                >
                  {[
                    { label: '普通源', value: 'normal', icon: Globe },
                    { label: 'TVBox 源', value: 'tvbox', icon: Tv },
                  ].map(({ label, value, icon: Icon }) => (
                    <button
                      key={value}
                      type='button'
                      aria-label={label}
                      title={label}
                      aria-pressed={sourceType === value}
                      onClick={() => handleSourceTypeChange(value)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                        sourceType === value
                          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'
                      }`}
                    >
                      <Icon size={18} aria-hidden='true' />
                    </button>
                  ))}
                </div>
              </div>
              {/* 过滤视频源：伸缩搜索框 */}
              <div
                className={`flex items-center h-9 bg-gray-50/80 dark:bg-gray-800 border border-gray-200/50 dark:border-gray-700 rounded-lg shadow-sm transition-all duration-300 ease-in-out overflow-hidden ${
                  isSourceFilterExpanded ? 'w-44 sm:w-56' : 'w-9'
                }`}
              >
                <button
                  type='button'
                  aria-label='过滤视频源'
                  onClick={() => {
                    setIsSourceFilterExpanded(true);
                    sourceFilterInputRef.current?.focus();
                  }}
                  className='flex-none w-9 h-9 flex items-center justify-center text-blue-500 hover:text-blue-600 transition-colors focus:outline-none focus-visible:outline-none'
                >
                  <Search size={18} />
                </button>
                <input
                  ref={sourceFilterInputRef}
                  type='text'
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  onFocus={() => setIsSourceFilterExpanded(true)}
                  // 内容为空失焦时收起搜索框
                  onBlur={() => {
                    if (!sourceFilter.trim()) setIsSourceFilterExpanded(false);
                  }}
                  placeholder='过滤视频源...'
                  tabIndex={isSourceFilterExpanded ? 0 : -1}
                  className={`min-w-0 w-full h-9 pr-3 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-opacity duration-300 ${
                    isSourceFilterExpanded
                      ? 'opacity-100'
                      : 'opacity-0 pointer-events-none'
                  }`}
                />
              </div>
            </div>
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
            ) : filteredApiSites.length === 0 ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  没有匹配的视频源
                </span>
              </div>
            ) : (
              <div className='flex'>
                <CapsuleSwitch
                  options={filteredApiSites.map((site) => ({
                    label: site.name,
                    value: site.key,
                  }))}
                  active={selectedSource}
                  onChange={(value) => {
                    if (value === selectedSource && viewMode === 'browse')
                      return;
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
                    aria-label='搜索视频'
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

          {/* 分类选择：两级源为「类型 → 分类」联动，平铺源仅显示分类 */}
          {selectedSource && viewMode === 'browse' && (
            <div className='relative space-y-6'>
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
              ) : isHierarchical ? (
                <>
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
                      选择类型
                    </label>
                    <div className='flex'>
                      <CapsuleSwitch
                        options={parentCategories.map((category) => ({
                          label: category.name,
                          value: category.id,
                        }))}
                        active={selectedParentCategory}
                        onChange={handleParentCategoryChange}
                      />
                    </div>
                  </div>
                  {subCategories.length > 0 && (
                    <div>
                      <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
                        选择分类
                      </label>
                      <div className='flex'>
                        <CapsuleSwitch
                          options={subCategories.map((category) => ({
                            label: category.name,
                            value: category.id,
                          }))}
                          active={selectedCategory}
                          onChange={handleCategoryChange}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
                    选择分类
                  </label>
                  <div className='flex'>
                    <CapsuleSwitch
                      options={categories.map((category) => ({
                        label: category.name,
                        value: category.id,
                      }))}
                      active={selectedCategory}
                      onChange={handleCategoryChange}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 视频列表 */}
        {selectedSource &&
          (viewMode === 'search' ? searchKeyword : selectedCategory) && (
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
                      <div key={`${item.source}-${item.id}`} className='w-full'>
                        <VideoCard
                          id={item.id}
                          title={item.title}
                          poster={item.poster}
                          episodes={item.vod_total || item.episodes.length}
                          source={item.source}
                          source_name={item.source_name}
                          douban_id={item.douban_id}
                          year={item.year}
                          from='source-search'
                          type={
                            (item.vod_total || item.episodes.length) > 1
                              ? 'tv'
                              : 'movie'
                          }
                          isAnime={isAnimeCategoryText(
                            item.type_name,
                            item.class
                          )}
                          typeName={item.type_name || item.class}
                          cmsData={
                            isTVBoxBridgeSource(item.source)
                              ? undefined
                              : {
                                  desc: item.desc,
                                  episodes: item.episodes,
                                  episodes_titles: item.episodes_titles,
                                }
                          }
                          onBeforeNavigate={saveSnapshot}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Infinite scroll trigger */}
                  <div
                    ref={loadMoreRef}
                    className='flex justify-center items-center py-8'
                  >
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
