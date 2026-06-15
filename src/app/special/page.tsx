'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import {
  isSpecialSourcesEnabledOnDevice,
  setSpecialSourcesEnabledOnDevice,
} from '@/lib/special-source.client';

function SpecialPageClient() {
  const searchParams = useSearchParams();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const enableParam = searchParams.get('enable');
    if (enableParam === '1' || enableParam === 'true') {
      setSpecialSourcesEnabledOnDevice(true);
    } else if (enableParam === '0' || enableParam === 'false') {
      setSpecialSourcesEnabledOnDevice(false);
    }

    setEnabled(isSpecialSourcesEnabledOnDevice());
    setReady(true);
  }, [searchParams]);

  const updateEnabled = (next: boolean) => {
    setSpecialSourcesEnabledOnDevice(next);
    setEnabled(next);
  };

  return (
    <main className='min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-slate-100'>
      <section className='mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10'>
        <div className='w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950 sm:p-8'>
          <div className='space-y-3'>
            <h1 className='text-2xl font-semibold tracking-tight text-gray-900 dark:text-white'>
              特殊源
            </h1>
            <p className='text-sm leading-6 text-gray-600 dark:text-slate-400'>
              开启后，将能搜索到特殊源的视频。
            </p>
          </div>

          <div className='mt-8 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.03] p-4'>
            <div>
              <div className='text-sm text-gray-600 dark:text-slate-400'>当前状态</div>
              <div className='mt-1 text-lg font-medium text-gray-900 dark:text-white'>
                {ready ? (enabled ? '已开启' : '已关闭') : '读取中'}
              </div>
            </div>

            <button
              type='button'
              onClick={() => updateEnabled(!enabled)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full p-1 transition focus:outline-none focus:ring-2 focus:ring-rose-400 ${
                enabled ? 'bg-rose-600' : 'bg-gray-300 dark:bg-slate-700'
              }`}
              aria-pressed={enabled}
              aria-label={enabled ? '关闭特殊源' : '开启特殊源'}
            >
              <span
                className={`h-6 w-6 rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <p className='mt-4 text-xs leading-5 text-gray-500 dark:text-slate-500'>
            此开关对 TVBox、OrionTV、WebTV 渠道无效，特殊源始终无法使用特殊源。
          </p>

          <div className='mt-8 flex flex-col gap-3 sm:flex-row'>
            <Link
              href='/search'
              className='inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400'
            >
              <Search className='h-4 w-4' />
              前往搜索
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function SpecialPage() {
  return (
    <Suspense fallback={null}>
      <SpecialPageClient />
    </Suspense>
  );
}
