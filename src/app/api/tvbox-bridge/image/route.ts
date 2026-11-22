/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  decodeTVBoxBridgeBase64Url,
  fetchTVBoxBridgeImage,
  getTVBoxBridgeEndpoint,
} from '@/lib/tvbox-bridge.server';

export const runtime = 'nodejs';

/**
 * GET /api/tvbox-bridge/image?u=<base64url 图片地址>&r=<Referer>
 *
 * 桥接 /api/img 需要 token，不能直接给浏览器用，所以本地转一层。
 * 结果与 /api/image-proxy 一样走长缓存。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const encodedUrl = searchParams.get('u');
  const referer = searchParams.get('r') || undefined;

  if (!encodedUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const imageUrl = decodeTVBoxBridgeBase64Url(encodedUrl);
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  try {
    const endpoint = await getTVBoxBridgeEndpoint();
    if (!endpoint) {
      return NextResponse.json(
        { error: 'TVBox 桥接未启用' },
        { status: 503 }
      );
    }

    const imageResponse = await fetchTVBoxBridgeImage(
      endpoint,
      imageUrl,
      referer
    );

    if (!imageResponse.ok || !imageResponse.body) {
      return NextResponse.json(
        { error: imageResponse.statusText || 'Image fetch failed' },
        { status: imageResponse.ok ? 500 : imageResponse.status }
      );
    }

    const headers = new Headers();
    const contentType = imageResponse.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000');
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');

    return new Response(imageResponse.body as unknown as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('[TVBoxBridge] 图片代理失败:', error);
    return NextResponse.json({ error: 'Error fetching image' }, { status: 500 });
  }
}
