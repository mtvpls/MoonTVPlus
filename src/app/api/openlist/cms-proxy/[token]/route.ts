/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import type { MetaInfo } from '@/lib/openlist-cache';
import {
  listPathMetaCategories,
  resolvePathMetaForSource,
} from '@/lib/openlist-path-meta';
import {
  createClientForSource,
  resolveFolderSource,
} from '@/lib/openlist-sources';
import { hasFeaturePermission } from '@/lib/permissions';
import {
  getTVBoxCMSBaseUrl,
  getTVBoxCMSImageUrl,
  getTVBoxCMSPage,
  TVBOX_CMS_PAGE_SIZE,
} from '@/lib/tvbox-cms';

export const runtime = 'nodejs';

/**
 * OpenList CMS 代理接口（动态路由）
 * 将 OpenList 私人影库转换为 TVBox 兼容的 CMS API 格式
 * 路径格式：/api/openlist/cms-proxy/{token}?ac=videolist&...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const { searchParams } = new URL(request.url);
  const ac = searchParams.get('ac');
  const wd = searchParams.get('wd'); // 搜索关键词
  const ids = searchParams.get('ids'); // 视频ID（即文件夹key）

  // 检查必要参数
  if (ac && ac !== 'videolist' && ac !== 'list' && ac !== 'detail') {
    return NextResponse.json(
      { code: 400, msg: '不支持的操作' },
      { status: 400 }
    );
  }

  // 验证 TVBox Token（从路径中获取）
  const requestToken = params.token;
  const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;

  // 检查是否是全局token或用户token
  let isValidToken = false;
  if (globalToken && requestToken === globalToken) {
    // 全局token
    isValidToken = true;
  } else {
    // 检查是否是用户token
    const { db } = await import('@/lib/db');
    const username = await db.getUsernameByTvboxToken(requestToken);
    if (username) {
      // 检查用户是否被封禁
      const userInfo = await db.getUserInfoV2(username);
      const allowed = await hasFeaturePermission(username, 'private_library');
      if (userInfo && !userInfo.banned && allowed) {
        isValidToken = true;
      }
    }
  }

  if (!isValidToken) {
    return NextResponse.json(
      {
        code: 401,
        msg: '无效的访问token',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      },
      { status: 401 }
    );
  }

  try {
    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    // 验证 OpenList 配置
    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({
        code: 0,
        msg: 'OpenList 未配置或未启用',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      });
    }

    // 读取元数据
    const { getCachedMetaInfo, setCachedMetaInfo } = await import(
      '@/lib/openlist-cache'
    );
    const { db } = await import('@/lib/db');

    let metaInfo = getCachedMetaInfo();

    if (!metaInfo) {
      try {
        const metainfoJson = await db.getGlobalValue('video.metainfo');
        if (metainfoJson) {
          metaInfo = JSON.parse(metainfoJson);
          if (metaInfo) {
            setCachedMetaInfo(metaInfo);
          }
        }
      } catch (error) {
        console.error(
          '[OpenList CMS Proxy] 从数据库读取 metainfo 失败:',
          error
        );
      }
    }

    if (!metaInfo || !metaInfo.folders) {
      return NextResponse.json({
        code: 0,
        msg: '未找到元数据',
        class: listPathMetaCategories(openListConfig.PathMeta).map(
          (category) => ({ type_id: category, type_name: category })
        ),
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      });
    }

    if (ids) {
      return await handleDetail(metaInfo, ids, config, requestToken, request);
    }
    // 首页、分类和搜索都返回列表，只有携带 ids 才读取播放详情。
    return await handleSearch(metaInfo, wd || '', config, request);
  } catch (error) {
    console.error('[OpenList CMS Proxy] 错误:', error);
    return NextResponse.json(
      {
        code: 500,
        msg: (error as Error).message,
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      },
      { status: 500 }
    );
  }
}

/**
 * 处理搜索请求
 */
function getFolderCategory(config: AdminConfig, folderName: string): string {
  const resolved = resolveFolderSource(config, folderName);
  return resolvePathMetaForSource(
    resolved?.source.name,
    resolved?.path || folderName,
    config.OpenListConfig?.PathMeta
  ).category;
}

async function handleSearch(
  metaInfo: MetaInfo,
  query: string,
  config: AdminConfig,
  request: NextRequest
) {
  const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
  const page = getTVBoxCMSPage(request.nextUrl.searchParams);
  const category = request.nextUrl.searchParams.get('t') || '';
  const lowerQuery = query.toLowerCase();
  const videos = Object.entries(metaInfo.folders)
    .filter(([, info]) => !info.failed)
    .map(([folderKey, info]) => ({
      folderKey,
      info,
      category: getFolderCategory(config, info.folderName),
    }));
  const categories = listPathMetaCategories(
    config.OpenListConfig?.PathMeta
  ).map((name) => ({ type_id: name, type_name: name }));
  if (videos.some((video) => !video.category)) {
    categories.push({ type_id: '__none__', type_name: '未分类' });
  }
  const matched = videos
    .filter(({ folderKey, info, category: folderCategory }) => {
      if (category === '__none__' && folderCategory) return false;
      if (category && category !== '__none__' && folderCategory !== category)
        return false;
      if (!query) return true; // 空查询返回所有
      const matchFolder = folderKey.toLowerCase().includes(lowerQuery);
      const matchTitle = info.title.toLowerCase().includes(lowerQuery);
      return matchFolder || matchTitle;
    })
    .sort((a, b) => b.info.last_updated - a.info.last_updated);
  const results = matched
    .slice((page - 1) * TVBOX_CMS_PAGE_SIZE, page * TVBOX_CMS_PAGE_SIZE)
    .map(({ folderKey, info, category: folderCategory }) => ({
      vod_id: folderKey,
      vod_name: info.title,
      vod_pic: getTVBoxCMSImageUrl(getTMDBImageUrl(info.poster_path), request),
      vod_remarks: info.media_type === 'movie' ? '电影' : '剧集',
      vod_year: info.release_date ? info.release_date.split('-')[0] : '',
      vod_content: info.overview || '',
      type_name: folderCategory || '未分类',
      type_id: folderCategory || '__none__',
      vod_douban_id: 0,
      vod_class: folderCategory,
      // 不在搜索结果中返回 vod_play_url，TVBox 会调用详情接口获取
    }));

  return NextResponse.json({
    code: 1,
    msg: '数据列表',
    class: categories,
    page,
    pagecount: Math.ceil(matched.length / TVBOX_CMS_PAGE_SIZE),
    limit: TVBOX_CMS_PAGE_SIZE,
    total: matched.length,
    list: results,
  });
}

/**
 * 处理详情请求
 */
async function handleDetail(
  metaInfo: any,
  folderKey: string,
  config: any,
  token: string,
  request: NextRequest
) {
  const { getTMDBImageUrl } = await import('@/lib/tmdb.search');

  // 查找文件夹信息
  const folderMeta = metaInfo.folders?.[folderKey];
  if (!folderMeta) {
    return NextResponse.json({
      code: 0,
      msg: '未找到该视频',
      page: 1,
      pagecount: 0,
      limit: 0,
      total: 0,
      list: [],
    });
  }

  // 获取文件夹名称和路径（folderName 可能带「源名@」前缀，需解析出源与真实路径）
  const folderName = folderMeta.folderName;
  const folderCategory = getFolderCategory(config, folderName);
  const resolved = resolveFolderSource(config, folderName);
  if (!resolved) {
    return NextResponse.json({
      code: 0,
      msg: 'OpenList 未配置',
      page: 1,
      pagecount: 0,
      limit: 0,
      total: 0,
      list: [],
    });
  }
  const { source } = resolved;
  const folderPath = resolved.path;

  // 调用 OpenList 客户端获取视频文件列表
  const { getCachedVideoInfo, setCachedVideoInfo } = await import(
    '@/lib/openlist-cache'
  );
  const { formatEpisodeDisplayTitle, parseVideoFileName } = await import(
    '@/lib/video-parser'
  );

  const client = createClientForSource(source);

  // 缓存键用带源前缀的完整路径（与 detail 路由保持一致）
  const cacheKey = folderName;
  let videoInfo = getCachedVideoInfo(cacheKey);

  // 获取所有分页的视频文件
  const allFiles: any[] = [];
  let currentPage = 1;
  const pageSize = 100;
  let total = 0;

  while (currentPage === 1 || allFiles.length < total) {
    const listResponse = await client.listDirectory(
      folderPath,
      currentPage,
      pageSize
    );

    if (listResponse.code !== 200) {
      return NextResponse.json({
        code: 0,
        msg: 'OpenList 列表获取失败2',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      });
    }

    total = listResponse.data.total;
    allFiles.push(...listResponse.data.content);

    if (allFiles.length >= total) {
      break;
    }

    currentPage++;
  }

  const videoExtensions = [
    '.mp4',
    '.mkv',
    '.avi',
    '.m3u8',
    '.flv',
    '.ts',
    '.mov',
    '.wmv',
    '.webm',
    '.rmvb',
    '.rm',
    '.mpg',
    '.mpeg',
    '.3gp',
    '.f4v',
    '.m4v',
    '.vob',
  ];
  const videoFiles = allFiles.filter((item) => {
    if (item.is_dir || item.name.startsWith('.') || item.name.endsWith('.json'))
      return false;
    return videoExtensions.some((ext) => item.name.toLowerCase().endsWith(ext));
  });

  if (!videoInfo) {
    videoInfo = { episodes: {}, last_updated: Date.now() };
    videoFiles.sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      const parsed = parseVideoFileName(file.name);
      videoInfo.episodes[file.name] = {
        episode: parsed.episode || i + 1,
        season: parsed.season,
        title: parsed.title,
        parsed_from: 'filename',
        isOVA: parsed.isOVA,
      };
    }
    setCachedVideoInfo(cacheKey, videoInfo);
  }

  // 构建播放链接
  // 获取当前请求的 baseUrl
  const baseUrl = getTVBoxCMSBaseUrl(request);

  const parsedSeasons = new Set(
    videoFiles
      .map((file) => parseVideoFileName(file.name).season)
      .filter((season): season is number => typeof season === 'number')
  );
  const hasMultipleSeasons = parsedSeasons.size > 1;

  const resolvedVideoInfo = videoInfo;
  const episodes = videoFiles
    .map((file, index) => {
      const parsed = parseVideoFileName(file.name);
      let episodeInfo;
      if (parsed.episode) {
        episodeInfo = {
          episode: parsed.episode,
          season: parsed.season,
          title: parsed.title,
          parsed_from: 'filename',
          isOVA: parsed.isOVA,
        };
      } else {
        episodeInfo = resolvedVideoInfo.episodes[file.name] || {
          episode: index + 1,
          season: undefined,
          title: undefined,
          parsed_from: 'filename',
        };
      }
      let displayTitle = formatEpisodeDisplayTitle(
        {
          episode: episodeInfo.episode,
          season: episodeInfo.season,
          isOVA: episodeInfo.isOVA,
        },
        hasMultipleSeasons
      );
      if (!displayTitle) {
        displayTitle = episodeInfo.title;
      }
      if (!displayTitle) {
        displayTitle = file.name;
      }

      // 生成播放链接，将 token 放在路径中
      const playUrl = `${baseUrl}/api/openlist/play/${encodeURIComponent(
        token
      )}?folder=${encodeURIComponent(folderName)}&fileName=${encodeURIComponent(
        file.name
      )}`;

      return {
        fileName: file.name,
        episode: episodeInfo.episode || 0,
        season: episodeInfo.season,
        title: displayTitle,
        playUrl,
        isOVA: episodeInfo.isOVA,
      };
    })
    .sort((a, b) => {
      // OVA 排在最后
      if (a.isOVA && !b.isOVA) return 1;
      if (!a.isOVA && b.isOVA) return -1;
      // 都是 OVA 或都不是 OVA，按集数排序
      return a.episode !== b.episode
        ? a.episode - b.episode
        : a.fileName.localeCompare(b.fileName);
    });

  // 转换为 CMS vod_play_url 格式
  // 格式：第1集$url1#第2集$url2#第3集$url3
  const vodPlayUrl = episodes
    .map((ep) => `${ep.title}$${ep.playUrl}`)
    .join('#');

  return NextResponse.json({
    code: 1,
    msg: '数据列表',
    page: 1,
    pagecount: 1,
    limit: 1,
    total: 1,
    list: [
      {
        vod_id: folderKey,
        vod_name: folderMeta.title,
        vod_pic: getTVBoxCMSImageUrl(
          getTMDBImageUrl(folderMeta.poster_path),
          request
        ),
        vod_remarks: folderMeta.media_type === 'movie' ? '电影' : '剧集',
        vod_year: folderMeta.release_date
          ? folderMeta.release_date.split('-')[0]
          : '',
        vod_content: folderMeta.overview || '',
        type_name: folderCategory || '未分类',
        type_id: folderCategory || '__none__',
        vod_douban_id: 0,
        vod_class: folderCategory,
        vod_play_url: vodPlayUrl,
        vod_play_from: '私人影库',
      },
    ],
  });
}
