import { NextRequest, NextResponse } from 'next/server';

import { requireFeaturePermission } from '@/lib/permissions';

function getBaseUrl(url: string): string {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  pathParts.pop();
  return `${urlObj.protocol}//${urlObj.host}${pathParts.join('/')}`;
}

function processM3u8Content(content: string, baseUrl: string): string {
  const lines = content.split('\n');
  const processedLines = lines.map(line => {
    const trimmedLine = line.trim();

    // 跳过注释行和空行
    if (trimmedLine.startsWith('#') || trimmedLine === '') {
      return line;
    }

    // 如果已经是完整URL，不处理
    if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
      return line;
    }

    // 处理相对路径
    if (trimmedLine.startsWith('/')) {
      // 绝对路径（相对于域名）
      const urlObj = new URL(baseUrl);
      return `${urlObj.protocol}//${urlObj.host}${trimmedLine}`;
    } else {
      // 相对路径
      return `${baseUrl}/${trimmedLine}`;
    }
  });

  return processedLines.join('\n');
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'web_live', '无权限访问网络直播');
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json({ error: '缺少URL参数' }, { status: 400 });
    }

    // 根据URL判断Referer
    let referer = 'https://www.huya.com/';
    if (url.includes('bilivideo.com') || url.includes('bilibili.com')) {
      referer = 'https://live.bilibili.com/';
    } else if (url.includes('douyin.com') || url.includes('douyincdn.com')) {
      referer = 'https://live.douyin.com/';
    }

    const streamRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer
      }
    });

    if (!streamRes.ok) {
      return NextResponse.json({ error: '无法获取直播流' }, { status: 404 });
    }

    const contentType = streamRes.headers.get('Content-Type') || '';

    // 检测是否为m3u8文件
    const isM3u8 = url.endsWith('.m3u8') ||
                   contentType.includes('application/vnd.apple.mpegurl') ||
                   contentType.includes('application/x-mpegURL');

    if (isM3u8) {
      // 读取m3u8内容
      const content = await streamRes.text();
      const baseUrl = getBaseUrl(url);
      const processedContent = processM3u8Content(content, baseUrl);

      return new NextResponse(processedContent, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 非m3u8文件，直接返回流
    return new NextResponse(streamRes.body, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '代理失败' },
      { status: 500 }
    );
  }
}
