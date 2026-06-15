import { NextRequest, NextResponse } from 'next/server';

import { isMusicSource, lxGetJson, normalizeLxSong, unwrapLxArray } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'wy';
    const id = searchParams.get('id') || '';
    const page = Number(searchParams.get('page') || '1');

    if (!isMusicSource(source)) return badRequest('不支持的音源');
    if (!id) return badRequest('缺少歌单 ID');

    const payload = await lxGetJson<any>(`/api/music/songList/detail?source=${source}&id=${encodeURIComponent(id)}&page=${page}`, 'none');
    const list = unwrapLxArray<any>(payload);

    return NextResponse.json({
      success: true,
      data: {
        info: payload?.info || payload?.data?.info || {},
        list: list.map(normalizeLxSong),
        page: payload?.page ?? page,
        total: payload?.total ?? list.length,
        limit: payload?.limit ?? list.length,
      },
    });
  } catch (error) {
    return internalError('获取歌单详情失败', (error as Error).message);
  }
}
