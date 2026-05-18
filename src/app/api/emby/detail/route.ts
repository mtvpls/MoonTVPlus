/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { embyManager } from '@/lib/emby-manager';
import { getProxyToken } from '@/lib/emby-token';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('id');
  const embyKey = searchParams.get('embyKey') || undefined;

  if (!itemId) {
    return NextResponse.json({ error: '缺少媒体ID' }, { status: 400 });
  }

  try {
    const authResult = await requireFeaturePermission(request, 'emby', '无权限访问 Emby');
    if (authResult instanceof NextResponse) return authResult;
    // 获取Emby客户端
    const client = await embyManager.getClient(embyKey);

    // 获取代理 token（如果启用了代理）
    const proxyToken = client.isProxyEnabled() ? await getProxyToken(request) : null;

    // 获取媒体详情
    const item = await client.getItem(itemId);

    let episodes: any[] = [];

    if (item.Type === 'Series') {
      // 获取所有剧集
      const allEpisodes = await client.getEpisodes(itemId);

      episodes = await Promise.all(
        allEpisodes
          .sort((a, b) => {
            if (a.ParentIndexNumber !== b.ParentIndexNumber) {
              return (a.ParentIndexNumber || 0) - (b.ParentIndexNumber || 0);
            }
            return (a.IndexNumber || 0) - (b.IndexNumber || 0);
          })
          .map(async (ep) => ({
            id: ep.Id,
            title: ep.Name,
            episode: ep.IndexNumber || 0,
            season: ep.ParentIndexNumber || 1,
            overview: ep.Overview || '',
            playUrl: await client.getStreamUrl(ep.Id),
          }))
      );
    }

    return NextResponse.json({
      success: true,
      item: {
        id: item.Id,
        title: item.Name,
        type: item.Type === 'Movie' ? 'movie' : 'tv',
        overview: item.Overview || '',
        poster: client.getImageUrl(item.Id, 'Primary', undefined, proxyToken || undefined),
        year: item.ProductionYear?.toString() || '',
        rating: item.CommunityRating || 0,
        playUrl: item.Type === 'Movie' ? await client.getStreamUrl(item.Id) : undefined,
      },
      episodes: item.Type === 'Series' ? episodes : [],
    });
  } catch (error) {
    console.error('获取 Emby 详情失败:', error);
    return NextResponse.json(
      { error: '获取 Emby 详情失败: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
