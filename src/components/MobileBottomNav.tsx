'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';

import {
  type RuntimeNavigationConfig,
  buildFeatureNavigationItems,
  DIRECT_PLAY_NAV_ACTION,
  HOME_NAV_ITEM,
  isNavigationItemActive,
} from './navigation-items';
import { useWatchRoomContextSafe } from './WatchRoomProvider';

interface MobileBottomNavProps {
  /**
   * 主动指定当前激活的路径。当未提供时，自动使用 usePathname() 获取的路径。
   */
  activePath?: string;
  onDirectPlay?: () => void;
}

type RuntimeConfigWindow = Window & {
  RUNTIME_CONFIG?: RuntimeNavigationConfig;
};

const MobileBottomNav = ({
  activePath,
  onDirectPlay,
}: MobileBottomNavProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchRoomContext = useWatchRoomContextSafe();
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeNavigationConfig>();

  useEffect(() => {
    setRuntimeConfig((window as RuntimeConfigWindow).RUNTIME_CONFIG);
  }, []);

  const currentActive = useMemo(() => {
    if (activePath) return activePath;
    const queryString = searchParams.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
  }, [activePath, pathname, searchParams]);

  const navItems = useMemo(
    () => [
      HOME_NAV_ITEM,
      ...buildFeatureNavigationItems(
        runtimeConfig,
        Boolean(watchRoomContext?.isEnabled)
      ),
    ],
    [runtimeConfig, watchRoomContext?.isEnabled]
  );

  if (pathname === '/watch-room/screen') {
    return null;
  }

  const DirectPlayIcon = DIRECT_PLAY_NAV_ACTION.icon;

  return (
    <nav
      className='fixed bottom-0 left-0 right-0 z-[600] overflow-hidden border-t border-gray-200/50 bg-white/90 backdrop-blur-xl md:hidden dark:border-gray-700/50 dark:bg-gray-900/80'
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
      aria-label='移动端主导航'
    >
      <ul className='flex items-center overflow-x-auto scrollbar-hide'>
        {navItems.map((item) => {
          const active = isNavigationItemActive(currentActive, item.href);
          const Icon = item.icon;

          return (
            <Fragment key={item.href}>
              <li
                className='flex-shrink-0'
                style={{ width: '20vw', minWidth: '20vw' }}
              >
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={active ? 'page' : undefined}
                  className='flex h-14 w-full flex-col items-center justify-center gap-1 text-xs'
                >
                  <Icon
                    className={`h-6 w-6 ${
                      active
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  />
                  <span
                    className={
                      active
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-600 dark:text-gray-300'
                    }
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
              {item.href === '/' && onDirectPlay && (
                <li
                  className='flex-shrink-0'
                  style={{ width: '20vw', minWidth: '20vw' }}
                >
                  <button
                    type='button'
                    onClick={onDirectPlay}
                    aria-haspopup='dialog'
                    className='flex h-14 w-full flex-col items-center justify-center gap-1 text-xs text-gray-600 dark:text-gray-300'
                  >
                    <DirectPlayIcon
                      aria-hidden='true'
                      className='h-6 w-6 text-gray-500 dark:text-gray-400'
                    />
                    <span>{DIRECT_PLAY_NAV_ACTION.label}</span>
                  </button>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
