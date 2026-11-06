import {
  getActiveTVBoxBridgeLine,
  getTVBoxBridgeLines,
} from './tvbox-bridge.shared';
import type { SearchResult } from './types';

/** 在发布播放详情之前恢复线路，剧集地址与 activeLine 必须来自同一条线路。 */
export async function restoreTVBoxBridgePlaybackLine(
  detail: SearchResult,
  requestedLine: string | null,
  readRecordedLine: () => Promise<string | undefined>
): Promise<SearchResult> {
  if (getTVBoxBridgeLines(detail).length === 0) return detail;

  const desiredLine = requestedLine || (await readRecordedLine());
  const line = getActiveTVBoxBridgeLine({
    ...detail,
    activeLine: desiredLine || detail.activeLine,
  });
  if (!line) return detail;

  return {
    ...detail,
    activeLine: line.name,
    episodes: line.episodes,
    episodes_titles: line.episodes_titles,
  };
}

/** 后台搜索保留当前播放卡，其线路和剧集以播放详情为准。 */
export function mergeTVBoxBridgePlaybackSources(
  sources: SearchResult[],
  currentDetail: SearchResult | null
): SearchResult[] {
  if (!currentDetail) return sources;

  let found = false;
  const merged = sources.map((source) => {
    if (
      source.source !== currentDetail.source ||
      source.id !== currentDetail.id
    ) {
      return source;
    }
    found = true;
    return { ...source, ...currentDetail };
  });
  return found ? merged : [currentDetail, ...merged];
}
