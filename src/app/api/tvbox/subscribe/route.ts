/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getCachedLiveChannels } from '@/lib/live';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * TVBOX订阅API
 * 根据视频源和直播源生成TVBOX订阅
 * 支持全局token（管理员）和用户token（普通用户）
 */
export async function GET(request: NextRequest) {
  // 检查是否开启订阅功能
  const enableSubscribe = process.env.ENABLE_TVBOX_SUBSCRIBE === 'true';
  if (!enableSubscribe) {
    return NextResponse.json(
      { error: '订阅功能未开启' },
      { status: 403 }
    );
  }

  // 验证token
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
  const adFilter = searchParams.get('adFilter') === 'true'; // 获取去广告参数
  const yellowFilter = searchParams.get('yellowFilter') === 'true';

  if (!token) {
    return NextResponse.json(
      { error: '缺少订阅token' },
      { status: 401 }
    );
  }

  // 判断是全局token还是用户token
  let username: string | undefined;
  let isGlobalToken = false;

  if (globalToken && token === globalToken) {
    // 全局token（管理员订阅）
    isGlobalToken = true;
    console.log('使用全局token访问TVBox订阅');
  } else {
    // 用户token，查询用户名
    username = await db.getUsernameByTvboxToken(token) || undefined;
    if (!username) {
      return NextResponse.json(
        { error: '无效的订阅token' },
        { status: 401 }
      );
    }

    // 检查用户是否被封禁
    const userInfo = await db.getUserInfoV2(username);
    if (userInfo?.banned) {
      return NextResponse.json(
        { error: '用户已被封禁' },
        { status: 403 }
      );
    }

    console.log(`用户 ${username} 访问TVBox订阅`);
  }

  try {
    // 获取配置
    const config = await getConfig();

    // 获取视频源
    // 全局token返回所有源，用户token返回该用户有权限的源
    const apiSites = await getAvailableApiSites(username);

    // 获取直播源
    const canAccessLive = isGlobalToken || !username
      ? true
      : await hasFeaturePermission(username, 'live');
    const liveConfig = canAccessLive
      ? config.LiveConfig?.filter(live => !live.disabled) || []
      : [];

    // 获取当前请求的 origin，用于构建代理链接
    // 优先级：SITE_BASE 环境变量 > origin 参数 > 从请求头构建
    let baseUrl = process.env.SITE_BASE || searchParams.get('origin');

    if (!baseUrl) {
      // 从请求头中获取 Host 和协议
      const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
      const proto = request.headers.get('x-forwarded-proto') ||
                    (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
      baseUrl = `${proto}://${host}`;
    }

    console.log('TVBOX 订阅 baseUrl:', baseUrl, 'adFilter:', adFilter, 'yellowFilter:', yellowFilter);

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
    const openlistSites = hasOpenList ? [{
      key: 'openlist',
      name: '私人影库',
      type: 1,
      api: `${baseUrl}/api/openlist/cms-proxy/${encodeURIComponent(token)}`,
      searchable: 1,
      quickSearch: 1,
      filterable: 1,
      ext: '',
    }] : [];

    // 构建 Emby 站点配置（为每个启用的Emby源生成独立站点）
    const embySites = embySources.map(source => ({
      key: `emby_${source.key}`,
      name: source.name || 'Emby媒体库',
      type: 1,
      api: `${baseUrl}/api/emby/cms-proxy/${encodeURIComponent(token)}?embyKey=${source.key}`,
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
        ...apiSites.map(site => ({
          key: site.key,
          name: site.name,
          type: 1,
          // 开启去广告或黄色过滤时使用 CMS 代理
          api: (adFilter || yellowFilter)
            ? `${baseUrl}/api/cms-proxy?api=${encodeURIComponent(site.api)}${adFilter ? '&adFilter=true' : ''}${yellowFilter ? '&yellowFilter=true' : ''}`
            : site.api,
          searchable: 1,
          quickSearch: 1,
          filterable: 1,
          ext: site.detail || '',
        }))
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
              epg: live.epg || (liveChannels?.epgUrl || ''),
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
      ? process.env.TVBOX_BLOCKED_SOURCES.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (blockedSources.length > 0) {
      tvboxSubscription.sites = tvboxSubscription.sites.filter(
        site => !blockedSources.includes(site.key)
      );
      console.log('TVBOX 订阅已屏蔽源:', blockedSources);
    }

    return NextResponse.json(tvboxSubscription, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
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
