import { NextRequest, NextResponse } from 'next/server';

import { isMusicSource, lxGetJson, unwrapLxArray } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'wy';
    const tagId = searchParams.get('tagId') || '';
    const sortId = searchParams.get('sortId') || 'hot';
    const page = Number(searchParams.get('page') || '1');

    if (!isMusicSource(source)) return badRequest('不支持的音源');

    const payload = await lxGetJson<any>(`/api/music/songList/list?source=${source}&tagId=${encodeURIComponent(tagId)}&sortId=${encodeURIComponent(sortId)}&page=${page}`, 'none');
    const list = unwrapLxArray<any>(payload);

    return NextResponse.json({
      success: true,
      data: {
        source,
        page,
        tagId,
        sortId,
        total: payload?.total ?? payload?.data?.total ?? list.length,
        limit: payload?.limit ?? payload?.data?.limit ?? list.length,
        list: list.map((item) => ({
          id: item.id || item.songlistId || item.listId || '',
          name: item.name || item.title || '未命名歌单',
          pic: item.img || item.cover || item.pic || item.coverImgUrl,
          source: item.source || source,
          author: item.author || item.creator?.nickname || item.uname || '',
          desc: item.desc || item.description || '',
          play_count: item.play_count || item.playCount || item.listencnt || item.visitnum || '',
          total: item.total || item.trackCount || item.songCount || 0,
          updateFrequency: item.updateFrequency || item.update_frequency || item.time || '',
        })),
      },
    });
  } catch (error) {
    return internalError('获取歌单失败', (error as Error).message);
  }
}
