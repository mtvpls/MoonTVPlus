/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import parseTorrentName from 'parse-torrent-name';

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { generateFolderKey } from '@/lib/crypto';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import {
  cleanupOldTasks,
  completeScanTask,
  createScanTask,
  failScanTask,
  updateScanTaskProgress,
} from '@/lib/scan-task';
import { parseSeasonFromTitle } from '@/lib/season-parser';
import { getTVSeasonDetails,searchTMDB } from '@/lib/tmdb.search';

/**
 * 获取根目录列表（兼容新旧配置）
 */
/**
 * 清理字符串中的 BOM 和其他不可见字符
 */
function cleanPath(path: string): string {
  // 移除 UTF-8 BOM (U+FEFF) 和其他零宽度字符
  return path
    .replace(/^\uFEFF/, '') // 移除开头的 BOM
    .replace(/\uFEFF/g, '') // 移除所有 BOM
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // 移除零宽度字符
    .trim(); // 移除首尾空白
}

function getRootPaths(openListConfig: AdminConfig['OpenListConfig']): string[] {
  if (!openListConfig) {
    return ['/'];
  }

  // 如果有新字段 RootPaths，直接使用并清理
  if (openListConfig.RootPaths && openListConfig.RootPaths.length > 0) {
    return openListConfig.RootPaths.map(cleanPath);
  }

  // 如果只有 RootPath，返回单元素数组并清理
  if (openListConfig.RootPath) {
    return [cleanPath(openListConfig.RootPath)];
  }

  // 默认值
  return ['/'];
}

/**
 * 迁移旧版单根目录配置到多根目录
 */
async function migrateToMultiRoot(openListConfig: NonNullable<AdminConfig['OpenListConfig']>): Promise<void> {
  const oldRootPath = openListConfig.RootPath!;

  console.log('[OpenList Migration] 检测到旧版配置，开始迁移...');

  // 1. 读取现有 metainfo
  const metainfoContent = await db.getGlobalValue('video.metainfo');
  if (metainfoContent) {
    const metaInfo: MetaInfo = JSON.parse(metainfoContent);

    // 2. 迁移 folderName：加上原根路径前缀
    for (const [_key, info] of Object.entries(metaInfo.folders)) {
      const oldFolderName = info.folderName;
      const newFolderName = `${oldRootPath}${oldRootPath.endsWith('/') ? '' : '/'}${oldFolderName}`;
      info.folderName = newFolderName;

      console.log(`[Migration] ${oldFolderName} -> ${newFolderName}`);
    }

    // 3. 保存迁移后的 metainfo
    await db.setGlobalValue('video.metainfo', JSON.stringify(metaInfo));
    console.log('[OpenList Migration] MetaInfo 迁移完成');
  }

  // 4. 更新配置：RootPath -> RootPaths
  const config = await getConfig();
  config.OpenListConfig!.RootPaths = [oldRootPath];
  delete config.OpenListConfig!.RootPath;
  await db.saveAdminConfig(config);

  console.log('[OpenList Migration] 配置迁移完成');
}

/**
 * 启动 OpenList 刷新任务
 */
export async function startOpenListRefresh(clearMetaInfo = false): Promise<{ taskId: string }> {
  const config = await getConfig();
  const openListConfig = config.OpenListConfig;

  if (
    !openListConfig ||
    !openListConfig.Enabled ||
    !openListConfig.URL ||
    !openListConfig.Username ||
    !openListConfig.Password
  ) {
    throw new Error('OpenList 未配置或未启用');
  }

  const tmdbApiKey = config.SiteConfig.TMDBApiKey;
  const tmdbProxy = config.SiteConfig.TMDBProxy;
  const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

  if (!tmdbApiKey) {
    throw new Error('TMDB API Key 未配置');
  }

  // 检测是否需要迁移
  if (openListConfig.RootPath && !openListConfig.RootPaths) {
    await migrateToMultiRoot(openListConfig);
    // 重新加载配置
    const newConfig = await getConfig();
    Object.assign(openListConfig, newConfig.OpenListConfig);
  }

  cleanupOldTasks();
  const taskId = createScanTask();

  const rootPaths = getRootPaths(openListConfig);

  // 顺序扫描多个根目录
  performMultiRootScan(
    taskId,
    openListConfig.URL,
    rootPaths,
    tmdbApiKey,
    tmdbProxy,
    tmdbReverseProxy,
    openListConfig.Username,
    openListConfig.Password,
    clearMetaInfo,
    openListConfig.ScanMode || 'hybrid'
  ).catch((error) => {
    console.error('[OpenList Refresh] 后台扫描失败:', error);
    failScanTask(taskId, (error as Error).message);
  });

  return { taskId };
}

/**
 * 扫描多个根目录
 */
async function performMultiRootScan(
  taskId: string,
  url: string,
  rootPaths: string[],
  tmdbApiKey: string,
  tmdbProxy: string | undefined,
  tmdbReverseProxy: string | undefined,
  username: string,
  password: string,
  clearMetaInfo: boolean,
  scanMode: 'torrent' | 'name' | 'hybrid'
): Promise<void> {
  for (let i = 0; i < rootPaths.length; i++) {
    const rootPath = rootPaths[i];

    console.log(`[OpenList Refresh] 扫描根目录 (${i + 1}/${rootPaths.length}): ${rootPath}`);
    try {
      await performScan(
        taskId,
        url,
        rootPath,
        tmdbApiKey,
        tmdbProxy,
        tmdbReverseProxy,
        username,
        password,
        clearMetaInfo && i === 0, // 只在第一个根目录时清除
        scanMode
      );
    } catch (error) {
      console.error(`[OpenList Refresh] 根目录 ${rootPath} 扫描失败:`, error);
      // 继续扫描其他根目录
    }
  }
}

/**
 * 执行扫描任务
 */
async function performScan(
  taskId: string,
  url: string,
  rootPath: string,
  tmdbApiKey: string,
  tmdbProxy?: string,
  tmdbReverseProxy?: string,
  username?: string,
  password?: string,
  clearMetaInfo?: boolean,
  scanMode: 'torrent' | 'name' | 'hybrid' = 'hybrid'
): Promise<void> {
  const client = new OpenListClient(url, username!, password!);

  updateScanTaskProgress(taskId, 0, 0);

  try {
    let metaInfo: MetaInfo;

    if (clearMetaInfo) {
      metaInfo = {
        folders: {},
        last_refresh: Date.now(),
      };
    } else {
      try {
        const metainfoContent = await db.getGlobalValue('video.metainfo');
        if (metainfoContent) {
          metaInfo = JSON.parse(metainfoContent);
        } else {
          metaInfo = {
            folders: {},
            last_refresh: Date.now(),
          };
        }
      } catch (error) {
        console.error('[OpenList Refresh] 读取现有 metainfo 失败:', error);
        metaInfo = {
          folders: {},
          last_refresh: Date.now(),
        };
      }
    }

    invalidateMetaInfoCache();

    const folders: any[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let total = 0;

    while (true) {
      const listResponse = await client.listDirectory(rootPath, currentPage, pageSize, true);
	  console.log(listResponse);
      if (listResponse.code !== 200) {
        throw new Error('OpenList 列表获取失败5');
      }

      total = listResponse.data.total;
      const pageFolders = listResponse.data.content.filter((item) => item.is_dir);
      folders.push(...pageFolders);

      // 判断是否还有更多数据：当前页为 null 或数据量小于 pageSize 说明已经是最后一页
      if (!listResponse.data.content || listResponse.data.content.length < pageSize) {
        break;
      }

      currentPage++;
    }

    updateScanTaskProgress(taskId, 0, folders.length);

    let newCount = 0;
    let existingCount = 0;
    let errorCount = 0;

    const existingKeys = new Set<string>(Object.keys(metaInfo.folders));

    const folderNameToKey = new Map<string, string>();
    for (const [key, info] of Object.entries(metaInfo.folders)) {
      folderNameToKey.set(info.folderName, key);
    }

    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];

      updateScanTaskProgress(taskId, i + 1, folders.length, folder.name);

      // folderName 存储完整路径（包含根目录）
      const fullFolderPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folder.name}`;

      if (!clearMetaInfo && folderNameToKey.has(fullFolderPath)) {
        existingCount++;
        continue;
      }

      const folderKey = generateFolderKey(fullFolderPath, existingKeys);
      existingKeys.add(folderKey);

      try {
        let searchQuery: string;
        let seasonNumber: number | null = null;
        let year: number | null = null;
        let searchResult: any;

        if (scanMode === 'torrent' || scanMode === 'hybrid') {
          const torrentInfo = parseTorrentName(folder.name);
          searchQuery = torrentInfo.title || folder.name;
          seasonNumber = torrentInfo.season || null;
          year = torrentInfo.year || null;

          console.log(`[OpenList Refresh] 种子库模式 - 文件夹: ${folder.name}`);
          console.log(`[OpenList Refresh] 解析结果 - 标题: ${searchQuery}, 季度: ${seasonNumber}, 年份: ${year}`);

          searchResult = await searchTMDB(tmdbApiKey, searchQuery, tmdbProxy, year || undefined, tmdbReverseProxy);
        }

        if (scanMode === 'name' || (scanMode === 'hybrid' && (!searchResult || searchResult.code !== 200 || !searchResult.result))) {
          const seasonInfo = parseSeasonFromTitle(folder.name);
          searchQuery = seasonInfo.cleanTitle || folder.name;
          seasonNumber = seasonInfo.seasonNumber;
          year = seasonInfo.year;

          console.log(`[OpenList Refresh] 名字匹配模式 - 文件夹: ${folder.name}`);
          console.log(`[OpenList Refresh] 清理后标题: ${searchQuery}, 季度: ${seasonNumber}, 年份: ${year}`);

          searchResult = await searchTMDB(tmdbApiKey, searchQuery, tmdbProxy, year || undefined, tmdbReverseProxy);
        }

        if (searchResult.code === 200 && searchResult.result) {
          const result = searchResult.result;

          const folderInfo: any = {
            folderName: fullFolderPath,
            tmdb_id: result.id,
            title: result.title || result.name || folder.name,
            poster_path: result.poster_path,
            release_date: result.release_date || result.first_air_date || '',
            overview: result.overview,
            vote_average: result.vote_average,
            media_type: result.media_type,
            last_updated: Date.now(),
            failed: false,
          };

          if (result.media_type === 'tv' && seasonNumber) {
            try {
              const seasonDetails = await getTVSeasonDetails(
                tmdbApiKey,
                result.id,
                seasonNumber,
                tmdbProxy,
                tmdbReverseProxy
              );

              if (seasonDetails.code === 200 && seasonDetails.season) {
                folderInfo.season_number = seasonDetails.season.season_number;
                folderInfo.season_name = seasonDetails.season.name;

                if (seasonDetails.season.season_number > 1) {
                  folderInfo.title = `${folderInfo.title} ${seasonDetails.season.name}`;
                }

                if (seasonDetails.season.poster_path) {
                  folderInfo.poster_path = seasonDetails.season.poster_path;
                }
                if (seasonDetails.season.overview) {
                  folderInfo.overview = seasonDetails.season.overview;
                }
                if (seasonDetails.season.air_date) {
                  folderInfo.release_date = seasonDetails.season.air_date;
                }
              } else {
                console.warn(`[OpenList Refresh] 获取季度 ${seasonNumber} 详情失败`);
                folderInfo.season_number = seasonNumber;
              }
            } catch (error) {
              console.error(`[OpenList Refresh] 获取季度详情异常:`, error);
              folderInfo.season_number = seasonNumber;
            }
          }

          metaInfo.folders[folderKey] = folderInfo;
          newCount++;
        } else {
          metaInfo.folders[folderKey] = {
            folderName: fullFolderPath,
            tmdb_id: 0,
            title: folder.name,
            poster_path: null,
            release_date: '',
            overview: '',
            vote_average: 0,
            media_type: 'movie',
            last_updated: Date.now(),
            failed: true,
          };
          errorCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[OpenList Refresh] 处理文件夹失败: ${folder.name}`, error);
        metaInfo.folders[folderKey] = {
          folderName: fullFolderPath,
          tmdb_id: 0,
          title: folder.name,
          poster_path: null,
          release_date: '',
          overview: '',
          vote_average: 0,
          media_type: 'movie',
          last_updated: Date.now(),
          failed: true,
        };
        errorCount++;
      }
    }

    metaInfo.last_refresh = Date.now();

    const metainfoContent = JSON.stringify(metaInfo);
    await db.setGlobalValue('video.metainfo', metainfoContent);

    invalidateMetaInfoCache();
    setCachedMetaInfo(metaInfo);

    const config = await getConfig();
    config.OpenListConfig!.LastRefreshTime = Date.now();
    config.OpenListConfig!.ResourceCount = Object.keys(metaInfo.folders).length;
    await db.saveAdminConfig(config);

    completeScanTask(taskId, {
      total: folders.length,
      new: newCount,
      existing: existingCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error('[OpenList Refresh] 扫描失败:', error);
    failScanTask(taskId, (error as Error).message);
    throw error;
  }
}
