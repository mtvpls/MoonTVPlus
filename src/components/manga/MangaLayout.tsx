'use client';

import { BookOpen, ChevronLeft, Compass, History, List, Search, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UpdateNotification } from '@/components/UpdateNotification';
import { UserMenu } from '@/components/UserMenu';

interface MangaLayoutProps {
  children: React.ReactNode;
}

const sectionTabs = [
  { href: '/manga', label: '推荐', icon: Compass },
  { href: '/manga/search', label: '搜索', icon: Search },
  { href: '/manga/shelf', label: '书架', icon: BookOpen },
  { href: '/manga/history', label: '历史', icon: History },
];

function getMeta(pathname: string, searchParams: ReturnType<typeof useSearchParams>) {
  if (pathname === '/manga/shelf') {
    return { title: '漫画书架', subtitle: '集中管理收藏的漫画' };
  }
  if (pathname === '/manga/history') {
    return { title: '漫画历史', subtitle: '从上次阅读的位置继续' };
  }
  if (pathname === '/manga/search') {
    return { title: '漫画搜索', subtitle: '按标题和来源搜索漫画' };
  }
  if (pathname === '/manga/detail') {
    return {
      title: searchParams.get('title') || '漫画详情',
      subtitle: searchParams.get('sourceName') || '漫画详情',
      backHref: searchParams.get('returnTo') || '/manga',
    };
  }
  if (pathname === '/manga/read') {
    const mangaId = searchParams.get('mangaId') || '';
    const sourceId = searchParams.get('sourceId') || '';
    const title = searchParams.get('title') || '漫画阅读';
    const cover = searchParams.get('cover') || '';
    const sourceName = searchParams.get('sourceName') || sourceId;
    const returnTo = searchParams.get('returnTo') || '/manga';
    return {
      title,
      subtitle: searchParams.get('chapterName') || '章节',
      backHref: `/manga/detail?mangaId=${encodeURIComponent(mangaId)}&sourceId=${encodeURIComponent(sourceId)}&title=${encodeURIComponent(title)}&cover=${encodeURIComponent(cover)}&sourceName=${encodeURIComponent(sourceName)}&returnTo=${encodeURIComponent(returnTo)}`,
    };
  }
  return { title: '漫画推荐', subtitle: '按来源查看热门与最新漫画' };
}

export default function MangaLayout({ children }: MangaLayoutProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const meta = getMeta(pathname, searchParams);
  const isReadingPage = pathname === '/manga/read';

  const isActive = (href: string) => pathname === href;

  return (
    <div className='min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100'>
      <header className='fixed inset-x-0 top-0 z-[999] border-b border-gray-200/70 bg-white/85 backdrop-blur-xl shadow-sm dark:border-gray-800/80 dark:bg-gray-950/85'>
        <div className='mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:h-16 sm:px-6'>
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            {meta.backHref ? (
              <Link
                href={meta.backHref}
                className='flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-sky-600 dark:text-gray-300 dark:hover:bg-gray-800'
              >
                <ChevronLeft className='h-5 w-5' />
              </Link>
            ) : (
              <Link
                href='/'
                className='flex h-10 items-center rounded-full px-3 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 dark:hover:bg-sky-950/40'
              >
                {siteName}
              </Link>
            )}
            <div className='min-w-0'>
              <div className='group relative'>
                <div className='truncate text-sm font-semibold sm:text-base'>{meta.title}</div>
                <div className='absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-3 py-2 bg-gray-800 dark:bg-gray-900 text-white text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-out z-[100] pointer-events-none w-max max-w-[85vw] whitespace-normal break-words text-center sm:max-w-none sm:whitespace-nowrap'>
                  <div className='text-sm'>{meta.title}</div>
                </div>
              </div>
              {meta.subtitle && (
                <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                  {meta.subtitle}
                </div>
              )}
            </div>
          </div>

          <nav className='ml-auto hidden items-center gap-2 lg:flex'>
            {sectionTabs.map((tab) => {
              const Icon = tab.icon;
              const active = isActive(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                    active
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-sky-600 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className='h-4 w-4' />
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          <div className={`${isReadingPage ? 'ml-auto flex shrink-0' : 'ml-auto hidden md:flex'} items-center gap-2`}>
            {isReadingPage ? (
              <>
                <button
                  type='button'
                  className='inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-sky-600 dark:text-gray-300 dark:hover:bg-gray-800'
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('manga-read-toggle-chapters'));
                  }}
                  aria-label='章节列表'
                >
                  <List className='h-5 w-5' />
                </button>
                <button
                  type='button'
                  className='inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-sky-600 dark:text-gray-300 dark:hover:bg-gray-800'
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('manga-read-toggle-settings'));
                  }}
                  aria-label='阅读设置'
                >
                  <Settings2 className='h-5 w-5' />
                </button>
              </>
            ) : (
              <>
                <ThemeToggle />
                <UserMenu />
                <UpdateNotification />
              </>
            )}
          </div>
        </div>
      </header>

      <main
        className={`mx-auto max-w-7xl pt-20 sm:pt-24 ${
          isReadingPage
            ? 'px-0 pb-24 sm:px-0 sm:pb-28 lg:pb-10'
            : 'px-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-10'
        }`}
      >
        {children}
      </main>

      {!isReadingPage && (
        <nav
          className='fixed inset-x-0 bottom-0 z-[998] border-t border-gray-200/70 bg-white/92 backdrop-blur-xl dark:border-gray-800/80 dark:bg-gray-950/92 lg:hidden'
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className='mx-auto grid max-w-3xl grid-cols-4'>
            {sectionTabs.map((tab) => {
              const Icon = tab.icon;
              const active = isActive(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className='flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-xs'
                >
                  <Icon
                    className={`h-5 w-5 ${
                      active ? 'text-sky-600 dark:text-sky-400' : 'text-gray-500 dark:text-gray-400'
                    }`}
                  />
                  <span
                    className={
                      active ? 'text-sky-600 dark:text-sky-400' : 'text-gray-600 dark:text-gray-300'
                    }
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
