/* eslint-disable @typescript-eslint/no-explicit-any */

import * as cheerio from 'cheerio/slim';
import { nanoid } from 'nanoid';

import { db } from '@/lib/db';

const SOURCE_SCRIPT_REGISTRY_KEY = 'source-script:registry';
const DEFAULT_TIMEOUT_MS = 20000;

// 绕过 webpack 静态分析，获取真正的 Node.js require
// eslint-disable-next-line no-eval
const _nodeRequire = eval('require') as NodeRequire;

// ---- 内存缓存 ----
let _registryCache: { data: SourceScriptRegistry; ts: number } | null = null;
const REGISTRY_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const _compiledCache = new Map<string, any>();
const MAX_COMPILED_CACHE_SIZE = 50;
const _runtimeCache = new Map<string, { value: string; expiresAt: number }>();

export interface SourceScriptRecord {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  version: string;
  code: string;
  createdAt: number;
  updatedAt: number;
}

export interface SourceScriptImportItem {
  key: string;
  name: string;
  description?: string;
  code: string;
  enabled?: boolean;
}

export interface SourceScriptRegistry {
  items: SourceScriptRecord[];
}

export interface SourceScriptTestResult {
  ok: boolean;
  durationMs: number;
  logs: string[];
  meta?: Record<string, any>;
  result?: any;
  error?: string;
}

export type SourceScriptHook =
  | 'getSources'
  | 'search'
  | 'recommend'
  | 'detail'
  | 'resolvePlayUrl';

export interface PublicSourceScriptSummary {
  id: string;
  key: string;
  name: string;
  description?: string;
  version: string;
  updatedAt: number;
}

export interface ScriptSourceDescriptor {
  id: string;
  name: string;
}

const SCRIPT_SOURCE_PREFIX = 'script:';

const DEFAULT_SCRIPT_TEMPLATE = `return {
  meta: {
    name: '示例脚本',
    author: 'admin'
  },

  async getSources(ctx) {
    return [
      { id: 'main', name: '主站' },
      { id: 'backup', name: '备用站' }
    ];
  },

  async search(ctx, { keyword, page, sourceId }) {
    ctx.log.info('search', keyword, page, sourceId);
    return {
      sourceId,
      list: [],
      page,
      pageCount: 1,
      total: 0
    };
  },

  async recommend(ctx, { page }) {
    ctx.log.info('recommend', page);
    return {
      list: [],
      page: page || 1,
      pageCount: 1,
      total: 0
    };
  },

  async detail(ctx, { id, sourceId }) {
    ctx.log.info('detail', id, sourceId);
    return {
      id,
      sourceId,
      title: '',
      poster: '',
      year: '',
      desc: '',
      playbacks: [
        {
          sourceId: sourceId || 'main',
          sourceName: '主站',
          episodes: [],
          episodes_titles: []
        }
      ]
    };
  },

  async resolvePlayUrl(ctx, { playUrl, sourceId, episodeIndex }) {
    ctx.log.info('resolvePlayUrl', sourceId, episodeIndex, playUrl);
    return {
      url: playUrl,
      type: 'auto',
      headers: {}
    };
  }
};`;

function getNowVersion() {
  return new Date().toISOString();
}

function buildEmptyRegistry(): SourceScriptRegistry {
  return { items: [] };
}

async function loadRegistry(): Promise<SourceScriptRegistry> {
  if (_registryCache && Date.now() - _registryCache.ts < REGISTRY_CACHE_TTL_MS) {
    return _registryCache.data;
  }

  const raw = await db.getGlobalValue(SOURCE_SCRIPT_REGISTRY_KEY);
  if (!raw) {
    const empty = buildEmptyRegistry();
    _registryCache = { data: empty, ts: Date.now() };
    return empty;
  }

  try {
    const parsed = JSON.parse(raw) as SourceScriptRegistry;
    if (!parsed || !Array.isArray(parsed.items)) {
      const empty = buildEmptyRegistry();
      _registryCache = { data: empty, ts: Date.now() };
      return empty;
    }
    _registryCache = { data: parsed, ts: Date.now() };
    return parsed;
  } catch {
    const empty = buildEmptyRegistry();
    _registryCache = { data: empty, ts: Date.now() };
    return empty;
  }
}

async function saveRegistry(registry: SourceScriptRegistry) {
  _registryCache = null;
  _compiledCache.clear();
  _runtimeCache.clear();
  await db.setGlobalValue(
    SOURCE_SCRIPT_REGISTRY_KEY,
    JSON.stringify(registry)
  );
}

function assertScriptKey(key: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error('脚本 Key 仅支持字母、数字、下划线和中划线');
  }
}

function createLogCollector() {
  const logs: string[] = [];

  const push = (level: string, args: any[]) => {
    const rendered = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    logs.push(`[${level}] ${rendered}`);
    if (logs.length > 50) {
      logs.shift();
    }
  };

  return {
    logs,
    log: {
      info: (...args: any[]) => push('info', args),
      warn: (...args: any[]) => push('warn', args),
      error: (...args: any[]) => push('error', args),
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`执行超时(${timeoutMs}ms)`)), timeoutMs);
    }),
  ]);
}

function createCacheHelpers(scriptId: string) {
  const prefix = `source-script-cache:${scriptId}:`;

  return {
    async get(key: string) {
      const entry = _runtimeCache.get(`${prefix}${key}`);
      if (!entry) {
        return null;
      }

      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        _runtimeCache.delete(`${prefix}${key}`);
        return null;
      }

      return entry.value ?? null;
    },
    async set(key: string, value: string, ttlSec = 300) {
      _runtimeCache.set(`${prefix}${key}`, {
        value,
        expiresAt: Date.now() + ttlSec * 1000,
      });
    },
    async del(key: string) {
      _runtimeCache.delete(`${prefix}${key}`);
    },
  };
}

function createUtils() {
  return {
    buildUrl(base: string, query?: Record<string, string | number | boolean>) {
      const url = new URL(base);
      Object.entries(query || {}).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });
      return url.toString();
    },
    joinUrl(base: string, path: string) {
      return new URL(path, base).toString();
    },
    randomUA() {
      return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
    },
    sleep(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    base64Encode(value: string) {
      return Buffer.from(value, 'utf8').toString('base64');
    },
    base64Decode(value: string) {
      return Buffer.from(value, 'base64').toString('utf8');
    },
    now() {
      return Date.now();
    },
  };
}

function createScriptFactory(code: string) {
  return new Function(
    'require',
    `"use strict";\n${code}`
  ) as (req: NodeRequire) => any;
}

async function createScriptContext(script: SourceScriptRecord, configValues?: Record<string, string>) {
  const { logs, log } = createLogCollector();
  const cache = createCacheHelpers(script.id);

  const fetcher = async (input: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, string | number | boolean>;
    body?: string;
    json?: unknown;
    timeoutMs?: number;
  }) => {
    const url = new URL(input.url);
    Object.entries(input.query || {}).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`不支持的协议: ${url.protocol}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      input.timeoutMs || DEFAULT_TIMEOUT_MS
    );

    try {
      const response = await fetch(url.toString(), {
        method: input.method || 'GET',
        headers: {
          ...(input.json ? { 'Content-Type': 'application/json' } : {}),
          ...(input.headers || {}),
        },
        body: input.json !== undefined ? JSON.stringify(input.json) : input.body,
        signal: controller.signal,
      });

      return {
        status: response.status,
        ok: response.ok,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        text: () => response.text(),
        json: <T = any>() => response.json() as Promise<T>,
        arrayBuffer: () => response.arrayBuffer(),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return {
    ctx: Object.freeze({
      fetch: fetcher,
      request: {
        get: (url: string, options?: Omit<Parameters<typeof fetcher>[0], 'url' | 'method'>) =>
          fetcher({ url, method: 'GET', ...(options || {}) }),
        post: (url: string, options?: Omit<Parameters<typeof fetcher>[0], 'url' | 'method'>) =>
          fetcher({ url, method: 'POST', ...(options || {}) }),
        async getHtml(url: string, options?: Omit<Parameters<typeof fetcher>[0], 'url' | 'method'>) {
          const response = await fetcher({ url, method: 'GET', ...(options || {}) });
          const text = await response.text();
          return cheerio.load(text);
        },
        async getJson<T = any>(url: string, options?: Omit<Parameters<typeof fetcher>[0], 'url' | 'method'>) {
          const response = await fetcher({ url, method: 'GET', ...(options || {}) });
          return response.json<T>();
        },
      },
      html: {
        load: (html: string) => cheerio.load(html),
      },
      json: {
        parse<T = any>(text: string, fallback?: T) {
          try {
            return JSON.parse(text) as T;
          } catch {
            return fallback as T;
          }
        },
        stringify(value: unknown) {
          return JSON.stringify(value);
        },
      },
      utils: createUtils(),
      cache,
      log,
      config: {
        get: (key: string) => configValues?.[key],
        require: (key: string) => {
          const value = configValues?.[key];
          if (!value) {
            throw new Error(`缺少脚本配置: ${key}`);
          }
          return value;
        },
        all: () => ({ ...(configValues || {}) }),
      },
      runtime: {
        scriptId: script.id,
        sourceKey: script.key,
        sourceName: script.name,
        version: script.version,
      },
    }),
    logs,
  };
}

function normalizeScript(script: any) {
  if (!script || typeof script !== 'object') {
    throw new Error('脚本必须返回对象');
  }
  return script;
}

async function getEnabledSourceScriptByKey(key: string) {
  const registry = await loadRegistry();
  const item = registry.items.find((record) => record.key === key);
  if (!item) {
    throw new Error('脚本不存在');
  }
  if (!item.enabled) {
    throw new Error('脚本已停用');
  }
  return item;
}

function getOrCompileScript(script: SourceScriptRecord) {
  const cacheKey = `${script.id}:${script.version}`;
  const cached = _compiledCache.get(cacheKey);
  if (cached) return cached;

  const factory = createScriptFactory(script.code);
  const compiled = normalizeScript(factory(_nodeRequire));

  if (_compiledCache.size >= MAX_COMPILED_CACHE_SIZE) {
    const firstKey = _compiledCache.keys().next().value;
    if (firstKey) _compiledCache.delete(firstKey);
  }
  _compiledCache.set(cacheKey, compiled);
  return compiled;
}

async function compileSourceScript(
  script: SourceScriptRecord,
  configValues?: Record<string, string>
) {
  const compiled = getOrCompileScript(script);
  const context = await createScriptContext(script, configValues);
  return {
    compiled,
    ...context,
  };
}

export async function executeSavedSourceScript(input: {
  key: string;
  hook: SourceScriptHook;
  payload?: Record<string, any>;
  configValues?: Record<string, string>;
}): Promise<SourceScriptTestResult> {
  const startedAt = Date.now();
  const script = await getEnabledSourceScriptByKey(input.key);
  const { compiled, ctx, logs } = await compileSourceScript(
    script,
    input.configValues
  );

  const hook = compiled[input.hook];
  if (typeof hook !== 'function') {
    throw new Error(`脚本未实现 ${input.hook} hook`);
  }

  const result = await withTimeout(
    Promise.resolve(hook(ctx, input.payload || {})),
    DEFAULT_TIMEOUT_MS
  );

  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    logs,
    meta: compiled.meta,
    result,
  };
}

export async function listEnabledSourceScripts(): Promise<PublicSourceScriptSummary[]> {
  const registry = await loadRegistry();
  return registry.items
    .filter((item) => item.enabled)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      version: item.version,
      updatedAt: item.updatedAt,
    }));
}

export async function listSourceScripts() {
  const registry = await loadRegistry();
  return registry.items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSourceScript(id: string) {
  const registry = await loadRegistry();
  return registry.items.find((item) => item.id === id) || null;
}

export async function saveSourceScript(input: {
  id?: string;
  key: string;
  name: string;
  description?: string;
  code: string;
  enabled?: boolean;
}) {
  assertScriptKey(input.key);

  const registry = await loadRegistry();
  const now = Date.now();
  const existing = input.id
    ? registry.items.find((item) => item.id === input.id)
    : undefined;

  if (!existing && registry.items.some((item) => item.key === input.key)) {
    throw new Error('脚本 Key 已存在');
  }

  if (existing) {
    existing.key = input.key;
    existing.name = input.name;
    existing.description = input.description || '';
    existing.code = input.code;
    existing.enabled = input.enabled ?? existing.enabled;
    existing.updatedAt = now;
    existing.version = getNowVersion();
    await saveRegistry(registry);
    return existing;
  }

  const created: SourceScriptRecord = {
    id: nanoid(),
    key: input.key,
    name: input.name,
    description: input.description || '',
    code: input.code,
    enabled: input.enabled ?? true,
    version: getNowVersion(),
    createdAt: now,
    updatedAt: now,
  };

  registry.items.unshift(created);
  await saveRegistry(registry);
  return created;
}

export async function importSourceScripts(items: SourceScriptImportItem[]) {
  const registry = await loadRegistry();
  const now = Date.now();
  const imported: SourceScriptRecord[] = [];

  for (const item of items) {
    if (!item?.key || !item?.name || !item?.code) {
      throw new Error('导入脚本缺少必要字段: key/name/code');
    }

    assertScriptKey(item.key);

    const existing = registry.items.find((record) => record.key === item.key);

    if (existing) {
      existing.name = item.name;
      existing.description = item.description || '';
      existing.code = item.code;
      existing.enabled = item.enabled ?? existing.enabled;
      existing.updatedAt = now;
      existing.version = getNowVersion();
      imported.push(existing);
      continue;
    }

    const created: SourceScriptRecord = {
      id: nanoid(),
      key: item.key,
      name: item.name,
      description: item.description || '',
      code: item.code,
      enabled: item.enabled ?? true,
      version: getNowVersion(),
      createdAt: now,
      updatedAt: now,
    };
    registry.items.unshift(created);
    imported.push(created);
  }

  await saveRegistry(registry);
  return imported;
}

export async function deleteSourceScript(id: string) {
  const registry = await loadRegistry();
  const nextItems = registry.items.filter((item) => item.id !== id);
  if (nextItems.length === registry.items.length) {
    throw new Error('脚本不存在');
  }
  registry.items = nextItems;
  await saveRegistry(registry);
}

export async function toggleSourceScriptEnabled(id: string) {
  const registry = await loadRegistry();
  const target = registry.items.find((item) => item.id === id);
  if (!target) {
    throw new Error('脚本不存在');
  }
  target.enabled = !target.enabled;
  target.updatedAt = Date.now();
  await saveRegistry(registry);
  return target;
}

export async function testSourceScript(input: {
  code: string;
  hook: SourceScriptHook;
  payload: Record<string, any>;
  name?: string;
  key?: string;
  configValues?: Record<string, string>;
}): Promise<SourceScriptTestResult> {
  const startedAt = Date.now();
  let collectedLogs: string[] = [];
  try {
    const tempScript: SourceScriptRecord = {
      id: 'test-script',
      key: input.key || 'test-script',
      name: input.name || '测试脚本',
      description: '',
      enabled: true,
      version: 'test',
      code: input.code,
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    const factory = createScriptFactory(input.code);
    const compiled = normalizeScript(factory(_nodeRequire));
    const hook = compiled[input.hook];
    if (typeof hook !== 'function') {
      throw new Error(`脚本未实现 ${input.hook} hook`);
    }

    const { ctx, logs } = await createScriptContext(tempScript, input.configValues);
    collectedLogs = logs;
    const result = await withTimeout(
      Promise.resolve(hook(ctx, input.payload)),
      DEFAULT_TIMEOUT_MS
    );

    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      logs,
      meta: compiled.meta,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      logs: collectedLogs,
      error: (error as Error).message,
    };
  }
}

export function getDefaultSourceScriptTemplate() {
  return DEFAULT_SCRIPT_TEMPLATE;
}

export function buildScriptSourceValue(scriptKey: string, sourceId?: string) {
  return `${SCRIPT_SOURCE_PREFIX}${scriptKey}:${sourceId || 'default'}`;
}

export function parseScriptSourceValue(source: string) {
  if (!source.startsWith(SCRIPT_SOURCE_PREFIX)) {
    return null;
  }

  const rest = source.slice(SCRIPT_SOURCE_PREFIX.length);
  const separatorIndex = rest.indexOf(':');
  if (separatorIndex === -1) {
    return {
      scriptKey: rest,
      sourceId: 'default',
    };
  }

  return {
    scriptKey: rest.slice(0, separatorIndex),
    sourceId: rest.slice(separatorIndex + 1) || 'default',
  };
}

export function normalizeScriptSources(result: any): ScriptSourceDescriptor[] {
  if (!Array.isArray(result)) {
    return [{ id: 'default', name: '默认源' }];
  }

  return result
    .filter((item) => item && item.id)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name || item.id),
    }));
}

export function normalizeScriptSearchResults(input: {
  scriptKey: string;
  scriptName: string;
  sourceId: string;
  sourceName: string;
  result: any;
}) {
  const list = Array.isArray(input.result?.list) ? input.result.list : [];
  return list.map((item: any) => {
    const titles = Array.isArray(item.episodes_titles) ? item.episodes_titles : [];
    const episodes = Array.isArray(item.episodes)
      ? item.episodes.map((episode: any, index: number) => {
          const playUrl =
            typeof episode === 'string'
              ? episode
              : String(episode?.playUrl || episode?.url || '');
          const needResolve =
            typeof episode === 'object' && episode
              ? episode.needResolve !== false
              : true;

          return needResolve
            ? buildScriptPlayUrl({
                scriptKey: input.scriptKey,
                sourceId: input.sourceId,
                episodeIndex: index,
                playUrl,
              })
            : playUrl;
        })
      : [];

    return {
      id: String(item.id),
      title: String(item.title || ''),
      poster: item.poster || '',
      episodes,
      episodes_titles: titles,
      source: buildScriptSourceValue(input.scriptKey, input.sourceId),
      source_name: `${input.scriptName} / ${input.sourceName}`,
      year: item.year || '',
      desc: item.desc || '',
      type_name: item.type_name || '',
      douban_id: item.douban_id || 0,
      vod_remarks: item.vod_remarks,
    };
  });
}

export function normalizeScriptRecommendResults(input: {
  scriptKey: string;
  scriptName: string;
  result: any;
  sources?: ScriptSourceDescriptor[];
  defaultSourceId?: string;
}) {
  const list = Array.isArray(input.result?.list) ? input.result.list : [];
  const sourceMap = new Map(
    (input.sources || []).map((item) => [String(item.id), String(item.name)])
  );
  const fallbackSourceId = input.defaultSourceId || 'default';

  return list.map((item: any) => {
    const sourceId = String(
      item?.sourceId || item?.source_id || item?.source || fallbackSourceId
    );
    const sourceName = String(
      item?.sourceName ||
        item?.source_name ||
        sourceMap.get(sourceId) ||
        sourceId
    );

    return {
      id: String(item?.id || ''),
      title: String(item?.title || ''),
      poster: item?.poster || '',
      episodes: Array.isArray(item?.episodes) ? item.episodes : [],
      episodes_titles: Array.isArray(item?.episodes_titles)
        ? item.episodes_titles
        : [],
      source: buildScriptSourceValue(input.scriptKey, sourceId),
      source_name: `${input.scriptName} / ${sourceName}`,
      year: item?.year || '',
      desc: item?.desc || '',
      type_name: item?.type_name || '',
      douban_id: item?.douban_id || 0,
      vod_remarks: item?.vod_remarks,
      vod_total: item?.vod_total,
      tmdb_id: item?.tmdb_id,
      rating: item?.rating,
    };
  });
}

export function normalizeScriptDetailResult(input: {
  source: string;
  scriptKey: string;
  scriptName: string;
  sourceId: string;
  sourceName: string;
  detailId: string;
  result: any;
}) {
  const playbacks = Array.isArray(input.result?.playbacks)
    ? input.result.playbacks
    : [
        {
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          episodes: input.result?.episodes || [],
          episodes_titles: input.result?.episodes_titles || [],
        },
      ];

  const flattenedEpisodes: string[] = [];
  const flattenedTitles: string[] = [];

  playbacks.forEach((playback: any) => {
    const playbackSourceName = String(playback.sourceName || input.sourceName);
    const titles = Array.isArray(playback.episodes_titles)
      ? playback.episodes_titles
      : [];
    const episodes = Array.isArray(playback.episodes) ? playback.episodes : [];

    episodes.forEach((episode: any, index: number) => {
      const rawPlayUrl =
        typeof episode === 'string'
          ? episode
          : String(episode?.playUrl || episode?.url || '');
      const episodeTitle =
        typeof episode === 'object' && episode?.title
          ? String(episode.title)
          : String(titles[index] || `第${index + 1}集`);

      const playbackSourceId = String(playback.sourceId || input.sourceId);
      const needResolve =
        typeof episode === 'object' && episode
          ? episode.needResolve !== false
          : true;
      const playUrl = needResolve
        ? buildScriptPlayUrl({
            scriptKey: input.scriptKey,
            sourceId: playbackSourceId,
            episodeIndex: index,
            playUrl: rawPlayUrl,
          })
        : rawPlayUrl;

      flattenedEpisodes.push(playUrl);
      flattenedTitles.push(`${playbackSourceName} / ${episodeTitle}`);
    });
  });

  return {
    id: input.detailId,
    title: String(input.result?.title || ''),
    poster: input.result?.poster || '',
    episodes: flattenedEpisodes,
    episodes_titles: flattenedTitles,
    source: input.source,
    source_name: `${input.scriptName} / ${input.sourceName}`,
    class: input.result?.class,
    year: input.result?.year || '',
    desc: input.result?.desc || '',
    type_name: input.result?.type_name || '',
    douban_id: input.result?.douban_id || 0,
    vod_remarks: input.result?.vod_remarks,
    vod_total: input.result?.vod_total,
    proxyMode: false,
  };
}

export async function resolveScriptDetailPlaybacks(input: {
  scriptKey: string;
  sourceId: string;
  result: any;
}) {
  const playbacks = Array.isArray(input.result?.playbacks)
    ? input.result.playbacks
    : [
        {
          sourceId: input.sourceId,
          sourceName: input.sourceId,
          episodes: input.result?.episodes || [],
          episodes_titles: input.result?.episodes_titles || [],
        },
      ];

  // 预检查：编译一次脚本，判断是否实现了 resolvePlayUrl
  const script = await getEnabledSourceScriptByKey(input.scriptKey);
  const compiled = getOrCompileScript(script);

  if (typeof compiled.resolvePlayUrl !== 'function') {
    return input.result;
  }

  // 已实现 resolvePlayUrl，创建一个 context 复用
  const { ctx } = await createScriptContext(script);

  const resolvedPlaybacks = await Promise.all(
    playbacks.map(async (playback: any) => {
      const playbackSourceId = String(playback.sourceId || input.sourceId);
      const episodes = Array.isArray(playback.episodes) ? playback.episodes : [];

      const resolvedEpisodes = await Promise.all(
        episodes.map(async (episode: any, index: number) => {
          const playUrl =
            typeof episode === 'string'
              ? episode
              : String(episode?.playUrl || episode?.url || '');

          try {
            const result = await withTimeout(
              Promise.resolve(
                compiled.resolvePlayUrl(ctx, {
                  playUrl,
                  sourceId: playbackSourceId,
                  episodeIndex: index,
                })
              ),
              DEFAULT_TIMEOUT_MS
            );
            return result?.url || playUrl;
          } catch {
            return playUrl;
          }
        })
      );

      return {
        ...playback,
        episodes: resolvedEpisodes,
      };
    })
  );

  return {
    ...input.result,
    playbacks: resolvedPlaybacks,
  };
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

export function buildScriptPlayUrl(input: {
  scriptKey: string;
  sourceId: string;
  episodeIndex: number;
  playUrl: string;
}) {
  const searchParams = new URLSearchParams({
    key: input.scriptKey,
    sourceId: input.sourceId,
    episodeIndex: String(input.episodeIndex),
    playUrl: encodeBase64Url(input.playUrl),
  });
  return `/api/source-script/play?${searchParams.toString()}`;
}

export function parseScriptPlayUrlValue(value: string) {
  return decodeBase64Url(value);
}

export async function resolveSavedScriptPlayUrl(input: {
  key: string;
  sourceId: string;
  episodeIndex: number;
  playUrl: string;
  configValues?: Record<string, string>;
}) {
  const script = await getEnabledSourceScriptByKey(input.key);
  const { compiled, ctx } = await compileSourceScript(script, input.configValues);

  if (typeof compiled.resolvePlayUrl !== 'function') {
    return {
      url: input.playUrl,
      type: 'auto',
      headers: {},
    };
  }

  const result = await withTimeout(
    Promise.resolve(
      compiled.resolvePlayUrl(ctx, {
        playUrl: input.playUrl,
        sourceId: input.sourceId,
        episodeIndex: input.episodeIndex,
      })
    ),
    DEFAULT_TIMEOUT_MS
  );

  return {
    url: result?.url || input.playUrl,
    type: result?.type || 'auto',
    headers: result?.headers || {},
  };
}
