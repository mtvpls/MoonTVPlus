'use client';

import { BookOpen, ChevronLeft, Headphones, History, Library, List, MoreVertical, Search, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSite } from '@/components/SiteProvider';

const tabs = [
  { href: '/books', label: '发现', icon: Library },
  { href: '/books/search', label: '搜索', icon: Search },
  { href: '/books/shelf', label: '书架', icon: BookOpen },
  { href: '/books/history', label: '历史', icon: History },
];

type ReadHeaderPayload = {
  title?: string;
  subtitle?: string;
  backHref?: string;
};

function getStaticMeta(pathname: string) {
  if (pathname === '/books/shelf') return { title: '电子书书架', subtitle: '集中管理收藏的电子书' };
  if (pathname === '/books/history') return { title: '阅读历史', subtitle: '从上次阅读的位置继续' };
  if (pathname === '/books/search') return { title: '电子书搜索', subtitle: '按书名与作者搜索' };
  if (pathname === '/books/detail') return { title: '电子书详情', subtitle: '查看书籍信息与可用格式' };
  if (pathname === '/books/read') return { title: '电子书阅读', subtitle: '分页阅读', backHref: '/books' };
  return { title: '电子书馆', subtitle: 'OPDS 目录、搜索、阅读与书架' };
}

export default function BooksLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const isRead = pathname === '/books/read';
  const [readHeader, setReadHeader] = useState<ReadHeaderPayload | null>(null);
  const [readMenuOpen, setReadMenuOpen] = useState(false);
  const readMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isRead) return;
    const handleUpdate = (event: Event) => {
      const custom = event as CustomEvent<ReadHeaderPayload>;
      setReadHeader(custom.detail || null);
    };
    window.addEventListener('books-read-update-header', handleUpdate as EventListener);
    return () => {
      window.removeEventListener('books-read-update-header', handleUpdate as EventListener);
    };
  }, [isRead]);

  useEffect(() => {
    if (!isRead) setReadHeader(null);
  }, [isRead, pathname]);

  useEffect(() => {
    if (!readMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!readMenuRef.current?.contains(event.target as Node)) {
        setReadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [readMenuOpen]);

  const meta = useMemo(() => {
    const base = getStaticMeta(pathname);
    if (pathname === '/books/detail') {
      return {
        title: searchParams.get('title') || base.title,
        subtitle: searchParams.get('author') || base.subtitle,
        backHref: '/books',
      };
    }
    if (isRead) {
      return {
        title: readHeader?.title || base.title,
        subtitle: readHeader?.subtitle || base.subtitle,
        backHref: readHeader?.backHref || `/books/detail?sourceId=${encodeURIComponent(searchParams.get('sourceId') || '')}&bookId=${encodeURIComponent(searchParams.get('bookId') || '')}`,
      };
    }
    return base;
  }, [pathname, searchParams, isRead, readHeader]);

  return (
    <div className='min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100'>
      <header className='fixed inset-x-0 top-0 z-40 border-b border-gray-200/70 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-950/90'>
        <div className='mx-auto flex h-14 max-w-6xl items-center gap-3 px-4'>
          {isRead || pathname === '/books/detail' ? (
            <Link href={meta.backHref || '/books'} className='inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800'>
              <ChevronLeft className='h-5 w-5' />
            </Link>
          ) : (
            <Link href='/' className='text-sm font-semibold text-sky-600'>{siteName}</Link>
          )}
          <div className='min-w-0 flex-1'>
            <div className='group relative'>
              <div className='truncate text-sm font-semibold sm:text-base'>{meta.title}</div>
              <div className='absolute left-1/2 top-full z-[100] mt-2 w-max max-w-[85vw] -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-center text-sm text-white opacity-0 invisible shadow-xl transition-all duration-200 ease-out pointer-events-none group-hover:visible group-hover:opacity-100 dark:bg-gray-900'>
                <div className='max-w-[85vw] break-words whitespace-normal sm:max-w-none sm:whitespace-nowrap'>{meta.title}</div>
                {meta.subtitle ? <div className='mt-1 max-w-[85vw] break-words whitespace-normal text-xs text-gray-300 sm:max-w-none sm:whitespace-nowrap'>{meta.subtitle}</div> : null}
              </div>
            </div>
            <div className='truncate text-xs text-gray-500 dark:text-gray-400'>{meta.subtitle}</div>
          </div>
          {isRead ? (
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => window.dispatchEvent(new CustomEvent('books-read-toggle-chapters'))}
                className='inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800'
                aria-label='目录'
              >
                <List className='h-5 w-5' />
              </button>
              <div className='relative' ref={readMenuRef}>
                <button
                  type='button'
                  onClick={() => setReadMenuOpen((prev) => !prev)}
                  className='inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800'
                  aria-label='更多'
                >
                  <MoreVertical className='h-5 w-5' />
                </button>
                {readMenuOpen ? (
                  <div className='absolute right-0 top-12 z-50 min-w-[9rem] overflow-hidden rounded-2xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-800 dark:bg-gray-950'>
                    <button
                      type='button'
                      onClick={() => {
                        setReadMenuOpen(false);
                        window.dispatchEvent(new CustomEvent('books-read-toggle-settings'));
                      }}
                      className='flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900'
                    >
                      <Settings2 className='h-4 w-4' />
                      设置
                    </button>
                    <button
                      type='button'
                      onClick={() => {
                        setReadMenuOpen(false);
                        window.dispatchEvent(new CustomEvent('books-read-toggle-tts'));
                      }}
                      className='flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900'
                    >
                      <Headphones className='h-4 w-4' />
                      听书
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <nav className='hidden items-center gap-2 md:flex'>
              {tabs.map((tab) => {
                const active = pathname === tab.href;
                const Icon = tab.icon;
                return (
                  <Link key={tab.href} href={tab.href} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${active ? 'bg-sky-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
                    <Icon className='h-4 w-4' />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </header>
      <main className={`mx-auto max-w-6xl ${isRead ? 'pt-14' : 'px-4 pb-24 pt-20'}`}>{children}</main>
      {!isRead && (
        <nav className='fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-gray-200/70 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95 md:hidden'>
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link key={tab.href} href={tab.href} className='flex min-h-16 flex-col items-center justify-center gap-1 text-xs'>
                <Icon className={`h-5 w-5 ${active ? 'text-sky-600' : 'text-gray-500'}`} />
                <span className={active ? 'text-sky-600' : 'text-gray-600 dark:text-gray-300'}>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
