/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';
import { buildProxyStreamHeaders } from '@/lib/server/proxy-headers';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  if (!source) {
    return NextResponse.json({ error: 'Missing source' }, { status: 400 });
  }

  // 检查该视频源是否启用了代理模式
  const config = await getConfig();
  const videoSource = config.SourceConfig?.find((s: any) => s.key === source);

  if (!videoSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  if (!videoSource.proxyMode) {
    return NextResponse.json({ error: 'Proxy mode not enabled for this source' }, { status: 403 });
  }

  try {
    const decodedUrl = decodeURIComponent(url);

    // 安全校验：防 SSRF 拦截请求内网或非法 URL
    const isSafeUrl = await validateProxyUrlServerSide(decodedUrl);
    if (!isSafeUrl) {
      return NextResponse.json({ error: 'Proxy request to local or invalid network is forbidden' }, { status: 403 });
    }

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': decodedUrl,
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch key' }, { status: 500 });
    }

    const headers = buildProxyStreamHeaders(
      response.headers.get('Content-Type') || 'application/octet-stream'
    );

    return new Response(response.body, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch key' }, { status: 500 });
  }
}
