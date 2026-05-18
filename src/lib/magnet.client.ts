/* eslint-disable @typescript-eslint/no-explicit-any */

import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

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

  const fetchOptions: any = proxy
    ? {
        ...init,
        agent: new HttpsProxyAgent(proxy, {
          timeout: 30000,
          keepAlive: false,
        }),
        signal: AbortSignal.timeout(30000),
      }
    : {
        ...init,
        signal: AbortSignal.timeout(15000),
      };

  return nodeFetch(url, fetchOptions) as unknown as Response;
}
