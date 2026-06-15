import { NextRequest, NextResponse } from 'next/server';

import { isMusicSource, lxGetJson } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

type HotSearchItem = { keyword: string; name: string; artist: string; source: string };
type LxHotSearchPayload =
  | string[]
  | Array<{ name?: string; keyword?: string; word?: string; singer?: string; source?: string }>
  | { source?: string; list?: string[] | Array<{ name?: string; keyword?: string; word?: string; singer?: string; source?: string }> };

function normalizeHotSearchPayload(payload: LxHotSearchPayload, fallbackSource: string): HotSearchItem[] {
  const payloadSource = Array.isArray(payload) ? fallbackSource : payload?.source || fallbackSource;
  const rawList = Array.isArray(payload) ? payload : payload?.list;
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((item) => {
      if (typeof item === 'string') {
        return { keyword: item, name: item, artist: '', source: payloadSource };
      }
      const keyword = item.name || item.keyword || item.word || '';
      return {
        keyword,
        name: keyword,
        artist: item.singer || '',
        source: item.source || payloadSource,
      };
    })
    .filter((item) => item.keyword);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'mg';
    if (!isMusicSource(source)) return badRequest('不支持的音源');

    const fallbackSources = [source, 'mg', 'kw', 'tx', 'wy', 'kg'].filter((item, index, arr) => arr.indexOf(item) === index);
    let list: HotSearchItem[] = [];

    for (const candidate of fallbackSources) {
      try {
        const payload = await lxGetJson<LxHotSearchPayload>(`/api/music/hotSearch?source=${candidate}`, 'none');
        list = normalizeHotSearchPayload(payload, candidate);
        if (list.length > 0) break;
      } catch {
        continue;
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          list,
        },
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=3600',
        },
      }
    );
  } catch (error) {
    return internalError('获取热搜失败', (error as Error).message);
  }
}
