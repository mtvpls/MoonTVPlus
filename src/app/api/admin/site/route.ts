/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

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
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      DisableYellowFilter,
      FluidSearch,
      DanmakuApiBase,
      DanmakuApiToken,
      TMDBApiKey,
      TMDBProxy,
      TMDBReverseProxy,
      BannerDataSource,
      RecommendationDataSource,
      PansouApiUrl,
      PansouUsername,
      PansouPassword,
      EnableComments,
      CustomAdFilterCode,
      CustomAdFilterVersion,
      EnableRegistration,
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
    } = body as {
      SiteName: string;
      Announcement: string;
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      DoubanProxy: string;
      DoubanImageProxyType: string;
      DoubanImageProxy: string;
      DisableYellowFilter: boolean;
      FluidSearch: boolean;
      DanmakuApiBase: string;
      DanmakuApiToken: string;
      TMDBApiKey?: string;
      TMDBProxy?: string;
      TMDBReverseProxy?: string;
      BannerDataSource?: string;
      RecommendationDataSource?: string;
      PansouApiUrl?: string;
      PansouUsername?: string;
      PansouPassword?: string;
      EnableComments: boolean;
      CustomAdFilterCode?: string;
      CustomAdFilterVersion?: number;
      EnableRegistration?: boolean;
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
    };

    // 参数校验
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      typeof DoubanProxy !== 'string' ||
      typeof DoubanImageProxyType !== 'string' ||
      typeof DoubanImageProxy !== 'string' ||
      typeof DisableYellowFilter !== 'boolean' ||
      typeof FluidSearch !== 'boolean' ||
      typeof DanmakuApiBase !== 'string' ||
      typeof DanmakuApiToken !== 'string' ||
      (TMDBApiKey !== undefined && typeof TMDBApiKey !== 'string') ||
      (TMDBProxy !== undefined && typeof TMDBProxy !== 'string') ||
      (TMDBReverseProxy !== undefined && typeof TMDBReverseProxy !== 'string') ||
      (BannerDataSource !== undefined && typeof BannerDataSource !== 'string') ||
      (RecommendationDataSource !== undefined && typeof RecommendationDataSource !== 'string') ||
      typeof EnableComments !== 'boolean' ||
      (CustomAdFilterCode !== undefined && typeof CustomAdFilterCode !== 'string') ||
      (CustomAdFilterVersion !== undefined && typeof CustomAdFilterVersion !== 'number') ||
      (EnableRegistration !== undefined && typeof EnableRegistration !== 'boolean') ||
      (RegistrationRequireTurnstile !== undefined && typeof RegistrationRequireTurnstile !== 'boolean') ||
      (LoginRequireTurnstile !== undefined && typeof LoginRequireTurnstile !== 'boolean') ||
      (TurnstileSiteKey !== undefined && typeof TurnstileSiteKey !== 'string') ||
      (TurnstileSecretKey !== undefined && typeof TurnstileSecretKey !== 'string') ||
      (DefaultUserTags !== undefined && !Array.isArray(DefaultUserTags)) ||
      (EnableOIDCLogin !== undefined && typeof EnableOIDCLogin !== 'boolean') ||
      (EnableOIDCRegistration !== undefined && typeof EnableOIDCRegistration !== 'boolean') ||
      (OIDCIssuer !== undefined && typeof OIDCIssuer !== 'string') ||
      (OIDCAuthorizationEndpoint !== undefined && typeof OIDCAuthorizationEndpoint !== 'string') ||
      (OIDCTokenEndpoint !== undefined && typeof OIDCTokenEndpoint !== 'string') ||
      (OIDCUserInfoEndpoint !== undefined && typeof OIDCUserInfoEndpoint !== 'string') ||
      (OIDCClientId !== undefined && typeof OIDCClientId !== 'string') ||
      (OIDCClientSecret !== undefined && typeof OIDCClientSecret !== 'string') ||
      (OIDCButtonText !== undefined && typeof OIDCButtonText !== 'string') ||
      (OIDCMinTrustLevel !== undefined && typeof OIDCMinTrustLevel !== 'number')
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
    adminConfig.SiteConfig = {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      DisableYellowFilter,
      FluidSearch,
      DanmakuApiBase,
      DanmakuApiToken,
      TMDBApiKey,
      TMDBProxy,
      TMDBReverseProxy,
      BannerDataSource,
      RecommendationDataSource,
      PansouApiUrl,
      PansouUsername,
      PansouPassword,
      EnableComments,
      CustomAdFilterCode,
      CustomAdFilterVersion,
      EnableRegistration,
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
