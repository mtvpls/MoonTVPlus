/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { ArrowDownWideNarrow, ArrowUpNarrowWide,Film } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo,useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { base58Encode } from '@/lib/utils';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

type LibrarySourceType = 'openlist' | 'emby' | 'xiaoya' | `emby:${string}` | `emby_${string}`;

interface EmbySourceOption {
  key: string;
  name: string;
}

interface Video {
  id: string;
  folder?: string;
  tmdbId?: number;
  title: string;
  poster: string;
  releaseDate?: string;
  year?: string;
  overview?: string;
  voteAverage?: number;
  rating?: number;
  mediaType: 'movie' | 'tv';
}

interface EmbyView {
  id: string;
  name: string;
  type: string;
}

export default function PrivateLibraryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 获取运行时配置
  const runtimeConfig = useMemo(() => {
    if (typeof window !== 'undefined' && (window as any).RUNTIME_CONFIG) {
      return (window as any).RUNTIME_CONFIG;
    }
    return { OPENLIST_ENABLED: false, EMBY_ENABLED: false, XIAOYA_ENABLED: false };
  }, []);

  // 解析URL中的source参数（支持 emby:emby1 格式）
  const parseSourceParam = (sourceParam: string | null): { sourceType: LibrarySourceType; embyKey?: string } => {
    if (!sourceParam) return { sourceType: 'openlist' };

    if (sourceParam.includes(':')) {
      const [type, key] = sourceParam.split(':');
      return { sourceType: type as LibrarySourceType, embyKey: key };
    }

    return { sourceType: sourceParam as LibrarySourceType };
  };

  const [sourceType, setSourceType] = useState<LibrarySourceType>('openlist');
  const [embyKey, setEmbyKey] = useState<string | undefined>();
  const [embySourceOptions, setEmbySourceOptions] = useState<EmbySourceOption[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [embyViews, setEmbyViews] = useState<EmbyView[]>([]);
  const [selectedView, setSelectedView] = useState<string>('all');
  const [loadingViews, setLoadingViews] = useState(false);
  // Emby排序状态
  const [sortBy, setSortBy] = useState<string>('SortName');
  const [sortOrder, setSortOrder] = useState<'Ascending' | 'Descending'>('Ascending');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [sortDropdownPosition, setSortDropdownPosition] = useState<{ x: number; y: number; width: number }>({ x: 0, y: 0, width: 0 });
  const sortButtonRef = useRef<HTMLDivElement | null>(null);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);
  // 小雅相关状态
  const [xiaoyaPath, setXiaoyaPath] = useState<string>('/');
  const [xiaoyaFolders, setXiaoyaFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [xiaoyaFiles, setXiaoyaFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [xiaoyaSearchKeyword, setXiaoyaSearchKeyword] = useState<string>('');
  const [xiaoyaSearchResults, setXiaoyaSearchResults] = useState<Array<{ name: string; path: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pageSize = 20;
  const observerTarget = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const embyScrollContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const isInitializedRef = useRef(false);
  const hasRestoredViewRef = useRef(false);

  // 客户端挂载标记
  useEffect(() => {
    setMounted(true);
  }, []);

  // 小雅搜索处理函数
  const handleXiaoyaSearch = async () => {
    if (!xiaoyaSearchKeyword.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch(`/api/xiaoya/search?keyword=${encodeURIComponent(xiaoyaSearchKeyword)}`);
      if (!response.ok) {
        throw new Error('搜索失败');
      }

      const data = await response.json();
      if (data.error) {
        setError(data.error);
        setXiaoyaSearchResults([]);
      } else {
        setXiaoyaSearchResults(data.videos || []);
      }
    } catch (err) {
      console.error('搜索失败:', err);
      setError('搜索失败');
      setXiaoyaSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // 从URL初始化状态，并检查配置自动跳转
  useEffect(() => {
    const urlSourceParam = searchParams.get('source');

    // 解析source参数
    const parsed = parseSourceParam(urlSourceParam);

    // 如果 OpenList 未配置但 Emby 已配置，强制使用 Emby
    if (!runtimeConfig.OPENLIST_ENABLED && runtimeConfig.EMBY_ENABLED) {
      setSourceType('emby');
    } else if (parsed.sourceType) {
      setSourceType(parsed.sourceType);
      if (parsed.embyKey) {
        setEmbyKey(parsed.embyKey);
      }
    }

    isInitializedRef.current = true;
  }, [searchParams, runtimeConfig]);

  // 获取Emby源列表
  useEffect(() => {
    const fetchEmbySources = async () => {
      try {
        const response = await fetch('/api/emby/sources');
        if (response.ok) {
          const data = await response.json();
          setEmbySourceOptions(data.sources || []);

          // 如果没有设置embyKey，使用第一个源
          if (!embyKey && data.sources && data.sources.length > 0) {
            setEmbyKey(data.sources[0].key);
          }
        }
      } catch (error) {
        console.error('获取Emby源列表失败:', error);
      }
    };

    if (sourceType === 'emby') {
      fetchEmbySources();
    }
  }, [sourceType]);

  // 更新URL参数
  useEffect(() => {
    if (!isInitializedRef.current) return;

    const params = new URLSearchParams();

    // 构建source参数
    if (sourceType === 'emby' && embyKey && embySourceOptions.length > 1) {
      params.set('source', `emby:${embyKey}`);
    } else {
      params.set('source', sourceType);
    }

    if (sourceType === 'emby' && selectedView !== 'all') {
      params.set('view', selectedView);
    }

    router.replace(`/private-library?${params.toString()}`, { scroll: false });
  }, [sourceType, embyKey, selectedView, router, embySourceOptions.length]);

  // 切换源类型时重置所有状态（但不在初始化时执行）
  useEffect(() => {
    if (!isInitializedRef.current) return;

    setPage(1);
    setVideos([]);
    setHasMore(true);
    setError('');
    setSelectedView('all');
    setLoading(false);
    setLoadingMore(false);
    isFetchingRef.current = false;
  }, [sourceType, embyKey]);

  // 切换分类时重置状态（但不在初始化时执行）
  useEffect(() => {
    if (!isInitializedRef.current) return;

    setPage(1);
    setVideos([]);
    setHasMore(true);
    setError('');
    setLoading(false);
    setLoadingMore(false);
    isFetchingRef.current = false;
  }, [selectedView]);

  // 切换排序时重置状态（但不在初始化时执行）
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (sourceType !== 'emby') return;

    setPage(1);
    setVideos([]);
    setHasMore(true);
    setError('');
    setLoading(false);
    setLoadingMore(false);
    isFetchingRef.current = false;
  }, [sortBy, sortOrder, sourceType]);

  // 获取 Emby 媒体库列表
  useEffect(() => {
    if (sourceType !== 'emby' || !embyKey) return;

    const fetchEmbyViews = async () => {
      setLoadingViews(true);
      try {
        const params = new URLSearchParams({ embyKey });
        const response = await fetch(`/api/emby/views?${params.toString()}`);
        const data = await response.json();

        if (data.error) {
          console.error('获取 Emby 媒体库列表失败:', data.error);
          setEmbyViews([]);
        } else {
          setEmbyViews(data.views || []);

          // 分类加载完成后，检查URL中是否有view参数（只在第一次加载时恢复）
          if (!hasRestoredViewRef.current) {
            const urlView = searchParams.get('view');
            if (urlView && data.views && data.views.length > 0) {
              // 检查该view是否存在于分类列表中
              const viewExists = data.views.some((v: EmbyView) => v.id === urlView);
              if (viewExists) {
                setSelectedView(urlView);
              }
            }
            hasRestoredViewRef.current = true;
          }
        }
      } catch (err) {
        console.error('获取 Emby 媒体库列表失败:', err);
        setEmbyViews([]);
      } finally {
        setLoadingViews(false);
      }
    };

    fetchEmbyViews();
  }, [sourceType, embyKey]);

  // 鼠标拖动滚动
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return;
    isDraggingRef.current = true;
    startXRef.current = e.pageX - scrollContainerRef.current.offsetLeft;
    scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
    scrollContainerRef.current.style.cursor = 'grabbing';
    scrollContainerRef.current.style.userSelect = 'none';
  };

  const handleMouseLeave = () => {
    if (!scrollContainerRef.current) return;
    isDraggingRef.current = false;
    scrollContainerRef.current.style.cursor = 'grab';
    scrollContainerRef.current.style.userSelect = 'auto';
  };

  const handleMouseUp = () => {
    if (!scrollContainerRef.current) return;
    isDraggingRef.current = false;
    scrollContainerRef.current.style.cursor = 'grab';
    scrollContainerRef.current.style.userSelect = 'auto';
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 2; // 滚动速度倍数
    scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  // 排序相关函数
  const sortOptions = [
    { label: '名称', value: 'SortName' },
    { label: '加入时间', value: 'DateCreated' },
    { label: '发行日期', value: 'PremiereDate' },
    { label: '年份', value: 'ProductionYear' },
    { label: '评分', value: 'CommunityRating' },
  ];

  const getSortDisplayText = () => {
    const option = sortOptions.find((opt) => opt.value === sortBy);
    return option?.label || '排序';
  };

  const isDefaultSort = () => {
    return sortBy === 'SortName' && sortOrder === 'Ascending';
  };

  const calculateSortDropdownPosition = () => {
    const element = sortButtonRef.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const isMobile = viewportWidth < 768;

      let x = rect.left;
      const minWidth = 200;
      let dropdownWidth = Math.max(rect.width, minWidth);
      let useFixedWidth = false;

      if (isMobile) {
        const padding = 16;
        const maxWidth = viewportWidth - padding * 2;
        dropdownWidth = Math.min(dropdownWidth, maxWidth);
        useFixedWidth = true;

        if (x + dropdownWidth > viewportWidth - padding) {
          x = viewportWidth - dropdownWidth - padding;
        }
        if (x < padding) {
          x = padding;
        }
      }

      setSortDropdownPosition({ x, y: rect.bottom + 4, width: useFixedWidth ? dropdownWidth : rect.width });
    }
  };

  const handleSortButtonClick = () => {
    if (showSortDropdown) {
      setShowSortDropdown(false);
    } else {
      setShowSortDropdown(true);
      calculateSortDropdownPosition();
    }
  };

  const handleSortOptionSelect = (value: string) => {
    setSortBy(value);
    setShowSortDropdown(false);
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === 'Ascending' ? 'Descending' : 'Ascending');
  };

  // 点击外部关闭排序下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node) &&
        sortButtonRef.current &&
        !sortButtonRef.current.contains(event.target as Node)
      ) {
        setShowSortDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 滚动时关闭排序下拉框
  useEffect(() => {
    const handleScroll = () => {
      if (showSortDropdown) {
        setShowSortDropdown(false);
      }
    };
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, [showSortDropdown]);

  // 加载数据的函数
  useEffect(() => {
    const fetchVideos = async () => {
      const isInitial = page === 1;

      // 取消之前的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // 如果选择了 openlist 但未配置，不发起请求
      if (sourceType === 'openlist' && !runtimeConfig.OPENLIST_ENABLED) {
        setLoading(false);
        return;
      }

      // 如果选择了 emby 但未配置或没有embyKey，不发起请求
      if (sourceType === 'emby' && (!runtimeConfig.EMBY_ENABLED || !embyKey)) {
        setLoading(false);
        return;
      }

      // 如果选择了 xiaoya 但未配置，不发起请求
      if (sourceType === 'xiaoya' && !runtimeConfig.XIAOYA_ENABLED) {
        setLoading(false);
        return;
      }

      // 创建新的 AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      isFetchingRef.current = true;

      try {
        if (isInitial) {
          setLoading(true);
        } else {
          setLoadingMore(true);
        }
        setError('');

        const endpoint = sourceType === 'openlist'
          ? `/api/openlist/list?page=${page}&pageSize=${pageSize}`
          : sourceType === 'xiaoya'
          ? `/api/xiaoya/browse?path=${encodeURIComponent(xiaoyaPath)}`
          : `/api/emby/list?page=${page}&pageSize=${pageSize}${selectedView !== 'all' ? `&parentId=${selectedView}` : ''}&embyKey=${embyKey}&sortBy=${sortBy}&sortOrder=${sortOrder}`;

        const response = await fetch(endpoint, { signal: abortController.signal });

        if (!response.ok) {
          throw new Error('获取视频列表失败');
        }

        const data = await response.json();

        if (data.error) {
          setError(data.error);
          if (isInitial) {
            setVideos([]);
          }
        } else {
          // 小雅返回的是文件夹和文件列表
          if (sourceType === 'xiaoya') {
            setXiaoyaFolders(data.folders || []);
            setXiaoyaFiles(data.files || []);
            setVideos([]); // 小雅不使用 videos 状态
            setHasMore(false); // 小雅不需要分页
          } else {
            const newVideos = data.list || [];

            if (isInitial) {
              setVideos(newVideos);
            } else {
              setVideos((prev) => [...prev, ...newVideos]);
            }

            // 检查是否还有更多数据
            const currentPage = data.page || page;
            const totalPages = data.totalPages || 1;
            const hasMoreData = currentPage < totalPages;
            setHasMore(hasMoreData);
          }
        }
      } catch (err: any) {
        // 忽略取消请求的错误
        if (err.name === 'AbortError') {
          return;
        }
        console.error('获取视频列表失败:', err);
        setError('获取视频列表失败');
        if (isInitial) {
          setVideos([]);
        }
      } finally {
        // 只有当这个请求没有被取消时才更新状态
        if (!abortController.signal.aborted) {
          if (isInitial) {
            setLoading(false);
          } else {
            setLoadingMore(false);
          }
          isFetchingRef.current = false;
        }
      }
    };

    fetchVideos();

    // 清理函数：组件卸载时取消请求
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [sourceType, embyKey, page, selectedView, xiaoyaPath, runtimeConfig, sortBy, sortOrder]);

  const handleVideoClick = (video: Video) => {
    // 构建source参数
    let sourceParam = sourceType;
    if (sourceType === 'emby' && embyKey && embySourceOptions.length > 1) {
      sourceParam = `emby:${embyKey}`;
    }

    // 跳转到播放页面
    router.push(`/play?source=${sourceParam}&id=${encodeURIComponent(video.id)}`);
  };

  // 使用 Intersection Observer 监听滚动
  useEffect(() => {
    if (!observerTarget.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        // 当目标元素可见且还有更多数据且没有正在加载时，加载下一页
        if (entry.isIntersecting && hasMore && !loadingMore && !loading && !isFetchingRef.current) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    const currentTarget = observerTarget.current;
    observer.observe(currentTarget);

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loadingMore, loading, page]);

  return (
    <PageLayout activePath='/private-library'>
      <div className='container mx-auto px-4 py-6'>
        <div className='mb-6 flex justify-between items-start'>
          <div>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              私人影库
            </h1>
            <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
              观看自我收藏的高清视频吧
            </p>
          </div>
          {mounted && (
            <button
              onClick={() => router.push('/movie-request')}
              className='flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors'
              style={{ marginTop: '10px' }}
            >
              <Film size={20} />
              <span>求片</span>
            </button>
          )}
        </div>

        {/* 第一级：源类型选择（OpenList / Emby / 小雅） */}
        {mounted && (
          <div className='mb-6 flex justify-center'>
            <CapsuleSwitch
              options={[
                ...(runtimeConfig.OPENLIST_ENABLED ? [{ label: 'OpenList', value: 'openlist' }] : []),
                ...(runtimeConfig.EMBY_ENABLED ? [{ label: 'Emby', value: 'emby' }] : []),
                ...(runtimeConfig.XIAOYA_ENABLED ? [{ label: '小雅', value: 'xiaoya' }] : []),
              ]}
              active={sourceType}
              onChange={(value) => setSourceType(value as LibrarySourceType)}
            />
          </div>
        )}

        {/* 第二级：Emby源选择（仅当选择Emby且有多个源时显示） */}
        {sourceType === 'emby' && embySourceOptions.length > 1 && (
          <div className='mb-6'>
            <div className='text-xs text-gray-500 dark:text-gray-400 mb-2 px-4'>
              服务
            </div>
            <div className='relative'>
              <div
                ref={embyScrollContainerRef}
                className='overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing'
                onMouseDown={(e) => {
                  if (!embyScrollContainerRef.current) return;
                  isDraggingRef.current = true;
                  startXRef.current = e.pageX - embyScrollContainerRef.current.offsetLeft;
                  scrollLeftRef.current = embyScrollContainerRef.current.scrollLeft;
                  embyScrollContainerRef.current.style.cursor = 'grabbing';
                  embyScrollContainerRef.current.style.userSelect = 'none';
                }}
                onMouseLeave={() => {
                  if (!embyScrollContainerRef.current) return;
                  isDraggingRef.current = false;
                  embyScrollContainerRef.current.style.cursor = 'grab';
                  embyScrollContainerRef.current.style.userSelect = 'auto';
                }}
                onMouseUp={() => {
                  if (!embyScrollContainerRef.current) return;
                  isDraggingRef.current = false;
                  embyScrollContainerRef.current.style.cursor = 'grab';
                  embyScrollContainerRef.current.style.userSelect = 'auto';
                }}
                onMouseMove={(e) => {
                  if (!isDraggingRef.current || !embyScrollContainerRef.current) return;
                  e.preventDefault();
                  const x = e.pageX - embyScrollContainerRef.current.offsetLeft;
                  const walk = (x - startXRef.current) * 2;
                  embyScrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
                }}
              >
                <div className='flex gap-2 px-4 min-w-min'>
                  {embySourceOptions.map((option) => (
                    <button
                      key={option.key}
                      onClick={() => setEmbyKey(option.key)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                        embyKey === option.key
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 第三级：Emby 媒体库分类选择器 */}
        {sourceType === 'emby' && (
          <div className='mb-6'>
            <div className='text-xs text-gray-500 dark:text-gray-400 mb-2 px-4'>
              分类
            </div>
            {loadingViews ? (
              <div className='flex justify-center'>
                <div className='w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
              </div>
            ) : embyViews.length > 0 ? (
              <div className='relative'>
                <div
                  ref={scrollContainerRef}
                  className='overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing'
                  onMouseDown={handleMouseDown}
                  onMouseLeave={handleMouseLeave}
                  onMouseUp={handleMouseUp}
                  onMouseMove={handleMouseMove}
                >
                  <div className='flex gap-2 px-4 min-w-min'>
                    <button
                      onClick={() => setSelectedView('all')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                        selectedView === 'all'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      全部
                    </button>
                    {embyViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => setSelectedView(view.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                          selectedView === view.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {view.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Emby 排序选择器 */}
        {sourceType === 'emby' && (
          <div className='mb-6'>
            <div className='text-xs text-gray-500 dark:text-gray-400 mb-2 px-4'>
              排序
            </div>
            <div className='px-4'>
              <div className='relative inline-flex rounded-full p-0.5 sm:p-1 bg-transparent gap-1 sm:gap-2'>
                {/* 排序字段选择 */}
                <div ref={sortButtonRef} className='relative'>
                  <button
                    onClick={handleSortButtonClick}
                    className={`relative z-10 px-1.5 py-0.5 sm:px-2 sm:py-1 md:px-4 md:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                      showSortDropdown
                        ? isDefaultSort()
                          ? 'text-gray-900 dark:text-gray-100 cursor-default'
                          : 'text-green-600 dark:text-green-400 cursor-default'
                        : isDefaultSort()
                          ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                          : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
                    }`}
                  >
                    <span>{getSortDisplayText()}</span>
                    <svg
                      className={`inline-block w-2.5 h-2.5 sm:w-3 sm:h-3 ml-0.5 sm:ml-1 transition-transform duration-200 ${
                        showSortDropdown ? 'rotate-180' : ''
                      }`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
                    </svg>
                  </button>
                </div>

                {/* 排序方向切换 */}
                <div className='relative'>
                  <button
                    onClick={toggleSortOrder}
                    className={`relative z-10 px-1.5 py-0.5 sm:px-2 sm:py-1 md:px-4 md:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                      isDefaultSort()
                        ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                        : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
                    }`}
                    aria-label={sortOrder === 'Ascending' ? '升序' : '降序'}
                  >
                    {sortOrder === 'Ascending' ? (
                      <ArrowUpNarrowWide className='inline-block w-4 h-4 sm:w-4 sm:h-4' />
                    ) : (
                      <ArrowDownWideNarrow className='inline-block w-4 h-4 sm:w-4 sm:h-4' />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 排序下拉框 Portal */}
        {mounted && showSortDropdown && createPortal(
          <div
            ref={sortDropdownRef}
            className='fixed z-[9999] bg-white/95 dark:bg-gray-800/95 rounded-xl border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm max-h-[50vh] flex flex-col'
            style={{
              left: `${sortDropdownPosition.x}px`,
              top: `${sortDropdownPosition.y}px`,
              minWidth: `${Math.max(sortDropdownPosition.width, 200)}px`,
              maxWidth: '300px',
              position: 'fixed',
            }}
          >
            <div className='p-2 sm:p-4 overflow-y-auto flex-1 min-h-0'>
              <div className='grid grid-cols-2 gap-1 sm:gap-2'>
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSortOptionSelect(option.value)}
                    className={`px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-lg transition-all duration-200 text-left ${
                      sortBy === option.value
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}

        {error && (
          <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6'>
            <p className='text-red-800 dark:text-red-200'>{error}</p>
          </div>
        )}

        {loading ? (
          sourceType === 'xiaoya' ? (
            // 小雅加载骨架屏 - 文件夹列表样式
            <div className='space-y-4'>
              {/* 文件夹骨架屏 */}
              <div className='space-y-2'>
                <div className='h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse' />
                <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2'>
                  {Array.from({ length: 12 }).map((_, index) => (
                    <div
                      key={index}
                      className='h-12 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            // OpenList/Emby 加载骨架屏 - 海报卡片样式
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
              {Array.from({ length: pageSize }).map((_, index) => (
                <div
                  key={index}
                  className='animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg aspect-[2/3]'
                />
              ))}
            </div>
          )
        ) : sourceType === 'xiaoya' ? (
          // 小雅浏览模式
          <div className='space-y-4'>
            {/* 搜索框 */}
            <div className='flex justify-center md:justify-end'>
              <div className='relative w-full max-w-md'>
                <input
                  type='text'
                  placeholder='搜索视频...'
                  value={xiaoyaSearchKeyword}
                  onChange={(e) => setXiaoyaSearchKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && xiaoyaSearchKeyword.trim()) {
                      handleXiaoyaSearch();
                    }
                  }}
                  className='w-full px-4 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
                {xiaoyaSearchKeyword ? (
                  <button
                    onClick={() => {
                      setXiaoyaSearchKeyword('');
                      setXiaoyaSearchResults([]);
                    }}
                    className='absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  >
                    <svg className='w-5 h-5' fill='currentColor' viewBox='0 0 20 20'>
                      <path fillRule='evenodd' d='M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z' clipRule='evenodd' />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={handleXiaoyaSearch}
                    disabled={!xiaoyaSearchKeyword.trim() || isSearching}
                    className='absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    <svg className='w-5 h-5' fill='currentColor' viewBox='0 0 20 20'>
                      <path fillRule='evenodd' d='M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z' clipRule='evenodd' />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* 搜索结果 */}
            {xiaoyaSearchResults.length > 0 ? (
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <h3 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    搜索结果 ({xiaoyaSearchResults.length})
                  </h3>
                  <button
                    onClick={() => {
                      setXiaoyaSearchKeyword('');
                      setXiaoyaSearchResults([]);
                    }}
                    className='text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                  >
                    返回浏览
                  </button>
                </div>
                <div className='grid grid-cols-1 gap-2'>
                  {xiaoyaSearchResults.map((item) => {
                    // 判断是否为视频文件
                    const videoExtensions = ['.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts', '.mov', '.wmv', '.webm'];
                    const isVideoFile = videoExtensions.some(ext => item.name.toLowerCase().endsWith(ext));

                    // 从路径中提取文件夹名作为标题
                    const pathParts = item.path.split('/').filter(Boolean);
                    const folderName = pathParts[pathParts.length - (isVideoFile ? 2 : 1)] || '';
                    const title = folderName
                      .replace(/\s*\(\d{4}\)\s*\{tmdb-\d+\}$/i, '')
                      .trim() || item.name;

                    return (
                      <button
                        key={item.path}
                        onClick={() => {
                          if (isVideoFile) {
                            // 视频文件：提取父目录作为ID，传递文件名
                            const pathParts = item.path.split('/').filter(Boolean);
                            const parentDir = '/' + pathParts.slice(0, -1).join('/');
                            const fileName = pathParts[pathParts.length - 1];
                            const encodedDirPath = base58Encode(parentDir);
                            router.push(`/play?source=xiaoya&id=${encodeURIComponent(encodedDirPath)}&fileName=${encodeURIComponent(fileName)}&title=${encodeURIComponent(title)}`);
                          } else {
                            // 文件夹：进入浏览
                            setXiaoyaPath(item.path);
                            setXiaoyaSearchKeyword('');
                            setXiaoyaSearchResults([]);
                          }
                        }}
                        className='flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-left'
                      >
                        {isVideoFile ? (
                          <svg className='w-5 h-5 text-green-600 flex-shrink-0' fill='currentColor' viewBox='0 0 20 20'>
                            <path d='M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z' />
                          </svg>
                        ) : (
                          <svg className='w-5 h-5 text-blue-600 flex-shrink-0' fill='currentColor' viewBox='0 0 20 20'>
                            <path d='M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z' />
                          </svg>
                        )}
                        <div className='flex-1 min-w-0'>
                          <div className='text-sm truncate'>{item.name}</div>
                          <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>{item.path}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : isSearching ? (
              <div className='flex justify-center py-8'>
                <div className='flex items-center gap-2 text-gray-600 dark:text-gray-400'>
                  <div className='w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
                  <span>搜索中...</span>
                </div>
              </div>
            ) : (
              <>
            {/* 面包屑导航 */}
            <div className='flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400'>
              <button
                onClick={() => setXiaoyaPath('/')}
                className='hover:text-blue-600 dark:hover:text-blue-400'
              >
                根目录
              </button>
              {xiaoyaPath.split('/').filter(Boolean).map((part, index, arr) => {
                const path = '/' + arr.slice(0, index + 1).join('/');
                return (
                  <span key={path} className='flex items-center gap-2'>
                    <span>/</span>
                    <button
                      onClick={() => setXiaoyaPath(path)}
                      className='hover:text-blue-600 dark:hover:text-blue-400'
                    >
                      {part}
                    </button>
                  </span>
                );
              })}
            </div>

            {/* 文件夹列表 */}
            {xiaoyaFolders.length > 0 && (
              <div className='space-y-2'>
                <h3 className='text-sm font-medium text-gray-700 dark:text-gray-300'>文件夹</h3>
                <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2'>
                  {xiaoyaFolders.map((folder) => (
                    <button
                      key={folder.path}
                      onClick={() => setXiaoyaPath(folder.path)}
                      className='flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-left'
                    >
                      <svg className='w-5 h-5 text-blue-600' fill='currentColor' viewBox='0 0 20 20'>
                        <path d='M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z' />
                      </svg>
                      <span className='text-sm truncate'>{folder.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 视频文件列表 */}
            {xiaoyaFiles.length > 0 && (
              <div className='space-y-2'>
                <h3 className='text-sm font-medium text-gray-700 dark:text-gray-300'>视频文件</h3>
                <div className='grid grid-cols-1 gap-2'>
                  {xiaoyaFiles.map((file) => {
                    // 从当前路径提取文件夹名作为标题
                    const pathParts = xiaoyaPath.split('/').filter(Boolean);
                    const folderName = pathParts[pathParts.length - 1] || '';
                    // 清理文件夹名（移除年份和 TMDb ID）
                    const title = folderName
                      .replace(/\s*\(\d{4}\)\s*\{tmdb-\d+\}$/i, '')
                      .trim() || file.name;

                    return (
                      <button
                        key={file.path}
                        onClick={() => {
                          // ID使用目录路径，额外传递文件名（不需要编码）
                          const encodedDirPath = base58Encode(xiaoyaPath);
                          router.push(`/play?source=xiaoya&id=${encodeURIComponent(encodedDirPath)}&fileName=${encodeURIComponent(file.name)}&title=${encodeURIComponent(title)}`);
                        }}
                        className='flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-left'
                      >
                        <svg className='w-5 h-5 text-green-600' fill='currentColor' viewBox='0 0 20 20'>
                          <path d='M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z' />
                        </svg>
                        <span className='text-sm truncate'>{file.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {xiaoyaFolders.length === 0 && xiaoyaFiles.length === 0 && (
              <div className='text-center py-12'>
                <p className='text-gray-500 dark:text-gray-400'>此目录为空</p>
              </div>
            )}
              </>
            )}
          </div>
        ) : videos.length === 0 ? (
          <div className='text-center py-12'>
            <p className='text-gray-500 dark:text-gray-400'>
              {sourceType === 'openlist'
                ? '暂无视频，请在管理面板配置 OpenList 并刷新'
                : '暂无视频，请在管理面板配置 Emby'}
            </p>
          </div>
        ) : (
          <>
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
              {videos.map((video) => {
                // 构建source参数用于VideoCard
                // 如果是emby源且有embyKey，使用下划线格式
                let sourceParam = sourceType;
                if (sourceType === 'emby' && embyKey) {
                  sourceParam = `emby_${embyKey}`;
                }

                return (
                  <VideoCard
                    key={video.id}
                    id={video.id}
                    source={sourceParam}
                    title={video.title}
                    poster={video.poster}
                    year={video.year || (video.releaseDate ? video.releaseDate.split('-')[0] : '')}
                    rate={
                      video.rating
                        ? video.rating.toFixed(1)
                        : video.voteAverage && video.voteAverage > 0
                        ? video.voteAverage.toFixed(1)
                        : ''
                    }
                    from='search'
                  />
                );
              })}
            </div>

            {/* 滚动加载指示器 - 始终渲染以便 observer 可以监听 */}
            <div ref={observerTarget} className='flex justify-center items-center py-8 min-h-[100px]'>
              {loadingMore && (
                <div className='flex items-center gap-2 text-gray-600 dark:text-gray-400'>
                  <div className='w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
                  <span>加载中...</span>
                </div>
              )}
              {!hasMore && videos.length > 0 && !loadingMore && (
                <div className='text-gray-500 dark:text-gray-400'>
                  已加载全部内容
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
