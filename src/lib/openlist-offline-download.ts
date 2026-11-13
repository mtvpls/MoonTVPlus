/* eslint-disable @typescript-eslint/no-explicit-any */

import { AdminConfig } from '@/lib/admin.types';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getOpenListSources,
  MAIN_SOURCE_NAME,
  resolveSourcePath,
  type ResolvedOpenListSource,
} from '@/lib/openlist-sources';

/** 离线下载目标：源 + 去掉源名前缀的基准目录 */
export interface OfflineDownloadTarget {
  source: ResolvedOpenListSource;
  basePath: string;
}

/**
 * 解析离线下载目标。
 * 父目录默认取「离线下载目录」；basePathOverride（追番订阅的「覆盖路径」）非空时以它为准。
 * 源由父目录的「源名@」前缀决定（无前缀即主源），也可用 overrideSourceName 临时覆盖
 * （「存到私人影库」弹窗里选源）。
 */
export function getOfflineDownloadTarget(
  config: AdminConfig,
  overrideSourceName?: string,
  basePathOverride?: string | null
): OfflineDownloadTarget {
  const openlistConfig = config.OpenListConfig;

  if (!openlistConfig?.Enabled) {
    throw new Error('私人影库功能未启用');
  }

  const rawBase =
    (basePathOverride ?? '').trim() ||
    openlistConfig.OfflineDownloadPath ||
    '/';

  const resolved = resolveSourcePath(config, rawBase);
  if (!resolved) {
    throw new Error('OpenList 未配置');
  }

  let source = resolved.source;

  if (overrideSourceName) {
    const hit = getOpenListSources(config).find(
      (s) => s.name === overrideSourceName
    );
    if (!hit) {
      throw new Error(`未知的 OpenList 源：${overrideSourceName}`);
    }
    source = hit;
  }

  if (!source.url || !source.username || !source.password) {
    throw new Error(`OpenList 源「${source.name}」配置不完整`);
  }

  return { source, basePath: resolved.path };
}

/** 「离线下载目录」所属的源名（无「源名@」前缀即主源） */
export function getOfflineDownloadSourceName(config: AdminConfig): string {
  const resolved = resolveSourcePath(
    config,
    config.OpenListConfig?.OfflineDownloadPath || '/'
  );
  return resolved?.source.name || MAIN_SOURCE_NAME;
}

/**
 * 「存到私人影库」弹窗的目标：源下拉和目录框都可以留空。
 * - 选了源 → 用选中的源；没选而目录里写了「源名@」→ 用目录里的源
 * - 只选了源没改目录 → 该源 + 离线下载目录
 * - 只改了目录没选源 → 沿用离线下载目录的源
 */
export function resolveOfflineDownloadTarget(
  config: AdminConfig,
  options: { sourceName?: string; pathOverride?: string } = {}
): OfflineDownloadTarget {
  const pathOverride = (options.pathOverride ?? '').trim();
  const resolved = pathOverride ? resolveSourcePath(config, pathOverride) : null;
  const sourceName =
    options.sourceName ||
    (resolved && !resolved.explicit
      ? getOfflineDownloadSourceName(config)
      : undefined);

  return getOfflineDownloadTarget(config, sourceName, pathOverride);
}

export function joinOpenListPath(basePath: string, name: string): string {
  return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
}

export async function addOpenListOfflineDownload(
  source: ResolvedOpenListSource,
  downloadPath: string,
  url: string,
  tool: string
) {
  const client = new OpenListClient(source.url, source.username, source.password);
  const token = await (client as any).getToken();
  const openlistUrl = `${source.url.replace(/\/$/, '')}/api/fs/add_offline_download`;

  const response = await fetch(openlistUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({
      path: downloadPath,
      urls: [url],
      tool,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.code !== 200) {
    throw new Error(data.message || '添加离线下载任务失败');
  }
}
