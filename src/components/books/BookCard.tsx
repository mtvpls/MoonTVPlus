'use client';

import Link from 'next/link';

import { BookListItem } from '@/lib/book.types';

export default function BookCard({ item, href, extra, onNavigate }: { item: BookListItem; href: string; extra?: React.ReactNode; onNavigate?: () => void }) {
  return (
    <div className='overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950'>
      <Link href={href} onClick={onNavigate}>
        <div className='relative aspect-[3/4] bg-gray-100 dark:bg-gray-900'>
          {item.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.cover} alt={item.title} className='h-full w-full object-cover' />
          ) : (
            <div className='flex h-full items-center justify-center text-sm text-gray-400'>无封面</div>
          )}
          <div className='absolute right-2 top-2 max-w-[70%] truncate rounded-full bg-black/70 px-2 py-1 text-[11px] text-white'>
            {item.sourceName}
          </div>
        </div>
      </Link>
      <div className='space-y-2 p-3'>
        <Link href={href} onClick={onNavigate} className='line-clamp-2 text-sm font-medium hover:text-sky-600'>{item.title}</Link>
        <div className='line-clamp-1 text-xs text-gray-500 dark:text-gray-400'>{item.author || '未知作者'}</div>
        {extra}
      </div>
    </div>
  );
}
