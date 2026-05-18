'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/manga', label: '推荐' },
  { href: '/manga/search', label: '搜索' },
  { href: '/manga/shelf', label: '书架' },
  { href: '/manga/history', label: '历史' },
];

export default function MangaSectionNav() {
  const pathname = usePathname();

  return (
    <div className='mb-6 flex flex-wrap gap-2'>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              active
                ? 'bg-sky-600 text-white shadow-sm'
                : 'border border-gray-200 bg-white text-gray-700 hover:border-sky-300 hover:text-sky-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
