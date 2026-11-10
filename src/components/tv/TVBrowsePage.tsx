'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { processImageUrl } from '@/lib/utils';

import TVLayout from './TVLayout';
import TVRow from './TVRow';
import { TVItem, TVSection } from './types';

async function loadDouban(
  kind: 'movie' | 'tv',
  tag: string,
  type: TVItem['type']
): Promise<TVItem[]> {
  const res = await fetch(
    `/api/douban?type=${kind}&tag=${encodeURIComponent(tag)}&pageSize=12`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('load failed');
  const data = await res.json();
  return (data.list || []).map((item: TVItem) => ({ ...item, type }));
}

export default function TVBrowsePage({
  title,
  subtitle,
  heroTitle,
  heroSubtitle,
  sections,
}: {
  title: string;
  subtitle: string;
  heroTitle?: string;
  heroSubtitle?: string;
  sections: Array<{
    title: string;
    subtitle?: string;
    kind: 'movie' | 'tv';
    tag: string;
    type: TVItem['type'];
    href?: string;
  }>;
}) {
  const [rows, setRows] = useState<TVSection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.allSettled(
      sections.map(async (section) => ({
        title: section.title,
        subtitle: section.subtitle,
        href: section.href,
        items: await loadDouban(section.kind, section.tag, section.type),
      }))
    ).then((results) => {
      if (!alive) return;
      const next = results.reduce<TVSection[]>((acc, result) => {
        if (result.status === 'fulfilled' && result.value.items.length > 0) {
          acc.push(result.value);
        }
        return acc;
      }, []);
      setRows(next);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [sections]);

  const featured = (rows[0]?.items || [])
    .filter((item) => item.poster)
    .slice(0, 3);

  return (
    <TVLayout>
      <section className='flex items-center justify-between gap-8 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'>
        <div className='min-w-0'>
          <h1 className='text-4xl font-medium leading-tight lg:text-5xl'>
            {heroTitle || title}
          </h1>
          <p className='mt-3 max-w-3xl text-xl leading-8 text-[#a1a1a6]'>
            {heroSubtitle || subtitle}
          </p>
          <p className='mt-5 flex flex-wrap items-center gap-2 text-lg text-[#8d8d93]'>
            方向键选片
            <span aria-hidden='true' className='mx-1'>
              ·
            </span>
            <kbd className='rounded border border-white/15 bg-[#232325] px-2 py-1 font-mono text-sm text-[#ededed]'>
              OK
            </kbd>
            查看详情
          </p>
        </div>
        <div aria-hidden='true' className='hidden shrink-0 gap-3 md:flex'>
          {featured.map((item) => (
            <img
              key={item.id}
              src={processImageUrl(item.poster || '')}
              alt=''
              width={96}
              height={144}
              className='h-36 w-24 rounded-lg bg-[#232325] object-cover'
            />
          ))}
        </div>
      </section>

      {loading ? (
        <div
          role='status'
          className='mt-12 flex items-center justify-center gap-3 text-xl text-[#a1a1a6]'
        >
          <Loader2
            className='h-6 w-6 animate-spin motion-reduce:animate-none'
            strokeWidth={1.5}
            aria-hidden='true'
          />{' '}
          正在加载影片
        </div>
      ) : rows.length === 0 ? (
        <div
          role='status'
          className='mt-8 rounded-2xl border border-white/[0.08] bg-[#19191b] p-8 text-xl text-[#a1a1a6]'
        >
          暂无影片，可以稍后再试或使用搜索选片
        </div>
      ) : (
        rows.map((section) => <TVRow key={section.title} section={section} />)
      )}
    </TVLayout>
  );
}
