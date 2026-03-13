/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
'use client';

import { AlertCircle, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PansouLink, PansouSearchResult } from '@/lib/pansou.client';

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

export default function PansouSearch({
  keyword,
  triggerSearch,
  onError,
}: PansouSearchProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PansouSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('all'); // 'all' 表示显示全部

  useEffect(() => {
    // triggerSearch 变化时触发搜索（无论是 true 还是 false）
    if (triggerSearch === undefined) {
      return;
    }

    const currentKeyword = keyword.trim();
    if (!currentKeyword) {
      return;
    }

    const searchPansou = async () => {
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
    };

    searchPansou();
  }, [triggerSearch, onError]); // 移除 keyword 依赖，只依赖 triggerSearch

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
          <p className='mt-4 text-sm text-red-600 dark:text-red-400'>{error}</p>
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
    <div className='space-y-6'>
      {/* 搜索结果统计 */}
      <div className='text-sm text-gray-600 dark:text-gray-400'>
        找到{' '}
        <span className='font-semibold text-green-600 dark:text-green-400'>
          {results.total}
        </span>{' '}
        个资源
      </div>

      {/* 网盘类型过滤器 */}
      <div className='flex flex-wrap gap-2'>
        <button
          onClick={() => setSelectedType('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedType === 'all'
              ? 'bg-green-600 text-white dark:bg-green-600'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
          }`}
        >
          全部 ({results.total})
        </button>
        {typeStats.map(({ type, count }) => {
          const typeName = CLOUD_TYPE_NAMES[type] || type;
          const typeColor = CLOUD_TYPE_COLORS[type] || CLOUD_TYPE_COLORS.others;

          return (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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

      {/* 按网盘类型分类显示 */}
      {filteredCloudTypes.map((cloudType) => {
        const links = results.merged_by_type?.[cloudType];
        if (!links || links.length === 0) return null;

        const typeName = CLOUD_TYPE_NAMES[cloudType] || cloudType;
        const typeColor =
          CLOUD_TYPE_COLORS[cloudType] || CLOUD_TYPE_COLORS.others;

        return (
          <div key={cloudType} className='space-y-3'>
            {/* 网盘类型标题 */}
            <div className='flex items-center gap-2'>
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${typeColor}`}
              >
                {typeName}
              </span>
              <span className='text-xs text-gray-500 dark:text-gray-400'>
                {links.length} 个链接
              </span>
            </div>

            {/* 链接列表 */}
            <div className='space-y-2'>
              {links.map((link: PansouLink, index: number) => (
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
                      <button
                        onClick={() =>
                          handleCopy(
                            link.password
                              ? `${link.url}\n提取码: ${link.password}`
                              : link.url,
                            link.url,
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
    </div>
  );
}
