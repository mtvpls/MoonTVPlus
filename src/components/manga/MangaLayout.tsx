'use client';

import {
  BookOpen,
  Compass,
  History,
  List,
  Search,
  Settings2,
} from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/cn';

import {
  LIBRARY_FOCUS,
  LIBRARY_ICON_BUTTON_GHOST,
} from '@/components/media/library';
import MediaShell, { MediaShellTab } from '@/components/media/MediaShell';
import { useSite } from '@/components/SiteProvider';

const tabs: MediaShellTab[] = [
  { href: '/manga', label: '推荐', icon: Compass },
  { href: '/manga/search', label: '搜索', icon: Search },
  { href: '/manga/shelf', label: '书架', icon: BookOpen },
  { href: '/manga/history', label: '历史', icon: History },
];

// 阅读页内容区样式：保持改造前的原值，避免 /manga/read 布局回归
const READER_MAIN_CLASS =
  'pt-[calc(5rem+var(--safe-top))] sm:pt-[calc(6rem+var(--safe-top))] px-0 pb-24 sm:pb-28 lg:pb-10';

function getMeta(
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>
) {
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
      backHref: `/manga/detail?mangaId=${encodeURIComponent(
        mangaId
      )}&sourceId=${encodeURIComponent(sourceId)}&title=${encodeURIComponent(
        title
      )}&cover=${encodeURIComponent(cover)}&sourceName=${encodeURIComponent(
        sourceName
      )}&returnTo=${encodeURIComponent(returnTo)}`,
    };
  }
  return { title: '漫画推荐', subtitle: '按来源查看热门与最新漫画' };
}

export default function MangaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const meta = getMeta(pathname, searchParams);
  const isReadingPage = pathname === '/manga/read';

  const readerActions = (
    <>
      <button
        type='button'
        className={cn(LIBRARY_ICON_BUTTON_GHOST, LIBRARY_FOCUS)}
        onClick={() => {
          window.dispatchEvent(new CustomEvent('manga-read-toggle-chapters'));
        }}
        aria-label='章节列表'
      >
        <List className='h-5 w-5' />
      </button>
      <button
        type='button'
        className={cn(LIBRARY_ICON_BUTTON_GHOST, LIBRARY_FOCUS)}
        onClick={() => {
          window.dispatchEvent(new CustomEvent('manga-read-toggle-settings'));
        }}
        aria-label='阅读设置'
      >
        <Settings2 className='h-5 w-5' />
      </button>
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
        isReadingPage
          ? { actions: readerActions, mainClassName: READER_MAIN_CLASS }
          : undefined
      }
    >
      {children}
    </MediaShell>
  );
}
