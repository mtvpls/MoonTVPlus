/**
 * OpenList 多源工具
 *
 * 一个「主源」（固定名「主源」，沿用旧配置的 URL/账号/密码）+ 若干「备用源」（ExtraSources）。
 * 路径统一用「源名@路径」区分来源：
 *   - 「115@/videos」  → 115 源的 /videos
 *   - 「/videos」      → 主源的 /videos
 * 只有 @ 左侧恰好等于某个已配置的源名时才按源解析，否则整串当作主源路径，
 * 这样路径本身含 @ 也不会被误判，且旧配置完全兼容。
 */

import type { AdminConfig } from '@/lib/admin.types';
import { OpenListClient } from '@/lib/openlist.client';
import { normalizeOpenListPath } from '@/lib/openlist-path-meta';

/** 主源固定名字 */
export const MAIN_SOURCE_NAME = '主源';

export interface ResolvedOpenListSource {
  name: string;
  url: string;
  username: string;
  password: string;
}

export interface ResolvedSourcePath {
  source: ResolvedOpenListSource;
  /** 去掉源名前缀后的真实 OpenList 路径，已规范化 */
  path: string;
  /** 是否显式写了「源名@」前缀 */
  explicit: boolean;
}

/**
 * 列出全部源：[主源, ...备用源]
 */
export function getOpenListSources(
  config: AdminConfig | null | undefined
): ResolvedOpenListSource[] {
  const c = config?.OpenListConfig;
  if (!c) return [];

  const sources: ResolvedOpenListSource[] = [
    {
      name: MAIN_SOURCE_NAME,
      url: c.URL || '',
      username: c.Username || '',
      password: c.Password || '',
    },
  ];

  for (const extra of c.ExtraSources || []) {
    if (!extra?.name) continue;
    sources.push({
      name: extra.name,
      url: extra.url || '',
      username: extra.username || '',
      password: extra.password || '',
    });
  }

  return sources;
}

/**
 * 解析「源名@路径」为 (源, 真实路径)。
 * 未配置任何源时返回 null。
 */
export function resolveSourcePath(
  config: AdminConfig | null | undefined,
  raw: string | null | undefined
): ResolvedSourcePath | null {
  const sources = getOpenListSources(config);
  if (sources.length === 0) return null;

  const value = (raw ?? '').toString();
  const at = value.indexOf('@');

  if (at > 0) {
    const name = value.slice(0, at).trim();
    const hit = sources.find((s) => s.name === name);
    if (hit) {
      return {
        source: hit,
        path: normalizeOpenListPath(value.slice(at + 1)) || '/',
        explicit: true,
      };
    }
  }

  return {
    source: sources[0],
    path: normalizeOpenListPath(value) || '/',
    explicit: false,
  };
}

/**
 * 解析存储的 folderName（可能带「源名@」前缀）为 (源, 真实路径)。
 * 与 resolveSourcePath 同义，语义上用于 metainfo 中记录的文件夹路径。
 */
export function resolveFolderSource(
  config: AdminConfig | null | undefined,
  folderName: string | null | undefined
): ResolvedSourcePath | null {
  return resolveSourcePath(config, folderName);
}

/**
 * 序列化 (源名, 路径) → 存储字符串：主源不写前缀。
 */
export function formatSourcePath(sourceName: string, path: string): string {
  const p = normalizeOpenListPath(path) || '/';
  return sourceName === MAIN_SOURCE_NAME ? p : `${sourceName}@${p}`;
}

/**
 * 检查「源名@路径」里的源名是否已配置。
 * 返回未知的源名；没问题（或没写前缀 / 整串是含 @ 的路径）返回 null。
 */
export function findUnknownSourceName(
  config: AdminConfig | null | undefined,
  raw: string | null | undefined
): string | null {
  const value = (raw ?? '').toString();
  const at = value.indexOf('@');
  if (at <= 0) return null;

  const name = value.slice(0, at).trim();
  if (!name || name.includes('/')) return null;

  return getOpenListSources(config).some((s) => s.name === name) ? null : name;
}

/**
 * 用解析出的源创建客户端
 */
export function createClientForSource(
  source: ResolvedOpenListSource
): OpenListClient {
  return new OpenListClient(source.url, source.username, source.password);
}
