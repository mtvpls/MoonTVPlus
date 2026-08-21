/* eslint-disable @typescript-eslint/no-explicit-any */

import { safeFetch } from './safe-http';

function isCloudflareEnvironment(): boolean {
  return process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
}

export function getMagnetBaseUrl(defaultBaseUrl: string, reverseProxyBaseUrl?: string): string {
  return (reverseProxyBaseUrl || defaultBaseUrl).replace(/\/+$/, '');
}

export async function universalMagnetFetch(
  url: string,
  proxy?: string,
  init?: RequestInit
): Promise<Response> {
  if (isCloudflareEnvironment()) {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    return response as unknown as Response;
  }

  const fetchOptions: any = {
    ...init,
    signal: proxy ? AbortSignal.timeout(30000) : AbortSignal.timeout(15000),
  };

  return safeFetch(url, fetchOptions, proxy) as unknown as Response;
}
