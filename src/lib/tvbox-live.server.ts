/* eslint-disable no-console */

import { createHash } from 'node:crypto';

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { fetchLive } from '@/lib/live-http';
import {
  fetchTVBoxBridgeLiveResource,
  getTVBoxBridgeEndpoint,
  listTVBoxBridgeLives,
} from '@/lib/tvbox-bridge.server';
import {
  getTVBoxLiveApiPath,
  isTVBoxLiveProxyUrl,
  isTVBoxLocalLiveProxy,
  TVBOX_LIVE_RELAY_PATH,
  TVBOX_LIVE_SOURCE_PREFIX,
} from '@/lib/tvbox-live.shared';

export type LiveSource = NonNullable<AdminConfig['LiveConfig']>[number];

let lastSync = { endpoint: '', time: 0 };
let generation = 0;
let syncing: Promise<number> | null = null;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

/** 发现直播源时只读 /api/lives；频道清单在选源或刷新时才获取。 */
export async function syncTVBoxLiveSources(force = false): Promise<number> {
  if (syncing) {
    await syncing;
    return force ? syncTVBoxLiveSources(true) : countTVBoxLives();
  }
  const run = async () => {
    const endpoint = await getTVBoxBridgeEndpoint();
    if (!endpoint) return 0;
    const endpointKey = hash(JSON.stringify(endpoint));
    if (
      !force &&
      lastSync.endpoint === endpointKey &&
      Date.now() - lastSync.time < 30000
    ) {
      return countTVBoxLives();
    }
    const data = await listTVBoxBridgeLives(endpoint);
    if (!data.configUrl || !Array.isArray(data.lives)) {
      throw new Error('TVBox 直播源列表格式无效，请先加载具体订阅');
    }
    if (force) generation++;
    const config = await getConfig();
    const previous = new Map(
      (config.LiveConfig || []).map((source) => [source.key, source])
    );
    const occurrences = new Map<string, number>();
    const sources: LiveSource[] = [];
    data.lives.forEach((value, index) => {
      if (!value || typeof value !== 'object') return;
      const entry = value as Record<string, unknown>;
      const name =
        typeof entry.name === 'string' && entry.name
          ? entry.name
          : `TVBox 直播 ${index + 1}`;
      const occurrence = occurrences.get(name) || 0;
      occurrences.set(name, occurrence + 1);
      const key = `${TVBOX_LIVE_SOURCE_PREFIX}${hash(
        `${data.configUrl}\n${name}\n${occurrence}`
      )}`;
      const inlineChannels = Array.isArray(entry.channels)
        ? entry.channels
        : entry.channel;
      const channels = Array.isArray(inlineChannels)
        ? inlineChannels
        : undefined;
      let url = typeof entry.url === 'string' ? entry.url.trim() : '';
      if (url && !isTVBoxLocalLiveProxy(url)) {
        try {
          url = new URL(url, data.configUrl).href;
        } catch {
          return;
        }
      }
      if (!url && !channels) return;
      const old = previous.get(key);
      const revision = hash(JSON.stringify([endpointKey, entry, generation]));
      let epg = '';
      if (typeof entry.epg === 'string' && entry.epg.trim()) {
        try {
          epg = new URL(entry.epg, data.configUrl).href;
        } catch {
          /* 忽略无效节目单地址 */
        }
      }
      sources.push({
        key,
        name,
        url,
        ua: typeof entry.ua === 'string' ? entry.ua : '',
        epg,
        from: 'config',
        disabled: old?.disabled ?? false,
        proxyMode: old?.proxyMode || 'full',
        channelNumber:
          old?.tvbox?.revision === revision ? old.channelNumber : 0,
        tvbox: { configUrl: data.configUrl, index, revision, channels },
      });
    });
    const remaining = new Map(sources.map((source) => [source.key, source]));
    const merged: LiveSource[] = [];
    // 保留管理员保存的排序、开关和普通直播源，清除旧订阅中已移除的 TVBox 源。
    for (const old of config.LiveConfig || []) {
      if (!old.tvbox) merged.push(old);
      else {
        const current = remaining.get(old.key);
        if (current) {
          merged.push(current);
          remaining.delete(old.key);
        }
      }
    }
    merged.push(...Array.from(remaining.values()));
    if (JSON.stringify(merged) !== JSON.stringify(config.LiveConfig || [])) {
      config.LiveConfig = merged;
      await db.saveAdminConfig(config);
    }
    lastSync = { endpoint: endpointKey, time: Date.now() };
    return sources.length;
  };
  const task = run();
  syncing = task;
  try {
    return await task;
  } finally {
    if (syncing === task) syncing = null;
  }
}

async function countTVBoxLives(): Promise<number> {
  return ((await getConfig()).LiveConfig || []).filter((source) => source.tvbox)
    .length;
}

export async function clearTVBoxLiveSources(): Promise<void> {
  generation++;
  lastSync = { endpoint: '', time: 0 };
  const config = await getConfig();
  config.LiveConfig = (config.LiveConfig || []).filter(
    (source) => !source.tvbox
  );
  await db.saveAdminConfig(config);
}

export async function getLiveSource(
  key: string | null
): Promise<LiveSource | null> {
  const config = await getConfig();
  const source = config.LiveConfig?.find((source) => source.key === key);
  if (!source || source.disabled) return null;
  if (source.tvbox && !(await getTVBoxBridgeEndpoint())) return null;
  return source;
}

/** 普通列表直接请求；本机代理及上游改写的资源才使用桥接鉴权。 */
export async function fetchLiveSource(
  source: LiveSource,
  url: string,
  init?: RequestInit
): Promise<Response> {
  let target = url;
  if (target.startsWith(`${TVBOX_LIVE_RELAY_PATH}?`)) {
    const params = new URL(target, 'http://localhost').searchParams;
    const resource = params.get('url');
    if (params.get('source') !== source.key || !resource) {
      throw new Error('无效的 TVBox 直播资源');
    }
    target = resource;
  }
  const ua = source.ua || 'AptvPlayer/1.4.10';
  if (!source.tvbox || !isTVBoxLiveProxyUrl(target)) {
    return fetchLive(target, ua, init);
  }
  const endpoint = await getTVBoxBridgeEndpoint();
  if (!endpoint) throw new Error('TVBox 桥接未启用');
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', ua);
  // Node 请求可能收到 node-fetch Response，统一使用普通对象传递 Headers。
  const requestHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });
  let parsed = new URL(target, 'http://localhost');
  for (let redirects = 0; redirects < 5; redirects++) {
    const params = isTVBoxLocalLiveProxy(target)
      ? new URLSearchParams({ index: String(source.tvbox.index), url: target })
      : new URLSearchParams(parsed.search);
    params.delete('token');
    params.delete('t');
    const response = await fetchTVBoxBridgeLiveResource(
      endpoint,
      getTVBoxLiveApiPath(target) || '/api/live/proxy',
      params,
      {
        ...init,
        headers: requestHeaders,
      }
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.text();
    if (!location) return response;
    target = new URL(location, `${endpoint.baseUrl}/api/live/proxy`).href;
    if (!isTVBoxLiveProxyUrl(target)) return fetchLive(target, ua, init);
    parsed = new URL(target);
  }
  throw new Error('TVBox 直播代理重定向过多');
}
