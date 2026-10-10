import { NextRequest, NextResponse } from 'next/server';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REDIRECTS = 5;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function corsHeaders(headers: Headers): Headers {
  const h = new Headers(headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  return h;
}

/**
 * 通用 m3u8 防盗链代理（服务端带 Referer 拉流，回传播放器）
 * GET /api/m3u8-proxy?url=<encodeURIComponent(m3u8)>&referer=<encodeURIComponent(referer)>
 * 供脚本源 resolvePlayUrl 返回代理地址使用；同源请求，无跨域问题。
 * 安全：每跳都经 validateProxyUrlServerSide 校验（DNS 解析 + 拒绝内网），防 SSRF。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');
    const referer = searchParams.get('referer') || '';

    if (!target) {
      return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
    }

    let currentUrl: string;
    try {
      currentUrl = new URL(target).toString();
    } catch {
      return NextResponse.json({ error: '无效的 url' }, { status: 400 });
    }

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      // SSRF 防护：每跳都校验目标（含 DNS 解析，拒绝内网/私有地址/重绑定）
      if (!(await validateProxyUrlServerSide(currentUrl))) {
        return NextResponse.json(
          { error: '禁止访问内网或非法地址' },
          { status: 403 }
        );
      }

      const resp = await fetch(currentUrl, {
        headers: {
          ...(referer ? { Referer: referer } : {}),
          'User-Agent': UA,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });

      // 手动跟随重定向，并对每一跳的 Location 重新校验
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        await resp.body?.cancel();
        if (!location) {
          return NextResponse.json(
            { error: '重定向缺少 location' },
            { status: 502 }
          );
        }
        if (i === MAX_REDIRECTS) {
          return new NextResponse(resp.body, {
            status: resp.status,
            headers: corsHeaders(resp.headers),
          });
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      return new NextResponse(resp.body, {
        status: resp.status,
        headers: corsHeaders(resp.headers),
      });
    }

    return NextResponse.json({ error: '重定向次数超限' }, { status: 502 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 }
    );
  }
}
