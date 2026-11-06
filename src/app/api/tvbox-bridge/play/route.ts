import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  buildTVBoxBridgeStreamUrl,
  decodeTVBoxBridgeBase64Url,
  getTVBoxBridgeEndpoint,
  getTVBoxBridgePlay,
  resolveTVBoxBridgeSites,
} from '@/lib/tvbox-bridge.server';

export const runtime = 'nodejs';

/**
 * GET /api/tvbox-bridge/play?key=<siteKey>&flag=<线路名>&id=<base64url 集标识>&format=json
 *
 * 取流策略：能不代理就直连。只有需要自定义请求头（多数 TVBox 源要 Referer/UA）
 * 或桥接要求二次解析时才交给桥接 /api/stream（它会改写 m3u8 内所有子清单/分片/AES key）。
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteKey = searchParams.get('key');
    const flag = searchParams.get('flag') || '';
    const encodedId = searchParams.get('id');
    const format = searchParams.get('format');

    if (!siteKey || !encodedId) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const episodeId = decodeTVBoxBridgeBase64Url(encodedId);
    if (!episodeId) {
      return NextResponse.json({ error: '无效的播放标识' }, { status: 400 });
    }

    // 站点必须仍然对本用户可用（停用 / 权限回收时立刻失效）
    const sites = await resolveTVBoxBridgeSites(
      authInfo.username,
      searchParams.get('special') === '1'
    );
    const site = sites.find((item) => item.siteKey === siteKey);
    if (!site) {
      return NextResponse.json(
        { error: '该 TVBox 源不可用或已被停用' },
        { status: 403 }
      );
    }

    const endpoint = await getTVBoxBridgeEndpoint();
    if (!endpoint) {
      return NextResponse.json({ error: 'TVBox 桥接未启用' }, { status: 503 });
    }

    const play = await getTVBoxBridgePlay(
      endpoint,
      site.siteKey,
      flag,
      episodeId
    );
    if (!play.url || !play.url.trim()) {
      throw new Error('获取到的播放链接为空');
    }

    // 直播/需要二次解析的地址桥接给不出可直接播的 URL，交回前端处理
    if (play.needsParse || play.isLive) {
      const result = {
        url: play.url,
        mediaType: play.type,
        isLive: Boolean(play.isLive),
        needsParse: Boolean(play.needsParse),
      };
      if (format === 'json') return NextResponse.json(result);
      return NextResponse.redirect(play.url);
    }

    const headers = play.headers || {};
    const hasHeaders = Object.keys(headers).length > 0;

    // m3u8 且不需要请求头 → 直连；其余一律走桥接代理（顺带解决跨域/防盗链）
    const directPlayable =
      !hasHeaders && (play.type === 'hls' || play.type === 'mp4');

    const url = directPlayable
      ? play.url
      : buildTVBoxBridgeStreamUrl(endpoint, play.url, headers);

    const result = {
      url,
      mediaType: play.type,
      isLive: Boolean(play.isLive),
      needsParse: false,
    };

    if (format === 'json') {
      return NextResponse.json(result);
    }

    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
