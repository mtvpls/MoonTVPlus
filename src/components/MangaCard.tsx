'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { MangaReadRecord, MangaSearchItem, MangaShelfItem } from '@/lib/manga.types';

import ProxyImage from './ProxyImage';

interface MangaCardProps {
  item: MangaSearchItem | MangaShelfItem | MangaReadRecord;
  href: string;
  subtitle?: string;
  badge?: string;
  updateCount?: number;
}

export default function MangaCard({ item, href, subtitle, badge, updateCount }: MangaCardProps) {
  const sourceName = useMemo(() => {
    if ('sourceName' in item) return item.sourceName;
    return '';
  }, [item]);

  return (
    <Link
      href={href}
      className='group overflow-hidden rounded-2xl border border-gray-200/70 bg-white/90 shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-gray-700 dark:bg-gray-900/80'
    >
      <div className='relative aspect-[3/4] overflow-hidden bg-gray-100 dark:bg-gray-800'>
        {item.cover ? (
          <ProxyImage
            originalSrc={item.cover}
            alt={item.title}
            className='h-full w-full object-cover transition duration-300 group-hover:scale-105'
          />
        ) : (
          <div className='flex h-full items-center justify-center text-sm text-gray-400'>暂无封面</div>
        )}
        {badge && (
          <span className='absolute left-3 top-3 rounded-full bg-black/65 px-2 py-1 text-xs text-white'>
            {badge}
          </span>
        )}
        {updateCount && updateCount > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              zIndex: 20,
              pointerEvents: 'none',
              width: '28px',
              height: '28px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: '0',
                borderRadius: '9999px',
                backgroundColor: 'rgb(14 165 233)',
                animation: 'ping-scale 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: '0',
                borderRadius: '9999px',
                backgroundColor: 'rgb(14 165 233)',
                animation: 'pulse-scale 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: '0',
                borderRadius: '9999px',
                background:
                  'linear-gradient(to bottom right, rgb(14 165 233), rgb(2 132 199))',
                color: 'white',
                fontSize: '11px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow:
                  '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                animation: 'badge-scale 2s ease-in-out infinite',
              }}
            >
              +{updateCount}
            </div>
          </div>
        )}
      </div>
      <div className='space-y-1 p-3'>
        <div className='line-clamp-2 min-h-[2.75rem] text-sm font-semibold text-gray-900 dark:text-gray-100'>
          {item.title}
        </div>
        {sourceName && <div className='text-xs text-gray-500 dark:text-gray-400'>{sourceName}</div>}
        {subtitle && <div className='line-clamp-2 text-xs text-sky-600 dark:text-sky-400'>{subtitle}</div>}
      </div>
    </Link>
  );
}
