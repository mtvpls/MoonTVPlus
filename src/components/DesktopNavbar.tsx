'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { BackButton } from './BackButton';
import {
  type NavigationItem,
  type RuntimeNavigationConfig,
  buildFeatureNavigationItems,
  DIRECT_PLAY_NAV_ACTION,
  HOME_NAV_ITEM,
  isNavigationItemActive,
  SEARCH_NAV_ITEM,
} from './navigation-items';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UpdateNotification } from './UpdateNotification';
import { UserMenu } from './UserMenu';
import { useWatchRoomContextSafe } from './WatchRoomProvider';

interface DesktopNavbarProps {
  activePath?: string;
  showBackButton?: boolean;
  onDirectPlay?: () => void;
}

type RuntimeConfigWindow = Window & {
  RUNTIME_CONFIG?: RuntimeNavigationConfig;
};

const DesktopNavbar = ({
  activePath = '/',
  showBackButton = false,
  onDirectPlay,
}: DesktopNavbarProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const watchRoomContext = useWatchRoomContextSafe();
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeNavigationConfig>();

  useEffect(() => {
    setRuntimeConfig((window as RuntimeConfigWindow).RUNTIME_CONFIG);
  }, []);

  const currentActive = useMemo(() => {
    const queryString = searchParams.toString();
    return queryString ? `${pathname}?${queryString}` : pathname || activePath;
  }, [activePath, pathname, searchParams]);

  const menuItems = useMemo(
    () =>
      buildFeatureNavigationItems(
        runtimeConfig,
        Boolean(watchRoomContext?.isEnabled)
      ),
    [runtimeConfig, watchRoomContext?.isEnabled]
  );

  if (pathname === '/watch-room/screen') {
    return null;
  }

  // Keep utility entries last without changing the shared mobile menu order.
  const sourceSearchItem = menuItems.find(
    (item) => item.href === '/source-search'
  );
  const mainMenuItems = menuItems.filter((item) => item !== sourceSearchItem);
  const DirectPlayIcon = DIRECT_PLAY_NAV_ACTION.icon;
  const navItemClass =
    'group inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100/70 hover:text-green-600 data-[active=true]:bg-green-500/15 data-[active=true]:text-green-700 xl:px-3 dark:text-gray-300 dark:hover:bg-gray-800/80 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400';

  const renderNavItem = (item: NavigationItem) => {
    const active = isNavigationItemActive(currentActive, item.href);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        data-active={active}
        aria-current={active ? 'page' : undefined}
        title={item.label}
        aria-label={item.label}
        className={navItemClass}
      >
        <Icon className='h-4 w-4 shrink-0' />
        <span className='hidden whitespace-nowrap xl:inline'>{item.label}</span>
      </Link>
    );
  };

  return (
    <header className='fixed inset-x-0 top-0 z-[900] hidden h-16 border-b border-gray-200/60 bg-white/80 shadow-sm backdrop-blur-xl md:block dark:border-gray-700/60 dark:bg-gray-950/80'>
      <div className='grid h-full w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 lg:gap-4 lg:px-6 xl:px-8'>
        <div className='flex min-w-0 items-center gap-2'>
          {showBackButton && <BackButton />}
          <Link
            href='/'
            prefetch={false}
            className='max-w-32 truncate text-lg font-bold tracking-tight text-green-600 transition-opacity hover:opacity-80 lg:max-w-48 lg:text-xl xl:text-2xl'
            title={siteName}
          >
            {siteName}
          </Link>
        </div>

        <nav
          className='min-w-0 overflow-x-auto scrollbar-hide'
          aria-label='主导航'
        >
          <div className='mx-auto flex min-w-max items-center justify-center gap-0.5 xl:gap-1'>
            {renderNavItem(HOME_NAV_ITEM)}
            {mainMenuItems.map(renderNavItem)}
            {renderNavItem(SEARCH_NAV_ITEM)}
            {onDirectPlay && (
              <button
                type='button'
                onClick={onDirectPlay}
                aria-haspopup='dialog'
                aria-label={DIRECT_PLAY_NAV_ACTION.label}
                title={DIRECT_PLAY_NAV_ACTION.label}
                className={navItemClass}
              >
                <DirectPlayIcon
                  aria-hidden='true'
                  className='h-4 w-4 shrink-0'
                />
                <span className='hidden whitespace-nowrap xl:inline'>
                  {DIRECT_PLAY_NAV_ACTION.label}
                </span>
              </button>
            )}
            {sourceSearchItem && renderNavItem(sourceSearchItem)}
          </div>
        </nav>

        <div className='flex shrink-0 items-center gap-1 lg:gap-1.5'>
          <ThemeToggle />
          <UserMenu />
          <UpdateNotification />
        </div>
      </div>
    </header>
  );
};

export default DesktopNavbar;
