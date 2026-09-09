/**
 * OpenList 代理播放 URL 构建工具
 * 路径格式：/api/openlist/proxy/{token}/{filename}?folder=xxx&fileName=xxx
 * - token：tvbox 订阅 token（用户/全局）；Web 端使用固定的 'proxy'，依赖登录 cookie 校验
 * - filename：用于 Content-Disposition，统一使用 video.mp4
 */

import { normalizeApiBaseUrl } from '@/lib/url';

export function buildOpenListProxyUrl(opts: {
  token: string;
  folder: string;
  fileName: string;
  baseUrl?: string;
}): string {
  const query = `?folder=${encodeURIComponent(opts.folder)}&fileName=${encodeURIComponent(opts.fileName)}`;
  return `${opts.baseUrl || ''}/api/openlist/proxy/${encodeURIComponent(opts.token)}/video.mp4${query}`;
}

export function is115OpenListProvider(provider?: string): boolean {
  const name = (provider || '').trim().toLowerCase();
  return (
    name === '115 cloud' ||
    name === '115 share' ||
    name === '115 open' ||
    name.startsWith('115 ')
  );
}

export function buildOpenListDownloadUrl(
  baseURL: string,
  filePath: string,
  sign?: string
): string {
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const path = encodedPath.startsWith('/') ? encodedPath : `/${encodedPath}`;
  const url = `${normalizeApiBaseUrl(baseURL)}/d${path}`;
  return sign ? `${url}?sign=${sign}` : url;
}

export function resolveOpenListDirectPlayUrl(opts: {
  openListBaseUrl: string;
  filePath: string;
  rawUrl?: string;
  sign?: string;
  provider?: string;
}): string {
  const rawUrl = (opts.rawUrl || '').trim();
  if (is115OpenListProvider(opts.provider) && opts.sign) {
    return buildOpenListDownloadUrl(
      opts.openListBaseUrl,
      opts.filePath,
      opts.sign
    );
  }
  return rawUrl;
}
