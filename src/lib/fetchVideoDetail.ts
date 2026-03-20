import { getAvailableApiSites } from '@/lib/config';
import { SearchResult } from '@/lib/types';

import { getDetailFromApiV2 } from './downstream';
import { getSpecialSourceDetail, isSpecialSource } from './special-sources-detail';

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
}

/**
 * 根据 source 与 id 获取视频详情。
 * 1. 如果是特殊源（emby、openlist、xiaoya），直接调用对应的获取函数。
 * 2. 其他采集源直接调用详情接口，避免依赖搜索接口。
 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle: _fallbackTitle = '',
}: FetchVideoDetailOptions): Promise<SearchResult> {
  // 检查是否是特殊源（emby、openlist、xiaoya）
  if (isSpecialSource(source)) {
    const detail = await getSpecialSourceDetail(source, id);
    if (detail) {
      return detail;
    }
    // 如果特殊源返回 null，继续使用标准流程
  }

  const apiSites = await getAvailableApiSites();
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) {
    throw new Error('无效的API来源');
  }

  const detail = await getDetailFromApiV2(apiSite, id);
  if (!detail) {
    throw new Error('获取视频详情失败');
  }

  return detail;
}
