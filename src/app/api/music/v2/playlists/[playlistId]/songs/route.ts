import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { MusicV2PlaylistItem, normalizeSong } from '@/lib/music-v2';
import { badRequest, getMusicV2Username, internalError, unauthorized } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ playlistId: string }> }) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const { playlistId } = await params;
    const playlist = await db.getMusicV2Playlist(playlistId);
    if (!playlist) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '歌单不存在' } }, { status: 404 });
    if (playlist.username !== username) return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '无权限访问此歌单' } }, { status: 403 });

    const songs = await db.listMusicV2PlaylistItems(playlistId);
    return NextResponse.json({ success: true, data: { songs } });
  } catch (error) {
    return internalError('获取歌单歌曲失败', (error as Error).message);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ playlistId: string }> }) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const { playlistId } = await params;
    const playlist = await db.getMusicV2Playlist(playlistId);
    if (!playlist) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '歌单不存在' } }, { status: 404 });
    if (playlist.username !== username) return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '无权限操作此歌单' } }, { status: 403 });

    const body = await request.json();
    const song = normalizeSong(body?.song || {});
    if (!song.songId || !song.source || !song.name || !song.artist) return badRequest('歌曲信息不完整');
    const exists = await db.hasMusicV2PlaylistItem(playlistId, song.songId);
    if (exists) return badRequest('歌曲已在歌单中', 'DUPLICATE_SONG');

    const item: MusicV2PlaylistItem = {
      ...song,
      playlistId,
      sortOrder: Number(body?.sortOrder || 0),
      addedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.addMusicV2PlaylistItem(playlistId, item);
    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError('添加歌曲失败', (error as Error).message);
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

    const { searchParams } = new URL(request.url);
    const songId = searchParams.get('songId');
    if (!songId) return badRequest('缺少 songId');

    await db.removeMusicV2PlaylistItem(playlistId, songId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError('删除歌曲失败', (error as Error).message);
  }
}
