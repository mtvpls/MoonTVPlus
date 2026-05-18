import { NextRequest, NextResponse } from 'next/server';

import { isMusicSource, lxGetJson, unwrapLxArray } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'kw';
    if (!isMusicSource(source)) return badRequest('不支持的音源');

    const fallbackSources = [source, 'kg', 'kw', 'tx', 'wy', 'mg'].filter(
      (item, index, arr) => arr.indexOf(item) === index
    );

    let actualSource = source as typeof source;
    let list: Array<{ id?: string; bangid?: string; name: string; img?: string }> = [];
    const errors: string[] = [];

    for (const candidate of fallbackSources) {
      try {
        const candidatePayload = await lxGetJson<any>(
          `/api/music/leaderboard/boards?source=${candidate}`,
          'none'
        );
        const candidateList = unwrapLxArray<{ id?: string; bangid?: string; name: string; img?: string }>(candidatePayload);
        if (Array.isArray(candidateList) && candidateList.length > 0) {
          actualSource = candidate as typeof source;
          list = candidateList;
          break;
        }
      } catch (error) {
        const message = (error as Error).message;
        errors.push(`${candidate}: ${message}`);
        console.error(`[music-v2] 获取榜单源失败: ${candidate}`, error);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        list: list.map(item => ({
          id: item.bangid || item.id || '',
          name: item.name,
          cover: item.img,
          source: actualSource,
        })),
        source: actualSource,
        errors,
      },
    });
  } catch (error) {
    console.error('[music-v2] 获取榜单失败:', error);
    return internalError('获取榜单失败', (error as Error).message);
  }
}
