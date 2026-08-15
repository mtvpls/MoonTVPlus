'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import {
  getSpecialSourcePathOnDevice,
  normalizeSpecialSourcePath,
  setSpecialSourcePathOnDevice,
} from '@/lib/special-source.client';

/**
 * /sp 页面的自定义入口路径设置。
 * 本机设置：只写 cookie，middleware 会把这个路径重定向到 /r18；只影响自己这台设备/浏览器。
 */
export default function SpecialSourcePathForm({
  initialPath,
}: {
  initialPath: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialPath);
  const [saved, setSaved] = useState(initialPath);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const inputId = useId();

  // cookie 才是真相：服务端渲染的那份可能来自路由缓存里的旧快照
  useEffect(() => {
    const current = getSpecialSourcePathOnDevice();
    setValue(current);
    setSaved(current);
  }, [initialPath]);

  const handleSave = () => {
    const normalized = normalizeSpecialSourcePath(value);
    if (!normalized) {
      setOk(false);
      setMsg('路径不可用：只能用字母数字和 - _ /，且不能与现有页面冲突');
      return;
    }
    setSpecialSourcePathOnDevice(normalized);
    setValue(normalized);
    setSaved(normalized);
    setOk(true);
    setMsg(`已生效：访问 ${normalized} 即可进入里世界`);
    router.refresh();
  };

  const handleClear = () => {
    setSpecialSourcePathOnDevice('');
    setValue('');
    setSaved('');
    setOk(true);
    setMsg('已清除，仅保留默认入口 /r18');
    router.refresh();
  };

  return (
    <div className='mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/[0.03]'>
      <label
        htmlFor={inputId}
        className='block text-sm font-medium text-gray-700 dark:text-slate-300'
      >
        自定义入口路径
      </label>
      <p className='mt-1 text-xs leading-5 text-gray-500 dark:text-slate-500'>
        默认入口是 /r18。填一个自己的路径（如 /anime），保存后在本机访问它会跳转到 /r18；
        /r18 仍然可用。此设置存在本机 cookie 里，只影响当前设备。
      </p>
      <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
        <input
          id={inputId}
          type='text'
          value={value}
          spellCheck={false}
          autoComplete='off'
          placeholder='/anime'
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className='flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400 dark:border-white/10 dark:bg-zinc-900 dark:text-slate-100'
        />
        <button
          type='button'
          onClick={handleSave}
          className='rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400'
        >
          保存
        </button>
        {saved && (
          <button
            type='button'
            onClick={handleClear}
            className='rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.06]'
          >
            清除
          </button>
        )}
      </div>
      {msg && (
        <p
          aria-live='polite'
          className={`mt-2 text-xs leading-5 ${
            ok
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}
