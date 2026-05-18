/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/xiaoya/search?keyword=<keyword>&type=<type>
 * 搜索小雅视频（使用小雅的网页搜索引擎）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'xiaoya', '无权限访问小雅');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword');
    const type = searchParams.get('type') || 'video'; // video, music, ebook, all

    if (!keyword) {
      return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
    }

    const config = await getConfig();
    const xiaoyaConfig = config.XiaoyaConfig;

    if (
      !xiaoyaConfig ||
      !xiaoyaConfig.Enabled ||
      !xiaoyaConfig.ServerURL
    ) {
      return NextResponse.json({ error: '小雅未配置或未启用' }, { status: 400 });
    }

    // 使用小雅的搜索引擎
    const searchUrl = `${xiaoyaConfig.ServerURL}/search?box=${encodeURIComponent(keyword)}&type=${type}&url=`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`搜索请求失败: ${response.status}`);
    }

    const html = await response.text();

    // 解析 HTML 中的链接
    // 格式: <a href=/path/to/file>path/to/file</a>
    const linkRegex = /<a href=([^>]+)>([^<]+)<\/a>/g;
    const results: Array<{ name: string; path: string }> = [];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let path = match[1];
      const displayText = match[2];

      // 跳过返回首页和频道链接
      if (path === '/' || path.startsWith('http')) {
        continue;
      }

      // URL 解码路径
      try {
        path = decodeURIComponent(path);
      } catch (e) {
        console.error('URL 解码失败:', path, e);
      }

      // 提取文件名（路径的最后一部分）
      const pathParts = displayText.split('/');
      const fileName = pathParts[pathParts.length - 1];

      results.push({
        name: fileName,
        path: path,
      });
    }

    return NextResponse.json({
      videos: results,
      total: results.length,
    });
  } catch (error) {
    console.error('小雅搜索失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
