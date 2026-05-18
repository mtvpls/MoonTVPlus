/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { API_CONFIG, getCacheTime, getConfig } from '@/lib/config';
import { getDuanjuSources, isDuanjuTypeName } from '@/lib/duanju';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sourceKey = searchParams.get('source');

  if (!sourceKey) {
    return NextResponse.json(
      { code: 400, message: '缺少参数: source', data: [] },
      { status: 400 }
    );
  }

  try {
    const sources = await getDuanjuSources();
    const targetSource = sources.find((source) => source.key === sourceKey);

    if (!targetSource) {
      return NextResponse.json(
        { code: 404, message: `未找到短剧采集源: ${sourceKey}`, data: [] },
        { status: 404 }
      );
    }

    const response = await fetch(`${targetSource.api}?ac=list`, {
      headers: API_CONFIG.search.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error('获取分类列表失败');
    }

    const data: CmsClassResponse = await response.json();
    const config = await getConfig();

    const categories = (data.class || [])
      .filter((item) => {
        const typeName = item.type_name || '';
        if (!isDuanjuTypeName(typeName)) return false;
        if (!config.SiteConfig.DisableYellowFilter) {
          return !yellowWords.some((word: string) => typeName.includes(word));
        }
        return true;
      })
      .map((item) => ({
        id: item.type_id.toString(),
        name: item.type_name,
      }));

    const defaultCategory = categories[0] || null;

    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { code: 200, message: '获取成功', data: categories, defaultCategory },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    console.error('获取短剧分类失败:', error);
    return NextResponse.json(
      {
        code: 500,
        message: '获取短剧分类失败',
        data: [],
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
