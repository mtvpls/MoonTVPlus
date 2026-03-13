import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import {
  getTMDBImageUrl,
  getTMDBMovieDetails,
  getTMDBTVDetails,
  searchTMDBMulti,
} from '@/lib/tmdb.client';

// 服务器端缓存（内存）
const searchCache = new Map<
  string,
  { data: { tmdbId: number; mediaType: 'movie' | 'tv' }; timestamp: number }
>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 1天

// 移除季度信息的辅助函数
function removeSeasonInfo(title: string): string {
  return title
    .replace(/第[一二三四五六七八九十\d]+[（(]\d+[）)][季部]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[季部]/g, '')
    .replace(/[（(]\d+[）)]/g, '')
    .replace(/\s+season\s+\d+/gi, '')
    .replace(/\s+S\d+/gi, '')
    .trim();
}

// 精确匹配标题
function findExactMatch(results: any[], originalTitle: string): any | null {
  if (!results || results.length === 0) return null;
  if (results.length === 1) return results[0];

  const cleanTitle = originalTitle.toLowerCase().trim();

  // 尝试精确匹配
  for (const result of results) {
    const resultTitle = (result.title || result.name || '')
      .toLowerCase()
      .trim();
    if (resultTitle === cleanTitle) {
      return result;
    }
  }

  // 如果没有精确匹配，返回第一个
  return results[0];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const title = searchParams.get('title');
    const cachedId = searchParams.get('cachedId');

    if (!title && !cachedId) {
      return NextResponse.json(
        { error: '缺少 title 或 cachedId 参数' },
        { status: 400 },
      );
    }

    // 获取配置
    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: '未配置 TMDB API Key' },
        { status: 500 },
      );
    }

    let tmdbId: number;
    let mediaType: 'movie' | 'tv';

    // 如果提供了cachedId，直接使用
    if (cachedId) {
      const [type, id] = cachedId.split(':');
      mediaType = type as 'movie' | 'tv';
      tmdbId = parseInt(id, 10);
    } else {
      // 否则需要搜索获取ID
      const cleanedTitle = removeSeasonInfo(title!);
      const cacheKey = `search_${cleanedTitle}`;

      // 检查服务器缓存
      const cached = searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('使用服务器缓存的搜索结果');
        tmdbId = cached.data.tmdbId;
        mediaType = cached.data.mediaType;
      } else {
        // 搜索TMDB
        console.log('搜索TMDB:', cleanedTitle);
        const searchResult = await searchTMDBMulti(
          tmdbApiKey,
          cleanedTitle,
          tmdbProxy,
          tmdbReverseProxy,
        );

        if (searchResult.code !== 200 || !searchResult.results.length) {
          return NextResponse.json(
            { error: '未找到匹配的内容' },
            { status: 404 },
          );
        }

        // 精确匹配
        const match = findExactMatch(searchResult.results, cleanedTitle);
        if (!match) {
          return NextResponse.json(
            { error: '未找到匹配的内容' },
            { status: 404 },
          );
        }

        tmdbId = match.id;
        mediaType = match.media_type;

        // 保存到服务器缓存
        searchCache.set(cacheKey, {
          data: { tmdbId, mediaType },
          timestamp: Date.now(),
        });

        // 清理过期缓存
        Array.from(searchCache.entries()).forEach(([key, value]) => {
          if (Date.now() - value.timestamp > CACHE_TTL) {
            searchCache.delete(key);
          }
        });
      }
    }

    // 获取详情
    let detailsResult;
    if (mediaType === 'movie') {
      detailsResult = await getTMDBMovieDetails(
        tmdbApiKey,
        tmdbId,
        tmdbProxy,
        tmdbReverseProxy,
      );
    } else {
      detailsResult = await getTMDBTVDetails(
        tmdbApiKey,
        tmdbId,
        tmdbProxy,
        tmdbReverseProxy,
      );
    }

    if (detailsResult.code !== 200 || !detailsResult.details) {
      return NextResponse.json(
        { error: '获取详情失败' },
        { status: detailsResult.code },
      );
    }

    const details = detailsResult.details;

    // 构建返回数据
    const responseData = {
      tmdbId: `${mediaType}:${tmdbId}`, // 用于缓存
      mediaType,
      title: details.title || details.name,
      backdrop: details.backdrop_path
        ? getTMDBImageUrl(details.backdrop_path, 'w1280')
        : null,
      poster: details.poster_path
        ? getTMDBImageUrl(details.poster_path, 'w500')
        : null,
      overview: details.overview || '',
      rating: details.vote_average ? details.vote_average.toFixed(1) : '',
      releaseDate: details.release_date || details.first_air_date || '',
      genres: details.genres || [], // 添加类型标签
    };

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=86400', // 浏览器缓存1天
      },
    });
  } catch (error) {
    console.error('获取 TMDB 详情失败:', error);
    return NextResponse.json({ error: '获取详情失败' }, { status: 500 });
  }
}
