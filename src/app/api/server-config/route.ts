/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { CURRENT_VERSION } from '@/lib/version'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 禁用缓存

export async function GET(request: NextRequest) {
  console.log('server-config called: ', request.url);

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 观影室配置从环境变量读取
  // 注意：不要暴露 externalServerAuth 到前端，这是敏感凭据
  const watchRoomConfig = {
    enabled: process.env.WATCH_ROOM_ENABLED === 'true',
    serverType: (process.env.WATCH_ROOM_SERVER_TYPE as 'internal' | 'external') || 'internal',
    externalServerUrl: process.env.WATCH_ROOM_EXTERNAL_SERVER_URL,
    // externalServerAuth 不应该暴露给前端
  };

  // 如果使用 localStorage，返回默认配置
  if (storageType === 'localstorage') {
    return NextResponse.json({
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTVPlus',
      StorageType: 'localstorage',
      Version: CURRENT_VERSION,
      WatchRoom: watchRoomConfig,
      EnableOfflineDownload: process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true',
    });
  }

  // 非 localStorage 模式，从数据库读取配置
  const config = await getConfig();
  const result = {
    SiteName: config.SiteConfig.SiteName,
    StorageType: storageType,
    Version: CURRENT_VERSION,
    WatchRoom: watchRoomConfig,
    EnableOfflineDownload: process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true',
    EnableRegistration: config.SiteConfig.EnableRegistration || false,
    RegistrationRequireTurnstile: config.SiteConfig.RegistrationRequireTurnstile || false,
    LoginRequireTurnstile: config.SiteConfig.LoginRequireTurnstile || false,
    TurnstileSiteKey: config.SiteConfig.TurnstileSiteKey || '',
    EnableOIDCLogin: config.SiteConfig.EnableOIDCLogin || false,
    EnableOIDCRegistration: config.SiteConfig.EnableOIDCRegistration || false,
    OIDCButtonText: config.SiteConfig.OIDCButtonText || '',
    loginBackgroundImage: config.ThemeConfig?.loginBackgroundImage || '',
    registerBackgroundImage: config.ThemeConfig?.registerBackgroundImage || '',
    progressThumbType: config.ThemeConfig?.progressThumbType || 'default',
    progressThumbPresetId: config.ThemeConfig?.progressThumbPresetId || '',
    progressThumbCustomUrl: config.ThemeConfig?.progressThumbCustomUrl || '',
    // AI配置（只暴露功能开关，不暴露API密钥等敏感信息）
    AIEnabled: config.AIConfig?.Enabled || false,
    AIEnableHomepageEntry: config.AIConfig?.EnableHomepageEntry || false,
    AIEnableVideoCardEntry: config.AIConfig?.EnableVideoCardEntry || false,
    AIEnablePlayPageEntry: config.AIConfig?.EnablePlayPageEntry || false,
    AIDefaultMessageNoVideo: config.AIConfig?.DefaultMessageNoVideo || '',
    AIDefaultMessageWithVideo: config.AIConfig?.DefaultMessageWithVideo || '',
  };
  return NextResponse.json(result);
}
