import { getConfig } from './config';
import {
  getTVBoxBridgeCategory,
  getTVBoxBridgeEndpoint,
  getTVBoxBridgeHome,
  normalizeTVBoxBridgeSearchResults,
  resolveTVBoxBridgeSites,
  searchTVBoxBridgeSite,
} from './tvbox-bridge.server';
import { yellowWords } from './yellow';

const HOME_CATEGORY = '__tvbox_home__';

/** 源站寻片按站点请求桥接，并沿用用户权限及特殊源隔离。 */
export async function fetchTVBoxSourceSearchPage(input: {
  user: string;
  source: string;
  specialOnly: boolean;
  mode: 'home' | 'category' | 'search';
  categoryId?: string;
  keyword?: string;
  page?: number;
  signal?: AbortSignal;
}) {
  const sites = await resolveTVBoxBridgeSites(input.user, input.specialOnly);
  const site = sites.find((item) => item.key === input.source);
  const endpoint = await getTVBoxBridgeEndpoint();
  if (!site || !endpoint) return null;

  const pageNumber = Number.isFinite(input.page)
    ? Math.max(1, Math.floor(input.page || 1))
    : 1;
  const isHome = input.mode === 'home' || input.categoryId === HOME_CATEGORY;
  const page = isHome
    ? await getTVBoxBridgeHome(endpoint, site.siteKey, input.signal)
    : input.mode === 'search'
    ? await searchTVBoxBridgeSite(
        endpoint,
        site.siteKey,
        input.keyword || '',
        pageNumber,
        input.signal
      )
    : await getTVBoxBridgeCategory(
        endpoint,
        site.siteKey,
        input.categoryId || '',
        pageNumber,
        input.signal
      );

  const config = await getConfig();
  const isAllowedType = (name: string) =>
    config.SiteConfig.DisableYellowFilter ||
    !yellowWords.some((word) => name.includes(word));
  const results = normalizeTVBoxBridgeSearchResults({
    site,
    list: page.list,
  }).filter((item) => isAllowedType(item.type_name || ''));
  const categories = (page.categories || [])
    .filter((item) => item.id && isAllowedType(item.name || ''))
    .map((item) => ({ id: String(item.id), name: item.name, pid: '0' }));
  if (categories.length === 0 && results.length > 0) {
    categories.push({ id: HOME_CATEGORY, name: '推荐', pid: '0' });
  }

  return {
    categories,
    results,
    total: page.total || results.length,
    page: isHome ? 1 : page.page || pageNumber,
    pageCount: isHome ? 1 : page.pagecount || 1,
  };
}
