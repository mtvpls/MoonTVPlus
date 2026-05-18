import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { badRequest, getMusicV2Username, internalError, unauthorized } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ playlistId: string }> }) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const { playlistId } = await params;
    const playlist = await db.getMusicV2Playlist(playlistId);
    if (!playlist) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '歌单不存在' } }, { status: 404 });
    if (playlist.username !== username) return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '无权限操作此歌单' } }, { status: 403 });

    const body = await request.json();
    await db.updateMusicV2Playlist(playlistId, {
      name: body?.name,
      description: body?.description,
      cover: body?.cover,
    });
    const updated = await db.getMusicV2Playlist(playlistId);
    return NextResponse.json({ success: true, data: { playlist: updated } });
  } catch (error) {
    return internalError('更新歌单失败', (error as Error).message);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ playlistId: string }> }) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const { playlistId } = await params;
    const playlist = await db.getMusicV2Playlist(playlistId);
    if (!playlist) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '歌单不存在' } }, { status: 404 });
    if (playlist.username !== username) return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '无权限操作此歌单' } }, { status: 403 });

    await db.deleteMusicV2Playlist(playlistId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError('删除歌单失败', (error as Error).message);
  }
}
