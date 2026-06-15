'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import TVLayout from './TVLayout';
import TVRow from './TVRow';
import { TVItem, TVSection } from './types';

const fallbackPosters = [
  'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1524985069026-dd778a71c7b4?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=500&q=80',
];

async function loadDouban(kind: 'movie' | 'tv', tag: string, type: TVItem['type']): Promise<TVItem[]> {
  const res = await fetch(`/api/douban?type=${kind}&tag=${encodeURIComponent(tag)}&pageSize=12`, { cache: 'no-store' });
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
  sections: Array<{ title: string; subtitle?: string; kind: 'movie' | 'tv'; tag: string; type: TVItem['type']; href?: string }>;
}) {
  const [rows, setRows] = useState<TVSection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.allSettled(sections.map(async (section) => ({
      title: section.title,
      subtitle: section.subtitle,
      href: section.href,
      items: await loadDouban(section.kind, section.tag, section.type),
    }))).then((results) => {
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
    return () => { alive = false; };
  }, [sections]);

  const hero = rows[0]?.items[0];

  return (
    <TVLayout>
      <section className='relative overflow-hidden rounded-[42px] border border-white/10 bg-slate-950/70 p-10 shadow-2xl shadow-black/60'>
        <div className='absolute inset-0 opacity-35'>
          {hero?.poster ? (
            <img src={hero.poster} alt='' className='h-full w-full object-cover blur-sm' />
          ) : (
            <img src={fallbackPosters[0]} alt='' className='h-full w-full object-cover blur-sm' />
          )}
          <div className='absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent' />
        </div>
        <div className='relative max-w-4xl py-12'>
          <p className='mb-4 inline-flex rounded-full bg-rose-600 px-5 py-2 text-xl font-bold text-white'>TV 专用大屏模式</p>
          <h1 className='text-7xl font-black tracking-tight text-white drop-shadow-2xl'>{heroTitle || title}</h1>
          <p className='mt-5 max-w-3xl text-2xl leading-relaxed text-slate-200'>{heroSubtitle || subtitle}</p>
          <div className='mt-9 inline-flex items-center gap-3 rounded-2xl bg-white px-7 py-4 text-2xl font-black text-black'>
            <PlayCircle className='h-8 w-8 text-rose-600' />
            遥控器 OK 键开始浏览
          </div>
        </div>
      </section>

      {loading ? (
        <div className='mt-16 flex items-center justify-center gap-4 text-2xl text-slate-300'>
          <Loader2 className='h-8 w-8 animate-spin' /> 正在加载大屏内容...
        </div>
      ) : (
        rows.map((section) => <TVRow key={section.title} section={section} />)
      )}
    </TVLayout>
  );
}
