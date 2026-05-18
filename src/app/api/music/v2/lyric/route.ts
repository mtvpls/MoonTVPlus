import { NextRequest, NextResponse } from 'next/server';

import { fetchLxLyric, normalizeSong } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const song = normalizeSong(body?.song || body?.songInfo || {});
    if (!song.source || !song.songId) {
      return badRequest(`歌曲信息不完整: songId=${song.songId || ''}, source=${song.source || ''}`);
    }

    const data = await fetchLxLyric(song);

    return NextResponse.json({ success: true, data: { lyric: data.lyric || '', tlyric: data.tlyric || '' } });
  } catch (error) {
    console.error('[music-v2] lyric route error:', error);
    return internalError('获取歌词失败', (error as Error).message);
  }
}
