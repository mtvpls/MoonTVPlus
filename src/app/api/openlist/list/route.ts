/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { db } from '@/lib/db';
import {
  getCachedMetaInfo,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import {
  listPathMetaCategories,
  resolvePathMetaForSource,
} from '@/lib/openlist-path-meta';
import { resolveSourcePath } from '@/lib/openlist-sources';
import { getTMDBImageUrl } from '@/lib/tmdb.search';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/list?page=1&pageSize=20&includeFailed=false&noCache=false&category=
 * 获取私人影库视频列表
 * category: 分类名；__none__ 表示未分类
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '无权限访问私人影库');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const includeFailed = searchParams.get('includeFailed') === 'true';
    const noCache = searchParams.get('noCache') === 'true';
    const categoryFilter = (searchParams.get('category') || '').trim();

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json(
        { error: 'OpenList 未配置或未启用', list: [], total: 0, categories: [] },
        { status: 200 }
      );
    }

    const pathMeta = openListConfig.PathMeta;
    const categories = listPathMetaCategories(pathMeta);

    // 读取 metainfo (从数据库或缓存)
    let metaInfo: MetaInfo | null = null;

    // 如果不使用缓存，直接从数据库读取
    if (noCache) {
      // noCache 模式：跳过缓存
    } else {
      metaInfo = getCachedMetaInfo();
    }

    if (!metaInfo) {
      try {
        const metainfoJson = await db.getGlobalValue('video.metainfo');

        if (metainfoJson) {
          try {
            metaInfo = JSON.parse(metainfoJson);

            // 验证数据结构
            if (!metaInfo || typeof metaInfo !== 'object') {
              throw new Error('metaInfo 不是有效对象');
            }
            if (!metaInfo.folders || typeof metaInfo.folders !== 'object') {
              throw new Error('metaInfo.folders 不存在或不是对象');
            }

            // 只有在不是 noCache 模式时才更新缓存
            if (!noCache) {
              setCachedMetaInfo(metaInfo);
            }
          } catch (parseError) {
            console.error('[OpenList List] JSON 解析或验证失败:', parseError);
            throw new Error(`JSON 解析失败: ${(parseError as Error).message}`);
          }
        } else {
          throw new Error('数据库中没有 metainfo 数据');
        }
      } catch (error) {
        console.error('[OpenList List] 从数据库读取 metainfo 失败:', error);
        return NextResponse.json(
          {
            error: 'metainfo 读取失败',
            details: (error as Error).message,
            list: [],
            total: 0,
            categories,
          },
          { status: 200 }
        );
      }
    }

    if (!metaInfo) {
      return NextResponse.json(
        { error: '无数据', list: [], total: 0, categories },
        { status: 200 }
      );
    }

    // 验证 metaInfo 结构
    if (!metaInfo.folders || typeof metaInfo.folders !== 'object') {
      return NextResponse.json(
        { error: 'metainfo.json 结构无效', list: [], total: 0, categories },
        { status: 200 }
      );
    }

    // 转换为数组并分页
    let allVideos = Object.entries(metaInfo.folders)
      .filter(([, info]) => includeFailed || !info.failed)
      .map(([key, info]) => {
        // 解析 folderName 的「源名@」前缀，PathMeta 按「真实路径 + 源」匹配
        const resolvedPath = resolveSourcePath(config, info.folderName);
        const pathMetaResolved = resolvePathMetaForSource(
          resolvedPath?.source.name,
          resolvedPath?.path || info.folderName,
          pathMeta
        );
        return {
          id: key,
          folder: info.folderName,
          tmdbId: info.tmdb_id,
          title: info.title,
          poster: getTMDBImageUrl(info.poster_path),
          releaseDate: info.release_date,
          overview: info.overview,
          voteAverage: info.vote_average,
          mediaType: info.media_type,
          lastUpdated: info.last_updated,
          failed: info.failed || false,
          seasonNumber: info.season_number,
          seasonName: info.season_name,
          category: pathMetaResolved.category,
          refresh14m: pathMetaResolved.refresh14m,
        };
      });

    // 分类筛选（完全匹配 PathMeta 后的 category）
    if (categoryFilter) {
      if (categoryFilter === '__none__') {
        allVideos = allVideos.filter((v) => !v.category);
      } else {
        allVideos = allVideos.filter((v) => v.category === categoryFilter);
      }
    }

    // 按更新时间倒序排序
    allVideos.sort((a, b) => b.lastUpdated - a.lastUpdated);

    const total = allVideos.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const list = allVideos.slice(start, end);

    return NextResponse.json({
      success: true,
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      categories,
    });
  } catch (error) {
    console.error('获取视频列表失败:', error);
    return NextResponse.json(
      {
        error: '获取失败',
        details: (error as Error).message,
        list: [],
        total: 0,
        categories: [],
      },
      { status: 500 }
    );
  }
}
