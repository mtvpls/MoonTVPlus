/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextResponse } from 'next/server';

import { API_CONFIG, getCacheTime } from '@/lib/config';
import { getDuanjuSources } from '@/lib/duanju';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

export const runtime = 'nodejs';

// 服务端内存缓存
let cachedRecommends: {
  timestamp: number;
  data: SearchResult[];
} | null = null;

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

/**
 * 获取热播短剧推荐视频
 */
export async function GET() {
  try {
    // 检查内存缓存
    const now = Date.now();
    const CACHE_DURATION = 60 * 60 * 1000; // 1小时

    if (cachedRecommends && now - cachedRecommends.timestamp < CACHE_DURATION) {
      console.log('使用缓存的短剧推荐数据');
      const cacheTime = await getCacheTime();
      return NextResponse.json(
        {
          code: 200,
          message: '获取成功',
          data: cachedRecommends.data,
        },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          },
        },
      );
    }

    // 获取短剧视频源列表
    const sources = await getDuanjuSources();

    if (!sources || sources.length === 0) {
      return NextResponse.json({
        code: 200,
        message: '暂无短剧视频源',
        data: [],
      });
    }

    // 取第一个视频源
    const firstSource = sources[0];
    console.log(`使用视频源: ${firstSource.name}`);

    // 获取该视频源的分类列表，找到短剧分类的ID
    const classUrl = `${firstSource.api}?ac=list`;
    const classResponse = await fetch(classUrl, {
      headers: API_CONFIG.search.headers,
    });

    if (!classResponse.ok) {
      throw new Error('获取分类列表失败');
    }

    const classData: CmsClassResponse = await classResponse.json();

    // 找到短剧分类的ID
    let duanjuTypeId: string | number | null = null;
    if (classData.class && Array.isArray(classData.class)) {
      const duanjuClass = classData.class.find((item) => {
        const typeName = item.type_name?.toLowerCase() || '';
        return (
          typeName.includes('短剧') ||
          typeName.includes('短视频') ||
          typeName.includes('微短剧')
        );
      });

      if (duanjuClass) {
        duanjuTypeId = duanjuClass.type_id;
      }
    }

    if (!duanjuTypeId) {
      return NextResponse.json({
        code: 200,
        message: '未找到短剧分类',
        data: [],
      });
    }

    console.log(`短剧分类ID: ${duanjuTypeId}`);

    // 请求该分类下的视频列表
    const videoListUrl = `${firstSource.api}?ac=videolist&t=${duanjuTypeId}&pg=1`;
    const videoListResponse = await fetch(videoListUrl, {
      headers: API_CONFIG.search.headers,
    });

    if (!videoListResponse.ok) {
      throw new Error('获取视频列表失败');
    }

    const videoListData = await videoListResponse.json();

    if (
      !videoListData ||
      !videoListData.list ||
      !Array.isArray(videoListData.list) ||
      videoListData.list.length === 0
    ) {
      return NextResponse.json({
        code: 200,
        message: '暂无短剧视频',
        data: [],
      });
    }

    // 处理视频数据
    const videos: SearchResult[] = videoListData.list.map(
      (item: ApiSearchItem) => {
        let episodes: string[] = [];
        let titles: string[] = [];

        // 使用正则表达式从 vod_play_url 提取 m3u8 链接
        if (item.vod_play_url) {
          // 先用 $$$ 分割
          const vod_play_url_array = item.vod_play_url.split('$$$');
          // 分集之间#分割，标题和播放链接 $ 分割
          vod_play_url_array.forEach((url: string) => {
            const matchEpisodes: string[] = [];
            const matchTitles: string[] = [];
            const title_url_array = url.split('#');
            title_url_array.forEach((title_url: string) => {
              const episode_title_url = title_url.split('$');
              if (
                episode_title_url.length === 2 &&
                episode_title_url[1].endsWith('.m3u8')
              ) {
                matchTitles.push(episode_title_url[0]);
                matchEpisodes.push(episode_title_url[1]);
              }
            });
            if (matchEpisodes.length > episodes.length) {
              episodes = matchEpisodes;
              titles = matchTitles;
            }
          });
        }

        return {
          id: item.vod_id.toString(),
          title: item.vod_name.trim().replace(/\s+/g, ' '),
          poster: item.vod_pic,
          episodes,
          episodes_titles: titles,
          source: firstSource.key,
          source_name: firstSource.name,
          class: item.vod_class,
          year: item.vod_year
            ? item.vod_year.match(/\d{4}/)?.[0] || ''
            : 'unknown',
          desc: cleanHtmlTags(item.vod_content || ''),
          type_name: item.type_name,
          douban_id: item.vod_douban_id,
        };
      },
    );

    // 过滤掉集数为 0 的结果，并限制返回数量
    const filteredVideos = videos
      .filter((video) => video.episodes.length > 0)
      .slice(0, 20);

    console.log(`返回 ${filteredVideos.length} 个短剧视频`);

    // 保存到内存缓存
    cachedRecommends = {
      timestamp: Date.now(),
      data: filteredVideos,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(
      {
        code: 200,
        message: '获取成功',
        data: filteredVideos,
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        },
      },
    );
  } catch (error) {
    console.error('获取热播短剧推荐失败:', error);
    return NextResponse.json(
      {
        code: 500,
        message: '获取热播短剧推荐失败',
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
