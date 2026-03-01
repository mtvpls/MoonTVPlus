/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { MusicPlayRecord } from '@/lib/db.client';
import { getCachedSongs, setCachedSong } from '@/lib/music-song-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 检查用户状态
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const records = await db.getAllMusicPlayRecords(authInfo.username);

    // 从缓存中获取歌曲信息并填充到记录中
    const keys = Object.keys(records).map(key => {
      const [platform, id] = key.split('+');
      return { platform, id };
    });
    const cachedSongs = getCachedSongs(keys);

    // 将缓存的歌曲信息合并到记录中
    const enrichedRecords: Record<string, MusicPlayRecord> = {};
    for (const [key, record] of Object.entries(records)) {
      const cachedSong = cachedSongs.get(key);
      enrichedRecords[key] = {
        ...record,
        name: cachedSong?.name || record.name,
        artist: cachedSong?.artist || record.artist,
        album: cachedSong?.album || record.album,
        pic: cachedSong?.pic || record.pic,
      };
    }

    return NextResponse.json(enrichedRecords, { status: 200 });
  } catch (err) {
    console.error('获取音乐播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();

    // 检查是否是批量添加
    if (Array.isArray(body.records)) {
      // 批量添加
      const records: Array<{ platform: string; id: string; record: MusicPlayRecord }> = [];

      for (const item of body.records) {
        const { key, record } = item;
        if (!key || !record) {
          return NextResponse.json(
            { error: 'Missing key or record in batch item' },
            { status: 400 }
          );
        }

        // 验证音乐播放记录数据
        if (!record.platform || !record.id || !record.name || !record.artist) {
          return NextResponse.json(
            { error: 'Invalid record data in batch item' },
            { status: 400 }
          );
        }

        // 从key中解析platform和id
        const [platform, id] = key.split('+');
        if (!platform || !id) {
          return NextResponse.json(
            { error: 'Invalid key format in batch item' },
            { status: 400 }
          );
        }

        records.push({ platform, id, record });

        // 缓存歌曲信息到服务器内存
        setCachedSong(platform, id, {
          id: record.id,
          name: record.name,
          artist: record.artist,
          album: record.album,
          pic: record.pic,
        });
      }

      // 批量保存到数据库
      await db.batchSaveMusicPlayRecords(authInfo.username, records);

      return NextResponse.json({ success: true, count: records.length }, { status: 200 });
    } else {
      // 单个添加（保持向后兼容）
      const { key, record }: { key: string; record: MusicPlayRecord } = body;

      if (!key || !record) {
        return NextResponse.json(
          { error: 'Missing key or record' },
          { status: 400 }
        );
      }

      // 验证音乐播放记录数据
      if (!record.platform || !record.id || !record.name || !record.artist) {
        return NextResponse.json(
          { error: 'Invalid record data' },
          { status: 400 }
        );
      }

      // 从key中解析platform和id
      const [platform, id] = key.split('+');
      if (!platform || !id) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }

      await db.saveMusicPlayRecord(authInfo.username, platform, id, record);

      // 缓存歌曲信息到服务器内存
      setCachedSong(platform, id, {
        id: record.id,
        name: record.name,
        artist: record.artist,
        album: record.album,
        pic: record.pic,
      });

      return NextResponse.json({ success: true }, { status: 200 });
    }
  } catch (err) {
    console.error('保存音乐播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 删除单条记录
      const [platform, id] = key.split('+');
      if (!platform || !id) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      await db.deleteMusicPlayRecord(authInfo.username, platform, id);
    } else {
      // 清空所有记录
      await db.clearAllMusicPlayRecords(authInfo.username);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除音乐播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
