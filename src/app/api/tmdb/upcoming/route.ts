import { NextRequest, NextResponse } from 'next/server';
import { getTMDBUpcomingContent } from '@/lib/tmdb.client';
import { getConfig } from '@/lib/config';

// 内存缓存对象
interface CacheItem {
  data: any;
  timestamp: number;
}

let cache: CacheItem | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1小时（毫秒）

export async function GET(request: NextRequest) {
  try {
    // 检查缓存是否存在且未过期
    const now = Date.now();
    if (cache && now - cache.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        code: 200,
        data: cache.data,
        cached: true,
        cacheAge: Math.floor((now - cache.timestamp) / 1000), // 缓存年龄（秒）
      });
    }

    // 缓存不存在或已过期，获取新数据
    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig?.TMDBApiKey;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { code: 400, message: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    // 调用TMDB API获取数据
    const result = await getTMDBUpcomingContent(tmdbApiKey);

    if (result.code !== 200) {
      return NextResponse.json(
        { code: result.code, message: '获取TMDB数据失败' },
        { status: result.code === 401 ? 401 : 500 }
      );
    }

    // 更新缓存
    cache = {
      data: result.list,
      timestamp: now,
    };

    return NextResponse.json({
      code: 200,
      data: result.list,
      cached: false,
    });
  } catch (error) {
    console.error('获取TMDB即将上映数据失败:', error);
    return NextResponse.json(
      { code: 500, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
