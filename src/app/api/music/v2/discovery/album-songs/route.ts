import { NextRequest, NextResponse } from 'next/server';

import { isMusicSource, lxGetJson, LxServerSong, normalizeLxSong, unwrapLxArray } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id')?.trim() || '';
    const source = searchParams.get('source') || 'wy';

    if (!id) return badRequest('缺少专辑 ID');
    if (!isMusicSource(source)) return badRequest('不支持的音源');

    const payload = await lxGetJson<any>(`/api/music/albumSongs?id=${encodeURIComponent(id)}&source=${source}`, 'none');
    const list = unwrapLxArray<LxServerSong>(payload);

    return NextResponse.json({
      success: true,
      data: {
        list: list.map(normalizeLxSong),
      },
    });
  } catch (error) {
    return internalError('获取专辑歌曲失败', (error as Error).message);
  }
}
