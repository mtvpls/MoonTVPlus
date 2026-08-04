import { Search } from 'lucide-react';
import Link from 'next/link';

import { getConfig } from '@/lib/config';

import SpecialSourceToggle from './SpecialSourceToggle';

export const dynamic = 'force-dynamic';

/**
 * 特殊源入口说明页（/sp）。
 * 开关是站点级配置（等同后台「站点配置 → 开启特殊源入口」），
 * 管理员可以直接在这一页切换，普通用户只看到状态。
 */
export default async function SpecialPage() {
  const config = await getConfig();
  const enabled = !!config.SiteConfig.EnableSpecialSources;

  return (
    <main className='min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-slate-100'>
      <section className='mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10'>
        <div className='w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950 sm:p-8'>
          <div className='space-y-3'>
            <h1 className='text-2xl font-semibold tracking-tight text-gray-900 dark:text-white'>
              特殊源
            </h1>
            <p className='text-sm leading-6 text-gray-600 dark:text-slate-400'>
              特殊源只在 /r18 路径下可用，普通搜索不会出现特殊源的内容；/r18
              路径下也不会出现普通源的内容。
            </p>
          </div>

          <div className='mt-8 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/[0.03]'>
            <div>
              <div className='text-sm text-gray-600 dark:text-slate-400'>
                当前状态
              </div>
              <div className='mt-1 text-lg font-medium text-gray-900 dark:text-white'>
                {enabled ? '已开启' : '已关闭'}
              </div>
            </div>

            <SpecialSourceToggle initialEnabled={enabled} />
          </div>

          <p className='mt-4 text-xs leading-5 text-gray-500 dark:text-slate-500'>
            该开关仅管理员可切换（等同后台「站点配置 → 开启特殊源入口」）。关闭时
            /r18 返回 404，特殊源完全不可用。此开关对 TVBox、OrionTV、WebTV
            渠道无效，这些渠道始终无法使用特殊源。
          </p>

          <div className='mt-8 flex flex-col gap-3 sm:flex-row'>
            {enabled ? (
              <Link
                href='/r18'
                className='inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400'
              >
                <Search className='h-4 w-4' />
                前往里世界
              </Link>
            ) : (
              <button
                type='button'
                disabled
                aria-disabled='true'
                title='该功能未开启，请联系管理员在后台开启'
                className='inline-flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-gray-200 px-4 py-3 text-sm font-medium text-gray-400 opacity-60 dark:bg-white/10 dark:text-slate-500'
              >
                <Search className='h-4 w-4' />
                前往里世界
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
