/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// 代理音频流
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json(
        { error: '缺少 url 参数' },
        { status: 400 }
      );
    }

    // 安全检查：只允许代理音乐平台的音频和图片 CDN
    const allowedDomains = [
      'sycdn.kuwo.cn',
      'kwcdn.kuwo.cn',
      'img1.kwcdn.kuwo.cn',
      'img2.kwcdn.kuwo.cn',
      'img3.kwcdn.kuwo.cn',
      'img4.kwcdn.kuwo.cn',
      'music.163.com',
      'y.qq.com',
      'ws.stream.qqmusic.qq.com',
      'isure.stream.qqmusic.qq.com',
      'dl.stream.qqmusic.qq.com',
    ];

    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return NextResponse.json(
        { error: '无效的 URL' },
        { status: 400 }
      );
    }

    const isAllowed = allowedDomains.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      console.warn(`拒绝代理音频请求: ${urlObj.hostname}`);
      return NextResponse.json(
        { error: '不允许的目标域名' },
        { status: 403 }
      );
    }

    // 检查是否有 Range 请求头
    const range = request.headers.get('range');

    // 构建上游请求头
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'http://www.kuwo.cn/',
    };

    // 如果有 Range 请求，转发给上游
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    // 发起请求获取音频流
    const response = await fetch(url, {
      headers: upstreamHeaders,
    });

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: '获取音频失败' },
        { status: response.status }
      );
    }

    // 获取响应头
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');

    // 创建响应头
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': acceptRanges || 'bytes',
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    // 如果上游返回了 Content-Range，转发给客户端
    if (contentRange) {
      headers['Content-Range'] = contentRange;
    }

    // 返回音频流，保持原始状态码（200 或 206）
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('代理音频失败:', error);
    return NextResponse.json(
      {
        error: '代理请求失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
