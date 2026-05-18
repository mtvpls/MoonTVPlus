/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
'use client';

import {
  AlertCircle,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PansouLink, PansouSearchResult } from '@/lib/pansou.client';

import Toast, { ToastProps } from '@/components/Toast';

interface PansouSearchProps {
  keyword: string;
  triggerSearch?: boolean; // 触发搜索的标志
  onError?: (error: string) => void;
}

// 网盘类型映射
const CLOUD_TYPE_NAMES: Record<string, string> = {
  baidu: '百度网盘',
  aliyun: '阿里云盘',
  quark: '夸克网盘',
  tianyi: '天翼云盘',
  uc: 'UC网盘',
  mobile: '移动云盘',
  '115': '115网盘',
  pikpak: 'PikPak',
  xunlei: '迅雷网盘',
  '123': '123网盘',
  magnet: '磁力链接',
  ed2k: '电驴链接',
  others: '其他',
};

// 网盘类型颜色
const CLOUD_TYPE_COLORS: Record<string, string> = {
  baidu: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  aliyun:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  quark:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
  tianyi: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  uc: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  mobile: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200',
  '115':
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  pikpak:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  xunlei: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
  '123': 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  magnet: 'bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-200',
  ed2k: 'bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-200',
  others: 'bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-200',
};

const CHECKABLE_CLOUD_TYPES = new Set([
  '115',
  'aliyun',
  'baidu',
  'mobile',
  'quark',
  'tianyi',
  'uc',
  'xunlei',
  '123',
]);

const CLOUD_TYPE_TO_CHECK_PLATFORM: Record<string, string> = {
  '115': '115',
  aliyun: 'aliyun',
  baidu: 'baidu',
  mobile: 'cmcc',
  quark: 'quark',
  tianyi: 'tianyi',
  uc: 'uc',
  xunlei: 'xunlei',
  '123': 'pan123',
};

type CheckItemStatus =
  | 'pending'
  | 'checking'
  | 'valid'
  | 'invalid'
  | 'unknown'
  | 'rate_limited';

interface NetdiskCheckTaskPayload {
  id: string;
  platform: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    total: number;
    done: number;
    valid: number;
    invalid: number;
    unknown: number;
    rateLimited: number;
    currentBatch: number;
    totalBatches: number;
  };
  results: Record<
    string,
    { status: CheckItemStatus; reason?: string; fromCache?: boolean }
  >;
  error?: string;
}

interface StoredCloudCheckState {
  taskId: string;
  task: NetdiskCheckTaskPayload;
}

const CHECK_STATUS_STYLE: Record<CheckItemStatus, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200',
  checking: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  valid: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  invalid: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  unknown:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-200',
  rate_limited:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
};

const CHECK_STATUS_TEXT: Record<CheckItemStatus, string> = {
  pending: '未检测',
  checking: '检测中',
  valid: '有效',
  invalid: '失效',
  unknown: '未知',
  rate_limited: '受限',
};

export default function PansouSearch({
  keyword,
  triggerSearch,
  onError,
}: PansouSearchProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PansouSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('all'); // 'all' 表示显示全部
  const typeScrollContainerRef = useRef<HTMLDivElement>(null);
  const isTypeDraggingRef = useRef(false);
  const typeDragStartXRef = useRef(0);
  const typeDragScrollLeftRef = useRef(0);
  const [transferingUrl, setTransferingUrl] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastProps | null>(null);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
  const [checkStatesByType, setCheckStatesByType] = useState<
    Record<string, StoredCloudCheckState>
  >({});

  useEffect(() => {
    setCooldownRemainingMs(0);
    setCheckStatesByType({});
  }, [keyword, triggerSearch]);

  useEffect(() => {
    const runningEntries = Object.entries(checkStatesByType).filter(
      ([, state]) => state.task.status === 'running'
    );
    if (runningEntries.length === 0) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const updates = await Promise.all(
        runningEntries.map(async ([cloudType, state]) => {
          try {
            const response = await fetch(
              `/api/netdisk/check/task?id=${encodeURIComponent(state.taskId)}`
            );
            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.error || '获取检测进度失败');
            }
            return {
              cloudType,
              taskId: state.taskId,
              task: data.task as NetdiskCheckTaskPayload,
              cooldownRemainingMs: Number(data.cooldownRemainingMs || 0),
            };
          } catch (error) {
            return {
              cloudType,
              taskId: state.taskId,
              task: {
                ...state.task,
                status: 'failed',
                error:
                  error instanceof Error ? error.message : '获取检测进度失败',
              } as NetdiskCheckTaskPayload,
              cooldownRemainingMs: 0,
            };
          }
        })
      );

      if (cancelled) return;

      setCheckStatesByType((prev) => {
        const next = { ...prev };
        updates.forEach((update) => {
          next[update.cloudType] = {
            taskId: update.taskId,
            task: update.task,
          };
        });
        return next;
      });
      setCooldownRemainingMs(
        Math.max(0, ...updates.map((item) => item.cooldownRemainingMs))
      );
      updates.forEach((update) => {
        if (update.task.status === 'failed' && update.task.error) {
          setToast({
            message: `${
              CLOUD_TYPE_NAMES[update.cloudType] || update.cloudType
            }: ${update.task.error}`,
            type: 'error',
            onClose: () => setToast(null),
          });
        }
      });
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [checkStatesByType]);

  // 提取搜索函数，以便在重试时调用
  const searchPansou = useCallback(async () => {
    const currentKeyword = keyword.trim();
    if (!currentKeyword) {
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch('/api/pansou/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keyword: currentKeyword,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '搜索失败');
      }

      const data: PansouSearchResult = await response.json();
      setResults(data);
    } catch (err: any) {
      const errorMsg = err.message || '搜索失败，请检查配置';
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [keyword, onError]);

  useEffect(() => {
    // triggerSearch 变化时触发搜索（无论是 true 还是 false）
    if (triggerSearch === undefined) {
      return;
    }

    searchPansou();
  }, [triggerSearch]); // 只在触发标志变化时搜索，避免 keyword 变化自动搜索

  const handleCopy = async (text: string, url: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  const handleOpenLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleQuarkTransfer = async (link: PansouLink) => {
    try {
      setTransferingUrl(link.url);
      const response = await fetch('/api/netdisk/quark/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shareUrl: link.url,
          passcode: link.password || '',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '转存失败');
      }

      setToast({
        message: `转存成功，已保存到：${data.targetPath}`,
        type: 'success',
        onClose: () => setToast(null),
      });
    } catch (err: any) {
      setToast({
        message: err?.message || '转存失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    } finally {
      setTransferingUrl(null);
    }
  };

  const handleNetdiskInstantPlay = async (
    cloudType: string,
    link: PansouLink
  ) => {
    try {
      setPlayingUrl(link.url);
      const instantPlayApi =
        cloudType === 'mobile'
          ? '/api/netdisk/mobile/instant-play'
          : cloudType === 'baidu'
          ? '/api/netdisk/baidu/instant-play'
          : cloudType === 'tianyi'
          ? '/api/netdisk/tianyi/instant-play'
          : cloudType === '115'
          ? '/api/netdisk/115/instant-play'
          : cloudType === 'uc'
          ? '/api/netdisk/uc/instant-play'
          : cloudType === '123'
          ? '/api/netdisk/123/instant-play'
          : '/api/netdisk/quark/instant-play';
      const response = await fetch(instantPlayApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shareUrl: link.url,
          passcode: link.password || '',
          title: keyword,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '播放失败');
      }

      router.push(
        `/play?source=${encodeURIComponent(
          data.source ||
            (cloudType === 'mobile'
              ? 'netdisk-mobile'
              : cloudType === 'baidu'
              ? 'netdisk-baidu'
              : cloudType === 'tianyi'
              ? 'netdisk-tianyi'
              : cloudType === '115'
              ? 'netdisk-115'
              : cloudType === 'uc'
              ? 'netdisk-uc'
              : cloudType === '123'
              ? 'netdisk-123'
              : 'netdisk-quark')
        )}&id=${encodeURIComponent(data.id)}&title=${encodeURIComponent(
          keyword
        )}`
      );
    } catch (err: any) {
      setToast({
        message: err?.message || '播放失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    } finally {
      setPlayingUrl(null);
    }
  };

  const handleStartCheck = async (cloudType: string, links: PansouLink[]) => {
    try {
      const platform = CLOUD_TYPE_TO_CHECK_PLATFORM[cloudType];
      if (!platform) {
        throw new Error('当前网盘类型暂不支持有效性检测');
      }
      const response = await fetch('/api/netdisk/check/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform,
          links: links.map((item) => item.url),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '启动检测失败');
      }
      setCheckStatesByType((prev) => ({
        ...prev,
        [cloudType]: {
          taskId: data.taskId,
          task: data.task,
        },
      }));
      setCooldownRemainingMs(Number(data.cooldownRemainingMs || 0));
    } catch (err: any) {
      setToast({
        message: err?.message || '启动检测失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    }
  };

  const handleCancelCheck = async (cloudType: string) => {
    const state = checkStatesByType[cloudType];
    if (!state?.taskId) return;
    try {
      const response = await fetch('/api/netdisk/check/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId: state.taskId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '停止检测失败');
      }
      setCheckStatesByType((prev) => ({
        ...prev,
        [cloudType]: {
          taskId: state.taskId,
          task: data.task,
        },
      }));
    } catch (err: any) {
      setToast({
        message: err?.message || '停止检测失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    }
  };

  const getCloudCheckState = (cloudType: string) => {
    return checkStatesByType[cloudType]?.task || null;
  };

  // 网盘类型选项卡横向拖动滚动
  const handleTypeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!typeScrollContainerRef.current) return;
    isTypeDraggingRef.current = true;
    typeDragStartXRef.current =
      e.pageX - typeScrollContainerRef.current.offsetLeft;
    typeDragScrollLeftRef.current = typeScrollContainerRef.current.scrollLeft;
    typeScrollContainerRef.current.style.cursor = 'grabbing';
    typeScrollContainerRef.current.style.userSelect = 'none';
  };

  const handleTypeMouseLeave = () => {
    if (!typeScrollContainerRef.current) return;
    isTypeDraggingRef.current = false;
    typeScrollContainerRef.current.style.cursor = 'grab';
    typeScrollContainerRef.current.style.userSelect = 'auto';
  };

  const handleTypeMouseUp = () => {
    if (!typeScrollContainerRef.current) return;
    isTypeDraggingRef.current = false;
    typeScrollContainerRef.current.style.cursor = 'grab';
    typeScrollContainerRef.current.style.userSelect = 'auto';
  };

  const handleTypeMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTypeDraggingRef.current || !typeScrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - typeScrollContainerRef.current.offsetLeft;
    const walk = (x - typeDragStartXRef.current) * 2;
    typeScrollContainerRef.current.scrollLeft =
      typeDragScrollLeftRef.current - walk;
  };

  const getCheckResultForUrl = (cloudType: string, url: string) => {
    const task = getCloudCheckState(cloudType);
    return task?.results?.[url] || null;
  };

  const getSortedLinks = (cloudType: string, links: PansouLink[]) => {
    return links
      .map((link, index) => ({
        link,
        index,
        checkResult: getCheckResultForUrl(cloudType, link.url),
      }))
      .sort((a, b) => {
        const aInvalid = a.checkResult?.status === 'invalid' ? 1 : 0;
        const bInvalid = b.checkResult?.status === 'invalid' ? 1 : 0;
        if (aInvalid !== bInvalid) {
          return aInvalid - bInvalid;
        }
        return a.index - b.index;
      })
      .map(({ link }) => link);
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className='flex items-center justify-center py-12'>
          <div className='text-center'>
            <Loader2 className='mx-auto h-8 w-8 animate-spin text-green-600 dark:text-green-400' />
            <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
              正在搜索网盘资源...
            </p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className='flex items-center justify-center py-12'>
          <div className='text-center'>
            <AlertCircle className='mx-auto h-12 w-12 text-red-500 dark:text-red-400' />
            <p className='mt-4 text-sm text-red-600 dark:text-red-400'>
              {error}
            </p>
            <button
              onClick={searchPansou}
              className='mt-4 inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors'
            >
              <RefreshCw className='h-4 w-4' />
              重试
            </button>
          </div>
        </div>
      );
    }

    if (!results || results.total === 0 || !results.merged_by_type) {
      return (
        <div className='flex items-center justify-center py-12'>
          <div className='text-center'>
            <AlertCircle className='mx-auto h-12 w-12 text-gray-400 dark:text-gray-600' />
            <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
              未找到相关资源
            </p>
          </div>
        </div>
      );
    }

    const cloudTypes = Object.keys(results.merged_by_type || {});

    // 过滤显示的网盘类型
    const filteredCloudTypes =
      selectedType === 'all'
        ? cloudTypes
        : cloudTypes.filter((type) => type === selectedType);

    // 计算每种网盘类型的数量
    const typeStats = cloudTypes.map((type) => ({
      type,
      count: results.merged_by_type?.[type]?.length || 0,
    }));

    return (
      <>
        {/* 搜索结果统计 */}
        <div className='text-sm text-gray-600 dark:text-gray-400'>
          找到{' '}
          <span className='font-semibold text-green-600 dark:text-green-400'>
            {results.total}
          </span>{' '}
          个资源
        </div>

        {/* 网盘类型过滤器 */}
        <div className='space-y-2'>
          <h3 className='text-sm font-semibold text-gray-700 dark:text-gray-200'>
            网盘类型
          </h3>
          <div className='relative'>
            <div
              ref={typeScrollContainerRef}
              className='overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing'
              onMouseDown={handleTypeMouseDown}
              onMouseLeave={handleTypeMouseLeave}
              onMouseUp={handleTypeMouseUp}
              onMouseMove={handleTypeMouseMove}
            >
              <div className='flex gap-2 min-w-min'>
                <button
                  onClick={() => setSelectedType('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                    selectedType === 'all'
                      ? 'bg-green-600 text-white dark:bg-green-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  全部 ({results.total})
                </button>
                {typeStats.map(({ type, count }) => {
                  const typeName = CLOUD_TYPE_NAMES[type] || type;

                  return (
                    <button
                      key={type}
                      onClick={() => setSelectedType(type)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                        selectedType === type
                          ? 'bg-green-600 text-white dark:bg-green-600'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      {typeName} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 按网盘类型分类显示 */}
        {filteredCloudTypes.map((cloudType) => {
          const links = results.merged_by_type?.[cloudType];
          if (!links || links.length === 0) return null;
          const sortedLinks = getSortedLinks(cloudType, links);

          const typeName = CLOUD_TYPE_NAMES[cloudType] || cloudType;
          const typeColor =
            CLOUD_TYPE_COLORS[cloudType] || CLOUD_TYPE_COLORS.others;
          const checkable = CHECKABLE_CLOUD_TYPES.has(cloudType);
          const cloudCheckTask = getCloudCheckState(cloudType);
          const isCheckingThisType = cloudCheckTask?.status === 'running';
          const groupProgress = cloudCheckTask?.progress || null;

          return (
            <div key={cloudType} className='space-y-3'>
              {/* 网盘类型标题 */}
              <div className='flex flex-wrap items-center gap-2'>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${typeColor}`}
                >
                  {typeName}
                </span>
                <span className='text-xs text-gray-500 dark:text-gray-400'>
                  {links.length} 个链接
                </span>
                {groupProgress && (
                  <span className='text-xs text-gray-500 dark:text-gray-400'>
                    进度 {groupProgress.done}/{groupProgress.total} · 有效{' '}
                    {groupProgress.valid} · 失效 {groupProgress.invalid} · 未知{' '}
                    {groupProgress.unknown + groupProgress.rateLimited}
                  </span>
                )}
                {checkable && (
                  <>
                    <button
                      onClick={() => handleStartCheck(cloudType, links)}
                      disabled={isCheckingThisType}
                      className='px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs transition-colors disabled:opacity-60'
                    >
                      {cloudCheckTask
                        ? cloudCheckTask.status === 'running'
                          ? '检测中...'
                          : '重新检测'
                        : '有效性检测'}
                    </button>
                    {isCheckingThisType && (
                      <button
                        onClick={() => handleCancelCheck(cloudType)}
                        className='px-3 py-1 rounded-md bg-gray-600 hover:bg-gray-700 text-white text-xs transition-colors'
                      >
                        停止检测
                      </button>
                    )}
                  </>
                )}
                {cooldownRemainingMs > 0 && (
                  <span className='text-xs text-orange-600 dark:text-orange-400'>
                    冷却中 {Math.ceil(cooldownRemainingMs / 1000)}s
                  </span>
                )}
              </div>

              {/* 链接列表 */}
              <div className='space-y-2'>
                {sortedLinks.map((link: PansouLink, index: number) => (
                  <div
                    key={`${cloudType}-${index}`}
                    className='p-4 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-green-400 dark:hover:border-green-600 transition-colors'
                  >
                    {/* 资源标题 */}
                    {link.note && (
                      <div className='mb-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {link.note}
                      </div>
                    )}

                    {/* 链接和密码 */}
                    <div className='flex items-center gap-2 mb-2'>
                      <div className='flex-1 min-w-0'>
                        <div className='text-xs text-gray-600 dark:text-gray-400 truncate'>
                          {link.url}
                        </div>
                        {link.password && (
                          <div className='text-xs text-gray-600 dark:text-gray-400 mt-1'>
                            提取码:{' '}
                            <span className='font-mono font-semibold'>
                              {link.password}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 操作按钮 */}
                      <div className='flex items-center gap-1 flex-shrink-0'>
                        {(() => {
                          const checkResult = getCheckResultForUrl(
                            cloudType,
                            link.url
                          );
                          if (!checkResult) return null;
                          return (
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                CHECK_STATUS_STYLE[checkResult.status]
                              }`}
                              title={
                                checkResult.reason ||
                                CHECK_STATUS_TEXT[checkResult.status]
                              }
                            >
                              {CHECK_STATUS_TEXT[checkResult.status]}
                            </span>
                          );
                        })()}
                        {(cloudType === 'quark' ||
                          cloudType === 'mobile' ||
                          cloudType === 'baidu' ||
                          cloudType === 'tianyi' ||
                          cloudType === '123' ||
                          cloudType === 'uc' ||
                          cloudType === '115') && (
                          <>
                            <button
                              onClick={() =>
                                handleNetdiskInstantPlay(cloudType, link)
                              }
                              disabled={playingUrl === link.url}
                              className='px-2 py-1 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs transition-colors disabled:opacity-60'
                              title='播放'
                            >
                              {playingUrl === link.url ? '处理中...' : '播放'}
                            </button>
                            {cloudType === 'quark' && (
                              <button
                                onClick={() => handleQuarkTransfer(link)}
                                disabled={transferingUrl === link.url}
                                className='px-2 py-1 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs transition-colors disabled:opacity-60'
                                title='转存到配置目录'
                              >
                                {transferingUrl === link.url
                                  ? '转存中...'
                                  : '转存'}
                              </button>
                            )}
                          </>
                        )}
                        <button
                          onClick={() =>
                            handleCopy(
                              link.password
                                ? `${link.url}\n提取码: ${link.password}`
                                : link.url,
                              link.url
                            )
                          }
                          className='p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                          title='复制链接'
                        >
                          {copiedUrl === link.url ? (
                            <span className='text-xs text-green-600 dark:text-green-400'>
                              已复制
                            </span>
                          ) : (
                            <Copy className='h-4 w-4 text-gray-600 dark:text-gray-400' />
                          )}
                        </button>
                        <button
                          onClick={() => handleOpenLink(link.url)}
                          className='p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                          title='打开链接'
                        >
                          <ExternalLink className='h-4 w-4 text-gray-600 dark:text-gray-400' />
                        </button>
                      </div>
                    </div>

                    {/* 来源和时间 */}
                    <div className='flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400'>
                      {link.source && <span>来源: {link.source}</span>}
                      {link.datetime && (
                        <span>
                          {new Date(link.datetime).toLocaleDateString()}
                        </span>
                      )}
                      {(() => {
                        const checkResult = getCheckResultForUrl(
                          cloudType,
                          link.url
                        );
                        if (!checkResult?.reason) return null;
                        return (
                          <span className='truncate'>
                            检测结果: {checkResult.reason}
                          </span>
                        );
                      })()}
                    </div>

                    {/* 图片预览 */}
                    {link.images && link.images.length > 0 && (
                      <div className='mt-3 flex gap-2 overflow-x-auto'>
                        {link.images.map((img, imgIndex) => (
                          <img
                            key={imgIndex}
                            src={img}
                            alt=''
                            className='h-20 w-auto rounded object-cover'
                            loading='lazy'
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <>
      <div className='space-y-6'>{renderBody()}</div>
      {toast && <Toast {...toast} />}
    </>
  );
}
