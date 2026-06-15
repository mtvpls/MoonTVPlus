'use client';

import {
  Film,
  Heart,
  Home,
  MonitorPlay,
  Radio,
  Search,
  Sparkles,
  Tv,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect } from 'react';

import TVVirtualRemote from './TVVirtualRemote';

const navItems = [
  { label: '搜索', href: '/tv/search', icon: Search },
  { label: '主页', href: '/tv', icon: Home },
  { label: '电影', href: '/tv/movie', icon: Film },
  { label: '剧集', href: '/tv/series', icon: Tv },
  { label: '动漫', href: '/tv/anime', icon: Sparkles },
  { label: '综艺', href: '/tv/variety', icon: MonitorPlay },
  { label: '直播', href: '/tv/live', icon: Radio },
  { label: '私人影库', href: '/tv/private', icon: Heart },
  { label: '我的', href: '/tv/me', icon: User },
];

export default function TVLayout({
  children,
  showNav = true,
}: {
  children: ReactNode;
  showNav?: boolean;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (!showNav || pathname !== '/tv') return;

    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) return;

      document
        .querySelector<HTMLElement>('[data-tv-home-nav="true"]')
        ?.focus({ preventScroll: true });
    });
  }, [pathname, showNav]);

  return (
    <main className='min-h-screen overflow-x-hidden bg-black text-slate-50'>
      <div className='fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_0%,rgba(225,29,72,0.22),transparent_34%),radial-gradient(circle_at_90%_10%,rgba(79,70,229,0.24),transparent_30%),linear-gradient(180deg,#05050b_0%,#000_55%)]' />
      {showNav && (
        <header className='fixed left-6 right-6 top-5 z-40 rounded-[28px] border border-white/10 bg-slate-950/78 px-5 py-3 shadow-2xl shadow-black/60 backdrop-blur-xl'>
          <nav className='flex items-center justify-center gap-3 overflow-x-auto overscroll-x-contain px-4 py-3 [scrollbar-width:none]'>
            {navItems.map((item) => {
              const active =
                item.href === '/tv'
                  ? pathname === '/tv'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tv-home-nav={item.href === '/tv' ? 'true' : undefined}
                  className={`group flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl px-5 py-3 text-xl font-semibold outline-none transition duration-200 tv-focusable ${
                    active
                      ? 'bg-rose-600 text-white shadow-lg shadow-rose-950/40'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white focus:bg-white/12'
                  }`}
                >
                  <Icon className='h-6 w-6' />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </header>
      )}
      <div className={`relative z-10 px-8 pb-16 ${showNav ? 'pt-32' : 'pt-16'}`}>{children}</div>
      <TVVirtualRemote />
    </main>
  );
}
