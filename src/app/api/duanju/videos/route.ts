/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { API_CONFIG, getCacheTime } from '@/lib/config';
import { getDuanjuSources } from '@/lib/duanju';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

export const runtime = 'nodejs';

interface CmsVideoItem {
  vod_id: string | number;
  vod_name: string;
  vod_pic?: string;
  vod_remarks?: string;
  vod_year?: string;
  vod_play_from?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

interface CmsVideoResponse {
  list?: CmsVideoItem[];
  total?: number;
  page?: number;
  pagecount?: number;
}

function parseEpisodes(item: CmsVideoItem) {
  const episodes: string[] = [];
  const episodesTitles: string[] = [];

  if (!item.vod_play_url) {
    return { episodes, episodesTitles };
  }

  const playSources = item.vod_play_url.split('$$$');
  playSources.forEach((sourceUrl) => {
    sourceUrl.split('#').forEach((episodeStr) => {
      const [name, url] = episodeStr.split('$');
      if (name && url) {
        episodes.push(url.trim());
        episodesTitles.push(name.trim());
      }
    });
  });

  return { episodes, episodesTitles };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sourceKey = searchParams.get('source');
  const categoryId = searchParams.get('categoryId');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  if (!sourceKey) {
    return NextResponse.json(
      { code: 400, message: '缺少参数: source', data: [] },
      { status: 400 }
    );
  }

  if (!categoryId) {
    return NextResponse.json(
      { code: 400, message: '缺少参数: categoryId', data: [] },
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

    const response = await fetch(
      `${targetSource.api}?ac=videolist&t=${encodeURIComponent(categoryId)}&pg=${page}`,
      {
        headers: API_CONFIG.search.headers,
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error('获取短剧列表失败');
    }

    const videoData: CmsVideoResponse = await response.json();

    const results: SearchResult[] = (videoData.list || []).map((item) => {
      const { episodes, episodesTitles } = parseEpisodes(item);

      return {
        id: item.vod_id.toString(),
        title: (item.vod_name || '').trim().replace(/\s+/g, ' '),
        poster: item.vod_pic || '',
        year: item.vod_year ? item.vod_year.match(/\d{4}/)?.[0] || item.vod_year : 'unknown',
        episodes,
        episodes_titles: episodesTitles,
        source: targetSource.key,
        source_name: targetSource.name,
        class: item.vod_class,
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
        vod_remarks: item.vod_remarks,
      };
    });

    const cacheTime = await getCacheTime();
    return NextResponse.json(
      {
        code: 200,
        message: '获取成功',
        data: results,
        total: videoData.total || 0,
        page: videoData.page || page,
        pageCount: videoData.pagecount || (results.length > 0 ? page + 1 : page),
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    console.error('获取短剧列表失败:', error);
    return NextResponse.json(
      {
        code: 500,
        message: '获取短剧列表失败',
        data: [],
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
