/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  Cat,
  Clover,
  Film,
  FolderOpen,
  Globe,
  Home,
  Star,
  Tv,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useWatchRoomContextSafe } from './WatchRoomProvider';

interface MobileBottomNavProps {
  /**
   * 主动指定当前激活的路径。当未提供时，自动使用 usePathname() 获取的路径。
   */
  activePath?: string;
}

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchRoomContext = useWatchRoomContextSafe();

  // 直接使用当前路由状态，确保立即响应路由变化
  const getCurrentFullPath = () => {
    const queryString = searchParams.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
  };
  const currentActive = activePath ?? getCurrentFullPath();

  const [navItems, setNavItems] = useState([
    { icon: Home, label: '首页', href: '/' },
    {
      icon: Film,
      label: '电影',
      href: '/douban?type=movie',
    },
    {
      icon: Tv,
      label: '剧集',
      href: '/douban?type=tv',
    },
    {
      icon: Cat,
      label: '动漫',
      href: '/douban?type=anime',
    },
    {
      icon: Clover,
      label: '综艺',
      href: '/douban?type=show',
    },
    {
      icon: Tv,
      label: '电视直播',
      href: '/live',
    },
    {
      icon: Globe,
      label: '网络直播',
      href: '/web-live',
    },
  ]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;

    // 基础导航项（不包括观影室）
    const items = [
      { icon: Home, label: '首页', href: '/' },
      {
        icon: Film,
        label: '电影',
        href: '/douban?type=movie',
      },
      {
        icon: Tv,
        label: '剧集',
        href: '/douban?type=tv',
      },
      {
        icon: Cat,
        label: '动漫',
        href: '/douban?type=anime',
      },
      {
        icon: Clover,
        label: '综艺',
        href: '/douban?type=show',
      },
      {
        icon: Tv,
        label: '电视直播',
        href: '/live',
      },
    ];

    // 如果启用网络直播，添加网络直播入口
    if (runtimeConfig?.WEB_LIVE_ENABLED) {
      items.push({
        icon: Globe,
        label: '网络直播',
        href: '/web-live',
      });
    }

    // 如果配置了 OpenList 或 Emby，添加私人影库入口
    if (runtimeConfig?.PRIVATE_LIBRARY_ENABLED) {
      items.push({
        icon: FolderOpen,
        label: '私人影库',
        href: '/private-library',
      });
    }

    // 如果启用观影室，添加观影室入口
    if (watchRoomContext?.isEnabled) {
      items.push({
        icon: Users,
        label: '观影室',
        href: '/watch-room',
      });
    }

    // 添加自定义分类（如果有）
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      items.push({
        icon: Star,
        label: '自定义',
        href: '/douban?type=custom',
      });
    }

    setNavItems(items);
  }, [watchRoomContext?.isEnabled]);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    // 解码URL以进行正确的比较
    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <nav
      className='md:hidden fixed left-0 right-0 z-[600] bg-white/90 backdrop-blur-xl border-t border-gray-200/50 overflow-hidden dark:bg-gray-900/80 dark:border-gray-700/50'
      style={{
        /* 紧贴视口底部，同时在内部留出安全区高度 */
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <ul className='flex items-center overflow-x-auto scrollbar-hide'>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <li
              key={item.href}
              className='flex-shrink-0'
              style={{ width: '20vw', minWidth: '20vw' }}
            >
              <Link
                href={item.href}
                prefetch={false}
                className='flex flex-col items-center justify-center w-full h-14 gap-1 text-xs'
              >
                <item.icon
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
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
