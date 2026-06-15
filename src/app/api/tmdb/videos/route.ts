/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getTMDBVideoList, searchTMDBMulti } from '@/lib/tmdb.client';

export const runtime = 'nodejs';

function normalizeType(type: string | null): 'movie' | 'tv' | null {
  if (type === 'movie' || type === 'tv') return type;
  return null;
}

/**
 * GET /api/tmdb/videos?id=xxx&type=movie|tv
 * GET /api/tmdb/videos?title=xxx&type=movie|tv&year=2026
 * 获取 TMDB YouTube 视频列表，用于选择预告片
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    const title = searchParams.get('title') || '';
    const typeParam = normalizeType(searchParams.get('type')) || 'movie';
    const year = searchParams.get('year') || '';

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    let mediaId = idParam ? parseInt(idParam, 10) : 0;
    let mediaType: 'movie' | 'tv' = typeParam;

    if (!mediaId) {
      if (!title.trim()) {
        return NextResponse.json({ error: '缺少 id 或 title 参数' }, { status: 400 });
      }

      const searchResponse = await searchTMDBMulti(
        tmdbApiKey,
        title.trim(),
        tmdbProxy,
        tmdbReverseProxy
      );

      if (searchResponse.code !== 200) {
        return NextResponse.json(
          { error: 'TMDB 搜索失败', code: searchResponse.code },
          { status: searchResponse.code }
        );
      }

      const validResults = (searchResponse.results || []).filter(
        (item: any) => item.media_type === 'movie' || item.media_type === 'tv'
      );
      const matched =
        validResults.find((item: any) => {
          if (item.media_type !== mediaType) return false;
          if (!year) return true;
          const date = item.release_date || item.first_air_date || '';
          return date.startsWith(year);
        }) ||
        validResults.find((item: any) => item.media_type === mediaType) ||
        validResults[0];

      if (!matched?.id) {
        return NextResponse.json({ error: '未找到 TMDB 条目' }, { status: 404 });
      }

      mediaId = matched.id;
      mediaType = matched.media_type;
    }

    const response = await getTMDBVideoList(
      tmdbApiKey,
      mediaType,
      mediaId,
      tmdbProxy,
      tmdbReverseProxy
    );

    if (response.code !== 200) {
      return NextResponse.json(
        { error: 'TMDB 视频获取失败', code: response.code },
        { status: response.code }
      );
    }

    return NextResponse.json({
      success: true,
      mediaId,
      mediaType,
      videos: response.videos,
    });
  } catch (error) {
    console.error('TMDB视频获取失败:', error);
    return NextResponse.json(
      { error: '获取预告片失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
