/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getProxyToken } from '@/lib/emby-token';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ results: [] }, { status: 200 });
  }

  const config = await getConfig();
  const [canAccessOpenList, canAccessEmby] = await Promise.all([
    hasFeaturePermission(authInfo.username, 'private_library'),
    hasFeaturePermission(authInfo.username, 'emby'),
  ]);

  // 权重映射
  const weightMap = new Map<string, number>();
  config.SourceConfig?.forEach((source: any) => {
    weightMap.set(source.key, source.weight ?? 0);
  });

  // 检查 OpenList 是否已配置
  const hasOpenList = !!(
    canAccessOpenList &&
    config.OpenListConfig?.Enabled &&
    config.OpenListConfig?.URL &&
    config.OpenListConfig?.Username &&
    config.OpenListConfig?.Password
  );

  // 获取所有启用的 Emby 源
  const { embyManager } = await import('@/lib/emby-manager');
  const embySourcesMap = await embyManager.getAllClients();
  const embySources = canAccessEmby ? Array.from(embySourcesMap.values()) : [];

  console.log('[PrivateSearch] Emby sources count:', embySources.length);

  // 获取代理 token（用于图片代理）
  const proxyToken = await getProxyToken(request);

  // 为每个 Emby 源创建搜索 Promise
  const embyPromises = embySources.map(({ client, config: embyConfig }: any) =>
    Promise.race([
      (async () => {
        try {
          const searchResult = await client.getItems({
            searchTerm: query,
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            Fields: 'Overview,ProductionYear',
            Limit: 50,
          });

          const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
          const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;

          return searchResult.Items.map((item: any) => ({
            id: item.Id,
            source: sourceValue,
            source_name: sourceName,
            weight: weightMap.get(sourceValue) ?? 0,
            title: item.Name,
            poster: client.getImageUrl(item.Id, 'Primary', undefined, client.isProxyEnabled() ? proxyToken || undefined : undefined),
            episodes: [],
            episodes_titles: [],
            year: item.ProductionYear?.toString() || '',
            desc: item.Overview || '',
            type_name: item.Type === 'Movie' ? '电影' : '电视剧',
            douban_id: 0,
          }));
        } catch (error) {
          console.error(`[PrivateSearch] 搜索 ${embyConfig.name} 失败:`, error);
          return [];
        }
      })(),
      new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error(`${embyConfig.name} timeout`)), 20000)
      ),
    ]).catch((error) => {
      console.error(`[PrivateSearch] 搜索 ${embyConfig.name} 超时:`, error);
      return [];
    })
  );

  // 搜索 OpenList
  const openlistPromise = hasOpenList
    ? Promise.race([
        (async () => {
          try {
            const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
            const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
            const { db } = await import('@/lib/db');

            let metaInfo = getCachedMetaInfo();

            if (!metaInfo) {
              const metainfoJson = await db.getGlobalValue('video.metainfo');
              if (metainfoJson) {
                metaInfo = JSON.parse(metainfoJson);
                if (metaInfo) {
                  setCachedMetaInfo(metaInfo);
                }
              }
            }

            if (metaInfo && metaInfo.folders) {
              return Object.entries(metaInfo.folders)
                .filter(([folderName, info]: [string, any]) => {
                  const matchFolder = folderName.toLowerCase().includes(query.toLowerCase());
                  const matchTitle = info.title?.toLowerCase().includes(query.toLowerCase()) ?? false;
                  return matchFolder || matchTitle;
                })
                .map(([folderName, info]: [string, any]) => ({
                  id: folderName,
                  source: 'openlist',
                  source_name: '私人影库',
                  weight: weightMap.get('openlist') ?? 0,
                  title: info.title || folderName,
                  poster: getTMDBImageUrl(info.poster_path),
                  episodes: [],
                  episodes_titles: [],
                  year: (info.release_date?.split('-')[0]) || '',
                  desc: info.overview || '',
                  type_name: info.media_type === 'movie' ? '电影' : '电视剧',
                  douban_id: 0,
                }));
            }
            return [];
          } catch (error) {
            console.error('[PrivateSearch] 搜索 OpenList 失败:', error);
            return [];
          }
        })(),
        new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error('OpenList timeout')), 20000)
        ),
      ]).catch((error) => {
        console.error('[PrivateSearch] 搜索 OpenList 超时:', error);
        return [];
      })
    : Promise.resolve([]);

  try {
    const allResults = await Promise.all([openlistPromise, ...embyPromises]);

    const openlistResults = Array.isArray(allResults[0]) ? allResults[0] : [];
    const embyResults = allResults.slice(1).filter(Array.isArray).flat();

    let flattenedResults = [...openlistResults, ...embyResults];

    flattenedResults = flattenedResults.map((result: any) => ({
      ...result,
      weight: result.weight ?? (weightMap.get(result.source) ?? 0),
    }));

    // 按权重降序排序
    flattenedResults.sort((a: any, b: any) => {
      const weightA = a.weight ?? 0;
      const weightB = b.weight ?? 0;
      return weightB - weightA;
    });

    return NextResponse.json({ results: flattenedResults }, { status: 200 });
  } catch (error) {
    console.error('[PrivateSearch] 搜索结果处理失败:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}