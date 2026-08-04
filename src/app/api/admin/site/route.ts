/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { normalizeApiBaseUrl } from '@/lib/url';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      SiteName,
      Announcement,
      AnnouncementDisplayMode,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      DisableYellowFilter,
      FluidSearch,
      DanmakuSourceType,
      DanmakuApiBase,
      DanmakuApiToken,
      DanmakuAutoLoadDefault,
      TMDBApiKey,
      TMDBProxy,
      TMDBReverseProxy,
      BangumiDataSource,
      BangumiApiBaseUrl,
      BangumiImageBaseUrl,
      BangumiProxy,
      BannerDataSource,
      RecommendationDataSource,
      PansouApiUrl,
      PansouUsername,
      PansouPassword,
      PansouKeywordBlocklist,
      MagnetProxy,
      MagnetMikanReverseProxy,
      MagnetDmhyReverseProxy,
      MagnetAcgripReverseProxy,
      MagnetNyaaReverseProxy,
      EnableComments,
      CustomAdFilterCode,
      CustomAdFilterVersion,
      EnableRegistration,
      RequireRegistrationInviteCode,
      RegistrationInviteCode,
      RegistrationRequireTurnstile,
      LoginRequireTurnstile,
      TurnstileSiteKey,
      TurnstileSecretKey,
      DefaultUserTags,
      EnableOIDCLogin,
      EnableOIDCRegistration,
      OIDCIssuer,
      OIDCAuthorizationEndpoint,
      OIDCTokenEndpoint,
      OIDCUserInfoEndpoint,
      OIDCClientId,
      OIDCClientSecret,
      OIDCButtonText,
      OIDCMinTrustLevel,
      AnalyticsEnabled,
      AnalyticsProvider,
      AnalyticsScriptUrl,
      AnalyticsWebsiteId,
      AnalyticsCustomScript,
    } = body as {
      SiteName: string;
      Announcement: string;
      AnnouncementDisplayMode?: 'once' | 'every';
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      DoubanProxy: string;
      DoubanImageProxyType: string;
      DoubanImageProxy: string;
      DisableYellowFilter: boolean;
      FluidSearch: boolean;
      DanmakuSourceType?: 'builtin' | 'custom';
      DanmakuApiBase: string;
      DanmakuApiToken: string;
      DanmakuAutoLoadDefault?: boolean;
      TMDBApiKey?: string;
      TMDBProxy?: string;
      TMDBReverseProxy?: string;
      BangumiDataSource?:
        | 'direct'
        | 'server-proxy'
        | 'custom-baseurl'
        | 'sakura';
      BangumiApiBaseUrl?: string;
      BangumiImageBaseUrl?: string;
      BangumiProxy?: string;
      BannerDataSource?: string;
      RecommendationDataSource?: string;
      PansouApiUrl?: string;
      PansouUsername?: string;
      PansouPassword?: string;
      PansouKeywordBlocklist?: string;
      MagnetProxy?: string;
      MagnetMikanReverseProxy?: string;
      MagnetDmhyReverseProxy?: string;
      MagnetAcgripReverseProxy?: string;
      MagnetNyaaReverseProxy?: string;
      EnableComments: boolean;
      CustomAdFilterCode?: string;
      CustomAdFilterVersion?: number;
      EnableRegistration?: boolean;
      RequireRegistrationInviteCode?: boolean;
      RegistrationInviteCode?: string;
      RegistrationRequireTurnstile?: boolean;
      LoginRequireTurnstile?: boolean;
      TurnstileSiteKey?: string;
      TurnstileSecretKey?: string;
      DefaultUserTags?: string[];
      EnableOIDCLogin?: boolean;
      EnableOIDCRegistration?: boolean;
      OIDCIssuer?: string;
      OIDCAuthorizationEndpoint?: string;
      OIDCTokenEndpoint?: string;
      OIDCUserInfoEndpoint?: string;
      OIDCClientId?: string;
      OIDCClientSecret?: string;
      OIDCButtonText?: string;
      OIDCMinTrustLevel?: number;
      AnalyticsEnabled?: boolean;
      AnalyticsProvider?: 'umami' | 'google' | 'clarity' | 'custom';
      AnalyticsScriptUrl?: string;
      AnalyticsWebsiteId?: string;
      AnalyticsCustomScript?: string;
    };

    // 参数校验
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      (AnnouncementDisplayMode !== undefined &&
        AnnouncementDisplayMode !== 'once' &&
        AnnouncementDisplayMode !== 'every') ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      typeof DoubanProxy !== 'string' ||
      typeof DoubanImageProxyType !== 'string' ||
      typeof DoubanImageProxy !== 'string' ||
      typeof DisableYellowFilter !== 'boolean' ||
      typeof FluidSearch !== 'boolean' ||
      (DanmakuSourceType !== undefined &&
        DanmakuSourceType !== 'builtin' &&
        DanmakuSourceType !== 'custom') ||
      typeof DanmakuApiBase !== 'string' ||
      typeof DanmakuApiToken !== 'string' ||
      (DanmakuAutoLoadDefault !== undefined &&
        typeof DanmakuAutoLoadDefault !== 'boolean') ||
      (TMDBApiKey !== undefined && typeof TMDBApiKey !== 'string') ||
      (TMDBProxy !== undefined && typeof TMDBProxy !== 'string') ||
      (TMDBReverseProxy !== undefined &&
        typeof TMDBReverseProxy !== 'string') ||
      (BangumiDataSource !== undefined &&
        BangumiDataSource !== 'direct' &&
        BangumiDataSource !== 'server-proxy' &&
        BangumiDataSource !== 'custom-baseurl' &&
        BangumiDataSource !== 'sakura') ||
      (BangumiApiBaseUrl !== undefined &&
        typeof BangumiApiBaseUrl !== 'string') ||
      (BangumiImageBaseUrl !== undefined &&
        typeof BangumiImageBaseUrl !== 'string') ||
      (BangumiProxy !== undefined && typeof BangumiProxy !== 'string') ||
      (BannerDataSource !== undefined &&
        typeof BannerDataSource !== 'string') ||
      (RecommendationDataSource !== undefined &&
        typeof RecommendationDataSource !== 'string') ||
      (PansouKeywordBlocklist !== undefined &&
        typeof PansouKeywordBlocklist !== 'string') ||
      (MagnetProxy !== undefined && typeof MagnetProxy !== 'string') ||
      (MagnetMikanReverseProxy !== undefined &&
        typeof MagnetMikanReverseProxy !== 'string') ||
      (MagnetDmhyReverseProxy !== undefined &&
        typeof MagnetDmhyReverseProxy !== 'string') ||
      (MagnetAcgripReverseProxy !== undefined &&
        typeof MagnetAcgripReverseProxy !== 'string') ||
      (MagnetNyaaReverseProxy !== undefined &&
        typeof MagnetNyaaReverseProxy !== 'string') ||
      typeof EnableComments !== 'boolean' ||
      (CustomAdFilterCode !== undefined &&
        typeof CustomAdFilterCode !== 'string') ||
      (CustomAdFilterVersion !== undefined &&
        typeof CustomAdFilterVersion !== 'number') ||
      (EnableRegistration !== undefined &&
        typeof EnableRegistration !== 'boolean') ||
      (RequireRegistrationInviteCode !== undefined &&
        typeof RequireRegistrationInviteCode !== 'boolean') ||
      (RegistrationInviteCode !== undefined &&
        typeof RegistrationInviteCode !== 'string') ||
      (RegistrationRequireTurnstile !== undefined &&
        typeof RegistrationRequireTurnstile !== 'boolean') ||
      (LoginRequireTurnstile !== undefined &&
        typeof LoginRequireTurnstile !== 'boolean') ||
      (TurnstileSiteKey !== undefined &&
        typeof TurnstileSiteKey !== 'string') ||
      (TurnstileSecretKey !== undefined &&
        typeof TurnstileSecretKey !== 'string') ||
      (DefaultUserTags !== undefined && !Array.isArray(DefaultUserTags)) ||
      (EnableOIDCLogin !== undefined && typeof EnableOIDCLogin !== 'boolean') ||
      (EnableOIDCRegistration !== undefined &&
        typeof EnableOIDCRegistration !== 'boolean') ||
      (OIDCIssuer !== undefined && typeof OIDCIssuer !== 'string') ||
      (OIDCAuthorizationEndpoint !== undefined &&
        typeof OIDCAuthorizationEndpoint !== 'string') ||
      (OIDCTokenEndpoint !== undefined &&
        typeof OIDCTokenEndpoint !== 'string') ||
      (OIDCUserInfoEndpoint !== undefined &&
        typeof OIDCUserInfoEndpoint !== 'string') ||
      (OIDCClientId !== undefined && typeof OIDCClientId !== 'string') ||
      (OIDCClientSecret !== undefined &&
        typeof OIDCClientSecret !== 'string') ||
      (OIDCButtonText !== undefined && typeof OIDCButtonText !== 'string') ||
      (OIDCMinTrustLevel !== undefined && typeof OIDCMinTrustLevel !== 'number') ||
      (AnalyticsEnabled !== undefined && typeof AnalyticsEnabled !== 'boolean') ||
      (AnalyticsProvider !== undefined &&
        AnalyticsProvider !== 'umami' &&
        AnalyticsProvider !== 'google' &&
        AnalyticsProvider !== 'clarity' &&
        AnalyticsProvider !== 'custom') ||
      (AnalyticsScriptUrl !== undefined && typeof AnalyticsScriptUrl !== 'string') ||
      (AnalyticsWebsiteId !== undefined && typeof AnalyticsWebsiteId !== 'string') ||
      (AnalyticsCustomScript !== undefined && typeof AnalyticsCustomScript !== 'string')
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const adminConfig = await getConfig();

    // 权限校验 - 使用v2用户系统
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 更新缓存中的站点设置
    // API Base URL 统一去尾斜杠，避免运行时拼接路径出现 //
    adminConfig.SiteConfig = {
      SiteName,
      Announcement,
      AnnouncementDisplayMode,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy: normalizeApiBaseUrl(DoubanProxy),
      DoubanImageProxyType,
      DoubanImageProxy: normalizeApiBaseUrl(DoubanImageProxy),
      DisableYellowFilter,
      FluidSearch,
      DanmakuSourceType,
      DanmakuApiBase: normalizeApiBaseUrl(DanmakuApiBase),
      DanmakuApiToken,
      DanmakuAutoLoadDefault,
      TMDBApiKey,
      TMDBProxy: normalizeApiBaseUrl(TMDBProxy),
      TMDBReverseProxy: normalizeApiBaseUrl(TMDBReverseProxy),
      BangumiDataSource,
      BangumiApiBaseUrl: normalizeApiBaseUrl(BangumiApiBaseUrl),
      BangumiImageBaseUrl: normalizeApiBaseUrl(BangumiImageBaseUrl),
      BangumiProxy: normalizeApiBaseUrl(BangumiProxy),
      BannerDataSource,
      RecommendationDataSource,
      PansouApiUrl: normalizeApiBaseUrl(PansouApiUrl),
      PansouUsername,
      PansouPassword,
      PansouKeywordBlocklist,
      MagnetProxy: normalizeApiBaseUrl(MagnetProxy),
      MagnetMikanReverseProxy: normalizeApiBaseUrl(MagnetMikanReverseProxy),
      MagnetDmhyReverseProxy: normalizeApiBaseUrl(MagnetDmhyReverseProxy),
      MagnetAcgripReverseProxy: normalizeApiBaseUrl(MagnetAcgripReverseProxy),
      MagnetNyaaReverseProxy: normalizeApiBaseUrl(MagnetNyaaReverseProxy),
      EnableComments,
      CustomAdFilterCode,
      CustomAdFilterVersion,
      EnableRegistration,
      RequireRegistrationInviteCode,
      RegistrationInviteCode,
      RegistrationRequireTurnstile,
      LoginRequireTurnstile,
      TurnstileSiteKey,
      TurnstileSecretKey,
      DefaultUserTags,
      EnableOIDCLogin,
      EnableOIDCRegistration,
      OIDCIssuer: normalizeApiBaseUrl(OIDCIssuer),
      OIDCAuthorizationEndpoint,
      OIDCTokenEndpoint,
      OIDCUserInfoEndpoint,
      OIDCClientId,
      OIDCClientSecret,
      OIDCButtonText,
      OIDCMinTrustLevel,
      AnalyticsEnabled,
      AnalyticsProvider,
      AnalyticsScriptUrl,
      AnalyticsWebsiteId,
      AnalyticsCustomScript,
    };

    // 写入数据库
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 不缓存结果
        },
      }
    );
  } catch (error) {
    console.error('更新站点配置失败:', error);
    return NextResponse.json(
      {
        error: '更新站点配置失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
