import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { badRequest, getMusicV2Username, internalError, unauthorized } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const playlists = await db.listMusicV2Playlists(username);
    return NextResponse.json({ success: true, data: { playlists } });
  } catch (error) {
    return internalError('获取歌单失败', (error as Error).message);
  }
}

export async function POST(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const body = await request.json();
    const name = body?.name?.trim();
    if (!name) return badRequest('歌单名称不能为空');

    const playlistId = randomUUID();
    await db.createMusicV2Playlist(username, {
      id: playlistId,
      name,
      description: body?.description?.trim(),
    });
    const playlist = await db.getMusicV2Playlist(playlistId);
    return NextResponse.json({ success: true, data: { playlist } });
  } catch (error) {
    return internalError('创建歌单失败', (error as Error).message);
  }
}
