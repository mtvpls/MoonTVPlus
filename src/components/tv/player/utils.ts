import {
  getTVSearchYear,
  inferTVSearchType,
  selectTVSearchSources,
  uniqueTVSearchSources,
} from '@/lib/tv-search';
import { resolveTVBoxBridgePlaybackUrl } from '@/lib/tvbox-bridge.client';
import {
  getTVBoxBridgeLines,
  isTVBoxBridgeSource,
} from '@/lib/tvbox-bridge.shared';
import type { SearchResult } from '@/lib/types';

export type TVEpisodePlayback = {
  url: string;
  sourceType?: 'm3u8' | 'flv' | 'native';
  live?: boolean;
};

type SearchCachePayload = {
  status: 'complete' | 'partial';
  results: SearchResult[];
  query: string;
  updatedAt: number;
};

const searchRequests = new Map<string, Promise<SearchResult[]>>();

/** TV 界面的错误提示不透出接口路径、状态码和响应正文。 */
export function getTVErrorMessage(
  error: unknown,
  fallback = '操作失败，请稍后重试'
): string {
  const message = (
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : ''
  ).trim();
  if (/未返回播放地址|播放(?:地址|链接)为空/.test(message))
    return '该线路未返回播放地址，请尝试其他线路';
  if (/超时|timeout|timed\s*out/i.test(message))
    return '该线路响应超时，请稍后重试';
  if (/需要(?:二次|额外)解析/.test(message))
    return '该线路需要进一步解析，请尝试其他线路';
  if (/未启用|停用|不可用/.test(message)) return '该源暂不可用，请尝试其他源';
  if (/当前设备.*(?:不支持|无法)/.test(message))
    return '当前设备无法检测该线路，请尝试其他线路';
  if (/不支持测速|直播线路/.test(message))
    return '未能获取媒体测速数据，请尝试其他线路';
  if (
    /媒体加载失败|HLS播放失败|networkError|mediaError|Failed to fetch/i.test(
      message
    )
  )
    return '媒体加载失败，请尝试其他线路';
  if (
    !/[\u4e00-\u9fff]/.test(message) ||
    message.length > 120 ||
    /[{}[\]\\/]|\b(?:[45]\d{2}|Error|Exception|Spider|tvbox-bridge)\b/i.test(
      message
    )
  )
    return fallback;
  return message;
}

export function cacheTVSearchResults(query: string, results: SearchResult[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      `search_cache_${query.trim()}`,
      JSON.stringify({
        status: 'complete',
        results,
        query: query.trim(),
        updatedAt: Date.now(),
      } satisfies SearchCachePayload)
    );
  } catch {
    // ignore storage failures
  }
}

function getCachedSearchResults(query?: string | null) {
  const keyword = query?.trim();
  if (!keyword || typeof window === 'undefined') return null;
  try {
    const cached = sessionStorage.getItem(`search_cache_${keyword}`);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as SearchCachePayload;
    if (
      Array.isArray(parsed.results) &&
      (parsed.results.length > 0 || parsed.status === 'complete')
    )
      return parsed.results;
  } catch {
    // ignore invalid cache
  }
  return null;
}

async function fetchSearchResults(query: string) {
  const keyword = query.trim();
  const cached = getCachedSearchResults(keyword);
  if (cached) return cached;

  const pending = searchRequests.get(keyword);
  if (pending) return pending;
  const request = fetch(`/api/search?q=${encodeURIComponent(keyword)}`, {
    cache: 'no-store',
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('搜索播放源失败');
      const data = await res.json();
      const results = (
        Array.isArray(data.results) ? data.results : []
      ) as SearchResult[];
      cacheTVSearchResults(keyword, results);
      return results;
    })
    .finally(() => searchRequests.delete(keyword));
  searchRequests.set(keyword, request);
  return request;
}

/** 补详情和测速只读取单个源，不触发整站搜索。 */
export async function fetchTVSourceDetail(params: {
  source: string;
  id: string;
  title?: string | null;
  fileName?: string | null;
  line?: string | null;
}): Promise<SearchResult> {
  const { source, id, title, fileName, line } = params;
  const qs = new URLSearchParams({ source, id, title: title || '' });
  if (fileName) qs.set('fileName', fileName);
  if (line) qs.set('line', line);
  const res = await fetch(`/api/source-detail?${qs.toString()}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('获取视频详情失败');
  return (await res.json()) as SearchResult;
}

export async function fetchTVDetail(params: {
  source?: string | null;
  id?: string | null;
  title?: string | null;
  fileName?: string | null;
  line?: string | null;
  year?: string | null;
  stype?: string | null;
  searchQuery?: string | null;
}): Promise<{ detail: SearchResult; sources: SearchResult[] }> {
  const { source, id, title, fileName, line, year, stype, searchQuery } =
    params;

  if (source && id) {
    const detail = await fetchTVSourceDetail({
      source,
      id,
      title,
      fileName,
      line,
    });
    let sources: SearchResult[] = [detail];
    const searchTitle = searchQuery || title || detail.title;
    if (searchTitle) {
      try {
        const list = await fetchSearchResults(searchTitle);
        const selected =
          list.find((item) => item.source === source && item.id === id) ||
          detail;
        sources = selectTVSearchSources(
          list,
          {
            title: selected.title,
            year: year || getTVSearchYear(selected),
            stype: stype || inferTVSearchType(selected),
          },
          detail
        );
      } catch {
        // 换源搜索失败不影响当前播放
      }
    }
    return { detail, sources };
  }

  if (!title) throw new Error('缺少片名');
  const list = await fetchSearchResults(searchQuery || title);
  const selected = selectTVSearchSources(list, { title, year, stype })[0];
  if (!selected) throw new Error('未找到该影片的播放源');
  const sources = selectTVSearchSources(list, {
    title: selected.title,
    year: year || getTVSearchYear(selected),
    stype: stype || inferTVSearchType(selected),
  });
  let detail = sources[0];
  if (
    !detail.episodes?.length ||
    (isTVBoxBridgeSource(detail.source) &&
      getTVBoxBridgeLines(detail).length === 0)
  ) {
    try {
      detail = await fetchTVSourceDetail({
        source: detail.source,
        id: detail.id,
        title: detail.title || title,
        fileName,
        line,
      });
    } catch {
      // 单个源的详情失败时，仍可优选其他匹配源。
    }
  }
  return { detail, sources: uniqueTVSearchSources([detail, ...sources]) };
}

export async function resolveTVEpisodePlayback(
  rawUrl: string,
  source?: string,
  proxyMode?: boolean
): Promise<TVEpisodePlayback> {
  let url = rawUrl;
  let mediaType: string | undefined;
  let live = false;
  const isBridgeUrl = url.startsWith('/api/tvbox-bridge/play');
  const lazyPrefixes = [
    '/api/xiaoya/play',
    '/api/openlist/play',
    '/api/netdisk/115/play',
    '/api/netdisk/123/play',
    '/api/netdisk/quark/play',
    '/api/netdisk/uc/play',
    '/api/netdisk/baidu/play',
    '/api/source-script/play',
  ];
  if (isBridgeUrl) {
    const result = await resolveTVBoxBridgePlaybackUrl(url);
    if (result.needsParse) {
      throw new Error('该线路需要额外解析，请尝试其他线路');
    }
    url = result.url;
    mediaType = result.mediaType;
    live = Boolean(result.isLive);
  } else if (lazyPrefixes.some((prefix) => url.startsWith(prefix))) {
    const separator = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${separator}format=json`, {
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok || typeof data?.url !== 'string' || !data.url.trim()) {
      throw new Error(data?.error || '获取播放链接失败');
    }
    url = data.url;
    mediaType = data.mediaType;
  }

  const sourceType: TVEpisodePlayback['sourceType'] =
    mediaType === 'hls' || mediaType === 'm3u8'
      ? 'm3u8'
      : mediaType === 'flv'
      ? 'flv'
      : mediaType === 'mp4' || mediaType === 'file'
      ? 'native'
      : undefined;
  const isM3u8 = sourceType
    ? sourceType === 'm3u8'
    : url.toLowerCase().includes('.m3u') ||
      !url.toLowerCase().match(/\.(mp4|flv|webm|mkv|avi|mov)(\?.*)?$/);
  // 桥接已经处理取流与请求头，不再交给普通采集源代理。
  if (
    proxyMode &&
    source &&
    isM3u8 &&
    !isBridgeUrl &&
    !url.startsWith('/api/proxy/')
  ) {
    url = `/api/proxy/vod/m3u8?url=${encodeURIComponent(
      url
    )}&source=${encodeURIComponent(source)}`;
  }
  return { url, sourceType, live };
}

export async function resolveTVEpisodeUrl(
  rawUrl: string,
  source?: string,
  proxyMode?: boolean
) {
  return (await resolveTVEpisodePlayback(rawUrl, source, proxyMode)).url;
}

export function formatTVTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s
        .toString()
        .padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
