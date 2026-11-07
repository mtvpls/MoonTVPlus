/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';
import { getCachedLiveChannels } from '@/lib/live';
import { hasFeaturePermission } from '@/lib/permissions';
import { isTVBoxBridgeSource } from '@/lib/tvbox-bridge.shared';
import {
  authorizeTVBoxSubscription,
  getTVBoxSubscriptionBaseUrl,
  getTVBoxSubscriptionOriginalConfig,
} from '@/lib/tvbox-subscription.server';

export const runtime = 'nodejs';

/**
 * TVBOX订阅API
 * 根据视频源和直播源生成TVBOX订阅
 * 支持全局token（管理员）和用户token（普通用户）
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requestToken = searchParams.get('token');
  const adFilter = searchParams.get('adFilter') === 'true'; // 获取去广告参数
  const yellowFilter = searchParams.get('yellowFilter') === 'true';
  const auth = await authorizeTVBoxSubscription(requestToken);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { token, username, isGlobalToken } = auth;

  try {
    // 获取配置
    const config = await getConfig();
    const baseUrl = getTVBoxSubscriptionBaseUrl(request);
    const responseHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    };
    const bridgeOnly = searchParams.get('source') === 'bridge';

    // 子仓不再携带多仓开关，避免 TVBox 反复读到多仓清单。
    if (searchParams.get('includeTVBox') === 'true' && !bridgeOnly) {
      const originalParams = new URLSearchParams(searchParams);
      originalParams.delete('includeTVBox');
      originalParams.delete('source');
      const bridgeParams = new URLSearchParams(originalParams);
      bridgeParams.set('source', 'bridge');
      return NextResponse.json(
        {
          urls: [
            {
              name: config.SiteConfig?.SiteName || 'MoonTVPlus',
              url: `${baseUrl}/api/tvbox/subscribe?${originalParams}`,
            },
            {
              name: 'TVBox 桥接',
              url: `${baseUrl}/api/tvbox/subscribe?${bridgeParams}`,
            },
          ],
        },
        { headers: responseHeaders }
      );
    }

    if (bridgeOnly) {
      const originalConfig = await getTVBoxSubscriptionOriginalConfig(
        config,
        username
      );
      return NextResponse.json(originalConfig, { headers: responseHeaders });
    }

    // 获取视频源
    // 全局token返回所有源，用户token返回该用户有权限的源
    const apiSites = (await getAvailableApiSites(username)).filter(
      (site) => !isTVBoxBridgeSource(site.key)
    );

    // 获取直播源
    const canAccessLive =
      isGlobalToken || !username
        ? true
        : await hasFeaturePermission(username, 'live');
    const liveConfig = canAccessLive
      ? config.LiveConfig?.filter(
          (live) =>
            !live.disabled && !live.tvbox && !live.key.startsWith('tvbox-live:')
        ) || []
      : [];

    console.log(
      'TVBOX 订阅 baseUrl:',
      baseUrl,
      'adFilter:',
      adFilter,
      'yellowFilter:',
      yellowFilter
    );

    // 检查是否配置了 OpenList
    const hasOpenList = !!(
      config.OpenListConfig?.Enabled &&
      config.OpenListConfig?.URL &&
      config.OpenListConfig?.Username &&
      config.OpenListConfig?.Password
    );

    // 获取所有启用的 Emby 源
    const { embyManager } = await import('@/lib/emby-manager');
    const embySources = await embyManager.getEnabledSources();

    // 构建 OpenList 站点配置
    const openlistSites = hasOpenList
      ? [
          {
            key: 'openlist',
            name: '私人影库',
            type: 1,
            api: `${baseUrl}/api/openlist/cms-proxy/${encodeURIComponent(
              token
            )}`,
            searchable: 1,
            quickSearch: 1,
            filterable: 1,
            ext: '',
          },
        ]
      : [];

    // 构建 Emby 站点配置（为每个启用的Emby源生成独立站点）
    const embySites = embySources.map((source) => ({
      key: `emby_${source.key}`,
      name: source.name || 'Emby媒体库',
      type: 1,
      api: `${baseUrl}/api/emby/cms-proxy/${encodeURIComponent(
        token
      )}?embyKey=${source.key}`,
      searchable: 1,
      quickSearch: 1,
      filterable: 1,
      ext: '',
    }));

    // 构建TVBOX订阅数据
    const tvboxSubscription = {
      // 站点配置
      spider: `${baseUrl}/tvbox/custom_spider.jar`,
      wallpaper: '',

      // 视频源站点 - 根据 adFilter 参数决定是否使用代理
      // OpenList 和 Emby 源放在最前面
      sites: [
        ...openlistSites,
        ...embySites,
        ...apiSites.map((site) => ({
          key: site.key,
          name: site.name,
          type: 1,
          // 开启去广告或黄色过滤时使用 CMS 代理
          api:
            adFilter || yellowFilter
              ? `${baseUrl}/api/cms-proxy?api=${encodeURIComponent(site.api)}${
                  adFilter ? '&adFilter=true' : ''
                }${yellowFilter ? '&yellowFilter=true' : ''}`
              : site.api,
          searchable: 1,
          quickSearch: 1,
          filterable: 1,
          ext: site.detail || '',
        })),
      ],

      // 直播源
      lives: await Promise.all(
        liveConfig.map(async (live) => {
          try {
            const liveChannels = await getCachedLiveChannels(live.key);
            return {
              name: live.name,
              type: 0,
              url: live.url,
              epg: live.epg || liveChannels?.epgUrl || '',
              logo: '',
            };
          } catch (error) {
            return {
              name: live.name,
              type: 0,
              playerType: 1,
              url: live.url,
              epg: live.epg || '',
              logo: '',
            };
          }
        })
      ),

      // 解析器
      parses: [],

      // 规则
      rules: [],

      // 广告配置
      ads: [],
    };

    // 获取屏蔽源列表并过滤
    const blockedSources = process.env.TVBOX_BLOCKED_SOURCES
      ? process.env.TVBOX_BLOCKED_SOURCES.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (blockedSources.length > 0) {
      tvboxSubscription.sites = tvboxSubscription.sites.filter(
        (site) => !blockedSources.includes(site.key)
      );
      console.log('TVBOX 订阅已屏蔽源:', blockedSources);
    }

    return NextResponse.json(tvboxSubscription, {
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('生成TVBOX订阅失败:', error);
    return NextResponse.json(
      {
        error: '生成订阅失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
