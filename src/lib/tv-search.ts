import { parseTVBoxBridgeEpisodeCount } from './tvbox-bridge.shared';
import type { SearchResult } from './types';

type TVSearchSelector = {
  title: string;
  year?: string | null;
  stype?: string | null;
};

function normalizeTVSearchTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[第\s._\-:：]+/g, '')
    .replace(/[（(].*?[）)]/g, '');
}

type TVSearchTypeMetadata = Pick<
  Partial<SearchResult>,
  | 'type_name'
  | 'class'
  | 'episodes'
  | 'episodes_titles'
  | 'vod_total'
  | 'vod_remarks'
>;

/** 懒详情源可能没有分类；保留未知状态，避免把电影误判为剧集。 */
export function inferTVSearchType(
  item: TVSearchTypeMetadata
): 'movie' | 'tv' | undefined {
  const typeName = (item.type_name || '').trim().toLowerCase();
  const category = (item.class || '').trim().toLowerCase();
  const labels = [typeName, category];
  if (
    labels.some(
      (text) =>
        /电影|movie|\bfilm\b/.test(text) ||
        (text.endsWith('片') && !text.includes('动漫'))
    )
  )
    return 'movie';
  if (
    /剧|动漫|综艺|anime|\btv\b|\bseries\b/.test(typeName) ||
    /电视剧|剧集|动漫|综艺|anime|\btv\b|\bseries\b/.test(category) ||
    item.episodes_titles?.some((text) => /第\d+集|第\d+话|EP?\d+/i.test(text))
  )
    return 'tv';
  const episodeCount = Math.max(
    item.episodes?.length || 0,
    item.vod_total || 0,
    parseTVBoxBridgeEpisodeCount(item.vod_remarks)
  );
  return episodeCount > 1 ? 'tv' : episodeCount === 1 ? 'movie' : undefined;
}

export function getTVSearchType(item: TVSearchTypeMetadata): 'movie' | 'tv' {
  return inferTVSearchType(item) || 'tv';
}

export function getTVSearchYear(item: { year?: string | null }) {
  return item.year && /^\d{4}$/.test(item.year) ? item.year : 'unknown';
}

export function getTVSearchGroupKey(item: SearchResult) {
  return `${normalizeTVSearchTitle(item.title)}-${getTVSearchType(
    item
  )}-${getTVSearchYear(item)}`;
}

/** 一个站点只占一个播放源；多线路由该站点的详情提供。 */
export function uniqueTVSearchSources(items: SearchResult[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.source)) return false;
    seen.add(item.source);
    return true;
  });
}

/** 搜索卡片、详情和播放页使用相同的影片匹配规则。 */
export function selectTVSearchSources(
  items: SearchResult[],
  selector: TVSearchSelector,
  currentDetail?: SearchResult
) {
  const title = normalizeTVSearchTitle(selector.title);
  const year = selector.year ? getTVSearchYear(selector) : null;
  const stype =
    selector.stype === 'movie' || selector.stype === 'tv'
      ? selector.stype
      : null;
  const matches = items.filter((item) => {
    const itemYear = getTVSearchYear(item);
    const itemType = inferTVSearchType(item);
    return (
      normalizeTVSearchTitle(item.title) === title &&
      (!year ||
        itemYear === year ||
        (year !== 'unknown' && itemYear === 'unknown')) &&
      (!stype || !itemType || itemType === stype)
    );
  });
  return uniqueTVSearchSources(
    currentDetail ? [currentDetail, ...matches] : matches
  );
}
