'use client';

import { AlertCircle, CheckCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getTMDBImageUrl } from '@/lib/tmdb.client';
import { processImageUrl } from '@/lib/utils';

import PageLayout from '@/components/PageLayout';

interface TMDBResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string;
  overview?: string;
  media_type: 'movie' | 'tv';
}

interface MovieRequest {
  id: string;
  title: string;
  year?: string;
  mediaType: 'movie' | 'tv';
  season?: number;
  poster?: string;
  requestCount: number;
  status: 'pending' | 'fulfilled';
  createdAt: number;
}

export default function MovieRequestPage() {
  const router = useRouter();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<TMDBResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSeasonDialog, setShowSeasonDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TMDBResult | null>(null);
  const [seasons, setSeasons] = useState<
    Array<{ season_number: number; name: string; poster_path?: string | null }>
  >([]);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error';
    title: string;
    message: string;
  }>({ isOpen: false, type: 'success', title: '', message: '' });
  const [myRequests, setMyRequests] = useState<MovieRequest[]>([]);
  const [loadingMyRequests, setLoadingMyRequests] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isFeatureEnabled, setIsFeatureEnabled] = useState(true);

  // 检查求片功能是否启用
  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig && runtimeConfig.ENABLE_MOVIE_REQUEST === false) {
      setIsFeatureEnabled(false);
    }
  }, []);

  // TMDB搜索
  const handleSearch = async () => {
    if (!searchKeyword.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/tmdb/search?query=${encodeURIComponent(searchKeyword)}`,
      );
      const data = await response.json();

      if (data.results) {
        setSearchResults(data.results.slice(0, 20));
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error('搜索失败:', err);
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '搜索失败',
        message: '请稍后重试',
      });
    } finally {
      setIsSearching(false);
    }
  };

  // 提交求片
  const handleRequest = async (item: TMDBResult) => {
    if (item.media_type === 'tv') {
      setSelectedItem(item);
      setLoadingSeasons(true);
      setShowSeasonDialog(true);

      try {
        const response = await fetch(`/api/tmdb/seasons?tvId=${item.id}`);
        const data = await response.json();
        if (data.seasons) {
          const validSeasons = data.seasons.filter(
            (s: any) => s.season_number > 0,
          );
          setSeasons(validSeasons);

          if (validSeasons.length === 1) {
            // 只有一季，自动提交
            setShowSeasonDialog(false);
            submitRequest(item, validSeasons[0].season_number);
          } else {
            setSelectedSeason(1);
          }
        }
      } catch (err) {
        console.error('加载季度失败:', err);
      } finally {
        setLoadingSeasons(false);
      }
    } else {
      submitRequest(item);
    }
  };

  const submitRequest = async (item: TMDBResult, season?: number) => {
    setSubmitting(true);
    try {
      let poster = item.poster_path
        ? processImageUrl(getTMDBImageUrl(item.poster_path, 'w500'))
        : undefined;
      let title = item.title || item.name || '';

      if (season && seasons.length > 0) {
        const seasonData = seasons.find((s) => s.season_number === season);
        if (seasonData) {
          title = `${title} ${seasonData.name}`;
          if (seasonData.poster_path) {
            poster = processImageUrl(
              getTMDBImageUrl(seasonData.poster_path, 'w500'),
            );
          }
        }
      }

      const response = await fetch('/api/movie-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId: item.id,
          title,
          year: (item.release_date || item.first_air_date)?.split('-')[0],
          mediaType: item.media_type,
          season,
          poster,
          overview: item.overview,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setShowSeasonDialog(false);
        setAlertModal({
          isOpen: true,
          type: 'success',
          title: '求片成功',
          message: data.message,
        });
        refreshMyRequests();
      } else {
        setAlertModal({
          isOpen: true,
          type: 'error',
          title: '求片失败',
          message: data.error || '请稍后重试',
        });
      }
    } catch (err) {
      console.error('求片失败:', err);
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '求片失败',
        message: '请稍后重试',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSeasonConfirm = () => {
    if (selectedItem) {
      submitRequest(selectedItem, selectedSeason);
    }
    setShowSeasonDialog(false);
    setSelectedItem(null);
  };

  // 加载我的求片列表
  useEffect(() => {
    const fetchMyRequests = async () => {
      try {
        const response = await fetch('/api/movie-requests?my=true');
        const data = await response.json();
        if (data.requests) {
          setMyRequests(data.requests);
        }
      } catch (err) {
        console.error('加载求片列表失败:', err);
      } finally {
        setLoadingMyRequests(false);
      }
    };

    fetchMyRequests();
  }, []);

  // 刷新我的求片列表
  const refreshMyRequests = async () => {
    try {
      const response = await fetch('/api/movie-requests?my=true');
      const data = await response.json();
      if (data.requests) {
        setMyRequests(data.requests);
      }
    } catch (err) {
      console.error('刷新求片列表失败:', err);
    }
  };

  return (
    <PageLayout activePath='/movie-request'>
      <div className='container mx-auto px-4 py-6'>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
            求片
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
            {isFeatureEnabled
              ? '搜索并提交您想看的影片'
              : '求片功能已关闭，仅可查看已求片列表'}
          </p>
        </div>

        {/* 功能关闭提示 */}
        {!isFeatureEnabled && (
          <div className='mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg'>
            <p className='text-sm text-yellow-800 dark:text-yellow-200'>
              求片功能已被管理员关闭，您可以查看已提交的求片记录
            </p>
          </div>
        )}

        {/* 搜索框 - 仅在功能启用时显示 */}
        {isFeatureEnabled && (
          <div className='mb-6'>
            <div className='flex gap-2'>
              <input
                type='text'
                placeholder='搜索影片名称...'
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                className='flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
              />
              <button
                onClick={handleSearch}
                disabled={!searchKeyword.trim() || isSearching}
                className='px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed'
              >
                {isSearching ? '搜索中...' : '搜索'}
              </button>
            </div>
          </div>
        )}

        {/* 我的求片列表 */}
        {searchResults.length === 0 && (
          <div className='mb-8'>
            <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>
              我的求片
            </h2>
            {loadingMyRequests ? (
              <div className='flex justify-center py-8'>
                <div className='w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
              </div>
            ) : myRequests.length === 0 ? (
              <div className='text-center py-8 text-gray-500 dark:text-gray-400'>
                暂无求片记录
              </div>
            ) : (
              <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
                {myRequests.map((request) => (
                  <div
                    key={request.id}
                    className='bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow hover:shadow-lg transition-shadow'
                  >
                    {request.poster ? (
                      <img
                        src={request.poster}
                        alt={request.title}
                        className='w-full aspect-[2/3] object-cover'
                      />
                    ) : (
                      <div className='w-full aspect-[2/3] bg-gray-200 dark:bg-gray-700 flex items-center justify-center'>
                        <span className='text-gray-400'>无海报</span>
                      </div>
                    )}
                    <div className='p-3'>
                      <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate mb-1'>
                        {request.title}
                      </h3>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mb-2'>
                        {request.year || '未知'} · {request.requestCount}人求片
                      </p>
                      <div
                        className={`text-xs px-2 py-1 rounded text-center ${
                          request.status === 'fulfilled'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                        }`}
                      >
                        {request.status === 'fulfilled' ? '已上架' : '待处理'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 搜索结果 */}
        {searchResults.length > 0 ? (
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
            {searchResults.map((item) => (
              <div
                key={item.id}
                className='bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow hover:shadow-lg transition-shadow'
              >
                {item.poster_path ? (
                  <img
                    src={processImageUrl(
                      getTMDBImageUrl(item.poster_path, 'w500'),
                    )}
                    alt={item.title || item.name}
                    className='w-full aspect-[2/3] object-cover'
                  />
                ) : (
                  <div className='w-full aspect-[2/3] bg-gray-200 dark:bg-gray-700 flex items-center justify-center'>
                    <span className='text-gray-400'>无海报</span>
                  </div>
                )}
                <div className='p-3'>
                  <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate mb-1'>
                    {item.title || item.name}
                  </h3>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mb-2'>
                    {(item.release_date || item.first_air_date)?.split(
                      '-',
                    )[0] || '未知'}
                  </p>
                  <button
                    onClick={() => handleRequest(item)}
                    disabled={submitting || !isFeatureEnabled}
                    className='w-full px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    {submitting
                      ? '处理中...'
                      : !isFeatureEnabled
                        ? '功能已关闭'
                        : '求片'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : searchKeyword && !isSearching ? (
          <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
            未找到相关影片
          </div>
        ) : null}
      </div>

      {/* 提示弹窗 */}
      {alertModal.isOpen &&
        typeof window !== 'undefined' &&
        createPortal(
          <div className='fixed inset-0 bg-black/50 z-[1002] flex items-center justify-center p-4'>
            <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6'>
              <div className='flex justify-center mb-4'>
                {alertModal.type === 'success' ? (
                  <CheckCircle className='w-12 h-12 text-green-500' />
                ) : (
                  <AlertCircle className='w-12 h-12 text-red-500' />
                )}
              </div>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 text-center mb-2'>
                {alertModal.title}
              </h3>
              <p className='text-gray-600 dark:text-gray-400 text-center mb-4'>
                {alertModal.message}
              </p>
              <button
                onClick={() => setAlertModal({ ...alertModal, isOpen: false })}
                className='w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg'
              >
                确定
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* 季度选择弹窗 */}
      {showSeasonDialog &&
        typeof window !== 'undefined' &&
        createPortal(
          <>
            <div
              className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
              onClick={() => setShowSeasonDialog(false)}
            />
            <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] p-6'>
              <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200 mb-4'>
                选择季度
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400 mb-4'>
                {selectedItem?.title || selectedItem?.name}
              </p>
              {loadingSeasons ? (
                <div className='flex justify-center py-8'>
                  <div className='w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
                </div>
              ) : (
                <div className='space-y-2 mb-4 max-h-60 overflow-y-auto'>
                  {seasons.map((season) => (
                    <button
                      key={season.season_number}
                      onClick={() => setSelectedSeason(season.season_number)}
                      className={`w-full p-3 rounded-lg text-left transition-colors ${
                        selectedSeason === season.season_number
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {season.name}
                    </button>
                  ))}
                </div>
              )}
              <div className='flex gap-2'>
                <button
                  onClick={() => setShowSeasonDialog(false)}
                  className='flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600'
                >
                  取消
                </button>
                <button
                  onClick={handleSeasonConfirm}
                  className='flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg'
                >
                  确认
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </PageLayout>
  );
}
