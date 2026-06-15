import { NextRequest, NextResponse } from 'next/server';

import { isMusicSource, lxGetJson } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'wy';
    if (!isMusicSource(source)) return badRequest('不支持的音源');

    const payload = await lxGetJson<any>(`/api/music/songList/tags?source=${source}`, 'none');

    return NextResponse.json({
      success: true,
      data: {
        groups: payload?.tags || [],
        hotTags: payload?.hotTag || [],
        sortList: payload?.sortList || [],
      },
    });
  } catch (error) {
    return internalError('获取歌单标签失败', (error as Error).message);
  }
}
