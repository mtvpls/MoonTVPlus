/* eslint-disable no-console,@typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  Home,
  LogOut,
  MessageSquare,
  Monitor,
  MoveDown,
  MoveUp,
  Package,
  Router as RouterIcon,
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { clearAllDanmakuCache, getDanmakuCacheStats } from '@/lib/danmaku/api';
import { clearBangumiImageFallbackCache } from '@/lib/utils';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

import { DeviceManagementPanel } from './DeviceManagementPanel';
import { DownloadManagementPanel } from './DownloadManagementPanel';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { FavoritesPanel } from './FavoritesPanel';
import { NotificationPanel } from './NotificationPanel';
import { OfflineDownloadPanel } from './OfflineDownloadPanel';
import { PersonalCenterPanel } from './PersonalCenterPanel';
import TVRemotePanel from './tv/TVRemotePanel';
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
  const [isProfileCenterOpen, setIsProfileCenterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [isOfflineDownloadPanelOpen, setIsOfflineDownloadPanelOpen] =
    useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [isFavoritesPanelOpen, setIsFavoritesPanelOpen] = useState(false);
  const [isEmailSettingsOpen, setIsEmailSettingsOpen] = useState(false);
  const [isDeviceManagementOpen, setIsDeviceManagementOpen] = useState(false);
  const [isEcoAppsOpen, setIsEcoAppsOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isDownloadManagementOpen, setIsDownloadManagementOpen] =
    useState(false);
  const [isTVRemoteOpen, setIsTVRemoteOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [displayStorageType, setDisplayStorageType] =
    useState<string>('localstorage');
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // 订阅相关状态
  const [subscribeEnabled, setSubscribeEnabled] = useState(false);
  const [tvModeEnabled, setTvModeEnabled] = useState(true);
  const [subscribeUrl, setSubscribeUrl] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [orionBaseUrlCopySuccess, setOrionBaseUrlCopySuccess] = useState(false);
  const [tvboxToken, setTvboxToken] = useState('');
  const [isResettingToken, setIsResettingToken] = useState(false);
  const [isLoadingSubscribeUrl, setIsLoadingSubscribeUrl] = useState(false);
  const [subscribeAdFilterEnabled, setSubscribeAdFilterEnabled] =
    useState(false);
  const [subscribeYellowFilterEnabled, setSubscribeYellowFilterEnabled] =
    useState(false);

  // Web 电视扫码登录入口（手机摄像头扫描电视端二维码）
  const [isTvQrScannerOpen, setIsTvQrScannerOpen] = useState(false);
  const [tvQrScannerStatus, setTvQrScannerStatus] = useState('');
  const [tvQrScannerError, setTvQrScannerError] = useState('');
  const tvQrVideoRef = useRef<HTMLVideoElement | null>(null);
  const tvQrStreamRef = useRef<MediaStream | null>(null);
  const tvQrScanStopRef = useRef(false);
  const [tvAccessTab, setTvAccessTab] = useState<'tvbox' | 'orion' | 'web'>('tvbox');

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (
      isProfileCenterOpen ||
      isSettingsOpen ||
      isChangePasswordOpen ||
      isSubscribeOpen ||
      isOfflineDownloadPanelOpen ||
      isEmailSettingsOpen ||
      isDeviceManagementOpen ||
      isEcoAppsOpen ||
      isReportOpen ||
      isDownloadManagementOpen ||
      isTvQrScannerOpen ||
      isTVRemoteOpen
    ) {
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
  }, [
    isProfileCenterOpen,
    isSettingsOpen,
    isChangePasswordOpen,
    isSubscribeOpen,
    isOfflineDownloadPanelOpen,
    isEmailSettingsOpen,
    isDeviceManagementOpen,
    isEcoAppsOpen,
    isReportOpen,
    isDownloadManagementOpen,
    isTvQrScannerOpen,
    isTVRemoteOpen,
  ]);

  // 设置相关状态
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [preferStrategy, setPreferStrategy] = useState<'fast' | 'full'>('fast');
  const [speedTestTimeout, setSpeedTestTimeout] = useState(4000); // 测速超时时间（毫秒）
  const [fluidSearch, setFluidSearch] = useState(true);
  const [tmdbBackdropDisabled, setTmdbBackdropDisabled] = useState(false);
  const [enableTrailers, setEnableTrailers] = useState(false);
  const [doubanDataSource, setDoubanDataSource] = useState(
    'cmliussss-cdn-tencent'
  );
  const [doubanDataSourceBackup, setDoubanDataSourceBackup] =
    useState('direct');
  const [animeDataSource, setAnimeDataSource] = useState('direct');
  const [animeDataSourceBackup, setAnimeDataSourceBackup] =
    useState('server-proxy');
  const [animeCustomBaseUrl, setAnimeCustomBaseUrl] = useState('');
  const [animeImageBaseUrl, setAnimeImageBaseUrl] = useState('');
  const [bangumiProxyScript, setBangumiProxyScript] = useState('');
  const [bangumiProxyScriptCopied, setBangumiProxyScriptCopied] =
    useState(false);
  const [doubanImageProxyType, setDoubanImageProxyType] = useState(
    'cmliussss-cdn-tencent'
  );
  const [doubanImageProxyTypeBackup, setDoubanImageProxyTypeBackup] =
    useState('server');
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');
  const [doubanProxyUrlBackup, setDoubanProxyUrlBackup] = useState('');
  const [doubanImageProxyUrlBackup, setDoubanImageProxyUrlBackup] =
    useState('');
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanBackupDropdownOpen, setIsDoubanBackupDropdownOpen] =
    useState(false);
  const [isAnimeDropdownOpen, setIsAnimeDropdownOpen] = useState(false);
  const [isAnimeBackupDropdownOpen, setIsAnimeBackupDropdownOpen] =
    useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);
  const [
    isDoubanImageProxyBackupDropdownOpen,
    setIsDoubanImageProxyBackupDropdownOpen,
  ] = useState(false);
  const [bufferStrategy, setBufferStrategy] = useState('medium');
  const [nextEpisodePreCache, setNextEpisodePreCache] = useState(true);
  const [nextEpisodeDanmakuPreload, setNextEpisodeDanmakuPreload] =
    useState(true);
  const [disableAutoLoadDanmaku, setDisableAutoLoadDanmaku] = useState(false);
  const [danmakuMaxCount, setDanmakuMaxCount] = useState(0);
  const [danmakuHeatmapDisabled, setDanmakuHeatmapDisabled] = useState(false);
  const [searchTraditionalToSimplified, setSearchTraditionalToSimplified] =
    useState(false);
  const [exactSearch, setExactSearch] = useState(true);
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(6);
  const [downloadThreadsPerTask, setDownloadThreadsPerTask] = useState(6);
  const [downloadSegmentTimeout, setDownloadSegmentTimeout] = useState(30000);
  const [downloadMode, setDownloadMode] = useState<'browser' | 'filesystem'>(
    'browser'
  );
  const [filesystemSavePath, setFilesystemSavePath] = useState<string>('');

  // 通知设置
  const [userEmail, setUserEmail] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [pushNotificationsConfigured, setPushNotificationsConfigured] = useState(false);
  const [pushNotificationsSupported, setPushNotificationsSupported] = useState(false);
  const [pushNotificationsBusy, setPushNotificationsBusy] = useState(false);
  const [emailSettingsLoading, setEmailSettingsLoading] = useState(false);
  const [emailSettingsSaving, setEmailSettingsSaving] = useState(false);
  const [emailSettingsMessage, setEmailSettingsMessage] = useState('');
  const [emailSettingsMessageType, setEmailSettingsMessageType] = useState<
    'success' | 'error' | null
  >(null);

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
    onConfirm: () => undefined,
  });

  // 折叠面板状态
  const [isDoubanSectionOpen, setIsDoubanSectionOpen] = useState(false);

  // TMDB 图片设置
  const [tmdbImageBaseUrl, setTmdbImageBaseUrl] = useState(
    'https://image.tmdb.org'
  );
  const [isUsageSectionOpen, setIsUsageSectionOpen] = useState(false);
  const [isDownloadSectionOpen, setIsDownloadSectionOpen] = useState(false);
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

  type HomeBannerHeightScale = '1' | '1.5' | '2';

  const defaultHomeModules: HomeModule[] = [
    { id: 'hotMovies', name: '热门电影', enabled: true, order: 0 },
    { id: 'hotDuanju', name: '热播短剧', enabled: true, order: 1 },
    { id: 'bangumiCalendar', name: '新番放送', enabled: true, order: 2 },
    { id: 'hotTvShows', name: '热门剧集', enabled: true, order: 3 },
    { id: 'hotVarietyShows', name: '热门综艺', enabled: true, order: 4 },
    { id: 'upcomingContent', name: '即将上映', enabled: true, order: 5 },
  ];

  const [homeModules, setHomeModules] =
    useState<HomeModule[]>(defaultHomeModules);
  const [homeBannerEnabled, setHomeBannerEnabled] = useState(true);
  const [homeBannerHeightScale, setHomeBannerHeightScale] =
    useState<HomeBannerHeightScale>('1');
  const [homeContinueWatchingEnabled, setHomeContinueWatchingEnabled] =
    useState(true);

  const homeBannerHeightOptions: {
    value: HomeBannerHeightScale;
    label: string;
    description: string;
  }[] = [
    { value: '1', label: '标准', description: '1x' },
    { value: '1.5', label: '增高', description: '1.5x' },
    { value: '2', label: '特高', description: '2x' },
  ];

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

  const animeDataSourceOptions = [
    { value: 'direct', label: '直连（浏览器直连 Bangumi）' },
    { value: 'server-proxy', label: '服务器代理（由服务器访问 Bangumi）' },
    { value: 'custom-baseurl', label: '自定义 Base URL' },
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
    {
      value: 'direct',
      label: '直连（浏览器直接请求豆瓣，可能需要浏览器插件才能正常显示）',
    },
    {
      value: 'img3',
      label: '豆瓣官方精品 CDN（阿里云，可能需要浏览器插件才能正常显示）',
    },
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
  const [clearCacheMessage, setClearCacheMessage] = useState<string | null>(
    null
  );
  const [danmakuCacheUsage, setDanmakuCacheUsage] = useState('计算中...');

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

  const formatCacheSize = useCallback((size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }, []);

  const loadDanmakuCacheUsage = useCallback(async () => {
    try {
      const stats = await getDanmakuCacheStats();
      setDanmakuCacheUsage(formatCacheSize(stats.totalSize));
    } catch (error) {
      console.error('获取弹幕缓存占用失败:', error);
      setDanmakuCacheUsage('获取失败');
    }
  }, [formatCacheSize]);

  // 首次加载时检查未读通知数量（使用全局标记避免多个实例重复请求）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 检查是否已经有其他实例在加载
    const globalWindow = window as any;
    if (globalWindow.__loadingNotifications) {
      // 如果正在加载，等待加载完成后获取结果
      const checkInterval = setInterval(() => {
        if (
          !globalWindow.__loadingNotifications &&
          globalWindow.__unreadNotificationCount !== undefined
        ) {
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

  useEffect(() => {
    if (!mounted || !isSettingsOpen || !isDanmakuSectionOpen) return;
    void (async () => {
      await loadDanmakuCacheUsage();
    })();
  }, [loadDanmakuCacheUsage, mounted, isSettingsOpen, isDanmakuSectionOpen]);

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
      window.removeEventListener(
        'notificationsUpdated',
        handleNotificationsUpdated
      );
    };
  }, []);

  // 从运行时配置读取订阅是否启用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.ENABLE_TVBOX_SUBSCRIBE || false;
      setSubscribeEnabled(enabled);
      setTvModeEnabled((window as any).RUNTIME_CONFIG?.ENABLE_TV_MODE !== false);
    }
  }, []);

  // 懒加载订阅 URL - 只在打开订阅面板时请求
  const fetchSubscribeUrl = async () => {
    setIsLoadingSubscribeUrl(true);
    try {
      // 获取用户的 TVBox token
      const response = await fetch('/api/user/tvbox-token');
      if (response.ok) {
        const data = await response.json();
        const token = data.token;
        setTvboxToken(token);

        setSubscribeUrl(
          buildSubscribeUrl(
            token,
            subscribeAdFilterEnabled,
            subscribeYellowFilterEnabled
          )
        );
      }
    } catch (error) {
      console.error('获取订阅URL失败:', error);
    } finally {
      setIsLoadingSubscribeUrl(false);
    }
  };

  // 重置 TVBox token
  const handleResetToken = async () => {
    setConfirmDialog({
      isOpen: true,
      title: '重置订阅Token',
      message: '确定要重置订阅token吗？重置后旧的订阅链接将失效。',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        setIsResettingToken(true);

        try {
          const response = await fetch('/api/user/tvbox-token/reset', {
            method: 'POST',
          });

          const messageEl = document.getElementById('tvbox-token-message');
          if (response.ok) {
            const data = await response.json();
            const token = data.token;
            setTvboxToken(token);

            setSubscribeUrl(
              buildSubscribeUrl(
                token,
                subscribeAdFilterEnabled,
                subscribeYellowFilterEnabled
              )
            );

            if (messageEl) {
              messageEl.textContent = '订阅token已重置！';
              messageEl.className =
                'text-xs text-center text-green-600 dark:text-green-400 mt-2';
              messageEl.classList.remove('hidden');
              setTimeout(() => {
                messageEl.classList.add('hidden');
              }, 3000);
            }
          } else {
            const data = await response.json();
            if (messageEl) {
              messageEl.textContent = data.error || '重置失败，请重试';
              messageEl.className =
                'text-xs text-center text-red-600 dark:text-red-400 mt-2';
              messageEl.classList.remove('hidden');
            }
          }
        } catch (error) {
          console.error('重置token失败:', error);
          const messageEl = document.getElementById('tvbox-token-message');
          if (messageEl) {
            messageEl.textContent = '重置失败，请重试';
            messageEl.className =
              'text-xs text-center text-red-600 dark:text-red-400 mt-2';
            messageEl.classList.remove('hidden');
          }
        } finally {
          setIsResettingToken(false);
        }
      },
    });
  };

  const buildSubscribeUrl = (
    token: string,
    adFilter: boolean,
    yellowFilter: boolean
  ) => {
    const currentOrigin = window.location.origin;
    const url = new URL('/api/tvbox/subscribe', currentOrigin);
    url.searchParams.set('token', token);
    if (adFilter) {
      url.searchParams.set('adFilter', 'true');
    }
    if (yellowFilter) {
      url.searchParams.set('yellowFilter', 'true');
    }
    return url.toString();
  };

  // 获取认证信息和存储类型
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const auth = getAuthInfoFromBrowserCookie();
      setAuthInfo(auth);

      const runtimeConfig = (window as any).RUNTIME_CONFIG || {};
      const type = runtimeConfig.STORAGE_TYPE || 'localstorage';
      const displayType = runtimeConfig.DISPLAY_STORAGE_TYPE || type;
      setStorageType(type);
      setDisplayStorageType(displayType);
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
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE ||
        'cmliussss-cdn-tencent';
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

      const savedDoubanDataSourceBackup = localStorage.getItem(
        'doubanDataSourceBackup'
      );
      setDoubanDataSourceBackup(savedDoubanDataSourceBackup || 'direct');

      const savedDoubanProxyUrlBackup = localStorage.getItem(
        'doubanProxyUrlBackup'
      );
      setDoubanProxyUrlBackup(savedDoubanProxyUrlBackup || '');

      const savedAnimeDataSource = localStorage.getItem('animeDataSource');
      const defaultAnimeDataSource =
        (window as any).RUNTIME_CONFIG?.BANGUMI_DATA_SOURCE || 'direct';
      setAnimeDataSource(savedAnimeDataSource || defaultAnimeDataSource);

      const savedAnimeDataSourceBackup = localStorage.getItem(
        'animeDataSourceBackup'
      );
      setAnimeDataSourceBackup(savedAnimeDataSourceBackup || 'server-proxy');

      const savedAnimeCustomBaseUrl =
        localStorage.getItem('animeCustomBaseUrl');
      setAnimeCustomBaseUrl(savedAnimeCustomBaseUrl || '');

      const savedAnimeImageBaseUrl = localStorage.getItem('animeImageBaseUrl');
      setAnimeImageBaseUrl(savedAnimeImageBaseUrl || '');

      fetch('/scripts/bangumi-proxy.worker.js')
        .then((response) => (response.ok ? response.text() : ''))
        .then(setBangumiProxyScript)
        .catch((error) => {
          console.error('加载 Bangumi Workers 脚本失败:', error);
        });

      const savedDoubanImageProxyType = localStorage.getItem(
        'doubanImageProxyType'
      );
      const defaultDoubanImageProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
        'cmliussss-cdn-tencent';
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

      const savedDoubanImageProxyTypeBackup = localStorage.getItem(
        'doubanImageProxyTypeBackup'
      );
      setDoubanImageProxyTypeBackup(
        savedDoubanImageProxyTypeBackup || 'server'
      );

      const savedDoubanImageProxyUrlBackup = localStorage.getItem(
        'doubanImageProxyUrlBackup'
      );
      setDoubanImageProxyUrlBackup(savedDoubanImageProxyUrlBackup || '');

      const savedTmdbImageBaseUrl = localStorage.getItem('tmdbImageBaseUrl');
      if (savedTmdbImageBaseUrl !== null) {
        setTmdbImageBaseUrl(savedTmdbImageBaseUrl);
      }

      const savedEnableOptimization =
        localStorage.getItem('enableOptimization');
      if (savedEnableOptimization !== null) {
        setEnableOptimization(JSON.parse(savedEnableOptimization));
      }

      const savedPreferStrategy = localStorage.getItem('preferStrategy');
      if (savedPreferStrategy === 'fast' || savedPreferStrategy === 'full') {
        setPreferStrategy(savedPreferStrategy);
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

      const savedTmdbBackdropDisabled = localStorage.getItem(
        'tmdb_backdrop_disabled'
      );
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

      const savedNextEpisodePreCache = localStorage.getItem(
        'nextEpisodePreCache'
      );
      if (savedNextEpisodePreCache !== null) {
        setNextEpisodePreCache(savedNextEpisodePreCache === 'true');
      }

      const savedNextEpisodeDanmakuPreload = localStorage.getItem(
        'nextEpisodeDanmakuPreload'
      );
      if (savedNextEpisodeDanmakuPreload !== null) {
        setNextEpisodeDanmakuPreload(savedNextEpisodeDanmakuPreload === 'true');
      }

      const savedDisableAutoLoadDanmaku = localStorage.getItem(
        'disableAutoLoadDanmaku'
      );
      if (savedDisableAutoLoadDanmaku !== null) {
        setDisableAutoLoadDanmaku(savedDisableAutoLoadDanmaku === 'true');
      } else {
        const runtimeDefault =
          (window as any).RUNTIME_CONFIG?.DANMAKU_AUTO_LOAD_DEFAULT !== false;
        setDisableAutoLoadDanmaku(!runtimeDefault);
      }

      const savedDanmakuMaxCount = localStorage.getItem('danmakuMaxCount');
      if (savedDanmakuMaxCount !== null) {
        setDanmakuMaxCount(parseInt(savedDanmakuMaxCount, 10));
      }

      const savedDanmakuHeatmapDisabled = localStorage.getItem(
        'danmaku_heatmap_disabled'
      );
      if (savedDanmakuHeatmapDisabled !== null) {
        setDanmakuHeatmapDisabled(savedDanmakuHeatmapDisabled === 'true');
      }

      const savedHomeBannerEnabled = localStorage.getItem('homeBannerEnabled');
      if (savedHomeBannerEnabled !== null) {
        setHomeBannerEnabled(savedHomeBannerEnabled === 'true');
      }

      const savedHomeBannerHeightScale = localStorage.getItem(
        'homeBannerHeightScale'
      );
      if (
        savedHomeBannerHeightScale === '1' ||
        savedHomeBannerHeightScale === '1.5' ||
        savedHomeBannerHeightScale === '2'
      ) {
        setHomeBannerHeightScale(savedHomeBannerHeightScale);
      }

      const savedHomeContinueWatchingEnabled = localStorage.getItem(
        'homeContinueWatchingEnabled'
      );
      if (savedHomeContinueWatchingEnabled !== null) {
        setHomeContinueWatchingEnabled(
          savedHomeContinueWatchingEnabled === 'true'
        );
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
      const savedSearchTraditionalToSimplified = localStorage.getItem(
        'searchTraditionalToSimplified'
      );
      if (savedSearchTraditionalToSimplified !== null) {
        setSearchTraditionalToSimplified(
          savedSearchTraditionalToSimplified === 'true'
        );
      }

      // 加载精确搜索设置
      const savedExactSearch = localStorage.getItem('exactSearch');
      if (savedExactSearch !== null) {
        setExactSearch(savedExactSearch === 'true');
      }

      // 加载最大同时下载限制设置
      const savedMaxConcurrentDownloads = localStorage.getItem(
        'maxConcurrentDownloads'
      );
      if (savedMaxConcurrentDownloads !== null) {
        setMaxConcurrentDownloads(Number(savedMaxConcurrentDownloads));
      }

      // 加载单任务线程数设置
      const savedDownloadThreadsPerTask = localStorage.getItem(
        'downloadThreadsPerTask'
      );
      if (savedDownloadThreadsPerTask !== null) {
        setDownloadThreadsPerTask(Number(savedDownloadThreadsPerTask));
      }

      // 加载分片下载超时设置
      const savedDownloadSegmentTimeout = localStorage.getItem(
        'downloadSegmentTimeout'
      );
      if (savedDownloadSegmentTimeout !== null) {
        const timeout = Number(savedDownloadSegmentTimeout);
        if (Number.isFinite(timeout)) {
          setDownloadSegmentTimeout(Math.min(Math.max(timeout, 30000), 300000));
        }
      }

      // 加载下载模式设置
      const savedDownloadMode = localStorage.getItem('downloadMode');
      if (
        savedDownloadMode === 'browser' ||
        savedDownloadMode === 'filesystem'
      ) {
        setDownloadMode(savedDownloadMode);
      }

      // 加载保存路径设置
      const savedFilesystemSavePath =
        localStorage.getItem('filesystemSavePath');
      if (savedFilesystemSavePath !== null) {
        setFilesystemSavePath(savedFilesystemSavePath);
      }
    }
  }, []);

  // 加载通知设置
  const loadEmailSettings = async () => {
    setEmailSettingsLoading(true);
    setEmailSettingsMessage('');
    setEmailSettingsMessageType(null);
    try {
      const response = await fetch('/api/user/email-settings');
      if (response.ok) {
        const data = await response.json();
        setUserEmail(data.email || '');
        setEmailNotifications(data.emailNotifications || false);
      }

      const pushResponse = await fetch('/api/notifications/push');
      if (pushResponse.ok) {
        const pushData = await pushResponse.json();
        setPushNotificationsConfigured(Boolean(pushData.configured && pushData.publicKey));
        setPushNotificationsSupported(
          Boolean(
            pushData.configured &&
            pushData.publicKey &&
            pushData.hasDeviceToken &&
            typeof window !== 'undefined' &&
            'Notification' in window &&
            'serviceWorker' in navigator &&
            'PushManager' in window
          )
        );
        setPushNotifications(Boolean(pushData.pushNotifications));
      }
    } catch (error) {
      console.error('加载通知设置失败:', error);
    } finally {
      setEmailSettingsLoading(false);
    }
  };

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const arrayBufferToBase64Url = (buffer: ArrayBuffer | null) => {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window
      .btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  };

  const isSubscriptionUsingPublicKey = (
    subscription: PushSubscription,
    publicKey: string
  ) => {
    const subscriptionKey = arrayBufferToBase64Url(
      subscription.options?.applicationServerKey || null
    );
    return subscriptionKey === publicKey;
  };

  const waitForServiceWorkerActivation = async (
    registration: ServiceWorkerRegistration
  ) => {
    let pendingWorker = registration.installing || registration.waiting;

    if (!pendingWorker) {
      await registration.update();
      pendingWorker = registration.installing || registration.waiting;
    }

    // 没有新的 installing/waiting worker 时，说明当前 active registration 可直接使用。
    if (!pendingWorker) {
      if (registration.active) return registration;
      throw new Error('Service Worker 注册失败，请刷新页面后重试');
    }

    const activatingWorker = pendingWorker;
    if (activatingWorker.state === 'activated') return registration;

    await new Promise<void>((resolve, reject) => {
      const handleStateChange = () => {
        if (activatingWorker.state === 'activated') {
          activatingWorker.removeEventListener('statechange', handleStateChange);
          resolve();
        } else if (activatingWorker.state === 'redundant') {
          activatingWorker.removeEventListener('statechange', handleStateChange);
          reject(new Error('Service Worker 激活失败，请刷新页面后重试'));
        }
      };

      activatingWorker.addEventListener('statechange', handleStateChange);
      handleStateChange();
    });

    return registration;
  };

  const getReadyServiceWorkerRegistration = async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('当前浏览器不支持 Service Worker');
    }

    // 开启系统通知时明确使用带 push 事件处理器的 Service Worker。
    // 如果浏览器里已有旧 /sw.js 注册，重新注册同一 scope 的 /push-sw.js 会更新该注册；
    // push-sw.js 内部会 skipWaiting + clients.claim，激活后再订阅，确保 Push 到达能展示通知。
    const registration = await navigator.serviceWorker.register('/push-sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    return waitForServiceWorkerActivation(registration);
  };

  const handlePushNotificationsChange = async (enabled: boolean) => {
    if (!enabled) {
      setPushNotificationsBusy(true);
      try {
        const registration =
          'serviceWorker' in navigator
            ? await navigator.serviceWorker.getRegistration()
            : undefined;
        const subscription = await registration?.pushManager.getSubscription();
        const endpoint = subscription?.endpoint;
        await subscription?.unsubscribe();
        await fetch('/api/notifications/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        });
        setPushNotifications(false);
      } catch (error) {
        console.error('关闭浏览器通知失败:', error);
        setEmailSettingsMessage('关闭浏览器通知失败，请重试');
        setEmailSettingsMessageType('error');
      } finally {
        setPushNotificationsBusy(false);
      }
      return;
    }

    setPushNotificationsBusy(true);
    setEmailSettingsMessage('');
    setEmailSettingsMessageType(null);
    try {
      const statusResponse = await fetch('/api/notifications/push');
      const status = statusResponse.ok ? await statusResponse.json() : null;
      if (!status?.configured || !status?.publicKey) {
        throw new Error('管理员尚未配置 Web Push VAPID 密钥');
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('浏览器通知权限未授权');
      }

      const registration = await getReadyServiceWorkerRegistration();

      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !isSubscriptionUsingPublicKey(subscription, status.publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(status.publicKey),
        });
      }

      const response = await fetch('/api/notifications/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          subscription: subscription.toJSON(),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '保存浏览器通知订阅失败');
      }

      setPushNotifications(true);
      setEmailSettingsMessage('浏览器系统通知已开启');
      setEmailSettingsMessageType('success');
    } catch (error) {
      console.error('开启浏览器通知失败:', error);
      setPushNotifications(false);
      setEmailSettingsMessage(error instanceof Error ? error.message : '开启浏览器通知失败');
      setEmailSettingsMessageType('error');
    } finally {
      setPushNotificationsBusy(false);
    }
  };

  // 保存通知设置
  const handleSaveEmailSettings = async () => {
    setEmailSettingsSaving(true);
    setEmailSettingsMessage('');
    setEmailSettingsMessageType(null);
    try {
      const response = await fetch('/api/user/email-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          emailNotifications,
        }),
      });

      if (response.ok) {
        setEmailSettingsMessage('保存成功！');
        setEmailSettingsMessageType('success');
        setTimeout(() => {
          setEmailSettingsMessage('');
          setEmailSettingsMessageType(null);
        }, 3000);
      } else {
        const data = await response.json();
        setEmailSettingsMessage(data.error || '保存失败');
        setEmailSettingsMessageType('error');
      }
    } catch (error) {
      console.error('保存通知设置失败:', error);
      setEmailSettingsMessage('保存失败，请重试');
      setEmailSettingsMessageType('error');
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
            // 撤销成功后不重新加载列表，仅移除当前撤销的设备项
            setDevices((prevDevices) =>
              prevDevices.filter((device) => device.tokenId !== tokenId)
            );
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
      message:
        '确定要登出所有设备吗？这将清除所有设备的登录状态（包括当前设备）。',
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

    if (
      info.includes('mobile') ||
      info.includes('iphone') ||
      info.includes('android')
    ) {
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
      if (isDoubanBackupDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource-backup"]')) {
          setIsDoubanBackupDropdownOpen(false);
        }
      }
    };

    if (isDoubanBackupDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanBackupDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isAnimeDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="anime-datasource"]')) {
          setIsAnimeDropdownOpen(false);
        }
      }
    };

    if (isAnimeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isAnimeDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isAnimeBackupDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="anime-datasource-backup"]')) {
          setIsAnimeBackupDropdownOpen(false);
        }
      }
    };

    if (isAnimeBackupDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isAnimeBackupDropdownOpen]);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyBackupDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy-backup"]')) {
          setIsDoubanImageProxyBackupDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyBackupDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyBackupDropdownOpen]);

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

  const stopTvQrScanner = useCallback(() => {
    tvQrScanStopRef.current = true;
    if (tvQrStreamRef.current) {
      tvQrStreamRef.current.getTracks().forEach((track) => track.stop());
      tvQrStreamRef.current = null;
    }
    if (tvQrVideoRef.current) {
      tvQrVideoRef.current.srcObject = null;
    }
  }, []);

  const closeTvQrScanner = useCallback(() => {
    stopTvQrScanner();
    setIsTvQrScannerOpen(false);
    setTvQrScannerStatus('');
    setTvQrScannerError('');
  }, [stopTvQrScanner]);

  const handleQrLoginResult = useCallback((rawValue: string) => {
    try {
      const url = new URL(rawValue, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== '/qr-login') {
        setTvQrScannerError('未识别到本站电视登录二维码，请扫描电视屏幕上的二维码。');
        return false;
      }

      const token = url.searchParams.get('token');
      if (!token) {
        setTvQrScannerError('二维码缺少登录凭证，请刷新电视端二维码后重试。');
        return false;
      }

      setTvQrScannerStatus('识别成功，正在打开确认登录页...');
      stopTvQrScanner();
      window.location.href = `/qr-login?token=${encodeURIComponent(token)}`;
      return true;
    } catch {
      setTvQrScannerError('二维码内容无效，请扫描电视端显示的登录二维码。');
      return false;
    }
  }, [stopTvQrScanner]);

  const startTvQrScanner = useCallback(async () => {
    setIsTvQrScannerOpen(true);
    setTvQrScannerError('');
    setTvQrScannerStatus('正在打开手机摄像头...');
    tvQrScanStopRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setTvQrScannerError('当前浏览器不支持调用摄像头，请使用手机浏览器或系统相机扫描电视端二维码。');
      setTvQrScannerStatus('');
      return;
    }

    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      setTvQrScannerError('当前浏览器不支持网页内二维码识别，请使用系统相机扫描电视端二维码。');
      setTvQrScannerStatus('');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      tvQrStreamRef.current = stream;

      if (!tvQrVideoRef.current) return;
      tvQrVideoRef.current.srcObject = stream;
      await tvQrVideoRef.current.play();

      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
      setTvQrScannerStatus('请将电视屏幕上的登录二维码放入取景框');

      const scan = async () => {
        if (tvQrScanStopRef.current || !tvQrVideoRef.current) return;
        try {
          const barcodes = await detector.detect(tvQrVideoRef.current);
          const rawValue = barcodes?.[0]?.rawValue;
          if (rawValue && handleQrLoginResult(rawValue)) return;
        } catch (error) {
          console.error('二维码识别失败:', error);
        }
        window.setTimeout(scan, 350);
      };

      scan();
    } catch (error) {
      console.error('打开摄像头失败:', error);
      setTvQrScannerError('无法打开摄像头，请检查浏览器相机权限后重试。');
      setTvQrScannerStatus('');
      stopTvQrScanner();
    }
  }, [handleQrLoginResult, stopTvQrScanner]);

  useEffect(() => {
    return () => stopTvQrScanner();
  }, [stopTvQrScanner]);

  const handleSubscribe = async () => {
    setIsOpen(false);
    setIsSubscribeOpen(true);
    setCopySuccess(false);
    setOrionBaseUrlCopySuccess(false);
    // 懒加载: TVBox 订阅启用时才请求订阅 URL
    if (subscribeEnabled) {
      await fetchSubscribeUrl();
    } else {
      setIsLoadingSubscribeUrl(false);
    }
  };

  const handleCloseSubscribe = () => {
    setIsSubscribeOpen(false);
    setCopySuccess(false);
    setOrionBaseUrlCopySuccess(false);
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

  const handleCopyOrionBaseUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setOrionBaseUrlCopySuccess(true);
      setTimeout(() => {
        setOrionBaseUrlCopySuccess(false);
      }, 2000);
    } catch (error) {
      console.error('复制OrionTV Base URL失败:', error);
    }
  };

  useEffect(() => {
    if (!tvboxToken || !isSubscribeOpen) return;
    setSubscribeUrl(
      buildSubscribeUrl(
        tvboxToken,
        subscribeAdFilterEnabled,
        subscribeYellowFilterEnabled
      )
    );
  }, [
    tvboxToken,
    subscribeAdFilterEnabled,
    subscribeYellowFilterEnabled,
    isSubscribeOpen,
  ]);

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

  const handlePreferStrategyChange = (value: 'fast' | 'full') => {
    setPreferStrategy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferStrategy', value);
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

  const handleDownloadThreadsPerTaskChange = (value: number) => {
    setDownloadThreadsPerTask(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadThreadsPerTask', String(value));
    }
  };

  const handleDownloadSegmentTimeoutChange = (value: number) => {
    const normalizedValue = Math.min(Math.max(value, 30000), 300000);
    setDownloadSegmentTimeout(normalizedValue);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadSegmentTimeout', String(normalizedValue));
    }
  };

  const formatDownloadSegmentTimeout = (value: number) => {
    if (value < 60000) {
      return `${Math.round(value / 1000)}秒`;
    }

    const minutes = Math.floor(value / 60000);
    const seconds = Math.round((value % 60000) / 1000);
    return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
  };

  const handleDownloadModeChange = (mode: 'browser' | 'filesystem') => {
    // 如果选择 filesystem 模式，先检测浏览器是否支持
    if (
      mode === 'filesystem' &&
      typeof window !== 'undefined' &&
      !('showDirectoryPicker' in window)
    ) {
      setConfirmDialog({
        isOpen: true,
        title: '浏览器不支持',
        message:
          '您的浏览器不支持 File System Access API，请使用 Chrome 86+ 或 Edge 86+',
        onConfirm: () => {
          setConfirmDialog({ ...confirmDialog, isOpen: false });
        },
      });
      return;
    }

    setDownloadMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadMode', mode);
    }
  };

  const handleSelectSavePath = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setFilesystemSavePath(dirHandle.name);
      localStorage.setItem('filesystemSavePath', dirHandle.name);

      // 保存目录句柄到 IndexedDB
      const dbName = 'MoonTVPlus';
      const storeName = 'dirHandles';

      // 使用 Promise 包装 IndexedDB 操作
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 2); // 使用版本 2，与 download-db.ts 保持一致

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // 创建 dirHandles 表（如果不存在）
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }

          // 创建 activeTasks 表（如果不存在）
          if (!db.objectStoreNames.contains('activeTasks')) {
            const activeStore = db.createObjectStore('activeTasks', {
              keyPath: 'id',
            });
            activeStore.createIndex('status', 'status', { unique: false });
            activeStore.createIndex('createdAt', 'createdAt', {
              unique: false,
            });
          }

          // 创建 completedTasks 表（如果不存在）
          if (!db.objectStoreNames.contains('completedTasks')) {
            const completedStore = db.createObjectStore('completedTasks', {
              keyPath: 'id',
            });
            completedStore.createIndex('source', 'source', { unique: false });
            completedStore.createIndex('videoId', 'videoId', { unique: false });
            completedStore.createIndex('completedAt', 'completedAt', {
              unique: false,
            });
            completedStore.createIndex('sourceVideoId', ['source', 'videoId'], {
              unique: false,
            });
          }
        };

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const transaction = db.transaction([storeName], 'readwrite');
          const store = transaction.objectStore(storeName);
          const putRequest = store.put(dirHandle, 'downloadDir');

          putRequest.onsuccess = () => {
            db.close();
            resolve();
          };

          putRequest.onerror = () => {
            db.close();
            reject(new Error('保存目录句柄失败'));
          };
        };

        request.onerror = () => {
          reject(new Error('无法打开 IndexedDB'));
        };
      });
    } catch (err) {
      console.error('选择目录失败:', err);
    }
  };

  const handleFluidSearchToggle = (value: boolean) => {
    setFluidSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fluidSearch', JSON.stringify(value));
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

  const handleDoubanDataSourceBackupChange = (value: string) => {
    setDoubanDataSourceBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanDataSourceBackup', value);
    }
  };

  const handleAnimeDataSourceChange = (value: string) => {
    clearBangumiImageFallbackCache();
    setAnimeDataSource(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('animeDataSource', value);
    }
  };

  const handleAnimeDataSourceBackupChange = (value: string) => {
    clearBangumiImageFallbackCache();
    setAnimeDataSourceBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('animeDataSourceBackup', value);
    }
  };

  const handleAnimeCustomBaseUrlChange = (value: string) => {
    clearBangumiImageFallbackCache();
    setAnimeCustomBaseUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('animeCustomBaseUrl', value);
    }
  };

  const handleAnimeImageBaseUrlChange = (value: string) => {
    clearBangumiImageFallbackCache();
    setAnimeImageBaseUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('animeImageBaseUrl', value);
    }
  };

  const handleCopyBangumiProxyScript = async () => {
    if (!bangumiProxyScript) return;
    try {
      await navigator.clipboard.writeText(bangumiProxyScript);
      setBangumiProxyScriptCopied(true);
      setTimeout(() => setBangumiProxyScriptCopied(false), 2000);
    } catch (error) {
      console.error('复制 Bangumi Workers 脚本失败:', error);
    }
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyType', value);
    }
  };

  const handleDoubanImageProxyTypeBackupChange = (value: string) => {
    setDoubanImageProxyTypeBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyTypeBackup', value);
    }
  };

  const handleDoubanProxyUrlBackupChange = (value: string) => {
    setDoubanProxyUrlBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrlBackup', value);
    }
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrl', value);
    }
  };

  const handleDoubanImageProxyUrlBackupChange = (value: string) => {
    setDoubanImageProxyUrlBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrlBackup', value);
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

  const handleHomeBannerHeightScaleChange = (value: HomeBannerHeightScale) => {
    setHomeBannerHeightScale(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeBannerHeightScale', value);
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
    const updatedModules = homeModules.map((module) =>
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
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE ||
      'cmliussss-cdn-tencent';
    const defaultDoubanProxy =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    const defaultDoubanImageProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
      'cmliussss-cdn-tencent';
    const defaultDoubanImageProxyUrl =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
    const defaultFluidSearch =
      (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
    const defaultAnimeDataSource =
      (window as any).RUNTIME_CONFIG?.BANGUMI_DATA_SOURCE || 'direct';
    const defaultAnimeBaseUrl = '';
    const defaultAnimeImageBaseUrl = '';

    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setPreferStrategy('fast');
    setFluidSearch(defaultFluidSearch);
    setTmdbBackdropDisabled(false);
    setEnableTrailers(false);
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setDoubanDataSourceBackup('direct');
    setDoubanProxyUrlBackup('');
    setAnimeDataSource(defaultAnimeDataSource);
    setAnimeDataSourceBackup('server-proxy');
    setAnimeCustomBaseUrl(defaultAnimeBaseUrl);
    setAnimeImageBaseUrl(defaultAnimeImageBaseUrl);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
    setDoubanImageProxyTypeBackup('server');
    setDoubanImageProxyUrlBackup('');
    setTmdbImageBaseUrl('https://image.tmdb.org');
    setBufferStrategy('medium');
    setNextEpisodePreCache(true);
    setNextEpisodeDanmakuPreload(true);
    const defaultDanmakuAutoLoad =
      (typeof window !== 'undefined' &&
        (window as any).RUNTIME_CONFIG?.DANMAKU_AUTO_LOAD_DEFAULT !== false) ||
      false;
    setDisableAutoLoadDanmaku(!defaultDanmakuAutoLoad);
    setHomeBannerEnabled(true);
    setHomeBannerHeightScale('1');
    setHomeContinueWatchingEnabled(true);
    setHomeModules(defaultHomeModules);
    setSearchTraditionalToSimplified(false);

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('preferStrategy', 'fast');
      localStorage.setItem('fluidSearch', JSON.stringify(defaultFluidSearch));
      localStorage.setItem('liveDirectConnect', JSON.stringify(false));
      localStorage.setItem('tmdb_backdrop_disabled', 'false');
      localStorage.setItem('enableTrailers', 'false');
      localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
      localStorage.setItem('doubanDataSource', defaultDoubanProxyType);
      localStorage.setItem('doubanDataSourceBackup', 'direct');
      localStorage.setItem('doubanProxyUrlBackup', '');
      localStorage.setItem('animeDataSource', defaultAnimeDataSource);
      localStorage.setItem('animeDataSourceBackup', 'server-proxy');
      localStorage.setItem('animeCustomBaseUrl', defaultAnimeBaseUrl);
      localStorage.setItem('animeImageBaseUrl', defaultAnimeImageBaseUrl);
      localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
      localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);
      localStorage.setItem('doubanImageProxyTypeBackup', 'server');
      localStorage.setItem('doubanImageProxyUrlBackup', '');
      localStorage.setItem('tmdbImageBaseUrl', 'https://image.tmdb.org');
      localStorage.setItem('bufferStrategy', 'medium');
      localStorage.setItem('nextEpisodePreCache', 'true');
      localStorage.setItem('nextEpisodeDanmakuPreload', 'true');
      localStorage.setItem(
        'disableAutoLoadDanmaku',
        String(!defaultDanmakuAutoLoad)
      );
      localStorage.setItem('danmakuMaxCount', '0');
      localStorage.setItem('danmaku_heatmap_disabled', 'false');
      localStorage.setItem('homeBannerEnabled', 'true');
      localStorage.setItem('homeBannerHeightScale', '1');
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
      setDanmakuCacheUsage('0 B');
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

  const currentUsername = authInfo?.username || 'default';
  const currentRole = authInfo?.role || 'user';
  const currentRoleText = getRoleText(currentRole);
  const shouldShowRoleBadge = currentRole !== 'user';
  const avatarText = currentUsername.trim().charAt(0).toUpperCase() || 'D';

  const roleBadgeClassName =
    currentRole === 'owner'
      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
      : currentRole === 'admin'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
      : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';

  const handleOpenProfileCenter = () => {
    setIsOpen(false);
    setIsProfileCenterOpen(true);
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
        <div className='px-3 py-1 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50'>
          <div className='flex items-start justify-between gap-3'>
            <button
              onClick={handleOpenProfileCenter}
              className='flex items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-white/70 dark:hover:bg-gray-700/40 transition-colors'
            >
              <div className='relative flex h-11 w-11 items-center justify-center rounded-full bg-blue-500 text-lg font-semibold text-white shadow-sm'>
                <span>{avatarText}</span>
                {shouldShowRoleBadge && (
                  <span
                    className={`absolute left-1/2 top-[calc(100%-6px)] z-10 -translate-x-1/2 inline-flex min-w-[26px] items-center justify-center whitespace-nowrap rounded-full px-1.5 py-[2px] text-[8px] leading-none font-medium shadow-sm ${roleBadgeClassName}`}
                  >
                    {currentRoleText}
                  </span>
                )}
              </div>
              <div className='min-w-0'>
                <span className='block max-w-[84px] truncate text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none'>
                  {currentUsername}
                </span>
              </div>
            </button>

            <div className='pt-1 text-right'>
              <div className='text-[10px] text-gray-400 dark:text-gray-500'>
                <div>数据存储</div>
                <div className='mt-0.5'>
                  {displayStorageType === 'localstorage'
                    ? '本地'
                    : displayStorageType}
                </div>
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

          {/* 电视访问按钮 */}
          <button
            onClick={handleSubscribe}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
          >
            <Monitor className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>电视访问</span>
          </button>

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
                    className={`w-2 h-2 rounded-full -translate-y-2 ${
                      updateStatus === UpdateStatus.HAS_UPDATE
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
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col'>
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
                    数据源设置
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
                        onClick={() =>
                          setIsDoubanDropdownOpen(!isDoubanDropdownOpen)
                        }
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
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                            isDoubanDropdownOpen ? 'rotate-180' : ''
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
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                doubanDataSource === option.value
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
                            window.open(
                              getThanksInfo(doubanDataSource)!.url,
                              '_blank'
                            )
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
                        onChange={(e) =>
                          handleDoubanProxyUrlChange(e.target.value)
                        }
                      />
                      {!doubanProxyUrl.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填写地址时将自动按直连处理
                        </p>
                      )}
                    </div>
                  )}

                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣数据备用渠道
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        主渠道失败后自动切换，默认直连
                      </p>
                    </div>
                    <div
                      className='relative'
                      data-dropdown='douban-datasource-backup'
                    >
                      <button
                        type='button'
                        onClick={() =>
                          setIsDoubanBackupDropdownOpen(
                            !isDoubanBackupDropdownOpen
                          )
                        }
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanDataSourceOptions.find(
                            (option) => option.value === doubanDataSourceBackup
                          )?.label
                        }
                      </button>
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                            isDoubanBackupDropdownOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                      {isDoubanBackupDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanDataSourceOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanDataSourceBackupChange(
                                  option.value
                                );
                                setIsDoubanBackupDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                doubanDataSourceBackup === option.value
                                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                  : 'text-gray-900 dark:text-gray-100'
                              }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanDataSourceBackup === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {doubanDataSourceBackup === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣备用代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          备用渠道为自定义代理时生效
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanProxyUrlBackup}
                        onChange={(e) =>
                          handleDoubanProxyUrlBackupChange(e.target.value)
                        }
                      />
                      {!doubanProxyUrlBackup.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填写地址时备用渠道将自动按直连处理
                        </p>
                      )}
                    </div>
                  )}

                  {/* 分割线 */}
                  <div className='border-t border-gray-200 dark:border-gray-700'></div>

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
                    <div
                      className='relative'
                      data-dropdown='douban-image-proxy'
                    >
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
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                            isDoubanDropdownOpen ? 'rotate-180' : ''
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
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                doubanImageProxyType === option.value
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
                      {!doubanImageProxyUrl.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填写地址时将自动按服务器代理处理
                        </p>
                      )}
                    </div>
                  )}

                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣图片备用渠道
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        主图片渠道失败后自动切换，默认服务器代理
                      </p>
                    </div>
                    <div
                      className='relative'
                      data-dropdown='douban-image-proxy-backup'
                    >
                      <button
                        type='button'
                        onClick={() =>
                          setIsDoubanImageProxyBackupDropdownOpen(
                            !isDoubanImageProxyBackupDropdownOpen
                          )
                        }
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanImageProxyTypeOptions.find(
                            (option) =>
                              option.value === doubanImageProxyTypeBackup
                          )?.label
                        }
                      </button>
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                            isDoubanImageProxyBackupDropdownOpen
                              ? 'rotate-180'
                              : ''
                          }`}
                        />
                      </div>
                      {isDoubanImageProxyBackupDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanImageProxyTypeOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanImageProxyTypeBackupChange(
                                  option.value
                                );
                                setIsDoubanImageProxyBackupDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                doubanImageProxyTypeBackup === option.value
                                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                  : 'text-gray-900 dark:text-gray-100'
                              }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanImageProxyTypeBackup === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {doubanImageProxyTypeBackup === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣图片备用代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          备用图片渠道为自定义代理时生效
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanImageProxyUrlBackup}
                        onChange={(e) =>
                          handleDoubanImageProxyUrlBackupChange(e.target.value)
                        }
                      />
                      {!doubanImageProxyUrlBackup.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填写地址时备用图片渠道将自动按服务器代理处理
                        </p>
                      )}
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

                  {/* 分割线 */}
                  <div className='border-t border-gray-200 dark:border-gray-700'></div>

                  {/* 动漫数据源设置 */}
                  <div className='space-y-4'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        动漫数据源
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        用于 Bangumi
                        新番放送和番剧详情；默认主源直连，备用源服务器代理。
                      </p>
                    </div>

                    <div className='grid gap-3 md:grid-cols-2'>
                      <div className='space-y-2'>
                        <label className='text-xs font-medium text-gray-600 dark:text-gray-400'>
                          主数据源
                        </label>
                        <div
                          className='relative'
                          data-dropdown='anime-datasource'
                        >
                          <button
                            type='button'
                            onClick={() =>
                              setIsAnimeDropdownOpen(!isAnimeDropdownOpen)
                            }
                            className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                          >
                            {
                              animeDataSourceOptions.find(
                                (option) => option.value === animeDataSource
                              )?.label
                            }
                          </button>
                          <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                            <ChevronDown
                              className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                                isAnimeDropdownOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </div>
                          {isAnimeDropdownOpen && (
                            <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                              {animeDataSourceOptions.map((option) => (
                                <button
                                  key={option.value}
                                  type='button'
                                  onClick={() => {
                                    handleAnimeDataSourceChange(option.value);
                                    setIsAnimeDropdownOpen(false);
                                  }}
                                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                    animeDataSource === option.value
                                      ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                      : 'text-gray-900 dark:text-gray-100'
                                  }`}
                                >
                                  <span className='truncate'>
                                    {option.label}
                                  </span>
                                  {animeDataSource === option.value && (
                                    <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className='space-y-2'>
                        <label className='text-xs font-medium text-gray-600 dark:text-gray-400'>
                          备用数据源
                        </label>
                        <div
                          className='relative'
                          data-dropdown='anime-datasource-backup'
                        >
                          <button
                            type='button'
                            onClick={() =>
                              setIsAnimeBackupDropdownOpen(
                                !isAnimeBackupDropdownOpen
                              )
                            }
                            className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                          >
                            {
                              animeDataSourceOptions.find(
                                (option) =>
                                  option.value === animeDataSourceBackup
                              )?.label
                            }
                          </button>
                          <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                            <ChevronDown
                              className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                                isAnimeBackupDropdownOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </div>
                          {isAnimeBackupDropdownOpen && (
                            <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                              {animeDataSourceOptions.map((option) => (
                                <button
                                  key={option.value}
                                  type='button'
                                  onClick={() => {
                                    handleAnimeDataSourceBackupChange(
                                      option.value
                                    );
                                    setIsAnimeBackupDropdownOpen(false);
                                  }}
                                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                    animeDataSourceBackup === option.value
                                      ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                      : 'text-gray-900 dark:text-gray-100'
                                  }`}
                                >
                                  <span className='truncate'>
                                    {option.label}
                                  </span>
                                  {animeDataSourceBackup === option.value && (
                                    <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {(animeDataSource === 'custom-baseurl' ||
                      animeDataSourceBackup === 'custom-baseurl') && (
                      <div className='space-y-2'>
                        <label className='text-xs font-medium text-gray-600 dark:text-gray-400'>
                          动漫自定义 Base URL
                        </label>
                        <input
                          type='text'
                          className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                          placeholder='例如: https://api.bgm.tv 或 https://bangumi-proxy.example.com'
                          value={animeCustomBaseUrl}
                          onChange={(e) =>
                            handleAnimeCustomBaseUrlChange(e.target.value)
                          }
                        />
                        {!animeCustomBaseUrl.trim() && (
                          <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                            未填写时自定义 Base URL 会自动按 Bangumi
                            官方直连处理。
                          </p>
                        )}
                      </div>
                    )}
                    <div className='space-y-2'>
                      <label className='text-xs font-medium text-gray-600 dark:text-gray-400'>
                        动漫图片 Base URL
                      </label>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com'
                        value={animeImageBaseUrl}
                        onChange={(e) =>
                          handleAnimeImageBaseUrlChange(e.target.value)
                        }
                      />
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        用于替换 Bangumi
                        图片域名。只需填写基础部分，不需要填写完整图片路径。
                      </p>
                    </div>

                    <details className='group rounded-lg border border-green-200 bg-green-50/60 p-3 dark:border-green-900/50 dark:bg-green-900/10'>
                      <summary className='flex cursor-pointer list-none items-center justify-between gap-2'>
                        <div className='min-w-0'>
                          <label className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                            Bangumi Cloudflare Workers 代理脚本
                          </label>
                          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                            复制后粘贴到 Cloudflare Workers，部署地址可填入上方
                            Base URL。
                          </p>
                        </div>
                        <div className='flex shrink-0 items-center gap-2'>
                          <button
                            type='button'
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleCopyBangumiProxyScript();
                            }}
                            disabled={!bangumiProxyScript}
                            className='inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                          >
                            <Copy className='h-3.5 w-3.5' />
                            {bangumiProxyScriptCopied ? '已复制' : '复制脚本'}
                          </button>
                          <ChevronDown className='h-4 w-4 text-green-600 transition-transform group-open:rotate-180 dark:text-green-400' />
                        </div>
                      </summary>
                      <pre className='mt-3 max-h-40 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300'>
                        <code>
                          {bangumiProxyScript || '正在加载 /scripts/bangumi-proxy.worker.js ...'}
                        </code>
                      </pre>
                    </details>
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
                          onChange={(e) =>
                            handleAggregateToggle(e.target.checked)
                          }
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
                          onChange={(e) =>
                            handleOptimizationToggle(e.target.checked)
                          }
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 测速超时设置 */}
                  {enableOptimization && (
                    <div className='ml-4 mt-2 space-y-2'>
                      <div className='space-y-2'>
                        <div className='flex items-center justify-between gap-3'>
                          <span className='flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400'>
                            优选策略
                            <button
                              type='button'
                              className='group relative inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500/50 dark:text-gray-500 dark:hover:text-gray-300'
                              aria-label='优选策略说明'
                            >
                              <CircleHelp className='h-3.5 w-3.5' />
                              <span className='pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-56 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-left text-xs leading-relaxed text-white shadow-lg group-hover:block group-focus:block dark:bg-gray-700'>
                                快速策略：快速优选高权重播放源
                                <br />
                                全量策略：全量优选全部源
                              </span>
                            </button>
                          </span>
                          <div className='inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800'>
                            <button
                              type='button'
                              onClick={() => handlePreferStrategyChange('fast')}
                              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                                preferStrategy === 'fast'
                                  ? 'bg-white text-green-600 shadow-sm dark:bg-gray-700 dark:text-green-400'
                                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                              }`}
                            >
                              快速优选
                            </button>
                            <button
                              type='button'
                              onClick={() => handlePreferStrategyChange('full')}
                              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                                preferStrategy === 'full'
                                  ? 'bg-white text-green-600 shadow-sm dark:bg-gray-700 dark:text-green-400'
                                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                              }`}
                            >
                              全量优选
                            </button>
                          </div>
                        </div>
                      </div>

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
                          onChange={(e) =>
                            handleSpeedTestTimeoutChange(Number(e.target.value))
                          }
                          className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                          style={{
                            background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                              ((speedTestTimeout - 4000) / (30000 - 4000)) * 100
                            }%, #e5e7eb ${
                              ((speedTestTimeout - 4000) / (30000 - 4000)) * 100
                            }%, #e5e7eb 100%)`,
                          }}
                        />
                      </div>
                      <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(4000)}
                          className={`px-2 py-0.5 rounded ${
                            speedTestTimeout === 4000
                              ? 'bg-green-500 text-white'
                              : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          4秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(10000)}
                          className={`px-2 py-0.5 rounded ${
                            speedTestTimeout === 10000
                              ? 'bg-green-500 text-white'
                              : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          10秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(20000)}
                          className={`px-2 py-0.5 rounded ${
                            speedTestTimeout === 20000
                              ? 'bg-green-500 text-white'
                              : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          20秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(30000)}
                          className={`px-2 py-0.5 rounded ${
                            speedTestTimeout === 30000
                              ? 'bg-green-500 text-white'
                              : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
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
                          onChange={(e) =>
                            handleFluidSearchToggle(e.target.checked)
                          }
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
                          onChange={(e) =>
                            handleTmdbBackdropDisabledToggle(e.target.checked)
                          }
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
                          onChange={(e) =>
                            handleEnableTrailersToggle(e.target.checked)
                          }
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
                          onChange={(e) =>
                            handleSearchTraditionalToSimplifiedToggle(
                              e.target.checked
                            )
                          }
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
                          onChange={(e) =>
                            handleExactSearchToggle(e.target.checked)
                          }
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* 下载设置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsDownloadSectionOpen(!isDownloadSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Download className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    下载设置
                  </h3>
                </div>
                {isDownloadSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isDownloadSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
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
                        onChange={(e) =>
                          handleMaxConcurrentDownloadsChange(
                            Number(e.target.value)
                          )
                        }
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                            ((maxConcurrentDownloads - 1) / (10 - 1)) * 100
                          }%, #e5e7eb ${
                            ((maxConcurrentDownloads - 1) / (10 - 1)) * 100
                          }%, #e5e7eb 100%)`,
                        }}
                      />
                    </div>
                    <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(1)}
                        className={`px-2 py-0.5 rounded ${
                          maxConcurrentDownloads === 1
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        1个
                      </button>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(10)}
                        className={`px-2 py-0.5 rounded ${
                          maxConcurrentDownloads === 10
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        10个
                      </button>
                    </div>
                  </div>

                  {/* 单任务线程数 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        单任务线程数
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        控制每个下载任务使用的线程数量，线程越多下载越快但占用资源越多
                      </p>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-gray-600 dark:text-gray-400'>
                        线程数量
                      </span>
                      <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                        {downloadThreadsPerTask}个
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='1'
                        max='32'
                        step='1'
                        value={downloadThreadsPerTask}
                        onChange={(e) =>
                          handleDownloadThreadsPerTaskChange(
                            Number(e.target.value)
                          )
                        }
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                            ((downloadThreadsPerTask - 1) / (32 - 1)) * 100
                          }%, #e5e7eb ${
                            ((downloadThreadsPerTask - 1) / (32 - 1)) * 100
                          }%, #e5e7eb 100%)`,
                        }}
                      />
                    </div>
                    <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <button
                        onClick={() => handleDownloadThreadsPerTaskChange(1)}
                        className={`px-2 py-0.5 rounded ${
                          downloadThreadsPerTask === 1
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        1个
                      </button>
                      <button
                        onClick={() => handleDownloadThreadsPerTaskChange(32)}
                        className={`px-2 py-0.5 rounded ${
                          downloadThreadsPerTask === 32
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        32个
                      </button>
                    </div>
                  </div>

                  {/* 分片下载超时 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        分片下载超时
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        单个分片超过该时间仍未完成时会自动判定超时并按原分片重试
                      </p>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-gray-600 dark:text-gray-400'>
                        超时时间
                      </span>
                      <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                        {formatDownloadSegmentTimeout(downloadSegmentTimeout)}
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='30000'
                        max='300000'
                        step='10000'
                        value={downloadSegmentTimeout}
                        onChange={(e) =>
                          handleDownloadSegmentTimeoutChange(
                            Number(e.target.value)
                          )
                        }
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                            ((downloadSegmentTimeout - 30000) / (300000 - 30000)) * 100
                          }%, #e5e7eb ${
                            ((downloadSegmentTimeout - 30000) / (300000 - 30000)) * 100
                          }%, #e5e7eb 100%)`,
                        }}
                      />
                    </div>
                    <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <button
                        onClick={() => handleDownloadSegmentTimeoutChange(30000)}
                        className={`px-2 py-0.5 rounded cursor-pointer ${
                          downloadSegmentTimeout === 30000
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        30秒
                      </button>
                      <button
                        onClick={() => handleDownloadSegmentTimeoutChange(120000)}
                        className={`px-2 py-0.5 rounded cursor-pointer ${
                          downloadSegmentTimeout === 120000
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        2分钟
                      </button>
                      <button
                        onClick={() => handleDownloadSegmentTimeoutChange(300000)}
                        className={`px-2 py-0.5 rounded cursor-pointer ${
                          downloadSegmentTimeout === 300000
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        5分钟
                      </button>
                    </div>
                  </div>

                  {/* 下载模式 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        下载模式
                      </h4>
                    </div>
                    <div className='space-y-2'>
                      <label className='flex items-center gap-2 cursor-pointer'>
                        <input
                          type='radio'
                          name='downloadMode'
                          value='browser'
                          checked={downloadMode === 'browser'}
                          onChange={() => handleDownloadModeChange('browser')}
                          className='w-4 h-4 text-green-500'
                        />
                        <span className='text-sm text-gray-700 dark:text-gray-300'>
                          浏览器下载（合并为单文件）
                        </span>
                      </label>
                      <label className='flex items-center gap-2 cursor-pointer'>
                        <input
                          type='radio'
                          name='downloadMode'
                          value='filesystem'
                          checked={downloadMode === 'filesystem'}
                          onChange={() =>
                            handleDownloadModeChange('filesystem')
                          }
                          className='w-4 h-4 text-green-500'
                        />
                        <span className='text-sm text-gray-700 dark:text-gray-300'>
                          File System API（保存分片到本地目录）
                        </span>
                      </label>
                    </div>

                    {/* 保存路径选择（仅在 filesystem 模式显示） */}
                    {downloadMode === 'filesystem' && (
                      <div className='mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2'>
                        <label className='block text-xs font-medium text-gray-700 dark:text-gray-300'>
                          保存路径
                        </label>
                        <div className='flex gap-2'>
                          <input
                            type='text'
                            value={filesystemSavePath}
                            readOnly
                            placeholder='点击选择保存目录'
                            className='flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          />
                          <button
                            onClick={handleSelectSavePath}
                            className='px-4 py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors'
                          >
                            选择目录
                          </button>
                        </div>
                        <p className='text-xs text-gray-500 dark:text-gray-400'>
                          需要 Chrome 86+ 或 Edge 86+ 浏览器支持
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 下载文件管理 */}
                  <div className='space-y-2'>
                    <button
                      onClick={() => setIsDownloadManagementOpen(true)}
                      className='w-full px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center justify-center gap-2'
                    >
                      <Package className='w-4 h-4' />
                      下载文件管理
                    </button>
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
                          const strategy =
                            getBufferStrategyFromSlider(sliderValue);
                          handleBufferStrategyChange(strategy);
                        }}
                        className='w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500'
                        style={{
                          background: `linear-gradient(to right, rgb(34 197 94) 0%, rgb(34 197 94) ${
                            (getSliderValueFromStrategy(bufferStrategy) / 3) *
                            100
                          }%, rgb(229 231 235) ${
                            (getSliderValueFromStrategy(bufferStrategy) / 3) *
                            100
                          }%, rgb(229 231 235) 100%)`,
                        }}
                      />

                      {/* 标签显示 */}
                      <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1'>
                        <span
                          className={
                            bufferStrategy === 'low'
                              ? 'font-semibold text-green-600 dark:text-green-400'
                              : ''
                          }
                        >
                          低缓冲
                        </span>
                        <span
                          className={
                            bufferStrategy === 'medium'
                              ? 'font-semibold text-green-600 dark:text-green-400'
                              : ''
                          }
                        >
                          中缓冲
                        </span>
                        <span
                          className={
                            bufferStrategy === 'high'
                              ? 'font-semibold text-green-600 dark:text-green-400'
                              : ''
                          }
                        >
                          高缓冲
                        </span>
                        <span
                          className={
                            bufferStrategy === 'ultra'
                              ? 'font-semibold text-green-600 dark:text-green-400'
                              : ''
                          }
                        >
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
                          onChange={(e) =>
                            handleNextEpisodePreCacheToggle(e.target.checked)
                          }
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
                          onChange={(e) =>
                            handleDisableAutoLoadDanmakuToggle(e.target.checked)
                          }
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
                          onChange={(e) =>
                            handleNextEpisodeDanmakuPreloadToggle(
                              e.target.checked
                            )
                          }
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
                          onChange={(e) =>
                            handleDanmakuHeatmapDisabledToggle(e.target.checked)
                          }
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
                        {danmakuMaxCount === 0
                          ? '无上限'
                          : `${danmakuMaxCount} 条`}
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='0'
                        max='10000'
                        step='100'
                        value={danmakuMaxCount}
                        onChange={(e) =>
                          handleDanmakuMaxCountChange(parseInt(e.target.value))
                        }
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                            (danmakuMaxCount / 10000) * 100
                          }%, #e5e7eb ${
                            (danmakuMaxCount / 10000) * 100
                          }%, #e5e7eb 100%)`,
                        }}
                      />
                    </div>
                    <div
                      className='relative text-xs text-gray-500 dark:text-gray-400'
                      style={{ height: '24px' }}
                    >
                      <button
                        onClick={() => handleDanmakuMaxCountChange(0)}
                        className={`absolute px-2 py-0.5 rounded ${
                          danmakuMaxCount === 0
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                        style={{ left: '0%', transform: 'translateX(0%)' }}
                      >
                        无上限
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(3000)}
                        className={`absolute px-2 py-0.5 rounded ${
                          danmakuMaxCount === 3000
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                        style={{ left: '30%', transform: 'translateX(-50%)' }}
                      >
                        3000
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(5000)}
                        className={`absolute px-2 py-0.5 rounded ${
                          danmakuMaxCount === 5000
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                        style={{ left: '50%', transform: 'translateX(-50%)' }}
                      >
                        5000
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(10000)}
                        className={`absolute px-2 py-0.5 rounded ${
                          danmakuMaxCount === 10000
                            ? 'bg-green-500 text-white'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
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
                        弹幕缓存空间占用：{danmakuCacheUsage}
                      </p>
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
                          <svg
                            className='w-4 h-4'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth={2}
                              d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'
                            />
                          </svg>
                          <span>清除弹幕缓存</span>
                        </>
                      )}
                    </button>

                    {/* 成功/失败提示 */}
                    {clearCacheMessage && (
                      <div
                        className={`text-sm p-3 rounded-lg border ${
                          clearCacheMessage.includes('成功')
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                        }`}
                      >
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
                      配置首页轮播图显示效果，以及首页模块布局
                    </p>
                  </div>

                  {/* 轮播图配置 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-semibold text-gray-800 dark:text-gray-200'>
                        轮播图配置
                      </h4>
                    </div>
                    <div className='p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3'>
                      <div>
                        <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                          轮播图高度
                        </div>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          调整首页轮播图显示高度
                        </p>
                      </div>
                      <div className='grid grid-cols-3 gap-2'>
                        {homeBannerHeightOptions.map((option) => (
                          <button
                            key={option.value}
                            onClick={() =>
                              handleHomeBannerHeightScaleChange(option.value)
                            }
                            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                              homeBannerHeightScale === option.value
                                ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                            title={`${option.label}（${option.description}）`}
                          >
                            <span>{option.label}</span>
                            <span
                              className={`ml-1 text-xs ${
                                homeBannerHeightScale === option.value
                                  ? 'text-blue-100'
                                  : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              {option.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 模块显示与排序 */}
                  <div className='space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3'>
                    <div>
                      <h4 className='text-sm font-semibold text-gray-800 dark:text-gray-200'>
                        模块显示与排序
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        控制首页组件和内容模块的显示/隐藏与顺序
                      </p>
                    </div>
                    <div className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
                      <button
                        onClick={() =>
                          handleHomeBannerToggle(!homeBannerEnabled)
                        }
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
                        <span
                          className={`text-sm font-medium ${
                            homeBannerEnabled
                              ? 'text-gray-900 dark:text-gray-100'
                              : 'text-gray-400 dark:text-gray-500'
                          }`}
                        >
                          首页轮播图
                        </span>
                      </div>
                    </div>

                    <div className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
                      <button
                        onClick={() =>
                          handleHomeContinueWatchingToggle(
                            !homeContinueWatchingEnabled
                          )
                        }
                        className='flex-shrink-0'
                        title={
                          homeContinueWatchingEnabled ? '点击隐藏' : '点击显示'
                        }
                      >
                        {homeContinueWatchingEnabled ? (
                          <Eye className='w-5 h-5 text-green-600 dark:text-green-400' />
                        ) : (
                          <EyeOff className='w-5 h-5 text-gray-400 dark:text-gray-500' />
                        )}
                      </button>
                      <div className='flex-1'>
                        <span
                          className={`text-sm font-medium ${
                            homeContinueWatchingEnabled
                              ? 'text-gray-900 dark:text-gray-100'
                              : 'text-gray-400 dark:text-gray-500'
                          }`}
                        >
                          继续观看
                        </span>
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
                            onClick={() =>
                              handleHomeModuleToggle(module.id, !module.enabled)
                            }
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
                            <span
                              className={`text-sm font-medium ${
                                module.enabled
                                  ? 'text-gray-900 dark:text-gray-100'
                                  : 'text-gray-400 dark:text-gray-500'
                              }`}
                            >
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
                  </div>

                  {/* 恢复默认按钮 */}
                  <button
                    onClick={() => {
                      setHomeModules(defaultHomeModules);
                      setHomeBannerEnabled(true);
                      setHomeBannerHeightScale('1');
                      setHomeContinueWatchingEnabled(true);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem(
                          'homeModules',
                          JSON.stringify(defaultHomeModules)
                        );
                        localStorage.setItem('homeBannerEnabled', 'true');
                        localStorage.setItem('homeBannerHeightScale', '1');
                        localStorage.setItem(
                          'homeContinueWatchingEnabled',
                          'true'
                        );
                        window.dispatchEvent(
                          new CustomEvent('homeModulesUpdated')
                        );
                      }
                    }}
                    className='w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors'
                  >
                    恢复默认配置
                  </button>

                  {/* 提示信息 */}
                  <div className='text-xs text-gray-500 dark:text-gray-400 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg'>
                    <p>
                      💡
                      提示：点击眼睛图标可显示/隐藏模块，使用箭头按钮调整模块顺序
                    </p>
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

  // 电视访问面板内容
  const subscribePanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000]'
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

      {/* 电视访问面板 */}
      <div className='fixed top-1/2 left-1/2 z-[1001] max-h-[92vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl shadow-black/30 dark:border-white/10 dark:bg-slate-950'>
        <div
          className='max-h-[92vh] overflow-y-auto p-6 sm:p-7'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {isTvQrScannerOpen ? (
            <div className='relative -m-6 min-h-[72vh] overflow-hidden bg-black sm:-m-7'>
              <video
                ref={tvQrVideoRef}
                className='absolute inset-0 h-full w-full object-cover'
                muted
                playsInline
              />
              <div className='pointer-events-none absolute inset-0 grid place-items-center'>
                <div className='h-64 w-64 rounded-xl border-4 border-white/90 [box-shadow:0_0_0_9999px_rgba(0,0,0,0.58),0_0_30px_rgba(244,63,94,0.55)] sm:h-80 sm:w-80' />
              </div>
              <div className='absolute left-0 right-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/75 to-transparent p-5 text-white sm:p-7'>
                <div>
                  <div className='inline-flex items-center gap-2 rounded-full bg-rose-500/25 px-3 py-1 text-xs font-black text-rose-100 ring-1 ring-rose-300/20'>
                    <Smartphone className='h-4 w-4' />
                    手机相机扫码
                  </div>
                  <h3 className='mt-3 text-2xl font-black'>扫描电视登录二维码</h3>
                  <p className='mt-1 text-sm text-white/75'>识别成功后会进入手机确认登录页</p>
                </div>
                <button
                  type='button'
                  onClick={closeTvQrScanner}
                  className='flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70'
                  aria-label='关闭扫码'
                >
                  <X className='h-5 w-5' />
                </button>
              </div>
              <div className='absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent p-5 sm:p-7'>
                {tvQrScannerStatus && (
                  <p className='rounded-2xl bg-white/12 px-4 py-3 text-center text-sm font-black text-white backdrop-blur'>
                    {tvQrScannerStatus}
                  </p>
                )}
                {tvQrScannerError && (
                  <p className='mt-3 rounded-2xl bg-red-500/20 px-4 py-3 text-center text-sm font-black text-red-100 ring-1 ring-red-300/20 backdrop-blur'>
                    {tvQrScannerError}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
          {/* 标题栏 */}
          <div className='mb-6 flex items-start justify-between gap-4'>
            <div>
              <div className='inline-flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 text-xs font-bold text-green-600 dark:text-green-400'>
                <Monitor className='h-4 w-4' />
                TV ACCESS
              </div>
              <h3 className='mt-3 text-2xl font-black text-slate-900 dark:text-slate-50'>
                电视访问
              </h3>
            </div>
            <button
              onClick={handleCloseSubscribe}
              className='flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:hover:bg-white/10 dark:hover:text-white'
              aria-label='Close'
            >
              <X className='h-5 w-5' />
            </button>
          </div>

          <div className='mb-5 grid grid-cols-3 rounded-2xl bg-slate-100 p-1 dark:bg-white/10'>
            {[
              { key: 'tvbox' as const, label: 'TVBox 订阅', icon: Rss },
              { key: 'orion' as const, label: 'OrionTV', icon: Download },
              { key: 'web' as const, label: 'Web 电视', icon: Monitor },
            ].map((item) => {
              const Icon = item.icon;
              const active = tvAccessTab === item.key;
              return (
                <button
                  key={item.key}
                  type='button'
                  onClick={() => {
                    setTvAccessTab(item.key);
                    if (item.key !== 'web') closeTvQrScanner();
                  }}
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/70 ${
                    active
                      ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className='h-4 w-4' />
                  <span className='hidden sm:inline'>{item.label}</span>
                  <span className='sm:hidden'>{item.key === 'tvbox' ? 'TVBox' : item.key === 'orion' ? 'Orion' : 'Web'}</span>
                </button>
              );
            })}
          </div>

          {tvAccessTab === 'tvbox' && (
            <section className='rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.04]'>
              <div className='flex items-center justify-between gap-3'>
                <div className='flex items-center gap-3'>
                  <div className='flex h-11 w-11 items-center justify-center rounded-2xl bg-green-500 text-white shadow-lg shadow-green-500/25'>
                    <Rss className='h-5 w-5' />
                  </div>
                  <div>
                    <h4 className='text-lg font-black text-slate-900 dark:text-slate-100'>
                      TVBox 订阅
                    </h4>
                    <p className='mt-1 text-sm text-slate-600 dark:text-slate-400'>
                      复制订阅链接到 TVBox 使用
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    subscribeEnabled
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400'
                  }`}
                >
                  {subscribeEnabled ? '已启用' : '未启用'}
                </span>
              </div>

              {!subscribeEnabled ? (
                <div className='mt-5 rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400'>
                  TVBox 订阅功能未启用
                </div>
              ) : isLoadingSubscribeUrl ? (
                <div className='mt-5 space-y-3'>
                  <div className='h-14 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10' />
                  <div className='h-14 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10' />
                  <div className='h-10 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10' />
                </div>
              ) : (
                <div className='mt-5 space-y-4'>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <button
                      type='button'
                      onClick={() => setSubscribeAdFilterEnabled((prev) => !prev)}
                      className='flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-green-400 dark:border-white/10 dark:bg-slate-900/70'
                    >
                      <div>
                        <div className='text-sm font-bold text-slate-800 dark:text-slate-200'>去广告</div>
                        <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>开启后通过代理处理播放链接</div>
                      </div>
                      <span className={`h-5 w-9 rounded-full p-0.5 transition ${subscribeAdFilterEnabled ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                        <span className={`block h-4 w-4 rounded-full bg-white transition ${subscribeAdFilterEnabled ? 'translate-x-4' : ''}`} />
                      </span>
                    </button>
                    <button
                      type='button'
                      onClick={() => setSubscribeYellowFilterEnabled((prev) => !prev)}
                      className='flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-yellow-400 dark:border-white/10 dark:bg-slate-900/70'
                    >
                      <div>
                        <div className='text-sm font-bold text-slate-800 dark:text-slate-200'>黄色过滤</div>
                        <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>过滤代理搜索中的黄色内容</div>
                      </div>
                      <span className={`h-5 w-9 rounded-full p-0.5 transition ${subscribeYellowFilterEnabled ? 'bg-yellow-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                        <span className={`block h-4 w-4 rounded-full bg-white transition ${subscribeYellowFilterEnabled ? 'translate-x-4' : ''}`} />
                      </span>
                    </button>
                  </div>

                  <div>
                    <h4 className='mb-2 text-sm font-medium text-slate-700 dark:text-slate-300'>
                      订阅链接
                    </h4>
                    <div className='flex gap-2'>
                      <input
                        type='text'
                        className='min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-green-500 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200'
                        value={subscribeUrl}
                        readOnly
                      />
                      <button
                        onClick={handleCopySubscribeUrl}
                        className='inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-green-700'
                      >
                        <Copy className='h-4 w-4' />
                        {copySuccess ? '已复制' : '复制'}
                      </button>
                    </div>
                    {(subscribeAdFilterEnabled || subscribeYellowFilterEnabled) && (
                      <p className='mt-2 rounded-xl border border-yellow-400/25 bg-yellow-400/10 px-3 py-2 text-xs font-semibold text-yellow-700 dark:text-yellow-300'>
                        💡 代理模式已开启，某些源可能因为区域或兼容问题无法播放
                      </p>
                    )}
                  </div>

                  <div className='pt-1'>
                    <button
                      onClick={handleResetToken}
                      disabled={isResettingToken}
                      className='w-full cursor-pointer rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      {isResettingToken ? '重置中...' : '重置订阅Token'}
                    </button>
                    <p className='mt-2 text-center text-xs text-slate-500 dark:text-slate-400'>
                      ⚠️ 重置后旧链接将失效
                    </p>
                    <p id='tvbox-token-message' className='hidden text-center text-xs'></p>
                  </div>
                </div>
              )}
            </section>
          )}

          {tvAccessTab === 'orion' && (
            <section className='rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.04]'>
              <div className='flex items-center gap-3'>
                <img
                  src='/icons/OrionTV.png'
                  alt='OrionTV'
                  className='h-11 w-11 rounded-2xl object-cover shadow-lg shadow-indigo-500/20'
                />
                <div>
                  <h4 className='text-lg font-black text-slate-900 dark:text-slate-100'>
                    OrionTV
                  </h4>
                  <p className='mt-1 text-sm text-slate-600 dark:text-slate-400'>
                    Android TV 专用客户端
                  </p>
                </div>
              </div>
              <p className='mt-5 text-sm leading-6 text-slate-600 dark:text-slate-400'>
                可直接作为 MoonTV Plus 电视端使用，适合安装到 Android TV / 电视盒子。
              </p>
              <div className='mt-5'>
                <h5 className='mb-2 text-sm font-bold text-slate-700 dark:text-slate-300'>
                  Base URL
                </h5>
                <div className='flex gap-2'>
                  <input
                    type='text'
                    readOnly
                    value={typeof window !== 'undefined' ? window.location.origin : ''}
                    className='min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-200'
                  />
                  <button
                    type='button'
                    onClick={handleCopyOrionBaseUrl}
                    className='inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700'
                  >
                    <Copy className='h-4 w-4' />
                    {orionBaseUrlCopySuccess ? '已复制' : '复制'}
                  </button>
                </div>
                <p className='mt-2 text-xs text-slate-500 dark:text-slate-400'>
                  在 OrionTV 中填写该地址作为后端服务地址。
                </p>
              </div>
              <a
                href='https://github.com/mtvpls/OrionTV_Build/tags'
                target='_blank'
                rel='noopener noreferrer'
                className='mt-5 inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white transition hover:bg-indigo-700'
              >
                下载 OrionTV
                <ExternalLink className='h-4 w-4' />
              </a>
            </section>
          )}

          {tvAccessTab === 'web' && (
            <section className='rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.04]'>
              <div className='flex items-center gap-3'>
                <div className='flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-lg shadow-rose-500/25'>
                  <Monitor className='h-5 w-5' />
                </div>
                <div>
                  <h4 className='text-lg font-black text-slate-900 dark:text-slate-100'>
                    Web 电视
                  </h4>
                  <p className='mt-1 text-sm text-slate-600 dark:text-slate-400'>
                    手机扫描电视屏幕二维码并确认登录
                  </p>
                </div>
              </div>
                <p className='mt-5 text-sm leading-6 text-slate-600 dark:text-slate-400'>
                {tvModeEnabled
                  ? '电视端打开 /tv 后会显示二维码；手机在这里打开相机扫描并确认登录。'
                  : '当前部署未开启 TV 模式，/tv 页面和 Web 电视遥控不可用。'}
              </p>
              {!tvModeEnabled && (
                <div className='mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-200'>
                  TV 模式未开启。请在环境变量中设置 ENABLE_TV_MODE=true 后重启服务。
                </div>
              )}
              <div className='mt-5 grid gap-2 sm:grid-cols-2'>
                <button
                  type='button'
                  onClick={startTvQrScanner}
                  disabled={!tvModeEnabled}
                  className='inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/70 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500'
                >
                  打开相机扫码登录
                  <Smartphone className='h-4 w-4' />
                </button>
                <button
                  type='button'
                  onClick={() => {
                    if (!tvModeEnabled) return;
                    setIsSubscribeOpen(false);
                    setIsTVRemoteOpen(true);
                  }}
                  disabled={!tvModeEnabled}
                  className='inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/70 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-white/10 dark:disabled:text-slate-500'
                >
                  <Sliders className='h-4 w-4' />
                  远程电视遥控器
                </button>
              </div>

            </section>
          )}
            </>
          )}
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
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'>
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
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1003] overflow-hidden'>
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
                抄袭狗
                <span className='font-bold text-red-600 dark:text-red-400'>
                  SzeMeng76
                </span>
                毫无廉耻，盯着本项目的commit区，疯狂抄袭。警告亦全当看不见，实为开源界耻辱。
              </p>
              <p className='text-gray-800 dark:text-gray-200 leading-relaxed mt-3'>
                超分，观影室，豆瓣反爬，精确搜索等等等等，直接抄袭，最不要脸的就是，刚更新一版，几小时后直接抄走。
              </p>
              <p className='text-gray-800 dark:text-gray-200 leading-relaxed mt-3'>
                <span className='font-semibold text-red-600 dark:text-red-400'>
                  2026-02-25：
                </span>
                抄袭emby功能
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
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'>
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
                      href='https://github.com/mtvpls/OrionTV_Build/tags'
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

              {/* 私人影库转码器 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <div className='w-16 h-16 rounded-xl bg-amber-500 flex items-center justify-center shadow-sm'>
                      <RouterIcon className='w-8 h-8 text-white' />
                    </div>
                    <span className='absolute -top-1 -right-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded'>
                      MKV转码
                    </span>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      私人影库转码器
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      为私人影库中的 MKV
                      视频提供转码播放能力，可解析内封字幕并解决部分视频无音频问题，但通常需要较高的本机性能配置。
                    </p>
                    <a
                      href='https://github.com/mtvpls/moontvplus-transcoder/tags'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors'
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

      <PersonalCenterPanel
        isOpen={isProfileCenterOpen}
        mounted={mounted}
        onClose={() => setIsProfileCenterOpen(false)}
        username={currentUsername}
        roleText={currentRoleText}
        showRoleBadge={shouldShowRoleBadge}
        avatarText={avatarText}
        roleBadgeClassName={roleBadgeClassName}
        showDeviceManagement={storageType !== 'localstorage'}
        showChangePassword={showChangePassword}
        onOpenEmailSettings={() => {
          setIsProfileCenterOpen(false);
          setIsEmailSettingsOpen(true);
          loadEmailSettings();
        }}
        onOpenDeviceManagement={() => {
          setIsProfileCenterOpen(false);
          setIsDeviceManagementOpen(true);
          loadDevices();
        }}
        onOpenChangePassword={() => {
          setIsProfileCenterOpen(false);
          handleChangePassword();
        }}
      />

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
            onOpenNotificationSettings={() => {
              setIsNotificationPanelOpen(false);
              setIsEmailSettingsOpen(true);
              void loadEmailSettings();
            }}
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

      {/* 使用 Portal 将下载文件管理面板渲染到 document.body */}
      {isDownloadManagementOpen &&
        mounted &&
        createPortal(
          <DownloadManagementPanel
            isOpen={isDownloadManagementOpen}
            onClose={() => setIsDownloadManagementOpen(false)}
          />,
          document.body
        )}

      <EmailSettingsPanel
        isOpen={isEmailSettingsOpen}
        mounted={mounted}
        onClose={() => setIsEmailSettingsOpen(false)}
        userEmail={userEmail}
        onUserEmailChange={setUserEmail}
        emailNotifications={emailNotifications}
        onEmailNotificationsChange={setEmailNotifications}
        pushNotifications={pushNotifications}
        onPushNotificationsChange={handlePushNotificationsChange}
        pushNotificationsSupported={pushNotificationsSupported}
        pushNotificationsConfigured={pushNotificationsConfigured}
        pushNotificationsBusy={pushNotificationsBusy}
        emailSettingsLoading={emailSettingsLoading}
        emailSettingsSaving={emailSettingsSaving}
        onSave={handleSaveEmailSettings}
        statusMessage={emailSettingsMessage}
        statusType={emailSettingsMessageType}
      />

      <DeviceManagementPanel
        isOpen={isDeviceManagementOpen}
        mounted={mounted}
        onClose={() => setIsDeviceManagementOpen(false)}
        devices={devices}
        devicesLoading={devicesLoading}
        revoking={revoking}
        onRevokeDevice={handleRevokeDevice}
        onRevokeAllDevices={handleRevokeAllDevices}
        getDeviceIcon={getDeviceIcon}
      />

      <TVRemotePanel
        isOpen={isTVRemoteOpen}
        mounted={mounted}
        onClose={() => setIsTVRemoteOpen(false)}
      />

      {/* 使用 Portal 将生态应用面板渲染到 document.body */}
      {isEcoAppsOpen && mounted && createPortal(ecoAppsPanel, document.body)}

      {/* 使用 Portal 将举报信息面板渲染到 document.body */}
      {isReportOpen && mounted && createPortal(reportPanel, document.body)}

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
                  onClick={() =>
                    setConfirmDialog({ ...confirmDialog, isOpen: false })
                  }
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
