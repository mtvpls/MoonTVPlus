'use client';

import {
  BookOpen,
  CheckCircle2,
  Compass,
  Library,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { BookSource } from '@/lib/book.types';

function BooksHomeSkeleton() {
  return (
    <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3 animate-pulse'>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className='rounded-[2rem] border border-emerald-100/80 bg-white/80 p-5 shadow-sm dark:border-emerald-500/10 dark:bg-gray-950/70'
        >
          <div className='h-5 w-32 rounded bg-emerald-100 dark:bg-gray-800' />
          <div className='mt-3 flex gap-2'>
            <div className='h-6 w-16 rounded-full bg-emerald-100 dark:bg-gray-800' />
            <div className='h-6 w-16 rounded-full bg-emerald-100 dark:bg-gray-800' />
          </div>
          <div className='mt-5 flex gap-2'>
            <div className='h-10 w-24 rounded-2xl bg-emerald-100 dark:bg-gray-800' />
            <div className='h-10 w-24 rounded-2xl bg-emerald-100 dark:bg-gray-800' />
          </div>
        </div>
      ))}
    </div>
  );
}

function CapabilityPill({
  enabled,
  children,
}: {
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const Icon = enabled ? CheckCircle2 : XCircle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        enabled
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20'
          : 'bg-gray-100 text-gray-500 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:ring-gray-800'
      }`}
    >
      <Icon className='h-3.5 w-3.5' />
      {children}
    </span>
  );
}

export default function BooksHomePage() {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      !(window as Window & { RUNTIME_CONFIG?: { BOOKS_ENABLED?: boolean } })
        .RUNTIME_CONFIG?.BOOKS_ENABLED
    ) {
      window.location.href = '/';
      return;
    }
    fetch('/api/books/sources')
      .then((res) => res.json())
      .then((data) => setSources(data.sources || []))
      .catch((err) => setError(err.message || '加载书源失败'))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const catalogCount = sources.filter(
      (source) => source.capabilities?.catalogSupported
    ).length;
    const searchCount = sources.filter(
      (source) => source.capabilities?.searchSupported
    ).length;
    return [
      { label: '可用书源', value: sources.length },
      { label: '支持目录', value: catalogCount },
      { label: '支持搜索', value: searchCount },
    ];
  }, [sources]);

  return (
    <div className='space-y-7'>
      <section className='relative overflow-hidden rounded-[2.25rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-amber-50 p-6 shadow-sm dark:border-emerald-500/10 dark:from-emerald-950/30 dark:via-gray-950 dark:to-amber-950/20 sm:p-8'>
        <div className='absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-500/10' />
        <div className='absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-500/10' />
        <div className='relative grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end'>
          <div>
            <div className='inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-200'>
              <Sparkles className='h-3.5 w-3.5' />
              MoonTVPlus Reading Library
            </div>
            <h1 className='mt-5 max-w-3xl text-4xl font-black tracking-[-0.06em] text-emerald-950 dark:text-emerald-50 sm:text-6xl lg:text-7xl'>
              电子书馆
            </h1>
            <div className='mt-6 flex flex-wrap gap-3'>
              <Link
                href='/books/search'
                className='inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors duration-200 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950'
              >
                <Search className='h-4 w-4' />
                搜索书籍
              </Link>
              <Link
                href='/books/shelf'
                className='inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-emerald-200 bg-white/70 px-5 py-3 text-sm font-semibold text-emerald-900 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-emerald-100 dark:hover:bg-emerald-950/30 dark:focus:ring-offset-gray-950'
              >
                <BookOpen className='h-4 w-4' />
                我的书架
              </Link>
            </div>
          </div>
          <div className='grid grid-cols-3 gap-3'>
            {stats.map((stat) => (
              <div
                key={stat.label}
                className='rounded-3xl border border-white/80 bg-white/75 p-4 text-center shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5'
              >
                <div className='text-2xl font-black text-emerald-700 dark:text-emerald-200'>
                  {stat.value}
                </div>
                <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className='flex items-end justify-between gap-3'>
        <div>
          <h2 className='text-xl font-bold tracking-tight text-slate-950 dark:text-white'>
            书源入口
          </h2>
          <p className='mt-1 text-sm text-slate-500 dark:text-slate-400'>
            选择一个书源开始浏览，或直接进入搜索。
          </p>
        </div>
        <Library className='hidden h-6 w-6 text-emerald-500 sm:block' />
      </div>

      {loading ? <BooksHomeSkeleton /> : null}
      {error ? (
        <div className='rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-950/20 dark:text-red-300'>
          {error}
        </div>
      ) : null}

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {sources.map((source) => (
          <article
            key={source.id}
            className='group relative overflow-hidden rounded-[2rem] border border-emerald-100/80 bg-white/85 p-5 shadow-sm transition-colors duration-200 hover:border-emerald-200 hover:bg-white dark:border-emerald-500/10 dark:bg-gray-950/70 dark:hover:border-emerald-500/30'
          >
            <div className='absolute -right-10 -top-12 h-28 w-28 rounded-full bg-emerald-200/40 blur-2xl transition-opacity duration-200 group-hover:opacity-80 dark:bg-emerald-500/10' />
            <div className='relative flex items-start justify-between gap-4'>
              <div className='min-w-0'>
                <div className='truncate text-base font-bold text-slate-950 dark:text-white'>
                  {source.name}
                </div>
                <div className='mt-1 text-xs font-medium uppercase tracking-[0.2em] text-emerald-500'>
                  {source.type === 'legado' ? 'Legado' : 'OPDS'}
                </div>
              </div>
              <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/20'>
                <Compass className='h-5 w-5' />
              </div>
            </div>
            <div className='relative mt-4 flex flex-wrap gap-2'>
              <CapabilityPill enabled={source.capabilities?.catalogSupported}>
                分类{source.capabilities?.catalogSupported ? '可用' : '不可用'}
              </CapabilityPill>
              <CapabilityPill enabled={source.capabilities?.searchSupported}>
                搜索{source.capabilities?.searchSupported ? '可用' : '不可用'}
              </CapabilityPill>
            </div>
            <div className='relative mt-5 flex flex-wrap gap-2'>
              {source.capabilities?.catalogSupported && (
                <Link
                  href={`/books/catalog?sourceId=${encodeURIComponent(
                    source.id
                  )}`}
                  className='inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950'
                >
                  浏览目录
                </Link>
              )}
              {source.capabilities?.searchSupported && (
                <Link
                  href={`/books/search?sourceId=${encodeURIComponent(
                    source.id
                  )}`}
                  className='inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:border-emerald-500/20 dark:text-emerald-100 dark:hover:bg-emerald-950/30 dark:focus:ring-offset-gray-950'
                >
                  搜索书籍
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && !error && sources.length === 0 ? (
        <div className='rounded-3xl border border-dashed border-emerald-200 bg-white/70 p-8 text-center text-sm text-slate-500 dark:border-emerald-500/20 dark:bg-gray-950/50 dark:text-slate-400'>
          暂无可用书源
        </div>
      ) : null}
    </div>
  );
}
