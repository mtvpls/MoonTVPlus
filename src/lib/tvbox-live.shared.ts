export const TVBOX_LIVE_SOURCE_PREFIX = 'tvbox-live:';
export const TVBOX_LIVE_RELAY_PATH = '/api/tvbox-bridge/live';

export function isTVBoxLocalLiveProxy(url: string): boolean {
  if (/^\/proxy(?:[/?]|$)/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      /^https?:$/.test(parsed.protocol) &&
      (/^127\./.test(host) ||
        ['localhost', '0.0.0.0', '[::1]'].includes(host)) &&
      /^\/proxy(?:[/?]|$)/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/** 上游 PUBLIC_BASE_URL 可与连接地址不同；直播代理路径统一交给配置的桥接。 */
export function getTVBoxLiveApiPath(
  url: string
): '/api/live/proxy' | '/api/stream' | '/api/img' | null {
  if (isTVBoxLocalLiveProxy(url)) return '/api/live/proxy';
  try {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname.endsWith('/api/live/proxy')) return '/api/live/proxy';
    if (parsed.searchParams.has('u')) {
      if (parsed.pathname.endsWith('/api/stream')) return '/api/stream';
      if (parsed.pathname.endsWith('/api/img')) return '/api/img';
    }
    return null;
  } catch {
    return null;
  }
}

export function isTVBoxLiveProxyUrl(url: string): boolean {
  return getTVBoxLiveApiPath(url) !== null;
}

export function buildLocalTVBoxLiveUrl(source: string, url: string): string {
  const parsed = new URL(url, 'http://localhost');
  // 上游改写地址可能带 token，浏览器只使用本项目的登录权限。
  if (isTVBoxLiveProxyUrl(url)) {
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('t');
  }
  return `${TVBOX_LIVE_RELAY_PATH}?${new URLSearchParams({
    source,
    url: parsed.href,
  })}`;
}

/** 同时处理子清单、分片、AES key、EXT-X-MAP 的 URI。 */
export function rewriteTVBoxLiveM3U(
  content: string,
  baseUrl: string,
  source: string
): string {
  const rewrite = (uri: string) => {
    if (/^(?:data|skd):/i.test(uri)) return uri;
    return buildLocalTVBoxLiveUrl(source, new URL(uri, baseUrl).href);
  };
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!trimmed.startsWith('#')) return rewrite(trimmed);
      return line.replace(
        /URI="([^"]+)"/g,
        (_match, uri: string) => `URI="${rewrite(uri)}"`
      );
    })
    .join('\n');
}
