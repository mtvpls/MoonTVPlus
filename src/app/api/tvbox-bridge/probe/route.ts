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
 * GET /api/tvbox-bridge/probe?key=<siteKey>&flag=<线路名>&id=<base64url 集标识>
 *
 * 换源面板的线路测速用。与 /play 的区别：
 * - 不重定向、不回原始 m3u8，只回答「这条线路测速该探哪个地址」；
 * - 直播 / 需二次解析的线路明确回 unsupported，界面显示「不支持测速」而不是错误。
 *
 * 之所以不让浏览器直接调 /play：那边是 307 跳转，跨域直连既拿不到 CORS
 * 也会被防盗链拦掉，测出来永远是「无法访问」。
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

    const play = await getTVBoxBridgePlay(endpoint, site.siteKey, flag, episodeId);

    // 直播地址是持续流，测速没有意义：标成不支持而不是让前端等到超时
    if (play.isLive) {
      return NextResponse.json({
        ok: false,
        unsupported: true,
        reason: '直播线路',
      });
    }

    // 二次解析要网页播放器（p2p / 嗅探）才出流，m3u8 探测拿不到媒体
    if (play.needsParse) {
      return NextResponse.json({
        ok: false,
        unsupported: true,
        reason: '需要二次解析',
      });
    }

    // 解析出来了但没给地址：按「这条线路取不到流」处理
    if (!play.url || !play.url.trim()) {
      return NextResponse.json({ ok: false, error: '获取到的播放链接为空' });
    }

    const headers = play.headers || {};
    const directPlayable =
      Object.keys(headers).length === 0 &&
      (play.type === 'hls' || play.type === 'mp4');

    // 直连地址交给浏览器测；带请求头 / 非标准类型的走桥接代理（顺带测到桥接改写链路）
    const url = directPlayable
      ? play.url
      : buildTVBoxBridgeStreamUrl(endpoint, play.url, headers);

    return NextResponse.json({ ok: true, url, mediaType: play.type || '' });
  } catch (error) {
    // 桥接解析失败（Spider 报错 / 桥接不可达）就是这条线路取不到流
    console.warn('[TVBoxBridge/测速] probe 解析失败:', error);
    return NextResponse.json({
      ok: false,
      error: (error as Error).message,
    });
  }
}
