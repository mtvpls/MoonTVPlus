import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { MusicV2HistoryRecord, normalizeSong } from '@/lib/music-v2';
import { badRequest, getMusicV2Username, internalError, unauthorized } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

function toHistoryRecord(input: any, previous?: MusicV2HistoryRecord): MusicV2HistoryRecord {
  const song = normalizeSong(input.song || input);
  const now = Date.now();
  return {
    ...song,
    playProgressSec: Number(input.playProgressSec ?? input.play_progress_sec ?? previous?.playProgressSec ?? 0),
    lastPlayedAt: Number(input.lastPlayedAt ?? input.last_played_at ?? now),
    playCount: Number(input.playCount ?? input.play_count ?? ((previous?.playCount || 0) + 1)),
    lastQuality: input.lastQuality || input.last_quality || previous?.lastQuality,
    createdAt: Number(input.createdAt ?? input.created_at ?? previous?.createdAt ?? now),
    updatedAt: now,
  };
}

export async function GET(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    // 注意：records 按“播放队列顺序”返回（createdAt ASC），
    // 前端再基于 lastPlayedAt 定位当前播放项。
    const records = await db.listMusicV2History(username);
    return NextResponse.json({ success: true, data: { records } });
  } catch (error) {
    return internalError('获取播放历史失败', (error as Error).message);
  }
}

export async function POST(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const body = await request.json();
    const existingRecords = await db.listMusicV2History(username);
    const existingMap = new Map(existingRecords.map(record => [record.songId, record]));

    if (Array.isArray(body.records)) {
      const records = body.records
        .map((item: any) => toHistoryRecord(item, existingMap.get(item.song?.songId || item.songId)))
        .filter((item: MusicV2HistoryRecord) => item.songId && item.source && item.name && item.artist);
      await db.batchUpsertMusicV2History(username, records);
      return NextResponse.json({ success: true, data: { count: records.length } });
    }

    const record = toHistoryRecord(body.record || body, existingMap.get(body.song?.songId || body.songId));
    if (!record.songId || !record.source || !record.name || !record.artist) {
      return badRequest('历史记录数据不完整');
    }

    await db.upsertMusicV2History(username, record);
    return NextResponse.json({ success: true, data: { record } });
  } catch (error) {
    return internalError('保存播放历史失败', (error as Error).message);
  }
}

export async function DELETE(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const { searchParams } = new URL(request.url);
    const songId = searchParams.get('songId');
    if (songId) {
      await db.deleteMusicV2History(username, songId);
    } else {
      await db.clearMusicV2History(username);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError('删除播放历史失败', (error as Error).message);
  }
}
