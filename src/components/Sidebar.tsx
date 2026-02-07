/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Cat, Clover, Film, FolderOpen, Globe, Home, Menu, Search, Star, Tv, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

import { useSite } from './SiteProvider';
import { useWatchRoomContextSafe } from './WatchRoomProvider';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const useSidebar = () => useContext(SidebarContext);

// FoxAI Logo 组件
const Logo = () => {
  return (
    <Link
      href='/'
      className='flex items-center justify-center h-16 select-none hover:opacity-80 transition-all duration-300 group'
    >
      <div className='flex items-center gap-2'>
        <div className='relative w-10 h-10'>
          <div className='absolute inset-0 bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 rounded-xl rotate-6 group-hover:rotate-12 transition-transform duration-300'></div>
          <div className='absolute inset-0 bg-gradient-to-br from-purple-600 via-blue-600 to-cyan-600 rounded-xl flex items-center justify-center'>
            <span className='text-white font-bold text-xl'>F</span>
          </div>
        </div>
        <div className='flex flex-col'>
          <span className='text-xl font-bold bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent'>
            FoxAI
          </span>
          <span className='text-[10px] text-gray-500 dark:text-gray-400 -mt-1'>
            影视聚合
          </span>
        </div>
      </div>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

// 在浏览器环境下通过全局变量缓存折叠状态，避免组件重新挂载时出现初始值闪烁
declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
    RUNTIME_CONFIG?: {
      EnableComments?: boolean;
      RecommendationDataSource?: string;
      [key: string]: any;
    };
  }
}

const Sidebar = ({ onToggle, activePath = '/' }: SidebarProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchRoomContext = useWatchRoomContextSafe();
  // 若同一次 SPA 会话中已经读取过折叠状态，则直接复用，避免闪烁
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__sidebarCollapsed === 'boolean'
    ) {
      return window.__sidebarCollapsed;
    }
    return false; // 默认展开
  });

  // 首次挂载时读取 localStorage，以便刷新后仍保持上次的折叠状态
  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      const val = JSON.parse(saved);
      setIsCollapsed(val);
      window.__sidebarCollapsed = val;
    }
  }, []);

  // 当折叠状态变化时，同步到 <html> data 属性，供首屏 CSS 使用
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  const [active, setActive] = useState(activePath);

  useEffect(() => {
    // 立即根据当前路径更新状态，不等待页面加载
    const getCurrentFullPath = () => {
      const queryString = searchParams.toString();
      return queryString ? `${pathname}?${queryString}` : pathname;
    };
    const fullPath = getCurrentFullPath();
    setActive(fullPath);
  }, [pathname, searchParams]);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const contextValue = {
    isCollapsed,
  };

  const [menuItems, setMenuItems] = useState([
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

    // 基础菜单项（不包括观影室）
    const items = [
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

    setMenuItems(items);
  }, [watchRoomContext?.isEnabled]);

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* 在移动端隐藏侧边栏 */}
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          className={`fixed top-0 left-0 h-screen bg-white/40 backdrop-blur-xl transition-all duration-300 border-r border-gray-200/50 z-10 shadow-lg dark:bg-gray-900/70 dark:border-gray-700/50 ${isCollapsed ? 'w-16' : 'w-64'
            }`}
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className='flex h-full flex-col'>
            {/* 顶部 Logo 区域 */}
            <div className='relative h-16'>
              <div
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isCollapsed ? 'opacity-0' : 'opacity-100'
                  }`}
              >
                <div className='w-[calc(100%-4rem)] flex justify-center'>
                  {!isCollapsed && <Logo />}
                </div>
              </div>
              <button
                onClick={handleToggle}
                className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 transition-colors duration-200 z-10 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50 ${isCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-2'
                  }`}
              >
                <Menu className='h-4 w-4' />
              </button>
            </div>

            {/* 首页和搜索导航 */}
            <nav className='px-2 mt-4 space-y-1'>
              <Link
                href='/'
                prefetch={false}
                onClick={(e) => {
                  // 确保点击事件立即生效，不被其他状态更新阻塞
                  e.currentTarget.blur();
                }}
                data-active={active === '/'}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                  } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Home className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                {!isCollapsed && (
                  <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                    首页
                  </span>
                )}
              </Link>
              <Link
                href='/search'
                data-active={active === '/search'}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                  } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Search className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                {!isCollapsed && (
                  <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                    搜索
                  </span>
                )}
              </Link>
            </nav>

            {/* 菜单项 */}
            <div className='flex-1 overflow-y-auto px-2 pt-4'>
              <div className='space-y-1'>
                {menuItems.map((item) => {
                  // 检查当前路径是否匹配这个菜单项
                  const typeMatch = item.href.match(/type=([^&]+)/)?.[1];

                  // 解码URL以进行正确的比较
                  const decodedActive = decodeURIComponent(active);
                  const decodedItemHref = decodeURIComponent(item.href);

                  const isActive =
                    decodedActive === decodedItemHref ||
                    (decodedActive.startsWith('/douban') &&
                      decodedActive.includes(`type=${typeMatch}`));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      data-active={isActive}
                      className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-sm text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                        } gap-3 justify-start`}
                    >
                      <div className='w-4 h-4 flex items-center justify-center'>
                        <Icon className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                      </div>
                      {!isCollapsed && (
                        <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                          {item.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
        <div
          className={`transition-all duration-300 sidebar-offset ${isCollapsed ? 'w-16' : 'w-64'
            }`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
