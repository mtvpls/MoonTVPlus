/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { SourceManager } from '@/lib/source-manager';

export const runtime = 'nodejs';

/**
 * 获取播放地址API
 * 对于苹果CMS源，直接从episodes返回
 * 对于网盘源，动态调用API获取播放地址
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sourceCode = searchParams.get('source');
  const id = searchParams.get('id');
  const episodeIndex = searchParams.get('episodeIndex');

  if (!sourceCode || !id || episodeIndex === null) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  const episodeIndexNum = parseInt(episodeIndex, 10);
  if (isNaN(episodeIndexNum) || episodeIndexNum < 0) {
    return NextResponse.json({ error: '无效的集数索引' }, { status: 400 });
  }

  try {
    const config = await getConfig();
    const apiSites = await getAvailableApiSites(authInfo.username);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    // 从 SourceConfig 中查找完整配置
    const fullSource = config.SourceConfig.find(s => s.key === apiSite.key);
    const sourceType = fullSource?.sourceType || 'applecms';

    // 对于苹果CMS源，直接获取详情然后返回episodes中的URL
    if (sourceType === 'applecms') {
      const sourceConfig = {
        key: apiSite.key,
        name: apiSite.name,
        api: apiSite.api,
        detail: apiSite.detail,
        sourceType: 'applecms' as const,
      };

      const detail = await SourceManager.getDetail(sourceConfig, id);

      if (episodeIndexNum >= detail.episodes.length) {
        return NextResponse.json({ error: '集数索引超出范围' }, { status: 400 });
      }

      return NextResponse.json({
        playUrl: detail.episodes[episodeIndexNum],
        sourceType: 'applecms',
      });
    }

    // 对于网盘源，调用适配器动态获取播放地址
    if (sourceType === 'quark' || sourceType === 'ali') {
      const sourceConfig = {
        key: apiSite.key,
        name: apiSite.name,
        api: apiSite.api,
        detail: apiSite.detail,
        sourceType,
        auth: fullSource?.auth,
        ext: fullSource?.ext,
      };

      // 使用 SourceManager 获取播放地址
      const playUrl = await SourceManager.getPlayUrl(sourceConfig, id, episodeIndexNum);

      return NextResponse.json({
        playUrl,
        sourceType,
      });
    }

    return NextResponse.json({ error: '不支持的源类型' }, { status: 400 });
  } catch (error) {
    console.error('获取播放地址失败:', error);
    return NextResponse.json(
      { error: (error as Error).message || '获取播放地址失败' },
      { status: 500 }
    );
  }
}
