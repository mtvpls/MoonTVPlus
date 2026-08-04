import { Search } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';

import { getConfig } from '@/lib/config';
import { SPECIAL_SOURCE_COOKIE } from '@/lib/special-source.client';

import SpecialSourceToggle from './SpecialSourceToggle';

export const dynamic = 'force-dynamic';

/**
 * 特殊源入口说明页（/sp）。
 * 开关是本机开关（cookie），任何用户都能自己打开，只对自己这台设备生效。
 */
export default async function SpecialPage() {
  const config = await getConfig();
  const enabled = cookies().get(SPECIAL_SOURCE_COOKIE)?.value === '1';
  const specialCount = (config.SpecialSourceApis || []).length;

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
                本机状态
              </div>
              <div className='mt-1 text-lg font-medium text-gray-900 dark:text-white'>
                {enabled ? '已开启' : '已关闭'}
              </div>
              <div className='mt-1 text-xs text-gray-500 dark:text-slate-500'>
                已标记特殊源 {specialCount} 个
              </div>
            </div>

            <SpecialSourceToggle initialEnabled={enabled} />
          </div>

          {specialCount === 0 && (
            <p className='mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'>
              没有任何采集源被标记为特殊源，此时普通搜索不会屏蔽任何源。请在后台
              「视频源管理 → 特殊源设置」勾选，或在配置文件里补上
              <code className='mx-1'>special_source_apis</code>
              后重新保存配置文件。
            </p>
          )}

          <p className='mt-4 text-xs leading-5 text-gray-500 dark:text-slate-500'>
            这是本机开关（存在 cookie 里），谁打开谁能用，只影响当前设备与浏览器，
            不改动站点配置。关闭后 /r18 返回 404，特殊源的收藏与播放记录也不会出现在
            普通入口——记录仍在，重新打开即可看到。此开关对 TVBox、OrionTV、WebTV
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
                title='请先打开上方开关'
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
