/* eslint-disable @typescript-eslint/no-explicit-any */

import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

export type AnimeDataSource = 'direct' | 'server-proxy' | 'custom-baseurl';

export const DEFAULT_BANGUMI_BASE_URL = 'https://api.bgm.tv';

function isCloudflareEnvironment(): boolean {
  return (
    process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare'
  );
}

export function normalizeBangumiBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl || DEFAULT_BANGUMI_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  return normalized || DEFAULT_BANGUMI_BASE_URL;
}

export async function fetchBangumiFromServer(
  path: string,
  options?: { baseUrl?: string; proxy?: string }
): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${normalizeBangumiBaseUrl(options?.baseUrl)}${normalizedPath}`;
  const proxy = options?.proxy?.trim();

  if (isCloudflareEnvironment()) {
    return fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MoonTVPlus/1.0 (https://github.com)',
      },
      signal: AbortSignal.timeout(15000),
    }) as Promise<Response>;
  }

  const fetchOptions: any = {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MoonTVPlus/1.0 (https://github.com)',
    },
    signal: AbortSignal.timeout(proxy ? 30000 : 15000),
  };

  if (proxy) {
    fetchOptions.agent = new HttpsProxyAgent(proxy, {
      timeout: 30000,
      keepAlive: false,
    });
  }

  return nodeFetch(url, fetchOptions) as unknown as Promise<Response>;
}
