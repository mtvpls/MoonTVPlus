import * as cheerio from 'cheerio';
import { NextRequest, NextResponse } from 'next/server';

import { fetchDoubanWithVerification } from '@/lib/douban-anti-crawler';

export const runtime = 'nodejs';

interface DoubanComment {
  id: string;
  userName: string;
  userAvatar: string;
  userUrl: string;
  rating: number | null; // 1-5 星，null 表示未评分
  content: string;
  time: string;
  votes: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const doubanId = searchParams.get('id');
  const start = searchParams.get('start') || '0';
  const limit = searchParams.get('limit') || '20';

  if (!doubanId) {
    return NextResponse.json({ error: 'Missing douban ID' }, { status: 400 });
  }

  try {
    // 请求豆瓣短评页面（使用反爬验证）
    const url = `https://movie.douban.com/subject/${doubanId}/comments?start=${start}&limit=${limit}&status=P&sort=new_score`;

    const response = await fetchDoubanWithVerification(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch douban page' },
        { status: response.status },
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const comments: DoubanComment[] = [];

    console.log('开始解析豆瓣评论，start:', start, 'limit:', limit);

    // 解析每条短评
    $('.comment-item').each((index, element) => {
      const $comment = $(element);

      // 提取评论 ID
      const commentId = $comment.attr('data-cid') || '';

      // 提取用户信息
      const $avatar = $comment.find('.avatar');
      const userUrl = $avatar.find('a').attr('href') || '';
      const userAvatar = $avatar.find('img').attr('src') || '';
      const userName = $avatar.find('a').attr('title') || '';

      // 提取评分（星级）
      const ratingClass = $comment.find('.rating').attr('class') || '';
      let rating: number | null = null;
      const ratingMatch = ratingClass.match(/allstar(\d)0/);
      if (ratingMatch) {
        rating = parseInt(ratingMatch[1]);
      }

      // 提取短评内容
      const $content = $comment.find('.short');
      const content = $content.text().trim();

      // 提取时间
      const $commentInfo = $comment.find('.comment-info');
      const time = $commentInfo.find('.comment-time').attr('title') || '';

      // 提取有用数
      const votesText = $comment.find('.votes.vote-count').text().trim();
      const votes = parseInt(votesText) || 0;

      if (commentId && content) {
        comments.push({
          id: commentId,
          userName,
          userAvatar,
          userUrl,
          rating,
          content,
          time,
          votes,
        });
      }
    });

    console.log('解析到评论数:', comments.length);

    // 获取总评论数 - 尝试多种方式
    let total = 0;

    // 方式1: 从标题获取 "全部 XXX 条"
    const titleText = $('.mod-hd h2, h2, .section-title').text();
    const titleMatch = titleText.match(/全部\s*(\d+)\s*条/);
    if (titleMatch) {
      total = parseInt(titleMatch[1]);
    }

    // 方式2: 从导航标签获取 "看过(XXX)"
    if (total === 0) {
      const navText = $('.tabs, .nav-tabs, a').text();
      const navMatch = navText.match(/看过\s*\((\d+)\)/);
      if (navMatch) {
        total = parseInt(navMatch[1]);
      }
    }

    // 方式3: 从页面所有文本查找
    if (total === 0) {
      const bodyText = $('body').text();
      const bodyMatch = bodyText.match(/全部\s*(\d+)\s*条|看过\s*\((\d+)\)/);
      if (bodyMatch) {
        total = parseInt(bodyMatch[1] || bodyMatch[2]);
      }
    }

    // 方式4: 如果有评论但 total 为 0，至少设置为当前评论数，并假设有更多
    if (total === 0 && comments.length > 0) {
      total = parseInt(start) + comments.length;
      // 如果本次获取了完整的 limit 数量，可能还有更多
      if (comments.length >= parseInt(limit)) {
        total += 1; // 暂定有更多
      }
    }

    console.log('豆瓣评论统计:', {
      total,
      commentsCount: comments.length,
      start,
      limit,
      hasMore:
        parseInt(start) + comments.length < total ||
        (total === 0 && comments.length >= parseInt(limit)),
    });

    return NextResponse.json(
      {
        comments,
        total,
        start: parseInt(start),
        limit: parseInt(limit),
        // 如果知道总数，就用总数判断；否则如果获取了完整页，假设还有更多
        hasMore:
          total > 0
            ? parseInt(start) + comments.length < total
            : comments.length >= parseInt(limit),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=600, s-maxage=600',
        },
      },
    );
  } catch (error) {
    console.error('Douban comments fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to parse douban comments' },
      { status: 500 },
    );
  }
}
