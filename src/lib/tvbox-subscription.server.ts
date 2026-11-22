import { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { fetchConfigSubscription } from '@/lib/config-subscription';
import { db } from '@/lib/db';
import { hasFeaturePermission } from '@/lib/permissions';
import {
  getTVBoxBridgeEndpoint,
  getTVBoxBridgeStatus,
} from '@/lib/tvbox-bridge.server';
import { buildTVBoxBridgeSourceValue } from '@/lib/tvbox-bridge.shared';

/** TVBox 客户端使用订阅 Token，不依赖浏览器登录 Cookie。 */
export async function authorizeTVBoxSubscription(token: string | null) {
  if (process.env.ENABLE_TVBOX_SUBSCRIBE !== 'true') {
    return { ok: false as const, status: 403, error: '订阅功能未开启' };
  }
  if (!token) {
    return { ok: false as const, status: 401, error: '缺少订阅token' };
  }
  if (
    process.env.TVBOX_SUBSCRIBE_TOKEN &&
    token === process.env.TVBOX_SUBSCRIBE_TOKEN
  ) {
    return {
      ok: true as const,
      token,
      username: undefined,
      isGlobalToken: true,
    };
  }
  const username = (await db.getUsernameByTvboxToken(token)) || undefined;
  if (!username) {
    return { ok: false as const, status: 401, error: '无效的订阅token' };
  }
  const user = await db.getUserInfoV2(username);
  if (user?.banned) {
    return { ok: false as const, status: 403, error: '用户已被封禁' };
  }
  return { ok: true as const, token, username, isGlobalToken: false };
}

export function getTVBoxSubscriptionBaseUrl(request: NextRequest): string {
  const configured =
    process.env.SITE_BASE || request.nextUrl.searchParams.get('origin');
  if (configured) return configured.replace(/\/+$/, '');
  const host =
    request.headers.get('host') ||
    request.headers.get('x-forwarded-host') ||
    request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ||
    (host.includes('localhost') || host.includes('127.0.0.1')
      ? 'http'
      : 'https');
  return `${proto}://${host}`;
}

type OriginalTVBoxSite = Record<string, unknown> & { key: string };
type OriginalTVBoxConfig = Record<string, unknown> & {
  sites: OriginalTVBoxSite[];
};

/** 补全相对资源的来源地址；JAR 校验后缀及原有代理 URL 保持不变。 */
function resolveResource(
  value: unknown,
  baseUrl: string,
  jar = false
): unknown {
  if (typeof value !== 'string' || !value) return value;
  const [url, ...suffix] = jar ? value.split(';') : [value];
  if (!url || /^[a-z][a-z\d+.-]*:/i.test(url)) return value;
  if (!jar && !/^(?:\.\.?\/|\/)/.test(url)) return value;
  return [new URL(url, baseUrl).href, ...suffix].join(';');
}

/** 多仓的 TVBox 子仓使用原始订阅，只按本项目权限过滤，不改为 CMS 爬虫。 */
export async function getTVBoxSubscriptionOriginalConfig(
  config: AdminConfig,
  username?: string
): Promise<OriginalTVBoxConfig> {
  const bridge = config.TVBoxBridgeConfig;
  if (!bridge?.Enabled) return { sites: [] };
  let configUrl = bridge.SelectedDepotUrl || bridge.ConfigUrl;
  if (!configUrl) {
    const endpoint = await getTVBoxBridgeEndpoint();
    const status = endpoint && (await getTVBoxBridgeStatus(endpoint));
    configUrl = status?.configUrl || undefined;
  }
  if (!configUrl) throw new Error('请先在 TVBox 桥接中加载订阅并选择具体仓库');
  const response = await fetchConfigSubscription(
    configUrl,
    config.ConfigSubscribtion?.Proxy
  );
  if (!response.ok)
    throw new Error(`TVBox 原始订阅请求失败: HTTP ${response.status}`);
  const raw: unknown = JSON.parse(
    (await response.text()).replace(/^\uFEFF/, '')
  );
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    !Array.isArray((raw as Record<string, unknown>).sites)
  ) {
    throw new Error('TVBox 原始订阅不是单仓配置，请先选择具体仓库');
  }
  const result = raw as OriginalTVBoxConfig;
  const originalBase = response.url || configUrl;
  let allowedKeys: Set<string> | null = null;
  if (
    username &&
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !== 'localstorage'
  ) {
    const user = await db.getUserInfoV2(username);
    if (user?.enabledApis?.length) {
      allowedKeys = new Set(user.enabledApis);
    } else if (user?.tags?.length) {
      const keys = new Set<string>();
      for (const tag of config.UserConfig.Tags || []) {
        if (user.tags.includes(tag.name))
          tag.enabledApis?.forEach((key) => keys.add(key));
      }
      if (keys.size) allowedKeys = keys;
    }
  }
  const special = new Set(config.SpecialSourceApis || []);
  const blocked = new Set(
    (process.env.TVBOX_BLOCKED_SOURCES || '')
      .split(',')
      .map((key) => key.trim())
  );
  const settings = new Map(
    (bridge.Sites || []).map((site) => [site.key, site])
  );
  result.sites = result.sites
    .filter((site) => {
      if (!site || typeof site.key !== 'string') return false;
      const key = buildTVBoxBridgeSourceValue(site.key);
      return (
        !special.has(key) &&
        !special.has(site.key) &&
        !blocked.has(key) &&
        !blocked.has(site.key) &&
        settings.get(site.key)?.enabled !== false &&
        (!allowedKeys || allowedKeys.has(key))
      );
    })
    .map((site) => {
      const resolved = { ...site };
      for (const field of ['api', 'ext'])
        if (field in resolved)
          resolved[field] = resolveResource(resolved[field], originalBase);
      if ('jar' in resolved)
        resolved.jar = resolveResource(resolved.jar, originalBase, true);
      return resolved;
    });
  if ('spider' in result)
    result.spider = resolveResource(result.spider, originalBase, true);
  if ('wallpaper' in result)
    result.wallpaper = resolveResource(result.wallpaper, originalBase);
  if (Array.isArray(result.parses))
    result.parses = result.parses.map((parse) => {
      if (!parse || typeof parse !== 'object') return parse;
      return { ...parse, url: resolveResource(parse.url, originalBase) };
    });
  if (username && !(await hasFeaturePermission(username, 'live'))) {
    result.lives = [];
  } else if (Array.isArray(result.lives)) {
    result.lives = result.lives.map((live) => {
      if (!live || typeof live !== 'object') return live;
      const resolved = { ...live };
      for (const field of ['url', 'epg', 'logo'])
        if (field in resolved)
          resolved[field] = resolveResource(resolved[field], originalBase);
      return resolved;
    });
  }
  return result;
}
