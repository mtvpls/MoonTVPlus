import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 通用 m3u8 防盗链代理（服务端带 Referer 拉流，回传播放器）
 * GET /api/m3u8-proxy?url=<encodeURIComponent(m3u8)>&referer=<encodeURIComponent(referer)>
 * 供脚本源 resolvePlayUrl 返回代理地址使用；同源请求，无跨域问题。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');
    const referer = searchParams.get('referer') || '';

    if (!target) {
      return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return NextResponse.json({ error: '无效的 url' }, { status: 400 });
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return NextResponse.json({ error: '不支持的协议' }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(targetUrl.toString(), {
        headers: {
          ...(referer ? { Referer: referer } : {}),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      const headers = new Headers(res.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      return new NextResponse(res.body, { status: res.status, headers });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 }
    );
  }
}
