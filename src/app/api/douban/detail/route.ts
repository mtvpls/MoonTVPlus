import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';

interface DoubanDetailApiResponse {
  id: string;
  title: string;
  original_title?: string;
  year: string;
  type: 'movie' | 'tv';
  subtype?: string;
  is_tv?: boolean;
  pic?: {
    large: string;
    normal: string;
  };
  rating?: {
    value: number;
    count: number;
    star_count: number;
  };
  card_subtitle?: string;
  intro?: string;
  genres?: string[];
  directors?: Array<{ name: string; id?: string }>;
  actors?: Array<{ name: string; id?: string }>;
  countries?: string[];
  languages?: string[];
  pubdate?: string[];
  durations?: string[];
  aka?: string[];
  episodes_count?: number;
  episodes_info?: string;
  cover_url?: string;
  url?: string;
  [key: string]: any; // 允许其他字段
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const id = searchParams.get('id');

  // 验证参数
  if (!id) {
    return NextResponse.json({ error: '缺少必要参数: id' }, { status: 400 });
  }

  const target = `https://m.douban.com/rexxar/api/v2/subject/${id}`;

  try {
    // 调用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanDetailApiResponse>(target);

    const cacheTime = await getCacheTime();
    return NextResponse.json(doubanData, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣详情失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
