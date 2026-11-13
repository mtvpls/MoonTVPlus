import { Readable } from 'node:stream';

import { isCloudflareEnvironment } from '@/lib/bangumi.server';
import { safeFetch } from '@/lib/safe-http';

/**
 * 直播源（频道列表 / EPG / m3u8 / TS 分片）统一请求入口。
 *
 * 部分直播源部署在 Cloudflare WAF 之后，会按 TLS 指纹、User-Agent 和连接
 * 是否复用来综合判定：
 * - Node 原生 fetch（undici）即使带上 okhttp 等播放器 UA 也会被 challenge；
 * - node-fetch（底层 node:https）配合播放器 UA 可以正常通过；
 * - 建连后复用的 keep-alive 连接可能已被打上 challenge 标记，后续请求会持续 403，
 *   因此这里强制每次新建连接。
 * Cloudflare Workers 运行时没有 node:https，仍使用原生 fetch。
 */
export function fetchLive(
  url: string,
  ua: string,
  init?: RequestInit
): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  headers['User-Agent'] = ua;

  const requestInit: RequestInit = { ...init, headers };

  if (isCloudflareEnvironment()) {
    return fetch(url, requestInit);
  }

  return safeFetch(url, requestInit, undefined, { forceNonKeepAlive: true });
}

/**
 * 把响应体统一转成 Web ReadableStream。
 * node-fetch 返回的是 Node.js Readable，不能直接交给 Response 或 getReader()。
 */
export function toWebStream(
  body: unknown
): ReadableStream<Uint8Array> | null {
  if (!body) {
    return null;
  }
  if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    return body as ReadableStream<Uint8Array>;
  }
  return Readable.toWeb(body as Readable) as ReadableStream<Uint8Array>;
}
