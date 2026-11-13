'use client';

import {
  BookOpen,
  Headphones,
  History,
  Library,
  List,
  MoreVertical,
  Search,
  Settings2,
} from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import {
  LIBRARY_FOCUS,
  LIBRARY_ICON_BUTTON_GHOST,
  LIBRARY_MENU_ITEM,
  LIBRARY_PANEL,
} from '@/components/media/library';
import MediaShell, { MediaShellTab } from '@/components/media/MediaShell';
import { useSite } from '@/components/SiteProvider';

const tabs: MediaShellTab[] = [
  { href: '/books', label: '发现', icon: Library },
  { href: '/books/search', label: '搜索', icon: Search },
  { href: '/books/shelf', label: '书架', icon: BookOpen },
  { href: '/books/history', label: '历史', icon: History },
];

// 阅读页内容区样式：保持改造前的原值，仅把移动端顶栏高度对齐到外壳统一的 h-14
// （阅读页自身按 calc(100vh-3.5rem) 计算高度，原先桌面端 h-16 会多出 0.5rem）。
// max-w-6xl 经 cn() 覆盖外壳默认的 max-w-7xl，避免 /books/read 布局回归。
const READER_MAIN_CLASS =
  'max-w-6xl pt-[calc(3.5rem+var(--safe-top))] sm:pt-[calc(4rem+var(--safe-top))]';

type ReadHeaderPayload = {
  title?: string;
  subtitle?: string;
  backHref?: string;
};

function getStaticMeta(pathname: string) {
  if (pathname === '/books/shelf')
    return { title: '电子书书架', subtitle: '集中管理收藏的电子书' };
  if (pathname === '/books/history')
    return { title: '阅读历史', subtitle: '从上次阅读的位置继续' };
  if (pathname === '/books/search')
    return { title: '电子书搜索', subtitle: '按书名与作者搜索' };
  if (pathname === '/books/detail')
    return { title: '电子书详情', subtitle: '查看书籍信息与可用格式' };
  if (pathname === '/books/read')
    return { title: '电子书阅读', subtitle: '分页阅读', backHref: '/books' };
  return { title: '电子书馆' };
}

export default function BooksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    window.addEventListener(
      'books-read-update-header',
      handleUpdate as EventListener
    );
    return () => {
      window.removeEventListener(
        'books-read-update-header',
        handleUpdate as EventListener
      );
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
        backHref:
          readHeader?.backHref ||
          `/books/detail?sourceId=${encodeURIComponent(
            searchParams.get('sourceId') || ''
          )}&bookId=${encodeURIComponent(searchParams.get('bookId') || '')}`,
      };
    }
    return base;
  }, [pathname, searchParams, isRead, readHeader]);

  const iconButtonClass = cn(LIBRARY_ICON_BUTTON_GHOST, LIBRARY_FOCUS);

  const readerActions = (
    <>
      <button
        type='button'
        onClick={() =>
          window.dispatchEvent(new CustomEvent('books-read-toggle-chapters'))
        }
        className={iconButtonClass}
        aria-label='目录'
      >
        <List className='h-5 w-5' />
      </button>
      <div className='relative' ref={readMenuRef}>
        <button
          type='button'
          onClick={() => setReadMenuOpen((prev) => !prev)}
          className={iconButtonClass}
          aria-label='更多'
          aria-expanded={readMenuOpen}
        >
          <MoreVertical className='h-5 w-5' />
        </button>
        {readMenuOpen ? (
          <div
            className={cn(
              LIBRARY_PANEL,
              'absolute right-0 top-12 z-50 min-w-[9rem] overflow-hidden py-1 shadow-lg'
            )}
          >
            <button
              type='button'
              onClick={() => {
                setReadMenuOpen(false);
                window.dispatchEvent(
                  new CustomEvent('books-read-toggle-settings')
                );
              }}
              className={LIBRARY_MENU_ITEM}
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
              className={LIBRARY_MENU_ITEM}
            >
              <Headphones className='h-4 w-4' />
              听书
            </button>
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <MediaShell
      siteName={siteName}
      title={meta.title}
      subtitle={meta.subtitle}
      backHref={meta.backHref}
      tabs={tabs}
      reader={
        isRead
          ? { actions: readerActions, mainClassName: READER_MAIN_CLASS }
          : undefined
      }
    >
      {children}
    </MediaShell>
  );
}
