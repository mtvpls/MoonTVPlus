import * as cheerio from 'cheerio/slim';
import { NextRequest, NextResponse } from 'next/server';

import { fetchDoubanData } from '@/lib/douban';
import { fetchDoubanWithVerification } from '@/lib/douban-anti-crawler';

export const runtime = 'nodejs';

interface DoubanRecommendation {
  doubanId: string;
  title: string;
  poster: string;
  rating: string;
}

interface DoubanDetailApiResponse {
  id: string;
  title: string;
  [key: string]: any;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const doubanId = searchParams.get('id');

  if (!doubanId) {
    return NextResponse.json({ error: 'Missing douban ID' }, { status: 400 });
  }

  try {
    // 请求豆瓣电影页面（使用反爬验证）
    const url = `https://movie.douban.com/subject/${doubanId}/`;

    const response = await fetchDoubanWithVerification(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch douban page' },
        { status: response.status }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const recommendations: DoubanRecommendation[] = [];

    console.log('开始解析豆瓣推荐');

    // 解析推荐模块
    $('.recommendations-bd dl').each((index, element) => {
      const $dl = $(element);

      // 提取链接和豆瓣ID
      const $link = $dl.find('dt a');
      const href = $link.attr('href') || '';
      const doubanIdMatch = href.match(/subject\/(\d+)/);
      const recDoubanId = doubanIdMatch ? doubanIdMatch[1] : '';

      // 提取图片 - 返回原始豆瓣URL，由客户端processImageUrl根据配置处理
      const poster = $link.find('img').attr('src') || '';

      // 提取标题
      const title = $dl.find('dd a').first().text().trim();

      // 提取评分
      const rating = $dl.find('dd .subject-rate').text().trim();

      if (recDoubanId && title) {
        recommendations.push({
          doubanId: recDoubanId,
          title,
          poster,
          rating,
        });
      }
    });

    console.log('解析到推荐数:', recommendations.length);

    // 处理标题截断问题
    const processedRecommendations: DoubanRecommendation[] = [];

    for (const rec of recommendations) {
      // 检查标题是否被截断（包含三个点）
      if (rec.title.includes('...')) {
        console.log(`检测到截断标题: ${rec.title}, ID: ${rec.doubanId}`);

        try {
          // 调用豆瓣详情接口获取完整名称
          const detailUrl = `https://m.douban.com/rexxar/api/v2/subject/${rec.doubanId}`;
          const detailData = await fetchDoubanData<DoubanDetailApiResponse>(detailUrl);

          if (detailData && detailData.title) {
            console.log(`成功获取完整标题: ${detailData.title}`);
            processedRecommendations.push({
              ...rec,
              title: detailData.title,
            });
          } else {
            console.log(`详情接口未返回标题，移除该视频: ${rec.doubanId}`);
            // 补充失败，不添加到结果中
          }
        } catch (error) {
          console.error(`获取完整标题失败，移除该视频: ${rec.doubanId}`, error);
          // 补充失败，不添加到结果中
        }
      } else {
        // 标题正常，直接添加
        processedRecommendations.push(rec);
      }
    }

    console.log('处理后的推荐数:', processedRecommendations.length);

    return NextResponse.json(
      {
        recommendations: processedRecommendations,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      }
    );
  } catch (error) {
    console.error('Douban recommendations fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to parse douban recommendations' },
      { status: 500 }
    );
  }
}
