/* eslint-disable no-console,@typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  Home,
  KeyRound,
  LogOut,
  Mail,
  MessageSquare,
  Monitor,
  MoveDown,
  MoveUp,
  Package,
  Rss,
  Settings,
  Shield,
  Sliders,
  Smartphone,
  Star,
  Tablet,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { clearAllDanmakuCache } from '@/lib/danmaku/api';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

import { FavoritesPanel } from './FavoritesPanel';
import { NotificationPanel } from './NotificationPanel';
import { OfflineDownloadPanel } from './OfflineDownloadPanel';
import { useVersionCheck } from './VersionCheckProvider';
import { VersionPanel } from './VersionPanel';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const { updateStatus, isChecking } = useVersionCheck();
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [isOfflineDownloadPanelOpen, setIsOfflineDownloadPanelOpen] = useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [isFavoritesPanelOpen, setIsFavoritesPanelOpen] = useState(false);
  const [isEmailSettingsOpen, setIsEmailSettingsOpen] = useState(false);
  const [isDeviceManagementOpen, setIsDeviceManagementOpen] = useState(false);
  const [isEcoAppsOpen, setIsEcoAppsOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // 订阅相关状态
  const [subscribeEnabled, setSubscribeEnabled] = useState(false);
  const [subscribeUrl, setSubscribeUrl] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [adFilterEnabled, setAdFilterEnabled] = useState(true); // 去广告开关，默认开启

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (isSettingsOpen || isChangePasswordOpen || isSubscribeOpen || isOfflineDownloadPanelOpen || isEmailSettingsOpen || isDeviceManagementOpen || isEcoAppsOpen || isReportOpen) {
      const body = document.body;
      const html = document.documentElement;

      // 保存原始样式
      const originalBodyOverflow = body.style.overflow;
      const originalHtmlOverflow = html.style.overflow;

      // 只设置 overflow 来阻止滚动
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';

      return () => {

        // 恢复所有原始样式
        body.style.overflow = originalBodyOverflow;
        html.style.overflow = originalHtmlOverflow;
      };
    }
  }, [isSettingsOpen, isChangePasswordOpen, isSubscribeOpen, isOfflineDownloadPanelOpen, isEmailSettingsOpen, isDeviceManagementOpen, isEcoAppsOpen]);

  // 设置相关状态
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [speedTestTimeout, setSpeedTestTimeout] = useState(4000); // 测速超时时间（毫秒）
  const [fluidSearch, setFluidSearch] = useState(true);
  const [liveDirectConnect, setLiveDirectConnect] = useState(false);
  const [tmdbBackdropDisabled, setTmdbBackdropDisabled] = useState(false);
  const [enableTrailers, setEnableTrailers] = useState(false);
  const [doubanDataSource, setDoubanDataSource] = useState('cmliussss-cdn-tencent');
  const [doubanImageProxyType, setDoubanImageProxyType] = useState('cmliussss-cdn-tencent');
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);
  const [bufferStrategy, setBufferStrategy] = useState('medium');
  const [nextEpisodePreCache, setNextEpisodePreCache] = useState(true);
  const [nextEpisodeDanmakuPreload, setNextEpisodeDanmakuPreload] = useState(true);
  const [disableAutoLoadDanmaku, setDisableAutoLoadDanmaku] = useState(false);
  const [danmakuMaxCount, setDanmakuMaxCount] = useState(0);
  const [danmakuHeatmapDisabled, setDanmakuHeatmapDisabled] = useState(false);
  const [searchTraditionalToSimplified, setSearchTraditionalToSimplified] = useState(false);
  const [exactSearch, setExactSearch] = useState(true);
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(6);

  // 邮件通知设置
  const [userEmail, setUserEmail] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [emailSettingsLoading, setEmailSettingsLoading] = useState(false);
  const [emailSettingsSaving, setEmailSettingsSaving] = useState(false);

  // 设备管理状态
  const [devices, setDevices] = useState<any[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // 折叠面板状态
  const [isDoubanSectionOpen, setIsDoubanSectionOpen] = useState(true);

  // TMDB 图片设置
  const [tmdbImageBaseUrl, setTmdbImageBaseUrl] = useState('https://image.tmdb.org');
  const [isUsageSectionOpen, setIsUsageSectionOpen] = useState(false);
  const [isBufferSectionOpen, setIsBufferSectionOpen] = useState(false);
  const [isDanmakuSectionOpen, setIsDanmakuSectionOpen] = useState(false);
  const [isHomepageSectionOpen, setIsHomepageSectionOpen] = useState(false);

  // 首页模块配置
  interface HomeModule {
    id: string;
    name: string;
    enabled: boolean;
    order: number;
  }

  const defaultHomeModules: HomeModule[] = [
    { id: 'hotMovies', name: '热门电影', enabled: true, order: 0 },
    { id: 'hotDuanju', name: '热播短剧', enabled: true, order: 1 },
    { id: 'bangumiCalendar', name: '新番放送', enabled: true, order: 2 },
    { id: 'hotTvShows', name: '热门剧集', enabled: true, order: 3 },
    { id: 'hotVarietyShows', name: '热门综艺', enabled: true, order: 4 },
    { id: 'upcomingContent', name: '即将上映', enabled: true, order: 5 },
  ];

  const [homeModules, setHomeModules] = useState<HomeModule[]>(defaultHomeModules);
  const [homeBannerEnabled, setHomeBannerEnabled] = useState(true);
  const [homeContinueWatchingEnabled, setHomeContinueWatchingEnabled] = useState(true);

  // 豆瓣数据源选项
  const doubanDataSourceOptions = [
    { value: 'direct', label: '直连（服务器直接请求豆瓣）' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];

  // 豆瓣图片代理选项
  const doubanImageProxyTypeOptions = [
    { value: 'server', label: '服务器代理（由服务器代理请求豆瓣）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'baidu', label: '百度图片代理' },
    { value: 'custom', label: '自定义代理' },
    { value: 'direct', label: '直连（浏览器直接请求豆瓣，可能需要浏览器插件才能正常显示）' },
    { value: 'img3', label: '豆瓣官方精品 CDN（阿里云，可能需要浏览器插件才能正常显示）' },
  ];

  // 缓冲策略选项
  const bufferStrategyOptions = [
    { value: 'low', label: '低缓冲（省流量）' },
    { value: 'medium', label: '中缓冲（推荐）' },
    { value: 'high', label: '高缓冲（流畅播放）' },
    { value: 'ultra', label: '超高缓冲（极速体验）' },
  ];

  // 修改密码相关状态
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 清除弹幕缓存相关状态
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [clearCacheMessage, setClearCacheMessage] = useState<string | null>(null);

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  // 加载未读通知数量
  const loadUnreadCount = async () => {
    try {
      const response = await fetch('/api/notifications');
      if (response.ok) {
        const data = await response.json();
        const count = data.unreadCount || 0;
        setUnreadCount(count);
        // 同步到全局，让其他 UserMenu 实例也能获取
        if (typeof window !== 'undefined') {
          (window as any).__unreadNotificationCount = count;
        }
      }
    } catch (error) {
      console.error('加载未读通知数量失败:', error);
    }
  };

  // 首次加载时检查未读通知数量（使用全局标记避免多个实例重复请求）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 检查是否已经有其他实例在加载
    const globalWindow = window as any;
    if (globalWindow.__loadingNotifications) {
      // 如果正在加载，等待加载完成后获取结果
      const checkInterval = setInterval(() => {
        if (!globalWindow.__loadingNotifications && globalWindow.__unreadNotificationCount !== undefined) {
          setUnreadCount(globalWindow.__unreadNotificationCount);
          clearInterval(checkInterval);
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }

    // 检查是否已经加载过
    if (globalWindow.__unreadNotificationCount !== undefined) {
      setUnreadCount(globalWindow.__unreadNotificationCount);
      return;
    }

    // 标记正在加载
    globalWindow.__loadingNotifications = true;
    loadUnreadCount().finally(() => {
      globalWindow.__loadingNotifications = false;
    });
  }, []);

  // 监听通知更新事件
  useEffect(() => {
    const handleNotificationsUpdated = () => {
      // 清除缓存，强制重新加载
      if (typeof window !== 'undefined') {
        delete (window as any).__unreadNotificationCount;
      }
      loadUnreadCount();
    };

    window.addEventListener('notificationsUpdated', handleNotificationsUpdated);
    return () => {
      window.removeEventListener('notificationsUpdated', handleNotificationsUpdated);
    };
  }, []);

  // 从运行时配置读取订阅是否启用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled = (window as any).RUNTIME_CONFIG?.ENABLE_TVBOX_SUBSCRIBE || false;
      setSubscribeEnabled(enabled);
    }
  }, []);

  // 懒加载订阅 URL - 只在打开订阅面板时请求
  const fetchSubscribeUrl = async (adFilter?: boolean) => {
    try {
      const currentOrigin = window.location.origin;
      const filterValue = adFilter !== undefined ? adFilter : adFilterEnabled;
      const response = await fetch(`/api/tvbox/config?origin=${encodeURIComponent(currentOrigin)}&adFilter=${filterValue}`);
      if (response.ok) {
        const data = await response.json();
        setSubscribeUrl(data.url);
      }
    } catch (error) {
      console.error('获取订阅URL失败:', error);
    }
  };

  // 获取认证信息和存储类型
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const auth = getAuthInfoFromBrowserCookie();
      setAuthInfo(auth);

      const type =
        (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage';
      setStorageType(type);
    }
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAggregateSearch = localStorage.getItem(
        'defaultAggregateSearch'
      );
      if (savedAggregateSearch !== null) {
        setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
      }

      const savedDoubanDataSource = localStorage.getItem('doubanDataSource');
      const defaultDoubanProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent';
      if (savedDoubanDataSource !== null) {
        setDoubanDataSource(savedDoubanDataSource);
      } else if (defaultDoubanProxyType) {
        setDoubanDataSource(defaultDoubanProxyType);
      }

      const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
      const defaultDoubanProxy =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
      if (savedDoubanProxyUrl !== null) {
        setDoubanProxyUrl(savedDoubanProxyUrl);
      } else if (defaultDoubanProxy) {
        setDoubanProxyUrl(defaultDoubanProxy);
      }

      const savedDoubanImageProxyType = localStorage.getItem(
        'doubanImageProxyType'
      );
      const defaultDoubanImageProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent';
      if (savedDoubanImageProxyType !== null) {
        setDoubanImageProxyType(savedDoubanImageProxyType);
      } else if (defaultDoubanImageProxyType) {
        setDoubanImageProxyType(defaultDoubanImageProxyType);
      }

      const savedDoubanImageProxyUrl = localStorage.getItem(
        'doubanImageProxyUrl'
      );
      const defaultDoubanImageProxyUrl =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
      if (savedDoubanImageProxyUrl !== null) {
        setDoubanImageProxyUrl(savedDoubanImageProxyUrl);
      } else if (defaultDoubanImageProxyUrl) {
        setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
      }

      const savedTmdbImageBaseUrl = localStorage.getItem('tmdbImageBaseUrl');
      if (savedTmdbImageBaseUrl !== null) {
        setTmdbImageBaseUrl(savedTmdbImageBaseUrl);
      }

      const savedEnableOptimization =
        localStorage.getItem('enableOptimization');
      if (savedEnableOptimization !== null) {
        setEnableOptimization(JSON.parse(savedEnableOptimization));
      }

      const savedSpeedTestTimeout = localStorage.getItem('speedTestTimeout');
      if (savedSpeedTestTimeout !== null) {
        setSpeedTestTimeout(Number(savedSpeedTestTimeout));
      }

      const savedFluidSearch = localStorage.getItem('fluidSearch');
      const defaultFluidSearch =
        (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
      if (savedFluidSearch !== null) {
        setFluidSearch(JSON.parse(savedFluidSearch));
      } else if (defaultFluidSearch !== undefined) {
        setFluidSearch(defaultFluidSearch);
      }

      const savedLiveDirectConnect = localStorage.getItem('liveDirectConnect');
      if (savedLiveDirectConnect !== null) {
        setLiveDirectConnect(JSON.parse(savedLiveDirectConnect));
      }

      const savedTmdbBackdropDisabled = localStorage.getItem('tmdb_backdrop_disabled');
      if (savedTmdbBackdropDisabled !== null) {
        setTmdbBackdropDisabled(savedTmdbBackdropDisabled === 'true');
      }

      const savedEnableTrailers = localStorage.getItem('enableTrailers');
      if (savedEnableTrailers !== null) {
        setEnableTrailers(savedEnableTrailers === 'true');
      }

      const savedBufferStrategy = localStorage.getItem('bufferStrategy');
      if (savedBufferStrategy !== null) {
        setBufferStrategy(savedBufferStrategy);
      }

      const savedNextEpisodePreCache = localStorage.getItem('nextEpisodePreCache');
      if (savedNextEpisodePreCache !== null) {
        setNextEpisodePreCache(savedNextEpisodePreCache === 'true');
      }

      const savedNextEpisodeDanmakuPreload = localStorage.getItem('nextEpisodeDanmakuPreload');
      if (savedNextEpisodeDanmakuPreload !== null) {
        setNextEpisodeDanmakuPreload(savedNextEpisodeDanmakuPreload === 'true');
      }

      const savedDisableAutoLoadDanmaku = localStorage.getItem('disableAutoLoadDanmaku');
      if (savedDisableAutoLoadDanmaku !== null) {
        setDisableAutoLoadDanmaku(savedDisableAutoLoadDanmaku === 'true');
      }

      const savedDanmakuMaxCount = localStorage.getItem('danmakuMaxCount');
      if (savedDanmakuMaxCount !== null) {
        setDanmakuMaxCount(parseInt(savedDanmakuMaxCount, 10));
      }

      const savedDanmakuHeatmapDisabled = localStorage.getItem('danmaku_heatmap_disabled');
      if (savedDanmakuHeatmapDisabled !== null) {
        setDanmakuHeatmapDisabled(savedDanmakuHeatmapDisabled === 'true');
      }

      const savedHomeBannerEnabled = localStorage.getItem('homeBannerEnabled');
      if (savedHomeBannerEnabled !== null) {
        setHomeBannerEnabled(savedHomeBannerEnabled === 'true');
      }

      const savedHomeContinueWatchingEnabled = localStorage.getItem('homeContinueWatchingEnabled');
      if (savedHomeContinueWatchingEnabled !== null) {
        setHomeContinueWatchingEnabled(savedHomeContinueWatchingEnabled === 'true');
      }

      // 加载首页模块配置
      const savedHomeModules = localStorage.getItem('homeModules');
      if (savedHomeModules !== null) {
        try {
          setHomeModules(JSON.parse(savedHomeModules));
        } catch (error) {
          console.error('解析首页模块配置失败:', error);
        }
      }

      // 加载搜索繁体转简体设置
      const savedSearchTraditionalToSimplified = localStorage.getItem('searchTraditionalToSimplified');
      if (savedSearchTraditionalToSimplified !== null) {
        setSearchTraditionalToSimplified(savedSearchTraditionalToSimplified === 'true');
      }

      // 加载精确搜索设置
      const savedExactSearch = localStorage.getItem('exactSearch');
      if (savedExactSearch !== null) {
        setExactSearch(savedExactSearch === 'true');
      }

      // 加载最大同时下载限制设置
      const savedMaxConcurrentDownloads = localStorage.getItem('maxConcurrentDownloads');
      if (savedMaxConcurrentDownloads !== null) {
        setMaxConcurrentDownloads(Number(savedMaxConcurrentDownloads));
      }
    }
  }, []);

  // 加载邮件通知设置
  const loadEmailSettings = async () => {
    setEmailSettingsLoading(true);
    try {
      const response = await fetch('/api/user/email-settings');
      if (response.ok) {
        const data = await response.json();
        setUserEmail(data.email || '');
        setEmailNotifications(data.emailNotifications || false);
      }
    } catch (error) {
      console.error('加载邮件设置失败:', error);
    } finally {
      setEmailSettingsLoading(false);
    }
  };

  // 保存邮件通知设置
  const handleSaveEmailSettings = async () => {
    setEmailSettingsSaving(true);
    try {
      const response = await fetch('/api/user/email-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          emailNotifications,
        }),
      });

      const messageEl = document.getElementById('email-settings-message');
      if (response.ok) {
        if (messageEl) {
          messageEl.textContent = '保存成功！';
          messageEl.className = 'text-xs text-center text-green-600 dark:text-green-400';
          messageEl.classList.remove('hidden');
          setTimeout(() => {
            messageEl.classList.add('hidden');
          }, 3000);
        }
      } else {
        const data = await response.json();
        if (messageEl) {
          messageEl.textContent = data.error || '保存失败';
          messageEl.className = 'text-xs text-center text-red-600 dark:text-red-400';
          messageEl.classList.remove('hidden');
        }
      }
    } catch (error) {
      console.error('保存邮件设置失败:', error);
      const messageEl = document.getElementById('email-settings-message');
      if (messageEl) {
        messageEl.textContent = '保存失败，请重试';
        messageEl.className = 'text-xs text-center text-red-600 dark:text-red-400';
        messageEl.classList.remove('hidden');
      }
    } finally {
      setEmailSettingsSaving(false);
    }
  };

  // 加载设备列表
  const loadDevices = async () => {
    setDevicesLoading(true);
    try {
      const response = await fetch('/api/auth/devices');
      if (response.ok) {
        const data = await response.json();
        setDevices(data.devices || []);
      }
    } catch (error) {
      console.error('加载设备列表失败:', error);
    } finally {
      setDevicesLoading(false);
    }
  };

  // 撤销单个设备
  const handleRevokeDevice = async (tokenId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: '撤销设备登录',
      message: '确定要撤销该设备的登录吗？',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        setRevoking(tokenId);
        try {
          const response = await fetch('/api/auth/devices', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokenId }),
          });

          if (response.ok) {
            // 重新加载设备列表
            await loadDevices();
          } else {
            alert('撤销失败，请重试');
          }
        } catch (error) {
          console.error('撤销设备失败:', error);
          alert('撤销失败，请重试');
        } finally {
          setRevoking(null);
        }
      },
    });
  };

  // 撤销所有设备
  const handleRevokeAllDevices = async () => {
    setConfirmDialog({
      isOpen: true,
      title: '登出所有设备',
      message: '确定要登出所有设备吗？这将清除所有设备的登录状态（包括当前设备）。',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          const response = await fetch('/api/auth/devices', {
            method: 'POST',
          });

          if (response.ok) {
            // 登出所有设备后，重定向到首页
            window.location.href = '/';
          } else {
            alert('操作失败，请重试');
          }
        } catch (error) {
          console.error('登出所有设备失败:', error);
          alert('操作失败，请重试');
        }
      },
    });
  };

  // 根据设备类型返回对应的图标
  const getDeviceIcon = (deviceInfo: string) => {
    const info = deviceInfo.toLowerCase();

    if (info.includes('mobile') || info.includes('iphone') || info.includes('android')) {
      return Smartphone;
    }

    if (info.includes('tablet') || info.includes('ipad')) {
      return Tablet;
    }

    return Monitor;
  };

  // 点击外部区域关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  const handleMenuClick = () => {
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }
    window.location.href = '/';
  };

  const handleAdminPanel = () => {
    router.push('/admin');
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleSubscribe = async () => {
    setIsOpen(false);
    setIsSubscribeOpen(true);
    setCopySuccess(false);
    // 懒加载:打开面板时才请求订阅URL
    await fetchSubscribeUrl();
  };

  const handleCloseSubscribe = () => {
    setIsSubscribeOpen(false);
    setCopySuccess(false);
  };

  const handleAdFilterToggle = async (checked: boolean) => {
    setAdFilterEnabled(checked);
    // 当去广告开关改变时,重新获取订阅URL，传入新的值
    await fetchSubscribeUrl(checked);
  };

  const handleCopySubscribeUrl = async () => {
    try {
      await navigator.clipboard.writeText(subscribeUrl);
      setCopySuccess(true);
      setTimeout(() => {
        setCopySuccess(false);
      }, 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const handleSubmitChangePassword = async () => {
    setPasswordError('');

    // 验证密码
    if (!newPassword) {
      setPasswordError('新密码不得为空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordError(data.error || '修改密码失败');
        return;
      }

      // 修改成功，关闭弹窗并登出
      setIsChangePasswordOpen(false);
      await handleLogout();
    } catch (error) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  // 设置相关的处理函数
  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
    }
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrl', value);
    }
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(value));
    }
  };

  const handleSpeedTestTimeoutChange = (value: number) => {
    setSpeedTestTimeout(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speedTestTimeout', String(value));
    }
  };

  const handleMaxConcurrentDownloadsChange = (value: number) => {
    setMaxConcurrentDownloads(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('maxConcurrentDownloads', String(value));
    }
  };

  const handleFluidSearchToggle = (value: boolean) => {
    setFluidSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fluidSearch', JSON.stringify(value));
    }
  };

  const handleLiveDirectConnectToggle = (value: boolean) => {
    setLiveDirectConnect(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('liveDirectConnect', JSON.stringify(value));
    }
  };

  const handleTmdbBackdropDisabledToggle = (value: boolean) => {
    setTmdbBackdropDisabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('tmdb_backdrop_disabled', String(value));
    }
  };

  const handleEnableTrailersToggle = (value: boolean) => {
    setEnableTrailers(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableTrailers', String(value));
    }
  };

  const handleDoubanDataSourceChange = (value: string) => {
    setDoubanDataSource(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanDataSource', value);
    }
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyType', value);
    }
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrl', value);
    }
  };

  const handleTmdbImageBaseUrlChange = (value: string) => {
    setTmdbImageBaseUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('tmdbImageBaseUrl', value);
    }
  };

  const handleBufferStrategyChange = (value: string) => {
    setBufferStrategy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('bufferStrategy', value);
    }
  };

  // 将滑块值转换为策略值
  const getBufferStrategyFromSlider = (sliderValue: number): string => {
    const strategies = ['low', 'medium', 'high', 'ultra'];
    return strategies[sliderValue] || 'medium';
  };

  // 将策略值转换为滑块值
  const getSliderValueFromStrategy = (strategy: string): number => {
    const strategies = ['low', 'medium', 'high', 'ultra'];
    const index = strategies.indexOf(strategy);
    return index >= 0 ? index : 1; // 默认返回 1 (medium)
  };

  const handleNextEpisodePreCacheToggle = (value: boolean) => {
    setNextEpisodePreCache(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nextEpisodePreCache', String(value));
    }
  };

  const handleNextEpisodeDanmakuPreloadToggle = (value: boolean) => {
    setNextEpisodeDanmakuPreload(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nextEpisodeDanmakuPreload', String(value));
    }
  };

  const handleDisableAutoLoadDanmakuToggle = (value: boolean) => {
    setDisableAutoLoadDanmaku(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('disableAutoLoadDanmaku', String(value));
    }
  };

  const handleDanmakuMaxCountChange = (value: number) => {
    setDanmakuMaxCount(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('danmakuMaxCount', String(value));
    }
  };

  const handleDanmakuHeatmapDisabledToggle = (value: boolean) => {
    setDanmakuHeatmapDisabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('danmaku_heatmap_disabled', String(value));
    }
  };

  const handleSearchTraditionalToSimplifiedToggle = (value: boolean) => {
    setSearchTraditionalToSimplified(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('searchTraditionalToSimplified', String(value));
    }
  };

  const handleExactSearchToggle = (value: boolean) => {
    setExactSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('exactSearch', String(value));
    }
  };

  const handleHomeBannerToggle = (value: boolean) => {
    setHomeBannerEnabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeBannerEnabled', String(value));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  const handleHomeContinueWatchingToggle = (value: boolean) => {
    setHomeContinueWatchingEnabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeContinueWatchingEnabled', String(value));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  // 首页模块配置处理函数
  const handleHomeModuleToggle = (id: string, enabled: boolean) => {
    const updatedModules = homeModules.map(module =>
      module.id === id ? { ...module, enabled } : module
    );
    setHomeModules(updatedModules);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeModules', JSON.stringify(updatedModules));
      // 触发自定义事件通知首页刷新
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  const handleHomeModuleMoveUp = (index: number) => {
    if (index === 0) return;
    const updatedModules = [...homeModules];
    const temp = updatedModules[index];
    updatedModules[index] = updatedModules[index - 1];
    updatedModules[index - 1] = temp;
    // 更新order
    updatedModules.forEach((module, idx) => {
      module.order = idx;
    });
    setHomeModules(updatedModules);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeModules', JSON.stringify(updatedModules));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  const handleHomeModuleMoveDown = (index: number) => {
    if (index === homeModules.length - 1) return;
    const updatedModules = [...homeModules];
    const temp = updatedModules[index];
    updatedModules[index] = updatedModules[index + 1];
    updatedModules[index + 1] = temp;
    // 更新order
    updatedModules.forEach((module, idx) => {
      module.order = idx;
    });
    setHomeModules(updatedModules);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeModules', JSON.stringify(updatedModules));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  // 获取感谢信息
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent';
    const defaultDoubanProxy =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    const defaultDoubanImageProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent';
    const defaultDoubanImageProxyUrl =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
    const defaultFluidSearch =
      (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;

    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setFluidSearch(defaultFluidSearch);
    setLiveDirectConnect(false);
    setTmdbBackdropDisabled(false);
    setEnableTrailers(false);
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
    setTmdbImageBaseUrl('https://image.tmdb.org');
    setBufferStrategy('medium');
    setNextEpisodePreCache(true);
    setNextEpisodeDanmakuPreload(true);
    setDisableAutoLoadDanmaku(false);
    setHomeBannerEnabled(true);
    setHomeContinueWatchingEnabled(true);
    setHomeModules(defaultHomeModules);
    setSearchTraditionalToSimplified(false);

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('fluidSearch', JSON.stringify(defaultFluidSearch));
      localStorage.setItem('liveDirectConnect', JSON.stringify(false));
      localStorage.setItem('tmdb_backdrop_disabled', 'false');
      localStorage.setItem('enableTrailers', 'false');
      localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
      localStorage.setItem('doubanDataSource', defaultDoubanProxyType);
      localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
      localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);
      localStorage.setItem('tmdbImageBaseUrl', 'https://image.tmdb.org');
      localStorage.setItem('bufferStrategy', 'medium');
      localStorage.setItem('nextEpisodePreCache', 'true');
      localStorage.setItem('nextEpisodeDanmakuPreload', 'true');
      localStorage.setItem('disableAutoLoadDanmaku', 'false');
      localStorage.setItem('danmakuMaxCount', '0');
      localStorage.setItem('danmaku_heatmap_disabled', 'false');
      localStorage.setItem('homeBannerEnabled', 'true');
      localStorage.setItem('homeContinueWatchingEnabled', 'true');
      localStorage.setItem('homeModules', JSON.stringify(defaultHomeModules));
      localStorage.setItem('searchTraditionalToSimplified', 'false');
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  // 清除弹幕缓存
  const handleClearDanmakuCache = async () => {
    setIsClearingCache(true);
    setClearCacheMessage(null);

    try {
      await clearAllDanmakuCache();
      setClearCacheMessage('弹幕缓存已清除成功！');
      console.log('弹幕缓存已清除');

      // 3秒后自动清除提示
      setTimeout(() => {
        setClearCacheMessage(null);
      }, 3000);
    } catch (error) {
      console.error('清除弹幕缓存失败:', error);
      setClearCacheMessage('清除失败，请重试');

      // 3秒后自动清除提示
      setTimeout(() => {
        setClearCacheMessage(null);
      }, 3000);
    } finally {
      setIsClearingCache(false);
    }
  };

  // 检查是否显示管理面板按钮
  const showAdminPanel =
    (authInfo?.role === 'owner' || authInfo?.role === 'admin') &&
    storageType !== 'localstorage';

  // 检查是否显示离线下载按钮
  const showOfflineDownload =
    (authInfo?.role === 'owner' || authInfo?.role === 'admin') &&
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.ENABLE_OFFLINE_DOWNLOAD === true;

  // 检查是否显示修改密码按钮
  const showChangePassword =
    authInfo?.role !== 'owner' && storageType !== 'localstorage';

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站长';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      default:
        return '';
    }
  };

  // 菜单面板内容
  const menuPanel = (
    <>
      {/* 背景遮罩 - 普通菜单无需模糊 */}
      <div
        className='fixed inset-0 bg-transparent z-[1000]'
        onClick={handleCloseMenu}
      />

      {/* 菜单面板 */}
      <div className='fixed top-14 right-4 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-xl z-[1001] border border-gray-200/50 dark:border-gray-700/50 overflow-hidden select-none'>
        {/* 用户信息区域 */}
        <div className='px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-0.5'>
                <span className='text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  当前用户
                </span>
                {/* 邮件设置图标按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(false);
                    setIsEmailSettingsOpen(true);
                    // 懒加载:打开面板时才请求邮件设置
                    loadEmailSettings();
                  }}
                  className='p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                  title='邮件通知设置'
                >
                  <Mail className='w-3 h-3 text-gray-500 dark:text-gray-400' />
                </button>
                {/* 设备管理图标按钮 */}
                {storageType !== 'localstorage' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(false);
                      setIsDeviceManagementOpen(true);
                      // 懒加载:打开面板时才请求设备列表
                      loadDevices();
                    }}
                    className='p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                    title='设备管理'
                  >
                    <Monitor className='w-3 h-3 text-gray-500 dark:text-gray-400' />
                  </button>
                )}
              </div>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${(authInfo?.role || 'user') === 'owner'
                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                  : (authInfo?.role || 'user') === 'admin'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  }`}
              >
                {getRoleText(authInfo?.role || 'user')}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <div className='font-semibold text-gray-900 dark:text-gray-100 text-sm truncate'>
                {authInfo?.username || 'default'}
              </div>
              <div className='text-[10px] text-gray-400 dark:text-gray-500'>
                数据存储：
                {storageType === 'localstorage' ? '本地' : storageType}
              </div>
            </div>
          </div>
        </div>

        {/* 菜单项 */}
        <div className='py-1'>
          {/* 通知按钮 */}
          <button
            onClick={() => {
              setIsOpen(false);
              setIsNotificationPanelOpen(true);
            }}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm relative'
          >
            <Bell className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>通知中心</span>
            {unreadCount > 0 && (
              <span className='ml-auto px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded-full'>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* 我的收藏按钮 */}
          <button
            onClick={() => {
              setIsOpen(false);
              setIsFavoritesPanelOpen(true);
            }}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm relative'
          >
            <Star className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>我的收藏</span>
          </button>

          {/* 设置按钮 */}
          <button
            onClick={handleSettings}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
          >
            <Settings className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>设置</span>
          </button>

          {/* 管理面板按钮 */}
          {showAdminPanel && (
            <button
              onClick={handleAdminPanel}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <Shield className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>管理面板</span>
            </button>
          )}

          {/* 离线下载按钮 */}
          {showOfflineDownload && (
            <button
              onClick={() => {
                setIsOfflineDownloadPanelOpen(true);
                setIsOpen(false);
              }}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <Download className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>离线下载</span>
            </button>
          )}

          {/* 修改密码按钮 */}
          {showChangePassword && (
            <button
              onClick={handleChangePassword}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <KeyRound className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>修改密码</span>
            </button>
          )}

          {/* 订阅按钮 */}
          {subscribeEnabled && (
            <button
              onClick={handleSubscribe}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <Rss className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>订阅</span>
            </button>
          )}

          {/* 生态应用按钮 */}
          <button
            onClick={() => {
              setIsOpen(false);
              setIsEcoAppsOpen(true);
            }}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
          >
            <Package className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>生态应用</span>
          </button>

          {/* 分割线 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 登出按钮 */}
          <button
            onClick={handleLogout}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm'
          >
            <LogOut className='w-4 h-4' />
            <span className='font-medium'>登出</span>
          </button>

          {/* 分割线 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 版本信息 */}
          <button
            onClick={() => {
              setIsVersionPanelOpen(true);
              handleCloseMenu();
            }}
            className='w-full px-3 py-2 text-center flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-xs'
          >
            <div className='flex items-center gap-1'>
              <span className='font-mono'>v{CURRENT_VERSION}</span>
              {!isChecking &&
                updateStatus &&
                updateStatus !== UpdateStatus.FETCH_FAILED && (
                  <div
                    className={`w-2 h-2 rounded-full -translate-y-2 ${updateStatus === UpdateStatus.HAS_UPDATE
                      ? 'bg-yellow-500'
                      : updateStatus === UpdateStatus.NO_UPDATE
                        ? 'bg-green-400'
                        : ''
                      }`}
                  ></div>
                )}
            </div>
          </button>
        </div>
      </div>
    </>
  );

  // 设置面板内容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseSettings}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 设置面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col'
      >
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='flex-1 px-4 py-6 md:p-6 overflow-y-auto'
          data-panel-content
          style={{
            touchAction: 'pan-y', // 只允许垂直滚动
            overscrollBehavior: 'contain', // 防止滚动冒泡
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                本地设置
              </h3>
              <button
                onClick={handleResetSettings}
                className='px-2 py-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors'
                title='重置为默认设置'
              >
                恢复默认
              </button>
            </div>
            <button
              onClick={handleCloseSettings}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 设置项 */}
          <div className='space-y-3 md:space-y-4'>
            {/* 豆瓣设置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsDoubanSectionOpen(!isDoubanSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Globe className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    网络设置
                  </h3>
                </div>
                {isDoubanSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isDoubanSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  {/* 豆瓣数据源选择 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣数据代理
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        选择获取豆瓣数据的方式
                      </p>
                    </div>
                    <div className='relative' data-dropdown='douban-datasource'>
                      {/* 自定义下拉选择框 */}
                      <button
                        type='button'
                        onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanDataSourceOptions.find(
                            (option) => option.value === doubanDataSource
                          )?.label
                        }
                      </button>

                      {/* 下拉箭头 */}
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isDoubanDropdownOpen ? 'rotate-180' : ''
                            }`}
                        />
                      </div>

                      {/* 下拉选项列表 */}
                      {isDoubanDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanDataSourceOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanDataSourceChange(option.value);
                                setIsDoubanDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${doubanDataSource === option.value
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                : 'text-gray-900 dark:text-gray-100'
                                }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanDataSource === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 感谢信息 */}
                    {getThanksInfo(doubanDataSource) && (
                      <div className='mt-3'>
                        <button
                          type='button'
                          onClick={() =>
                            window.open(getThanksInfo(doubanDataSource)!.url, '_blank')
                          }
                          className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                        >
                          <span className='font-medium'>
                            {getThanksInfo(doubanDataSource)!.text}
                          </span>
                          <ExternalLink className='w-3.5 opacity-70' />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
                  {doubanDataSource === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          自定义代理服务器地址
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanProxyUrl}
                        onChange={(e) => handleDoubanProxyUrlChange(e.target.value)}
                      />
                    </div>
                  )}

                  {/* 分割线 */}
                  <div className='border-t border-gray-200 dark:border-gray-700'></div>

                  {/* 豆瓣图片代理设置 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣图片代理
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        选择获取豆瓣图片的方式
                      </p>
                    </div>
                    <div className='relative' data-dropdown='douban-image-proxy'>
                      {/* 自定义下拉选择框 */}
                      <button
                        type='button'
                        onClick={() =>
                          setIsDoubanImageProxyDropdownOpen(
                            !isDoubanImageProxyDropdownOpen
                          )
                        }
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanImageProxyTypeOptions.find(
                            (option) => option.value === doubanImageProxyType
                          )?.label
                        }
                      </button>

                      {/* 下拉箭头 */}
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isDoubanDropdownOpen ? 'rotate-180' : ''
                            }`}
                        />
                      </div>

                      {/* 下拉选项列表 */}
                      {isDoubanImageProxyDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanImageProxyTypeOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanImageProxyTypeChange(option.value);
                                setIsDoubanImageProxyDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${doubanImageProxyType === option.value
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                : 'text-gray-900 dark:text-gray-100'
                                }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanImageProxyType === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 感谢信息 */}
                    {getThanksInfo(doubanImageProxyType) && (
                      <div className='mt-3'>
                        <button
                          type='button'
                          onClick={() =>
                            window.open(
                              getThanksInfo(doubanImageProxyType)!.url,
                              '_blank'
                            )
                          }
                          className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                        >
                          <span className='font-medium'>
                            {getThanksInfo(doubanImageProxyType)!.text}
                          </span>
                          <ExternalLink className='w-3.5 opacity-70' />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 豆瓣图片代理地址设置 - 仅在选择自定义代理时显示 */}
                  {doubanImageProxyType === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣图片代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          自定义图片代理服务器地址
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanImageProxyUrl}
                        onChange={(e) =>
                          handleDoubanImageProxyUrlChange(e.target.value)
                        }
                      />
                    </div>
                  )}

                  {/* 分割线 */}
                  <div className='border-t border-gray-200 dark:border-gray-700'></div>

                  {/* TMDB 图片网络请求地址设置 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        TMDB 图片网络请求地址
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        TMDB 图片的 Base URL（默认: https://image.tmdb.org）
                      </p>
                    </div>
                    <input
                      type='text'
                      className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                      placeholder='例如: https://image.tmdb.org'
                      value={tmdbImageBaseUrl}
                      onChange={(e) =>
                        handleTmdbImageBaseUrlChange(e.target.value)
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsUsageSectionOpen(!isUsageSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Sliders className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    通用设置
                  </h3>
                </div>
                {isUsageSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isUsageSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  {/* 默认聚合搜索结果 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        默认聚合搜索结果
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        搜索时默认按标题和年份聚合显示结果
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={defaultAggregateSearch}
                          onChange={(e) => handleAggregateToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 优选和测速 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        优选和测速
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        如出现播放器劫持问题可关闭
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={enableOptimization}
                          onChange={(e) => handleOptimizationToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 测速超时设置 */}
                  {enableOptimization && (
                    <div className='ml-4 mt-2 space-y-2'>
                      <div className='flex items-center justify-between'>
                        <span className='text-xs text-gray-600 dark:text-gray-400'>
                          换源面板测速超时
                        </span>
                        <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                          {speedTestTimeout / 1000}秒
                        </span>
                      </div>
                      <div className='flex items-center gap-2'>
                        <input
                          type='range'
                          min='4000'
                          max='30000'
                          step='1000'
                          value={speedTestTimeout}
                          onChange={(e) => handleSpeedTestTimeoutChange(Number(e.target.value))}
                          className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                          style={{
                            background: `linear-gradient(to right, #10b981 0%, #10b981 ${((speedTestTimeout - 4000) / (30000 - 4000)) * 100}%, #e5e7eb ${((speedTestTimeout - 4000) / (30000 - 4000)) * 100}%, #e5e7eb 100%)`
                          }}
                        />
                      </div>
                      <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(4000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 4000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          4秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(10000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 10000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          10秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(20000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 20000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          20秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(30000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 30000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          30秒
                        </button>
                      </div>
                      <p className='text-xs text-gray-500 dark:text-gray-400 italic'>
                        注：此设置仅对换源面板测速生效，优选播放源时仍使用4秒超时
                      </p>
                    </div>
                  )}

                  {/* 流式搜索 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        流式搜索输出
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        启用搜索结果实时流式输出，关闭后使用传统一次性搜索
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={fluidSearch}
                          onChange={(e) => handleFluidSearchToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 直播视频浏览器直连 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        IPTV 视频浏览器直连
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        开启 IPTV 视频浏览器直连时，需要自备 Allow CORS 插件
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={liveDirectConnect}
                          onChange={(e) => handleLiveDirectConnectToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 禁用背景图渲染 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        禁用背景图渲染
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        关闭播放页面的TMDB背景图显示（需手动刷新页面生效）
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={tmdbBackdropDisabled}
                          onChange={(e) => handleTmdbBackdropDisabledToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 启用预告片 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        首页预告片
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        在首页轮播图中显示视频预告片（需刷新页面生效）
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={enableTrailers}
                          onChange={(e) => handleEnableTrailersToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 搜索繁体转简体 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        搜索繁体转简体
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        搜索时自动将繁体中文转换为简体中文
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={searchTraditionalToSimplified}
                          onChange={(e) => handleSearchTraditionalToSimplifiedToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 精确搜索 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        精确搜索
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        开启后，搜索结果将过滤掉不包含搜索词的内容
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={exactSearch}
                          onChange={(e) => handleExactSearchToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 分割线 */}
                  <div className='border-t border-gray-200 dark:border-gray-700'></div>

                  {/* 最大同时下载限制 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        最大同时下载限制
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        控制播放页面下载时的同时下载数量
                      </p>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-gray-600 dark:text-gray-400'>
                        同时下载数量
                      </span>
                      <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                        {maxConcurrentDownloads}个
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='1'
                        max='10'
                        step='1'
                        value={maxConcurrentDownloads}
                        onChange={(e) => handleMaxConcurrentDownloadsChange(Number(e.target.value))}
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${((maxConcurrentDownloads - 1) / (10 - 1)) * 100}%, #e5e7eb ${((maxConcurrentDownloads - 1) / (10 - 1)) * 100}%, #e5e7eb 100%)`
                        }}
                      />
                    </div>
                    <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(1)}
                        className={`px-2 py-0.5 rounded ${maxConcurrentDownloads === 1 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        1个
                      </button>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(3)}
                        className={`px-2 py-0.5 rounded ${maxConcurrentDownloads === 3 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        3个
                      </button>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(6)}
                        className={`px-2 py-0.5 rounded ${maxConcurrentDownloads === 6 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        6个
                      </button>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(10)}
                        className={`px-2 py-0.5 rounded ${maxConcurrentDownloads === 10 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        10个
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 缓冲设置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsBufferSectionOpen(!isBufferSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Gauge className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    缓冲设置
                  </h3>
                </div>
                {isBufferSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isBufferSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  <div>
                    <p className='text-xs text-gray-500 dark:text-gray-400'>
                      调整播放器缓冲策略（仅在播放页面生效）
                    </p>
                  </div>

                  {/* 缓冲策略 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        缓冲策略
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        设置视频缓冲块大小，影响播放流畅度和流量消耗
                      </p>
                    </div>

                    {/* 滑块控件 */}
                    <div className='space-y-2'>
                      <input
                        type='range'
                        min='0'
                        max='3'
                        step='1'
                        value={getSliderValueFromStrategy(bufferStrategy)}
                        onChange={(e) => {
                          const sliderValue = parseInt(e.target.value);
                          const strategy = getBufferStrategyFromSlider(sliderValue);
                          handleBufferStrategyChange(strategy);
                        }}
                        className='w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500'
                        style={{
                          background: `linear-gradient(to right, rgb(34 197 94) 0%, rgb(34 197 94) ${(getSliderValueFromStrategy(bufferStrategy) / 3) * 100}%, rgb(229 231 235) ${(getSliderValueFromStrategy(bufferStrategy) / 3) * 100}%, rgb(229 231 235) 100%)`
                        }}
                      />

                      {/* 标签显示 */}
                      <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1'>
                        <span className={bufferStrategy === 'low' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          低缓冲
                        </span>
                        <span className={bufferStrategy === 'medium' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          中缓冲
                        </span>
                        <span className={bufferStrategy === 'high' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          高缓冲
                        </span>
                        <span className={bufferStrategy === 'ultra' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          超高缓冲
                        </span>
                      </div>

                      {/* 当前选择的说明 */}
                      <div className='text-center text-sm font-medium text-gray-700 dark:text-gray-300 mt-2'>
                        {
                          bufferStrategyOptions.find(
                            (option) => option.value === bufferStrategy
                          )?.label
                        }
                      </div>
                    </div>
                  </div>

                  {/* 下集预缓冲 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        下集预缓冲
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        播放进度达到90%时，自动预缓冲下一集内容
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={nextEpisodePreCache}
                          onChange={(e) => handleNextEpisodePreCacheToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* 弹幕设置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsDanmakuSectionOpen(!isDanmakuSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <MessageSquare className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    弹幕设置
                  </h3>
                </div>
                {isDanmakuSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isDanmakuSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  {/* 禁用自动装填弹幕 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        禁用自动装填弹幕
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        开启后，播放页面不会自动匹配弹幕，只能手动匹配
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={disableAutoLoadDanmaku}
                          onChange={(e) => handleDisableAutoLoadDanmakuToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 下集弹幕预加载 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        下集弹幕预加载
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        播放进度达到90%时，自动预加载下一集弹幕
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={nextEpisodeDanmakuPreload}
                          onChange={(e) => handleNextEpisodeDanmakuPreloadToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 禁用弹幕热力图 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        禁用弹幕热力图
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        开启后不显示弹幕热力图和热力图开关
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={danmakuHeatmapDisabled}
                          onChange={(e) => handleDanmakuHeatmapDisabledToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 弹幕加载上限 */}
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-gray-600 dark:text-gray-400'>
                        弹幕加载上限
                      </span>
                      <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                        {danmakuMaxCount === 0 ? '无上限' : `${danmakuMaxCount} 条`}
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='0'
                        max='10000'
                        step='100'
                        value={danmakuMaxCount}
                        onChange={(e) => handleDanmakuMaxCountChange(parseInt(e.target.value))}
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${(danmakuMaxCount / 10000) * 100}%, #e5e7eb ${(danmakuMaxCount / 10000) * 100}%, #e5e7eb 100%)`
                        }}
                      />
                    </div>
                    <div className='relative text-xs text-gray-500 dark:text-gray-400' style={{ height: '24px' }}>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(0)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 0 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '0%', transform: 'translateX(0%)' }}
                      >
                        无上限
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(3000)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 3000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '30%', transform: 'translateX(-50%)' }}
                      >
                        3000
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(5000)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 5000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '50%', transform: 'translateX(-50%)' }}
                      >
                        5000
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(10000)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 10000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '100%', transform: 'translateX(-100%)' }}
                      >
                        10000
                      </button>
                    </div>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                      限制加载的弹幕数量，减少性能消耗
                    </p>
                  </div>

                  {/* 清除弹幕缓存 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        弹幕缓存管理
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        清除所有已缓存的弹幕数据
                      </p>
                    </div>
                    <button
                      onClick={handleClearDanmakuCache}
                      disabled={isClearingCache}
                      className='w-full px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-red-400 dark:bg-red-600 dark:hover:bg-red-700 dark:disabled:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed flex items-center justify-center gap-2'
                    >
                      {isClearingCache ? (
                        <>
                          <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                          <span>清除中...</span>
                        </>
                      ) : (
                        <>
                          <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' />
                          </svg>
                          <span>清除弹幕缓存</span>
                        </>
                      )}
                    </button>

                    {/* 成功/失败提示 */}
                    {clearCacheMessage && (
                      <div className={`text-sm p-3 rounded-lg border ${
                        clearCacheMessage.includes('成功')
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                      }`}>
                        {clearCacheMessage}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 首页设置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsHomepageSectionOpen(!isHomepageSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Home className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    首页设置
                  </h3>
                </div>
                {isHomepageSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isHomepageSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  <div>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mb-3'>
                      配置首页模块的显示顺序和可见性
                    </p>
                  </div>

                  {/* 首页顶部组件显示 */}
                  <div className='space-y-2'>
                    <div className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
                      <button
                        onClick={() => handleHomeBannerToggle(!homeBannerEnabled)}
                        className='flex-shrink-0'
                        title={homeBannerEnabled ? '点击隐藏' : '点击显示'}
                      >
                        {homeBannerEnabled ? (
                          <Eye className='w-5 h-5 text-green-600 dark:text-green-400' />
                        ) : (
                          <EyeOff className='w-5 h-5 text-gray-400 dark:text-gray-500' />
                        )}
                      </button>
                      <div className='flex-1'>
                        <span className={`text-sm font-medium ${
                          homeBannerEnabled
                            ? 'text-gray-900 dark:text-gray-100'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}>
                          首页轮播图
                        </span>
                      </div>
                    </div>

                    <div className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
                      <button
                        onClick={() => handleHomeContinueWatchingToggle(!homeContinueWatchingEnabled)}
                        className='flex-shrink-0'
                        title={homeContinueWatchingEnabled ? '点击隐藏' : '点击显示'}
                      >
                        {homeContinueWatchingEnabled ? (
                          <Eye className='w-5 h-5 text-green-600 dark:text-green-400' />
                        ) : (
                          <EyeOff className='w-5 h-5 text-gray-400 dark:text-gray-500' />
                        )}
                      </button>
                      <div className='flex-1'>
                        <span className={`text-sm font-medium ${
                          homeContinueWatchingEnabled
                            ? 'text-gray-900 dark:text-gray-100'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}>
                          继续观看
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 模块列表 */}
                  <div className='space-y-2'>
                    {homeModules.map((module, index) => (
                      <div
                        key={module.id}
                        className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'
                      >
                        {/* 左侧：显示/隐藏开关 */}
                        <button
                          onClick={() => handleHomeModuleToggle(module.id, !module.enabled)}
                          className='flex-shrink-0'
                          title={module.enabled ? '点击隐藏' : '点击显示'}
                        >
                          {module.enabled ? (
                            <Eye className='w-5 h-5 text-green-600 dark:text-green-400' />
                          ) : (
                            <EyeOff className='w-5 h-5 text-gray-400 dark:text-gray-500' />
                          )}
                        </button>

                        {/* 中间：模块名称 */}
                        <div className='flex-1'>
                          <span className={`text-sm font-medium ${
                            module.enabled
                              ? 'text-gray-900 dark:text-gray-100'
                              : 'text-gray-400 dark:text-gray-500'
                          }`}>
                            {module.name}
                          </span>
                        </div>

                        {/* 右侧：上下移动按钮 */}
                        <div className='flex gap-1'>
                          <button
                            onClick={() => handleHomeModuleMoveUp(index)}
                            disabled={index === 0}
                            className='p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                            title='上移'
                          >
                            <MoveUp className='w-4 h-4 text-gray-600 dark:text-gray-400' />
                          </button>
                          <button
                            onClick={() => handleHomeModuleMoveDown(index)}
                            disabled={index === homeModules.length - 1}
                            className='p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                            title='下移'
                          >
                            <MoveDown className='w-4 h-4 text-gray-600 dark:text-gray-400' />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 恢复默认按钮 */}
                  <button
                    onClick={() => {
                      setHomeModules(defaultHomeModules);
                      setHomeBannerEnabled(true);
                      setHomeContinueWatchingEnabled(true);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('homeModules', JSON.stringify(defaultHomeModules));
                        localStorage.setItem('homeBannerEnabled', 'true');
                        localStorage.setItem('homeContinueWatchingEnabled', 'true');
                        window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
                      }
                    }}
                    className='w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors'
                  >
                    恢复默认配置
                  </button>

                  {/* 提示信息 */}
                  <div className='text-xs text-gray-500 dark:text-gray-400 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg'>
                    <p>💡 提示：点击眼睛图标可显示/隐藏模块，使用箭头按钮调整模块顺序</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              这些设置保存在本地浏览器中
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 订阅面板内容
  const subscribePanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseSubscribe}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 订阅面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              订阅
            </h3>
            <button
              onClick={handleCloseSubscribe}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 内容 */}
          <div className='space-y-4'>
            {/* 去广告开关 */}
            <div className='flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  去广告
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  开启后自动过滤视频广告
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={adFilterEnabled}
                    onChange={(e) => handleAdFilterToggle(e.target.checked)}
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* TVBOX订阅 */}
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                TVBOX订阅
              </h4>
              <div className='flex gap-2'>
                <input
                  type='text'
                  className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 cursor-not-allowed'
                  value={subscribeUrl}
                  disabled
                  readOnly
                />
                <button
                  onClick={handleCopySubscribeUrl}
                  className='px-4 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2'
                >
                  <Copy className='w-4 h-4' />
                  {copySuccess ? '已复制' : '复制'}
                </button>
              </div>
            </div>
          </div>

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              将订阅链接复制到TVBOX应用中使用
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 修改密码面板内容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseChangePassword}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 修改密码面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            // 阻止事件冒泡到遮罩层，但允许内部滚动
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto', // 允许所有触摸操作
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              修改密码
            </h3>
            <button
              onClick={handleCloseChangePassword}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 表单 */}
          <div className='space-y-4'>
            {/* 新密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                新密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请输入新密码'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 确认密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                确认密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请再次输入新密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 错误信息 */}
            {passwordError && (
              <div className='text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800'>
                {passwordError}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className='flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <button
              onClick={handleCloseChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              onClick={handleSubmitChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={passwordLoading || !newPassword || !confirmPassword}
            >
              {passwordLoading ? '修改中...' : '确认修改'}
            </button>
          </div>

          {/* 底部说明 */}
          <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              修改密码后需要重新登录
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 邮件设置面板内容
  const emailSettingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={() => setIsEmailSettingsOpen(false)}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 邮件设置面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              邮件通知设置
            </h3>
            <button
              onClick={() => setIsEmailSettingsOpen(false)}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 表单 */}
          {emailSettingsLoading ? (
            <div className='space-y-4'>
              {/* 加载骨架屏 */}
              <div className='animate-pulse'>
                <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-2'></div>
                <div className='h-10 bg-gray-200 dark:bg-gray-700 rounded'></div>
              </div>
              <div className='animate-pulse'>
                <div className='h-20 bg-gray-200 dark:bg-gray-700 rounded'></div>
              </div>
              <div className='animate-pulse'>
                <div className='h-10 bg-gray-200 dark:bg-gray-700 rounded'></div>
              </div>
              <div className='text-center text-sm text-gray-500 dark:text-gray-400'>
                加载中...
              </div>
            </div>
          ) : (
            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  邮箱地址
                </label>
                <input
                  type='email'
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder='输入您的邮箱地址'
                  disabled={emailSettingsSaving}
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
                />
              </div>

              <div className='flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    接收收藏更新通知
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    当收藏的影片有更新时发送邮件通知
                  </p>
                </div>
                <button
                  onClick={() => setEmailNotifications(!emailNotifications)}
                  disabled={emailSettingsSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    emailNotifications ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      emailNotifications ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <button
                onClick={handleSaveEmailSettings}
                disabled={emailSettingsSaving}
                className='w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2'
              >
                {emailSettingsSaving ? (
                  <>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                    <span>保存中...</span>
                  </>
                ) : (
                  '保存设置'
                )}
              </button>

              <p id='email-settings-message' className='text-xs text-center hidden'></p>
            </div>
          )}

          {/* 提示信息 */}
          <div className='mt-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg'>
            <p className='text-xs text-blue-800 dark:text-blue-200'>
              💡 提示：需要管理员先在管理面板中配置邮件服务
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 设备管理面板内容
  const deviceManagementPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={() => setIsDeviceManagementOpen(false)}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 设备管理面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        <div
          className='h-full max-h-[80vh] flex flex-col'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              设备管理
            </h3>
            <button
              onClick={() => setIsDeviceManagementOpen(false)}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 设备列表 */}
          <div className='flex-1 overflow-y-auto p-6'>
            {devicesLoading ? (
              <div className='space-y-3'>
                {[1, 2, 3].map((i) => (
                  <div key={i} className='animate-pulse'>
                    <div className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg'></div>
                  </div>
                ))}
                <div className='text-center text-sm text-gray-500 dark:text-gray-400 mt-4'>
                  加载中...
                </div>
              </div>
            ) : devices.length === 0 ? (
              <div className='text-center py-8'>
                <Monitor className='w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-3' />
                <p className='text-sm text-gray-500 dark:text-gray-400'>暂无登录设备</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {devices
                  .sort((a, b) => {
                    // 当前设备置顶
                    if (a.isCurrent && !b.isCurrent) return -1;
                    if (!a.isCurrent && b.isCurrent) return 1;
                    return 0;
                  })
                  .map((device) => {
                  const DeviceIcon = getDeviceIcon(device.deviceInfo);
                  return (
                    <div
                      key={device.tokenId}
                      className={`p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border ${
                        device.isCurrent
                          ? 'border-yellow-400 dark:border-yellow-500'
                          : 'border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <div className='flex items-start justify-between'>
                        <div className='flex-1'>
                          <div className='flex items-center gap-2 mb-2'>
                            <DeviceIcon className='w-4 h-4 text-gray-600 dark:text-gray-400' />
                            <span className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                              {device.deviceInfo}
                            </span>
                            {device.isCurrent && (
                              <span className='px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-full'>
                                当前设备
                              </span>
                            )}
                          </div>
                          <div className='space-y-1 text-xs text-gray-500 dark:text-gray-400'>
                            <div>登录时间: {new Date(device.createdAt).toLocaleString('zh-CN')}</div>
                            <div>最后活跃: {new Date(device.lastUsed).toLocaleString('zh-CN')}</div>
                          </div>
                        </div>
                        {!device.isCurrent && (
                          <button
                            onClick={() => handleRevokeDevice(device.tokenId)}
                            disabled={revoking === device.tokenId}
                            className='ml-3 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                          >
                            {revoking === device.tokenId ? '撤销中...' : '撤销'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部操作 */}
          <div className='p-6 border-t border-gray-200 dark:border-gray-700 space-y-3'>
            <button
              onClick={handleRevokeAllDevices}
              disabled={devices.length === 0}
              className='w-full px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-red-400 dark:bg-red-600 dark:hover:bg-red-700 dark:disabled:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed'
            >
              登出所有设备
            </button>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              登出所有设备后需要重新登录
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 举报信息弹窗
  const reportPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1002]'
        onClick={() => setIsReportOpen(false)}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 举报信息面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1003] overflow-hidden'
      >
        <div
          className='h-full max-h-[70vh] flex flex-col'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              耻辱柱
            </h3>
            <button
              onClick={() => setIsReportOpen(false)}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 内容区域 */}
          <div className='flex-1 overflow-y-auto p-6'>
            <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
              <p className='text-gray-800 dark:text-gray-200 leading-relaxed'>
                抄袭狗<span className='font-bold text-red-600 dark:text-red-400'>SzeMeng76</span>毫无廉耻，盯着本项目的commit区，疯狂抄袭。警告亦全当看不见，实为开源界耻辱。
              </p>
              <p className='text-gray-800 dark:text-gray-200 leading-relaxed mt-3'>
                超分，观影室，豆瓣反爬，精确搜索等等等等，直接抄袭，最不要脸的就是，刚更新一版，几小时后直接抄走。
              </p>
            </div>
          </div>

          {/* 底部按钮 */}
          <div className='p-6 border-t border-gray-200 dark:border-gray-700'>
            <button
              onClick={() => setIsReportOpen(false)}
              className='w-full px-4 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium rounded-lg transition-colors'
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </>
  );

  // 生态应用面板内容
  const ecoAppsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={() => setIsEcoAppsOpen(false)}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 生态应用面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        <div
          className='h-full max-h-[85vh] flex flex-col'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              生态应用
            </h3>
            <div className='flex items-center gap-2'>
              {/* 举报按钮 */}
              <button
                onClick={() => setIsReportOpen(true)}
                className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-lg'
                aria-label='Report'
                title='举报抄袭'
              >
                🐶
              </button>
              {/* 关闭按钮 */}
              <button
                onClick={() => setIsEcoAppsOpen(false)}
                className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                aria-label='Close'
              >
                <X className='w-full h-full' />
              </button>
            </div>
          </div>

          {/* 应用列表 */}
          <div className='flex-1 overflow-y-auto p-6'>
            <div className='grid gap-6 md:grid-cols-1'>
              {/* MoonTVPlus-PC 客户端 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <img
                      src='/logo.png'
                      alt='MoonTVPlus-PC'
                      className='w-16 h-16 rounded-xl object-cover'
                    />
                    <div className='absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center shadow-lg'>
                      <Monitor className='w-3.5 h-3.5 text-white' />
                    </div>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      MoonTVPlus-PC客户端
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      专为Windows开发的客户端，完美支持私人影库mkv视频
                    </p>
                    <a
                      href='https://github.com/mtvpls/MoonTVPlus-PC/releases'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors'
                    >
                      <Download className='w-4 h-4' />
                      下载
                      <ExternalLink className='w-3 h-3' />
                    </a>
                  </div>
                </div>
              </div>

              {/* Selene 跨平台客户端 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <img
                      src='/icons/Selene.png'
                      alt='Selene'
                      className='w-16 h-16 rounded-xl object-cover'
                    />
                    <span className='absolute -top-1 -right-1 px-1.5 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded'>
                      二开
                    </span>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      Selene 跨平台客户端
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      多平台客户端
                    </p>
                    <div className='flex flex-wrap gap-2'>
                      <a
                        href='https://github.com/mtvpls/Selene-Build/releases'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors'
                      >
                        <Download className='w-4 h-4' />
                        下载
                        <ExternalLink className='w-3 h-3' />
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* OrionTV TV专用客户端 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <img
                      src='/icons/OrionTV.png'
                      alt='OrionTV'
                      className='w-16 h-16 rounded-xl object-cover'
                    />
                    <span className='absolute -top-1 -right-1 px-1.5 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded'>
                      二开
                    </span>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      OrionTV TV专用客户端
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      tv专用
                    </p>
                    <a
                      href='https://github.com/mtvpls/MoonTVPlus/releases/tag/OrionTV%E9%80%82%E9%85%8D%E7%89%882'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors'
                    >
                      <Download className='w-4 h-4' />
                      下载
                      <ExternalLink className='w-3 h-3' />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 底部说明 */}
          <div className='p-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              选择适合您设备的客户端下载使用
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          onClick={handleMenuClick}
          className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
          aria-label='User Menu'
        >
          <User className='w-full h-full' />
        </button>
        {/* 版本更新红点 */}
        {updateStatus === UpdateStatus.HAS_UPDATE && (
          <div className='absolute top-[2px] right-[2px] w-2 h-2 bg-yellow-500 rounded-full'></div>
        )}
        {/* 未读通知红点 */}
        {unreadCount > 0 && (
          <div className='absolute top-[2px] right-[2px] w-2 h-2 bg-red-500 rounded-full'></div>
        )}
      </div>

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {/* 使用 Portal 将设置面板渲染到 document.body */}
      {isSettingsOpen && mounted && createPortal(settingsPanel, document.body)}

      {/* 使用 Portal 将修改密码面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}

      {/* 使用 Portal 将订阅面板渲染到 document.body */}
      {isSubscribeOpen &&
        mounted &&
        createPortal(subscribePanel, document.body)}

      {/* 版本面板 */}
      <VersionPanel
        isOpen={isVersionPanelOpen}
        onClose={() => setIsVersionPanelOpen(false)}
      />

      {/* 离线下载面板 */}
      <OfflineDownloadPanel
        isOpen={isOfflineDownloadPanelOpen}
        onClose={() => setIsOfflineDownloadPanelOpen(false)}
      />

      {/* 使用 Portal 将通知面板渲染到 document.body */}
      {isNotificationPanelOpen &&
        mounted &&
        createPortal(
          <NotificationPanel
            isOpen={isNotificationPanelOpen}
            onClose={() => {
              setIsNotificationPanelOpen(false);
              // 不需要在这里刷新，NotificationPanel 内部会触发事件
            }}
          />,
          document.body
        )}

      {/* 使用 Portal 将收藏面板渲染到 document.body */}
      {isFavoritesPanelOpen &&
        mounted &&
        createPortal(
          <FavoritesPanel
            isOpen={isFavoritesPanelOpen}
            onClose={() => setIsFavoritesPanelOpen(false)}
          />,
          document.body
        )}

      {/* 使用 Portal 将邮件设置面板渲染到 document.body */}
      {isEmailSettingsOpen &&
        mounted &&
        createPortal(emailSettingsPanel, document.body)}

      {/* 使用 Portal 将设备管理面板渲染到 document.body */}
      {isDeviceManagementOpen &&
        mounted &&
        createPortal(deviceManagementPanel, document.body)}

      {/* 使用 Portal 将生态应用面板渲染到 document.body */}
      {isEcoAppsOpen &&
        mounted &&
        createPortal(ecoAppsPanel, document.body)}

      {/* 使用 Portal 将举报信息面板渲染到 document.body */}
      {isReportOpen &&
        mounted &&
        createPortal(reportPanel, document.body)}

      {/* 确认对话框 */}
      {confirmDialog.isOpen &&
        mounted &&
        createPortal(
          <div className='fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm'>
            <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md m-4'>
              {/* 标题 */}
              <div className='p-6 border-b border-gray-200 dark:border-gray-700'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  {confirmDialog.title}
                </h3>
              </div>

              {/* 内容 */}
              <div className='p-6'>
                <p className='text-gray-700 dark:text-gray-300'>
                  {confirmDialog.message}
                </p>
              </div>

              {/* 按钮 */}
              <div className='p-6 pt-0 flex gap-3 justify-end'>
                <button
                  onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                  className='px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg transition-colors'
                >
                  取消
                </button>
                <button
                  onClick={confirmDialog.onConfirm}
                  className='px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 rounded-lg transition-colors'
                >
                  确定
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
