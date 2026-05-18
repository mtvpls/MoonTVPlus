/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedMetaInfo,
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/correct
 * 纠正视频的TMDB映射
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '无权限访问私人影库');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json();
    const {
      key,
      tmdbId,
      doubanId,
      title,
      posterPath,
      releaseDate,
      overview,
      voteAverage,
      mediaType,
      seasonNumber,
      seasonName,
    } = body;

    // 只验证 key 和 title 是必需的
    if (!key || !title) {
      return NextResponse.json(
        { error: '缺少必要参数 (key 或 title)' },
        { status: 400 }
      );
    }

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
        { error: 'OpenList 未配置或未启用' },
        { status: 400 }
      );
    }

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 读取现有 metainfo (从数据库或缓存)
    let metaInfo: MetaInfo | null = getCachedMetaInfo();

    if (!metaInfo) {
      try {
        console.log('[OpenList Correct] 尝试从数据库读取 metainfo');
        const metainfoJson = await db.getGlobalValue('video.metainfo');

        if (metainfoJson) {
          metaInfo = JSON.parse(metainfoJson);
        }
      } catch (error) {
        console.error('[OpenList Correct] 从数据库读取 metainfo 失败:', error);
        return NextResponse.json(
          { error: 'metainfo 读取失败' },
          { status: 500 }
        );
      }
    }

    if (!metaInfo) {
      return NextResponse.json(
        { error: 'metainfo.json 不存在' },
        { status: 404 }
      );
    }

    // 检查 key 是否存在
    if (!metaInfo.folders[key]) {
      return NextResponse.json(
        { error: '视频不存在' },
        { status: 404 }
      );
    }

    // 保留原始文件夹名称
    const folderName = metaInfo.folders[key].folderName;

    // 更新视频信息
    metaInfo.folders[key] = {
      folderName: folderName,
      tmdb_id: tmdbId || null,
      title: title,
      poster_path: posterPath,
      release_date: releaseDate || '',
      overview: overview || '',
      vote_average: voteAverage || 0,
      media_type: mediaType,
      last_updated: Date.now(),
      failed: false, // 纠错后标记为成功
      season_number: seasonNumber, // 季度编号(可选)
      season_name: seasonName, // 季度名称(可选)
    };

    // 保存 metainfo 到数据库
    const metainfoContent = JSON.stringify(metaInfo);

    await db.setGlobalValue('video.metainfo', metainfoContent);

    // 更新缓存
    invalidateMetaInfoCache();
    setCachedMetaInfo(metaInfo);

    return NextResponse.json({
      success: true,
      message: '纠错成功',
    });
  } catch (error) {
    console.error('视频纠错失败:', error);
    return NextResponse.json(
      { error: '纠错失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
