/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getTMDBCredits } from '@/lib/tmdb.client';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/credits?id=xxx&type=movie|tv
 * 获取TMDB演职人员信息
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type') || 'movie';

    if (!id) {
      return NextResponse.json({ error: '缺少ID参数' }, { status: 400 });
    }

    if (type !== 'movie' && type !== 'tv') {
      return NextResponse.json({ error: '类型参数必须是movie或tv' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    const response = await getTMDBCredits(
      tmdbApiKey,
      parseInt(id),
      type as 'movie' | 'tv',
      tmdbProxy,
      tmdbReverseProxy
    );

    if (response.code !== 200 || !response.credits) {
      return NextResponse.json(
        { error: 'TMDB 演职人员信息获取失败', code: response.code },
        { status: response.code }
      );
    }

    return NextResponse.json(response.credits);
  } catch (error) {
    console.error('TMDB演职人员信息获取失败:', error);
    return NextResponse.json(
      { error: '获取演职人员信息失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
