/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { isCloudflareEnvironment } from '@/lib/bangumi.server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { toWebStream } from '@/lib/live-http';
import { safeFetch } from '@/lib/safe-http';
import {
  buildTVBoxBridgeSourceValue,
  isTVBoxBridgeLocalSite,
  parseTVBoxBridgeEpisodeCount,
  TVBoxBridgeDepotInfo,
} from '@/lib/tvbox-bridge.shared';
import type { SearchResult } from '@/lib/types';
import { normalizeApiBaseUrl } from '@/lib/url';

/**
 * tvbox-bridge 服务端客户端。
 *
 * 桥接是单实例服务：配置由桥接自己持久化（/api/config 成功后写快照，重启离线恢复），
 * 所以本地**只在管理员点「加载/更新配置」时**才调 /api/config，平时只读 /api/sites。
 * 凭据（网盘 cookie / bili cookie）也只透传给桥接，本地不落库。
 */

export interface TVBoxBridgeSite {
  key: string;
  name: string;
  type: number;
  api: string;
  usesCompanion?: boolean;
  engine?: 'java' | 'python' | 'cms';
  unsupported?: boolean;
  searchable?: number;
  loginSiteKey?: string;
  loaded?: boolean;
}

export interface TVBoxBridgeConfigResult {
  kind: 'config';
  configUrl: string;
  siteCount: number;
  parseCount: number;
  liveCount: number;
  spider: string;
  sites: TVBoxBridgeSite[];
}

export interface TVBoxBridgeDepotResult extends TVBoxBridgeDepotInfo {
  kind: 'depot';
}

export interface TVBoxBridgeEpisode {
  name: string;
  url: string;
}

export interface TVBoxBridgeSource {
  name: string;
  episodes: TVBoxBridgeEpisode[];
}

export interface TVBoxBridgeVodItem {
  id: string;
  name: string;
  pic?: string;
  remarks?: string;
  typeName?: string;
  year?: string;
  area?: string;
  score?: string;
  tag?: string;
  action?: string;
  searchKeyword?: string;
  site?: { key: string; name: string };
}

export interface TVBoxBridgePage {
  page: number;
  pagecount: number;
  total: number;
  limit?: number;
  categories?: Array<{ id: string; name: string }>;
  list: TVBoxBridgeVodItem[];
}

export interface TVBoxBridgeDetailResult {
  item: TVBoxBridgeVodItem & {
    actor?: string;
    director?: string;
    content?: string;
  };
  sources: TVBoxBridgeSource[];
  site: { key: string; name: string };
}

export interface TVBoxBridgePlayResult {
  url: string;
  type: 'hls' | 'mp4' | 'flv' | 'ts' | 'rtmp' | 'rtsp' | 'other';
  headers?: Record<string, string>;
  needsParse?: boolean;
  isLive?: boolean;
  stream?: string;
  streamUrl?: string;
}

export interface TVBoxBridgeStatus {
  version: string;
  auth: boolean;
  configLoaded: boolean;
  configUrl: string | null;
  sites: number;
  loadedSites?: Array<{ key: string; ok: boolean; error?: string; at?: number }>;
  companion?: {
    running: boolean;
    port: number;
    startedAt: number;
    lastError?: string;
  } | null;
}

export interface TVBoxBridgeCredentialStatus {
  ok: boolean;
  configured: boolean;
  updatedAt: string | null;
}

export interface TVBoxBridgeEndpoint {
  baseUrl: string;
  token: string;
}

/**
 * 读取桥接连接信息。配置为空时回退到环境变量，与 CONFIG_SUBSCRIPTION_PROXY 同思路。
 */
export async function getTVBoxBridgeEndpoint(): Promise<TVBoxBridgeEndpoint | null> {
  const config = await getConfig();
  const bridge = config.TVBoxBridgeConfig;
  if (!bridge?.Enabled) return null;

  const baseUrl = normalizeApiBaseUrl(
    bridge.BaseUrl || process.env.TVBOX_BRIDGE_URL || ''
  );
  if (!baseUrl) return null;

  const token = bridge.Token || process.env.TVBOX_BRIDGE_TOKEN || '';
  return { baseUrl, token };
}

function buildHeaders(endpoint: TVBoxBridgeEndpoint): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (endpoint.token) {
    headers['Authorization'] = `Bearer ${endpoint.token}`;
  }
  return headers;
}

/**
 * 桥接请求统一入口。Node 侧走 safeFetch（绕过 undici 的 CF WAF 指纹问题），
 * Workers 侧没有 node:https，只能用原生 fetch。
 */
async function bridgeFetch(
  endpoint: TVBoxBridgeEndpoint,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${endpoint.baseUrl}${path}`;
  const requestInit: RequestInit = {
    ...init,
    headers: {
      ...buildHeaders(endpoint),
      ...((init?.headers as Record<string, string>) || {}),
    },
  };

  if (isCloudflareEnvironment()) {
    return fetch(url, requestInit);
  }
  return safeFetch(url, requestInit);
}

async function bridgeJson<T>(
  endpoint: TVBoxBridgeEndpoint,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await bridgeFetch(endpoint, path, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const isHtml =
      response.headers.get('content-type')?.includes('text/html') ||
      /^\s*(?:<!doctype\s+html|<html)/i.test(text);
    const isCloudflare =
      /cloudflare/i.test(response.headers.get('server') || '') ||
      Boolean(response.headers.get('cf-ray')) ||
      /cloudflare/i.test(text);
    let detail = '';
    if (response.status === 530 && isHtml && isCloudflare) {
      const code = text.match(
        /(?:error\s*(?:code)?|cf-error-code)[^\d]{0,100}(1\d{3})\b/i
      )?.[1];
      const reason =
        code === '1016'
          ? '桥接源站 DNS 解析失败'
          : code === '1033'
          ? '桥接的 Cloudflare Tunnel 未连接'
          : 'Cloudflare 无法访问桥接源站';
      detail = `${reason}${code ? `（错误 ${code}）` : ''}`;
    } else if (isHtml) {
      detail = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    } else {
      try {
        const data = JSON.parse(text);
        detail =
          typeof data?.error === 'string'
            ? data.error
            : typeof data?.message === 'string'
            ? data.message
            : '';
      } catch {
        detail = text.trim();
      }
    }
    detail = detail
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const reasons: Record<number, string> = {
      401: '桥接鉴权失败',
      403: '桥接访问被拒绝',
      404: '桥接接口不存在',
      500: '桥接服务内部错误',
      502: '上游服务响应异常',
      503: '桥接服务暂不可用',
      504: '桥接服务响应超时',
      530: '桥接源站连接失败',
    };
    throw new Error(
      `HTTP ${response.status}：${
        detail.slice(0, 200) || reasons[response.status] || '桥接请求失败'
      }`
    );
  }
  return (await response.json()) as T;
}

/** 健康检查：用于管理面板「查看状态」与静默降级判断 */
export async function getTVBoxBridgeStatus(
  endpoint: TVBoxBridgeEndpoint
): Promise<TVBoxBridgeStatus | null> {
  try {
    return await bridgeJson<TVBoxBridgeStatus>(endpoint, '/api/status');
  } catch (error) {
    console.warn('[TVBoxBridge] 获取状态失败:', error);
    return null;
  }
}

/**
 * 加载 / 切换配置。只在管理面板手动触发，或 status 显示未加载时调用。
 * 桥接成功后自行持久化，本地不重复拉取。
 */
export async function loadTVBoxBridgeConfig(
  endpoint: TVBoxBridgeEndpoint,
  url: string
): Promise<TVBoxBridgeConfigResult | TVBoxBridgeDepotResult> {
  return bridgeJson<TVBoxBridgeConfigResult | TVBoxBridgeDepotResult>(
    endpoint,
    '/api/config',
    { method: 'POST', body: JSON.stringify({ url }) }
  );
}

/** 当前配置的站点列表。读桥接快照，不触发拉取。 */
export async function listTVBoxBridgeSites(
  endpoint: TVBoxBridgeEndpoint
): Promise<TVBoxBridgeSite[]> {
  const data = await bridgeJson<{
    configUrl: string | null;
    sites: TVBoxBridgeSite[];
  }>(endpoint, '/api/sites');
  return Array.isArray(data.sites) ? data.sites : [];
}

/** 只读当前订阅的直播源，不初始化代理或重新加载订阅。 */
export async function listTVBoxBridgeLives(
  endpoint: TVBoxBridgeEndpoint
): Promise<{ configUrl: string; lives: unknown[] }> {
  return bridgeJson(endpoint, '/api/lives', {
    signal: AbortSignal.timeout(15000),
  });
}

export async function fetchTVBoxBridgeLiveResource(
  endpoint: TVBoxBridgeEndpoint,
  path: '/api/live/proxy' | '/api/stream' | '/api/img',
  params: URLSearchParams,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    return await bridgeFetch(endpoint, `${path}?${params}`, {
      ...init,
      redirect: 'manual',
      signal: init?.signal || controller.signal,
    });
  } finally {
    // 240 秒限制用于载荷初始化和响应等待；收到媒体后允许持续直播。
    clearTimeout(timer);
  }
}

/** 预热 Spider 站点（首次约 1 分钟）。仅在管理面板手动触发。 */
export async function loadTVBoxBridgeSite(
  endpoint: TVBoxBridgeEndpoint,
  key: string
): Promise<{ ok: boolean; error?: string; at?: number }> {
  return bridgeJson(endpoint, '/api/site/load', {
    method: 'POST',
    body: JSON.stringify({ key }),
  });
}

export async function getTVBoxBridgeDetail(
  endpoint: TVBoxBridgeEndpoint,
  key: string,
  id: string
): Promise<TVBoxBridgeDetailResult> {
  return bridgeJson<TVBoxBridgeDetailResult>(endpoint, '/api/detail', {
    method: 'POST',
    body: JSON.stringify({ key, id }),
  });
}

export async function getTVBoxBridgeHome(
  endpoint: TVBoxBridgeEndpoint,
  key: string,
  signal?: AbortSignal
): Promise<TVBoxBridgePage> {
  return bridgeJson<TVBoxBridgePage>(endpoint, '/api/home', {
    method: 'POST',
    body: JSON.stringify({ key, filter: true }),
    signal,
  });
}

export async function getTVBoxBridgeCategory(
  endpoint: TVBoxBridgeEndpoint,
  key: string,
  tid: string,
  pg: number,
  signal?: AbortSignal
): Promise<TVBoxBridgePage> {
  return bridgeJson<TVBoxBridgePage>(endpoint, '/api/category', {
    method: 'POST',
    body: JSON.stringify({ key, tid, pg, filter: true }),
    signal,
  });
}

export async function searchTVBoxBridgeSite(
  endpoint: TVBoxBridgeEndpoint,
  key: string,
  wd: string,
  pg: number,
  signal?: AbortSignal
): Promise<TVBoxBridgePage> {
  return bridgeJson<TVBoxBridgePage>(endpoint, '/api/search', {
    method: 'POST',
    body: JSON.stringify({ key, wd, pg, quick: false }),
    signal,
  });
}

/**
 * 解析播放地址。flag 是线路名（/api/detail 的 sources[].name）。
 */
const bridgePlayRequests = new Map<string, Promise<TVBoxBridgePlayResult>>();

export async function getTVBoxBridgePlay(
  endpoint: TVBoxBridgeEndpoint,
  key: string,
  flag: string,
  id: string
): Promise<TVBoxBridgePlayResult> {
  const requestKey = JSON.stringify([endpoint.baseUrl, endpoint.token, key, flag, id]);
  const running = bridgePlayRequests.get(requestKey);
  if (running) return running;
  const request = bridgeJson<TVBoxBridgePlayResult>(endpoint, '/api/play', {
    method: 'POST',
    body: JSON.stringify({ key, flag, id }),
    // 挂起的解析也必须退出并清理共用请求，避免后续播放/重测永远复用未完成任务。
    signal: AbortSignal.timeout(15000),
  }).finally(() => {
    bridgePlayRequests.delete(requestKey);
  });
  bridgePlayRequests.set(requestKey, request);
  return request;
}

/** 网盘凭据状态（不返回凭据本身） */
export async function getTVBoxBridgeNetdiskCredentials(
  endpoint: TVBoxBridgeEndpoint,
  key: string
): Promise<Record<string, TVBoxBridgeCredentialStatus>> {
  const data = await bridgeJson<{
    key: string;
    providers: Record<string, TVBoxBridgeCredentialStatus>;
  }>(
    endpoint,
    `/api/credentials/netdisk?key=${encodeURIComponent(key)}`
  );
  return data.providers || {};
}

/** 注入并持久化网盘凭据（同 jar 共用） */
export async function setTVBoxBridgeNetdiskCredential(
  endpoint: TVBoxBridgeEndpoint,
  input: { key: string; provider: 'quark' | 'uc' | 'ali'; cookie?: string; token?: string }
): Promise<{ applied?: boolean; adapter?: string }> {
  return bridgeJson(endpoint, '/api/credentials/netdisk', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getTVBoxBridgeBiliCredential(
  endpoint: TVBoxBridgeEndpoint
): Promise<TVBoxBridgeCredentialStatus> {
  return bridgeJson<TVBoxBridgeCredentialStatus>(
    endpoint,
    '/api/credentials/bili'
  );
}

export async function setTVBoxBridgeBiliCredential(
  endpoint: TVBoxBridgeEndpoint,
  cookie: string
): Promise<TVBoxBridgeCredentialStatus> {
  return bridgeJson<TVBoxBridgeCredentialStatus>(
    endpoint,
    '/api/credentials/bili',
    { method: 'POST', body: JSON.stringify({ cookie }) }
  );
}

/**
 * 构造桥接媒体代理地址（/api/stream）。
 * 桥接会改写 m3u8 内所有 URI（子清单 / 分片 / AES key）并沿用同一 token，
 * 因此带自定义请求头的源直接交给它，本地代理不需要透传 headers。
 */
export function buildTVBoxBridgeStreamUrl(
  endpoint: TVBoxBridgeEndpoint,
  mediaUrl: string,
  headers?: Record<string, string>
): string {
  const params = new URLSearchParams();
  params.set('u', encodeBase64Url(mediaUrl));
  if (headers && Object.keys(headers).length > 0) {
    params.set('h', encodeBase64Url(JSON.stringify(headers)));
  }
  if (endpoint.token) {
    params.set('token', endpoint.token);
  }
  return `${endpoint.baseUrl}/api/stream?${params.toString()}`;
}

/** 构造桥接图片代理地址（/api/img），支持 @Referer=...@User-Agent=... 附加头 */
export function buildTVBoxBridgeImageUrl(
  endpoint: TVBoxBridgeEndpoint,
  imageUrl: string,
  referer?: string
): string {
  const params = new URLSearchParams();
  params.set('u', encodeBase64Url(imageUrl));
  if (referer) params.set('r', referer);
  if (endpoint.token) params.set('token', endpoint.token);
  return `${endpoint.baseUrl}/api/img?${params.toString()}`;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 本地面向浏览器的图片代理地址。
 * 桥接 /api/img 需要带 token，不能暴露给前端，所以由本地转一层。
 */
export function buildLocalTVBoxBridgeImageUrl(
  imageUrl: string,
  referer?: string
): string {
  if (!imageUrl) return '';
  const params = new URLSearchParams();
  params.set('u', encodeBase64Url(imageUrl));
  if (referer) params.set('r', referer);
  return `/api/tvbox-bridge/image?${params.toString()}`;
}

/**
 * 通过桥接 /api/img 拉取图片（桥接会带上站点需要的 Referer/UA）。
 * 本地 /api/tvbox-bridge/image 只做转发，避免把 token 暴露给浏览器。
 */
export async function fetchTVBoxBridgeImage(
  endpoint: TVBoxBridgeEndpoint,
  imageUrl: string,
  referer?: string
): Promise<Response> {
  const params = new URLSearchParams();
  params.set('u', encodeBase64Url(imageUrl));
  if (referer) params.set('r', referer);
  if (endpoint.token) params.set('token', endpoint.token);

  const url = `${endpoint.baseUrl}/api/img?${params.toString()}`;
  const init: RequestInit = { signal: AbortSignal.timeout(15000) };
  return isCloudflareEnvironment() ? fetch(url, init) : safeFetch(url, init);
}

export function decodeTVBoxBridgeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding =
      normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
    return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 聚合搜索（SSE 转发）。
 *
 * 桥接侧自己调度全部 searchable 来源、共享 30 秒整轮期限、复用下载与初始化，
 * 所以本地不再逐站并发，也不需要 SearchConcurrency。这里把桥接的
 * start/source/done 事件转成本地 /api/search/ws 的既有事件形状。
 */
export async function* streamTVBoxBridgeSearch(
  endpoint: TVBoxBridgeEndpoint,
  keyword: string,
  signal?: AbortSignal
): AsyncGenerator<
  | { type: 'start'; total: number }
  | { type: 'source'; site: { key: string; name: string }; list: TVBoxBridgeVodItem[]; error?: string; timedOut?: boolean }
  | { type: 'done'; count: number; failed: number; timedOut: number }
> {
  const response = await bridgeFetch(endpoint, '/api/search/aggregate', {
    method: 'POST',
    body: JSON.stringify({ wd: keyword }),
    signal,
  });

  const body = toWebStream((response as any).body);
  if (!response.ok || !body) {
    throw new Error(`tvbox-bridge 聚合搜索失败: ${response.status}`);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      // SSE 事件以空行分隔；注释行（心跳）直接丢弃
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());
        if (dataLines.length === 0) continue;

        let payload: any;
        try {
          payload = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }

        const eventName = payload.event;
        if (eventName === 'start') {
          yield { type: 'start', total: Number(payload.total) || 0 };
        } else if (eventName === 'source') {
          yield {
            type: 'source',
            site: payload.site || { key: '', name: '' },
            list: Array.isArray(payload.list) ? payload.list : [],
            error: payload.error,
            timedOut: payload.timedOut === true,
          };
        } else if (eventName === 'done') {
          yield {
            type: 'done',
            count: Number(payload.count) || 0,
            failed: Number(payload.failed) || 0,
            timedOut: Number(payload.timedOut) || 0,
          };
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 流关闭后释放锁失败可以忽略。
    }
  }
}

/** 已解析出的本地可用站点（一个 site = 一个独立源条目） */
export interface TVBoxBridgeResolvedSite {
  /** 本地源 key：tvbox:<siteKey> */
  key: string;
  /** 桥接站点 key，调用 /api/detail、/api/play 用 */
  siteKey: string;
  name: string;
  weight: number;
  /** 站点接口地址，用于推导海报 Referer */
  api?: string;
}

/** 站点是否可参与搜索：桥接标记可搜索且非不支持类型 */
function isSearchableSite(site: TVBoxBridgeSite) {
  if (!site || !site.key) return false;
  if (site.unsupported) return false;
  // searchable 缺省视为可搜索（老版本桥接不带该字段）
  return site.searchable === undefined ? true : Number(site.searchable) !== 0;
}

/**
 * 列出当前用户可用的桥接站点。
 *
 * 权限判定与 getAvailableApiSites 完全一致：用户自己的 enabledApis 非空时
 * 绝对优先（此时不看 tags），否则按 tags 并集，都没有则全部放开。
 * 站点级开关（TVBoxBridgeConfig.Sites[].enabled）与本地文件屏蔽名单在这里生效。
 * 普通入口排除特殊源，/under 入口仅保留特殊源。
 *
 * 桥接不可达时返回空数组（静默降级，不阻塞搜索）。
 */
export async function resolveTVBoxBridgeSites(
  user?: string,
  specialOnly = false
): Promise<TVBoxBridgeResolvedSite[]> {
  const endpoint = await getTVBoxBridgeEndpoint();
  if (!endpoint) return [];

  const config = await getConfig();
  const bridge = config.TVBoxBridgeConfig;
  if (!bridge) return [];

  let sites: TVBoxBridgeSite[];
  try {
    sites = await listTVBoxBridgeSites(endpoint);
  } catch (error) {
    console.warn('[TVBoxBridge] 获取站点列表失败，静默降级:', error);
    return [];
  }

  const siteSettings = new Map(
    (bridge.Sites || []).map((item) => [item.key, item])
  );
  const blockedLocal = new Set(bridge.BlockedLocalSites || []);
  const specialSources = new Set(config.SpecialSourceApis || []);

  const enabledSites = sites.filter((site) => {
    if (
      specialSources.has(buildTVBoxBridgeSourceValue(site.key)) !== specialOnly
    ) {
      return false;
    }
    if (!isSearchableSite(site)) return false;
    // 本地文件类来源（file:// 等）桥接读不到，始终屏蔽
    if (isTVBoxBridgeLocalSite({ api: site.api })) return false;
    if (blockedLocal.has(site.key)) return false;
    const setting = siteSettings.get(site.key);
    // 未配置过的站点默认启用，避免每次换配置都要重新勾一遍
    return setting ? setting.enabled !== false : true;
  });

  let allowedKeys: Set<string> | null = null;
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (user && storageType !== 'localstorage') {
    try {
      const userInfoV2 = await db.getUserInfoV2(user);
      if (userInfoV2?.enabledApis && userInfoV2.enabledApis.length > 0) {
        allowedKeys = new Set(userInfoV2.enabledApis);
      } else if (
        userInfoV2?.tags &&
        userInfoV2.tags.length > 0 &&
        config.UserConfig.Tags
      ) {
        const fromTags = new Set<string>();
        userInfoV2.tags.forEach((tagName) => {
          const tagConfig = config.UserConfig.Tags?.find(
            (t) => t.name === tagName
          );
          tagConfig?.enabledApis?.forEach((key) => fromTags.add(key));
        });
        if (fromTags.size > 0) allowedKeys = fromTags;
      }
    } catch (error) {
      console.warn('[TVBoxBridge] 读取用户源权限失败:', error);
    }
  }

  return enabledSites
    .map((site) => {
      const setting = siteSettings.get(site.key);
      return {
        key: buildTVBoxBridgeSourceValue(site.key),
        siteKey: site.key,
        name: site.name || site.key,
        weight: setting?.weight ?? 0,
        api: site.api,
      };
    })
    .filter((site) => !allowedKeys || allowedKeys.has(site.key));
}

/**
 * 跑一轮桥接聚合搜索，并把结果按本地源（tvbox:<siteKey>）回吐。
 *
 * 桥接一次请求就跑完全部 searchable 站点，所以这里不能像普通源那样逐站并发；
 * 只把桥接回包里属于「本用户可用」的站点转成本地 SearchResult。
 * 结束时保证每个传入站点都恰好回调一次（没回包 / 桥接挂掉都算空结果），
 * 上层的 totalSourceCount 才不会永远卡住。
 */
export async function runTVBoxBridgeSearch(input: {
  sites: TVBoxBridgeResolvedSite[];
  keyword: string;
  signal?: AbortSignal;
  onSource?: (payload: {
    site: TVBoxBridgeResolvedSite;
    results: SearchResult[];
    error?: string;
  }) => void;
}): Promise<void> {
  const { sites, keyword, signal, onSource } = input;
  if (sites.length === 0) return;

  const reported = new Set<string>();
  const report = (
    site: TVBoxBridgeResolvedSite,
    results: SearchResult[],
    error?: string
  ) => {
    if (reported.has(site.siteKey)) return;
    reported.add(site.siteKey);
    onSource?.({ site, results, error });
  };

  const endpoint = await getTVBoxBridgeEndpoint();
  if (!endpoint) {
    sites.forEach((site) => report(site, []));
    return;
  }

  const bySiteKey = new Map(sites.map((site) => [site.siteKey, site]));

  try {
    for await (const event of streamTVBoxBridgeSearch(
      endpoint,
      keyword,
      signal
    )) {
      if (event.type !== 'source') continue;
      const site = bySiteKey.get(event.site?.key);
      // 桥接里存在但本用户不可用 / 已被屏蔽的站点，直接丢弃
      if (!site) continue;

      if (event.error) {
        report(site, [], event.error);
        continue;
      }
      report(
        site,
        normalizeTVBoxBridgeSearchResults({ site, list: event.list })
      );
    }
  } catch (error) {
    console.warn('[TVBoxBridge] 聚合搜索失败，静默降级:', error);
  } finally {
    // 没回包的站点（超时 / 连接中断）补空结果，避免搜索流永远不 complete
    sites.forEach((site) => report(site, []));
  }
}

/** 从站点接口地址推导海报 Referer（TVBox 采集站图片普遍校验 Referer） */
export function resolveTVBoxBridgeImageReferer(api?: string): string | undefined {
  if (!api) return undefined;
  try {
    const url = new URL(api);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.protocol}//${url.host}/`;
  } catch {
    return undefined;
  }
}

/**
 * 把桥接聚合搜索的 VodItem 转成本地 SearchResult。
 *
 * episodes 一律留空：tvbox 源走详情懒加载（线路只有 /api/detail 才知道）。
 */
export function normalizeTVBoxBridgeSearchResults(input: {
  site: TVBoxBridgeResolvedSite;
  list: TVBoxBridgeVodItem[];
  weight?: number;
}): SearchResult[] {
  const referer = resolveTVBoxBridgeImageReferer(input.site.api);
  return (input.list || [])
    .filter((item) => item && item.id)
    // folder 是分类目录卡片、action 是 Spider 自定义操作，都不是可播放影片
    .filter((item) => item.tag !== 'folder' && !item.action)
    .map((item) => ({
      id: String(item.id),
      title: String(item.name || ''),
      poster: item.pic
        ? buildLocalTVBoxBridgeImageUrl(item.pic, referer)
        : '',
      episodes: [] as string[],
      episodes_titles: [] as string[],
      source: input.site.key,
      source_name: input.site.name,
      weight: input.weight ?? input.site.weight,
      year: item.year || '',
      desc: '',
      type_name: item.typeName || '',
      douban_id: 0,
      vod_remarks: item.remarks,
      // 详情才能拿到真实集数，这里先用备注里的「全80集 / 更新至25集」顶着，
      // 否则聚合卡上永远显示 0 集。
      vod_total: parseTVBoxBridgeEpisodeCount(item.remarks),
    }));
}

/** 构造线路内某一集的懒解析播放地址 */
export function buildTVBoxBridgePlayUrl(input: {
  siteKey: string;
  flag: string;
  episodeId: string;
  episodeName?: string;
  specialOnly?: boolean;
}) {
  const params = new URLSearchParams({
    key: input.siteKey,
    flag: input.flag,
    id: encodeBase64Url(input.episodeId),
  });
  if (input.episodeName) params.set('name', input.episodeName);
  if (input.specialOnly) params.set('special', '1');
  return `/api/tvbox-bridge/play?${params.toString()}`;
}

/**
 * 把桥接 /api/detail 转成本地详情。
 *
 * 一个 site 就是一张卡：桥接的 sources[] 就是线路，全部放进 lines[]，
 * 默认线路（第一条）展开成 episodes/episodes_titles 供播放页直接使用。
 */
export function normalizeTVBoxBridgeDetailResult(input: {
  source: string;
  site: TVBoxBridgeResolvedSite;
  detailId: string;
  result: TVBoxBridgeDetailResult;
  specialOnly?: boolean;
}): SearchResult {
  const referer = resolveTVBoxBridgeImageReferer(input.site.api);
  const item = input.result.item || ({} as TVBoxBridgeDetailResult['item']);
  const rawSources = Array.isArray(input.result.sources)
    ? input.result.sources.filter((source) => source && source.name)
    : [];

  const lines = rawSources.map((source) => {
    const episodes = Array.isArray(source.episodes) ? source.episodes : [];
    const names: string[] = [];
    const urls: string[] = [];
    episodes.forEach((episode, index) => {
      const episodeId = String(episode?.url || '');
      if (!episodeId) return;
      const episodeName = String(episode?.name || `第${index + 1}集`);
      names.push(episodeName);
      urls.push(
        buildTVBoxBridgePlayUrl({
          siteKey: input.site.siteKey,
          flag: source.name,
          episodeId,
          episodeName,
          specialOnly: input.specialOnly,
        })
      );
    });
    return { name: String(source.name), episodes: urls, episodes_titles: names };
  });

  const activeLine = lines.length > 0 ? lines[0].name : undefined;
  const active = lines[0];

  const score = Number.parseFloat(String(item.score ?? ''));

  return {
    id: input.detailId,
    title: String(item.name || ''),
    poster: item.pic ? buildLocalTVBoxBridgeImageUrl(item.pic, referer) : '',
    episodes: active ? active.episodes : [],
    episodes_titles: active ? active.episodes_titles : [],
    source: input.source,
    source_name: input.site.name,
    weight: input.site.weight,
    class: item.typeName,
    year: item.year || '',
    desc: item.content || '',
    type_name: item.typeName || '',
    douban_id: 0,
    vod_remarks: item.remarks,
    vod_total: active ? active.episodes.length : 0,
    rating: Number.isFinite(score) && score > 0 ? score : undefined,
    lines,
    activeLine,
    proxyMode: false,
  };
}
