/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { toWebStream } from '@/lib/live-http';
import { requireFeaturePermission } from '@/lib/permissions';
import { fetchLiveSource, getLiveSource } from '@/lib/tvbox-live.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authResult = await requireFeaturePermission(
    request,
    'live',
    '无权限访问电视直播'
  );
  if (authResult instanceof NextResponse) return authResult;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('moontv-source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }
  const liveSource = await getLiveSource(source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  try {
    const decodedUrl = url;

    const response = await fetchLiveSource(liveSource, decodedUrl, {
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch', message: response.statusText },
        { status: 500 }
      );
    }

    const contentType = response.headers.get('Content-Type') || '';
    const normalizedContentType = contentType.toLowerCase();
    const finalUrl = response.url || decodedUrl;
    const normalizedUrl = finalUrl.toLowerCase().split('?')[0];
    let detectedType = '';
    const body = toWebStream(response.body);
    if (body) {
      const reader = body.getReader();
      try {
        const { value } = await reader.read();
        const prefix = value
          ? new TextDecoder()
              .decode(value.slice(0, 128))
              .replace(/^\uFEFF/, '')
              .trimStart()
          : '';
        if (prefix.startsWith('#EXTM3U') || prefix.startsWith('#EXTINF:'))
          detectedType = 'm3u8';
        else if (prefix.startsWith('FLV')) detectedType = 'flv';
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
    if (
      normalizedContentType.includes('video/mp4') ||
      normalizedUrl.endsWith('.mp4')
    ) {
      return NextResponse.json({ success: true, type: 'mp4' }, { status: 200 });
    }
    if (
      detectedType === 'flv' ||
      normalizedContentType.includes('video/x-flv') ||
      normalizedContentType.includes('video/flv') ||
      normalizedUrl.endsWith('.flv')
    ) {
      return NextResponse.json({ success: true, type: 'flv' }, { status: 200 });
    }
    if (
      detectedType === 'm3u8' ||
      normalizedContentType.includes('mpegurl') ||
      normalizedContentType.includes('application/vnd.apple') ||
      normalizedUrl.endsWith('.m3u8') ||
      normalizedUrl.endsWith('.m3u')
    ) {
      return NextResponse.json(
        { success: true, type: 'm3u8' },
        { status: 200 }
      );
    }
    return NextResponse.json(
      {
        error: 'Unsupported live stream type',
        contentType,
      },
      { status: 415 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch', message: error },
      { status: 500 }
    );
  }
}
