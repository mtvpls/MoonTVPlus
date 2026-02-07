// 弹幕搜索 API 路由
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const keyword = searchParams.get('keyword');

    if (!keyword) {
      return NextResponse.json(
        {
          errorCode: -1,
          success: false,
          errorMessage: '缺少关键词参数',
          animes: [],
        },
        { status: 400 }
      );
    }

    // 从数据库读取弹幕配置
    const config = await getConfig();
    const { DanmakuApiBase, DanmakuApiToken } = config.SiteConfig;

    // 构建 API URL
    const baseUrl = DanmakuApiToken ? `${DanmakuApiBase}/${DanmakuApiToken}` : DanmakuApiBase;

    const apiUrl = `${baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(keyword)}`;

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        keepalive: true,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      return NextResponse.json(data);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // 如果是超时错误，返回更友好的错误信息
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('弹幕服务器请求超时，请稍后重试');
      }

      throw fetchError;
    }
  } catch (error) {
    console.error('弹幕搜索代理错误:', error);
    return NextResponse.json(
      {
        errorCode: -1,
        success: false,
        errorMessage: error instanceof Error ? error.message : '搜索失败',
        animes: [],
      },
      { status: 500 }
    );
  }
}
