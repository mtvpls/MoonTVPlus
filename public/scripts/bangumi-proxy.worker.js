/* eslint-disable */
/**
 * MoonTVPlus Bangumi 代理 - Cloudflare Workers 版
 *
 * 项目配置方式：
 * 1. 后台 -> 动漫数据源配置：
 *    - 默认动漫数据源：自定义 Base URL
 *    - Bangumi Base URL：https://你的-worker.workers.dev
 *
 * 2. 如需代理 Bangumi 图片：
 *    - Bangumi 图片 Base URL：https://你的-worker.workers.dev
 *
 * 兼容路径：
 * - /calendar                    -> https://api.bgm.tv/calendar
 * - /v0/subjects/123             -> https://api.bgm.tv/v0/subjects/123
 * - /https://lain.bgm.tv/xxx.jpg -> https://lain.bgm.tv/xxx.jpg
 * - /?url=https://api.bgm.tv/calendar
 */

const API_ORIGIN = 'https://api.bgm.tv';

const ALLOWED_HOSTS = new Set([
  'api.bgm.tv',
  'bgm.tv',
  'bangumi.tv',
  'chii.in',
  'lain.bgm.tv',
  'r.bgm.tv',
]);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export default {
  async fetch(request) {
    return handleRequest(request);
  },
};

if (typeof addEventListener === 'function') {
  addEventListener('fetch', (event) => {
    event.respondWith(handleRequest(event.request));
  });
}

async function handleRequest(request) {
  const requestUrl = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (requestUrl.pathname === '/' && !requestUrl.searchParams.has('url')) {
    return jsonResponse({
      ok: true,
      name: 'MoonTVPlus Bangumi Proxy',
      apiBaseUrl: requestUrl.origin,
      imageBaseUrl: requestUrl.origin,
      examples: {
        calendar: `${requestUrl.origin}/calendar`,
        subject: `${requestUrl.origin}/v0/subjects/1`,
        image: `${requestUrl.origin}/https://lain.bgm.tv/pic/cover/l/demo.jpg`,
        queryProxy: `${requestUrl.origin}/?url=${encodeURIComponent('https://api.bgm.tv/calendar')}`,
      },
    });
  }

  try {
    const targetUrl = buildTargetUrl(requestUrl);
    assertAllowedTarget(targetUrl);

    const upstreamResponse = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: buildUpstreamHeaders(request.headers, targetUrl),
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
      cf: {
        cacheEverything: request.method === 'GET',
        cacheTtl: getCacheTtl(targetUrl),
      },
    });

    return buildProxyResponse(upstreamResponse, requestUrl.origin);
  } catch (error) {
    return jsonResponse(
      { error: error?.message || String(error) },
      502
    );
  }
}

function buildTargetUrl(requestUrl) {
  const urlParam = requestUrl.searchParams.get('url');
  if (urlParam) {
    return new URL(urlParam);
  }

  const rawPath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ''));

  // 兼容本项目 Bangumi 图片 Base URL 的拼接方式：
  // `${baseUrl}/${imageUrl}` 会形成 /https://lain.bgm.tv/xxx
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    const target = new URL(rawPath);
    target.search = requestUrl.search;
    return target;
  }

  // 某些 URL 解析/拼接场景可能变成 https:/lain.bgm.tv/xxx，这里修正为 https://...
  if (rawPath.startsWith('http:/') || rawPath.startsWith('https:/')) {
    const fixed = rawPath.replace(/^http:\//, 'http://').replace(/^https:\//, 'https://');
    const target = new URL(fixed);
    target.search = requestUrl.search;
    return target;
  }

  const target = new URL(API_ORIGIN);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  return target;
}

function assertAllowedTarget(targetUrl) {
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error('Only http/https target is allowed');
  }

  const host = targetUrl.hostname.toLowerCase();
  const allowed = ALLOWED_HOSTS.has(host) || host.endsWith('.bgm.tv') || host.endsWith('.bangumi.tv');
  if (!allowed) {
    throw new Error(`Target host is not allowed: ${host}`);
  }
}

function buildUpstreamHeaders(inputHeaders, targetUrl) {
  const headers = new Headers();

  for (const [name, value] of inputHeaders.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower.startsWith('cf-')) continue;
    if (lower === 'host' || lower === 'origin' || lower === 'referer') continue;
    headers.set(name, value);
  }

  const isImage = isLikelyImageUrl(targetUrl);
  headers.set('Accept', inputHeaders.get('Accept') || (isImage ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'application/json, text/plain, */*'));
  headers.set('Referer', 'https://bgm.tv/');
  headers.set('Origin', 'https://bgm.tv');
  headers.set('User-Agent', inputHeaders.get('User-Agent') || 'MoonTVPlus/1.0 CloudflareWorker (+https://github.com)');

  return headers;
}

function buildProxyResponse(upstreamResponse, workerOrigin) {
  const headers = new Headers(upstreamResponse.headers);

  for (const name of Array.from(headers.keys())) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower.startsWith('cf-')) {
      headers.delete(name);
    }
  }

  const location = headers.get('Location');
  if (location) {
    try {
      const locationUrl = new URL(location);
      if (isAllowedHost(locationUrl.hostname)) {
        headers.set('Location', `${workerOrigin}/${locationUrl.toString()}`);
      }
    } catch {
      // relative Location 保持原样
    }
  }

  setCors(headers);
  headers.set('X-Proxy-By', 'MoonTVPlus Bangumi Proxy');

  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=300');
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

function getCacheTtl(targetUrl) {
  if (isLikelyImageUrl(targetUrl)) return 60 * 60 * 24 * 30;
  if (targetUrl.pathname === '/calendar') return 60 * 30;
  if (targetUrl.pathname.startsWith('/v0/subjects/')) return 60 * 60 * 6;
  return 60 * 5;
}

function isLikelyImageUrl(url) {
  return /\.(avif|webp|png|jpe?g|gif|svg)(\?.*)?$/i.test(url.pathname);
}

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host) || host.endsWith('.bgm.tv') || host.endsWith('.bangumi.tv');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

function setCors(headers) {
  const cors = corsHeaders();
  for (const key of Object.keys(cors)) {
    headers.set(key, cors[key]);
  }
}

function jsonResponse(data, status = 200) {
  const headers = new Headers(corsHeaders());
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}
