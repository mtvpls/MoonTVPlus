/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

import { getConfig } from '@/lib/config';

import { DanmakuCacheCleanup } from '../components/DanmakuCacheCleanup';
import { DownloadBubble } from '../components/DownloadBubble';
import { DownloadPanel } from '../components/DownloadPanel';
import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import { TokenRefreshManager } from '../components/TokenRefreshManager';
import TopProgressBar from '../components/TopProgressBar';
import ChatFloatingWindow from '../components/watch-room/ChatFloatingWindow';
import { WatchRoomProvider } from '../components/WatchRoomProvider';
import { DownloadProvider } from '../contexts/DownloadContext';

const inter = Inter({ subsets: ['latin'] });
export const dynamic = 'force-dynamic';

// 动态生成 metadata，支持配置更新后的标题变化
export async function generateMetadata(): Promise<Metadata> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const config = await getConfig();
  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTVPlus';
  if (storageType !== 'localstorage') {
    siteName = config.SiteConfig.SiteName;
  }

  return {
    title: siteName,
    description: '影视聚合',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTVPlus';
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';

  let doubanProxyType = process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent';
  let doubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  let doubanImageProxyType =
    process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent';
  let doubanImageProxy = process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '';
  let disableYellowFilter =
    process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true';
  let fluidSearch = process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false';
  let enableComments = false;
  let recommendationDataSource = 'Mixed';
  let tmdbApiKey = '';
  let openListEnabled = false;
  let embyEnabled = false;
  let xiaoyaEnabled = false;
  let loginBackgroundImage = '';
  let registerBackgroundImage = '';
  let progressThumbType = 'default';
  let progressThumbPresetId = '';
  let progressThumbCustomUrl = '';
  let enableRegistration = false;
  let loginRequireTurnstile = false;
  let registrationRequireTurnstile = false;
  let turnstileSiteKey = '';
  let enableOIDCLogin = false;
  let enableOIDCRegistration = false;
  let oidcButtonText = '';
  let aiEnabled = false;
  let aiEnableHomepageEntry = false;
  let aiEnableVideoCardEntry = false;
  let aiEnablePlayPageEntry = false;
  let aiDefaultMessageNoVideo = '';
  let aiDefaultMessageWithVideo = '';
  let enableMovieRequest = true;
  let webLiveEnabled = false;
  let customAdFilterVersion = 0;
  let tuneHubEnabled = false;
  let customCategories = [] as {
    name: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  if (storageType !== 'localstorage') {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
    announcement = config.SiteConfig.Announcement;

    doubanProxyType = config.SiteConfig.DoubanProxyType;
    doubanProxy = config.SiteConfig.DoubanProxy;
    doubanImageProxyType = config.SiteConfig.DoubanImageProxyType;
    doubanImageProxy = config.SiteConfig.DoubanImageProxy;
    disableYellowFilter = config.SiteConfig.DisableYellowFilter;
    customCategories = config.CustomCategories.filter(
      (category) => !category.disabled
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    }));
    fluidSearch = config.SiteConfig.FluidSearch;
    enableComments = config.SiteConfig.EnableComments;
    recommendationDataSource = config.SiteConfig.RecommendationDataSource || 'Mixed';
    tmdbApiKey = config.SiteConfig.TMDBApiKey || '';
    loginBackgroundImage = config.ThemeConfig?.loginBackgroundImage || '';
    registerBackgroundImage = config.ThemeConfig?.registerBackgroundImage || '';
    progressThumbType = config.ThemeConfig?.progressThumbType || 'default';
    progressThumbPresetId = config.ThemeConfig?.progressThumbPresetId || '';
    progressThumbCustomUrl = config.ThemeConfig?.progressThumbCustomUrl || '';
    enableRegistration = config.SiteConfig.EnableRegistration || false;
    loginRequireTurnstile = config.SiteConfig.LoginRequireTurnstile || false;
    registrationRequireTurnstile = config.SiteConfig.RegistrationRequireTurnstile || false;
    turnstileSiteKey = config.SiteConfig.TurnstileSiteKey || '';
    enableOIDCLogin = config.SiteConfig.EnableOIDCLogin || false;
    enableOIDCRegistration = config.SiteConfig.EnableOIDCRegistration || false;
    oidcButtonText = config.SiteConfig.OIDCButtonText || '';
    // AI配置
    aiEnabled = config.AIConfig?.Enabled || false;
    aiEnableHomepageEntry = config.AIConfig?.EnableHomepageEntry || false;
    aiEnableVideoCardEntry = config.AIConfig?.EnableVideoCardEntry || false;
    aiEnablePlayPageEntry = config.AIConfig?.EnablePlayPageEntry || false;
    aiDefaultMessageNoVideo = config.AIConfig?.DefaultMessageNoVideo || '';
    aiDefaultMessageWithVideo = config.AIConfig?.DefaultMessageWithVideo || '';
    // 求片功能配置
    enableMovieRequest = config.SiteConfig.EnableMovieRequest ?? true;
    // 网络直播功能配置
    webLiveEnabled = config.WebLiveEnabled ?? false;
    // 自定义去广告代码版本号
    customAdFilterVersion = config.SiteConfig?.CustomAdFilterVersion || 0;
    // TuneHub音乐功能配置
    tuneHubEnabled = config.MusicConfig?.TuneHubEnabled || false;
    // 检查是否启用了 OpenList 功能
    openListEnabled = !!(
      config.OpenListConfig?.Enabled &&
      config.OpenListConfig?.URL &&
      config.OpenListConfig?.Username &&
      config.OpenListConfig?.Password
    );
    // 检查是否启用了 Emby 功能（支持多源）
    embyEnabled = !!(
      config.EmbyConfig?.Sources &&
      config.EmbyConfig.Sources.length > 0 &&
      config.EmbyConfig.Sources.some(s => s.enabled && s.ServerURL)
    );
    // 检查是否启用了小雅功能
    xiaoyaEnabled = !!(
      config.XiaoyaConfig?.Enabled &&
      config.XiaoyaConfig?.ServerURL
    );
  }

  // 将运行时配置注入到全局 window 对象，供客户端在运行时读取
  const runtimeConfig = {
    STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    DOUBAN_PROXY_TYPE: doubanProxyType,
    DOUBAN_PROXY: doubanProxy,
    DOUBAN_IMAGE_PROXY_TYPE: doubanImageProxyType,
    DOUBAN_IMAGE_PROXY: doubanImageProxy,
    DISABLE_YELLOW_FILTER: disableYellowFilter,
    CUSTOM_CATEGORIES: customCategories,
    FLUID_SEARCH: fluidSearch,
    EnableComments: enableComments,
    RecommendationDataSource: recommendationDataSource,
    ENABLE_TVBOX_SUBSCRIBE: process.env.ENABLE_TVBOX_SUBSCRIBE === 'true',
    ENABLE_OFFLINE_DOWNLOAD: process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true',
    VOICE_CHAT_STRATEGY: process.env.NEXT_PUBLIC_VOICE_CHAT_STRATEGY || 'webrtc-fallback',
    OPENLIST_ENABLED: openListEnabled,
    EMBY_ENABLED: embyEnabled,
    XIAOYA_ENABLED: xiaoyaEnabled,
    PRIVATE_LIBRARY_ENABLED: openListEnabled || embyEnabled || xiaoyaEnabled,
    LOGIN_BACKGROUND_IMAGE: loginBackgroundImage,
    REGISTER_BACKGROUND_IMAGE: registerBackgroundImage,
    PROGRESS_THUMB_TYPE: progressThumbType,
    PROGRESS_THUMB_PRESET_ID: progressThumbPresetId,
    PROGRESS_THUMB_CUSTOM_URL: progressThumbCustomUrl,
    ENABLE_REGISTRATION: enableRegistration,
    LOGIN_REQUIRE_TURNSTILE: loginRequireTurnstile,
    REGISTRATION_REQUIRE_TURNSTILE: registrationRequireTurnstile,
    TURNSTILE_SITE_KEY: turnstileSiteKey,
    ENABLE_OIDC_LOGIN: enableOIDCLogin,
    ENABLE_OIDC_REGISTRATION: enableOIDCRegistration,
    OIDC_BUTTON_TEXT: oidcButtonText,
    AI_ENABLED: aiEnabled,
    AI_ENABLE_HOMEPAGE_ENTRY: aiEnableHomepageEntry,
    AI_ENABLE_VIDEOCARD_ENTRY: aiEnableVideoCardEntry,
    AI_ENABLE_PLAYPAGE_ENTRY: aiEnablePlayPageEntry,
    AI_DEFAULT_MESSAGE_NO_VIDEO: aiDefaultMessageNoVideo,
    AI_DEFAULT_MESSAGE_WITH_VIDEO: aiDefaultMessageWithVideo,
    ENABLE_MOVIE_REQUEST: enableMovieRequest,
    WEB_LIVE_ENABLED: webLiveEnabled,
    CUSTOM_AD_FILTER_VERSION: customAdFilterVersion,
    TUNEHUB_ENABLED: tuneHubEnabled,
    FESTIVE_EFFECT_ENABLED:
      process.env.FESTIVE_EFFECT_ENABLED === 'true',
  };

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover'
        />
        <link rel='apple-touch-icon' href='/icons/icon-192x192.png' />
        {/* 主题CSS */}
        <link rel='stylesheet' href='/api/theme/css' />
        {/* 将配置序列化后直接写入脚本，浏览器端可通过 window.RUNTIME_CONFIG 获取 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig)};`,
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-200`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <TopProgressBar />
          <TokenRefreshManager />
          <SiteProvider siteName={siteName} announcement={announcement} tmdbApiKey={tmdbApiKey}>
            <WatchRoomProvider>
              <DownloadProvider>
                <DanmakuCacheCleanup />
                {children}
                <GlobalErrorIndicator />
                <ChatFloatingWindow />
                <DownloadBubble />
                <DownloadPanel />
              </DownloadProvider>
            </WatchRoomProvider>
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
