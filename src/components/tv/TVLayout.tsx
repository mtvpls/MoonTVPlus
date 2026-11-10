'use client';

import {
  Clapperboard,
  Film,
  Heart,
  Home,
  MonitorPlay,
  Radio,
  Search,
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
  { label: '动漫', href: '/tv/anime', icon: Clapperboard },
  { label: '综艺', href: '/tv/variety', icon: MonitorPlay },
  { label: '直播', href: '/tv/live', icon: Radio },
  { label: '私人影库', href: '/tv/private', icon: Heart },
  { label: '我的', href: '/tv/me', icon: User },
];

export default function TVLayout({
  children,
  showNav = true,
  fullBleed = false,
}: {
  children: ReactNode;
  showNav?: boolean;
  fullBleed?: boolean;
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
    <main className='min-h-screen overflow-x-hidden bg-[#141415] text-[#ededed]'>
      {showNav && (
        <header className='fixed inset-x-0 top-0 z-40 border-b border-white/[0.08] bg-[#0f0f10] px-4 py-3 sm:px-6'>
          <nav
            aria-label='电视导航'
            className='overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          >
            <div className='mx-auto flex w-max items-center gap-1'>
              {navItems.map((item) => {
                const active =
                  item.href === '/tv'
                    ? pathname === '/tv'
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    data-tv-home-nav={item.href === '/tv' ? 'true' : undefined}
                    className={`tv-focusable relative flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 text-lg font-medium outline-none xl:text-xl ${
                      active
                        ? 'bg-[#232325] text-[#ededed] after:absolute after:inset-x-4 after:bottom-1 after:h-0.5 after:rounded-sm after:bg-rose-500'
                        : 'text-[#a1a1a6] hover:bg-[#232325] hover:text-[#ededed]'
                    }`}
                  >
                    <Icon
                      className='h-[18px] w-[18px] shrink-0'
                      strokeWidth={1.5}
                      aria-hidden='true'
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </header>
      )}
      <div
        className={`relative z-10 ${
          fullBleed
            ? ''
            : `mx-auto max-w-[1800px] px-6 pb-16 lg:px-12 ${
                showNav ? 'pt-28' : 'pt-12'
              }`
        }`}
      >
        {children}
      </div>
      <TVVirtualRemote />
    </main>
  );
}
