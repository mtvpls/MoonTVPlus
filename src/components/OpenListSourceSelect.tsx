'use client';

import { useEffect, useState } from 'react';

interface OpenListSourceSelectProps {
  /** 选中的源名，空字符串表示「跟随离线下载目录」 */
  value: string;
  onChange: (value: string) => void;
}

/**
 * 「存到私人影库」弹窗里的临时目标源下拉框。
 * 从 /api/openlist/sources 拉取源名列表；只有一个源（或未配置）时不渲染。
 */
export default function OpenListSourceSelect({
  value,
  onChange,
}: OpenListSourceSelectProps) {
  const [sources, setSources] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/openlist/sources')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.sources)) {
          setSources(data.sources);
        }
      })
      .catch(() => {
        // 拉取失败时不显示下拉框，后端仍按默认源处理
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 一个源都没有（OpenList 未配置或未填完账号密码）时不渲染
  if (sources.length === 0) return null;

  return (
    <>
      <label className='mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300'>
        目标 OpenList 源
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className='mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500'
      >
        <option value=''>默认（跟随离线下载目录）</option>
        {sources.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </>
  );
}
