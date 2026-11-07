import { NextRequest, NextResponse } from 'next/server';

import { requireFeaturePermission } from '@/lib/permissions';
import { fetchLiveSource, getLiveSource } from '@/lib/tvbox-live.server';
import { relayTVBoxLiveResponse } from '@/lib/tvbox-live-relay.server';

export const runtime = 'nodejs';
export const maxDuration = 240;

export async function GET(request: NextRequest) {
  const authResult = await requireFeaturePermission(
    request,
    'live',
    '无权限访问电视直播'
  );
  if (authResult instanceof NextResponse) return authResult;
  const params = request.nextUrl.searchParams;
  const source = await getLiveSource(params.get('source'));
  if (!source?.tvbox)
    return NextResponse.json(
      { error: 'TVBox 直播源不存在或已禁用' },
      { status: 404 }
    );
  const url = params.get('url');
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: '无效的直播资源地址' }, { status: 400 });
  }
  try {
    const headers = new Headers();
    for (const name of ['range', 'if-range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetchLiveSource(source, url, { headers });
    if (!response.ok) {
      await response.text();
      return NextResponse.json(
        { error: 'TVBox 直播代理请求失败' },
        { status: response.status }
      );
    }
    return await relayTVBoxLiveResponse(
      response,
      source.key,
      response.url || url
    );
  } catch {
    return NextResponse.json(
      { error: 'TVBox 直播代理获取失败，请重试或刷新直播源' },
      { status: 502 }
    );
  }
}
