import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

export const runtime = 'nodejs';

export const maxDuration = 60; // 设置最大执行时间为 60 秒

/**
 * M3U8 代理接口
 * 用于外部播放器访问,会执行去广告逻辑并处理相对链接
 * GET /api/proxy-m3u8?url=<原始m3u8地址>&source=<播放源>&token=<鉴权token>
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const m3u8Url = searchParams.get('url');
    const source = searchParams.get('source') || '';
    const token = searchParams.get('token');

    // Token 鉴权：如果环境变量设置了 token，则必须验证
    const envToken = process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN;
    if (envToken && envToken.trim() !== '') {
      if (!token || token !== envToken) {
        return NextResponse.json(
          { error: '无效的访问令牌' },
          { status: 401 }
        );
      }
    }

    if (!m3u8Url) {
      return NextResponse.json(
        { error: '缺少必要参数: url' },
        { status: 400 }
      );
    }

    const DIRECT_PLAY_SOURCE = 'directplay';
    // 安全校验：防 SSRF / 域名重绑定，只允许合法的公网 URL。对所有经过 proxy-m3u8 的请求强制校验，不仅限于 directplay
    const isSafeUrl = await validateProxyUrlServerSide(m3u8Url);
    if (!isSafeUrl) {
      return NextResponse.json(
        { error: 'Proxy request to local or invalid network is forbidden' },
        { status: 403 }
      );
    }

    // 获取当前请求的 origin
    // 优先级：SITE_BASE 环境变量 > 从请求头构建
    let origin = process.env.SITE_BASE;
    if (!origin) {
      // 从请求头中获取 Host 和协议
      let host = request.headers.get('host') || request.headers.get('x-forwarded-host');

      // 安全校验：防 Host 头注入漏洞 (要求仅包含合法域名或 IP 格式字符)
      if (host && !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host)) {
        host = null;
      }

      // Fallback：如果以上 Header 无效或未提供，回退到 request.url 获取
      if (!host) {
        try {
          host = new URL(request.url).host;
        } catch {
          return NextResponse.json({ error: 'Invalid Request Host' }, { status: 400 });
        }
      }

      const proto = request.headers.get('x-forwarded-proto') ||
        (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
      origin = `${proto}://${host}`;
    }

    // 获取原始 m3u8 内容
    const m3u8UrlObj = new URL(m3u8Url);
    const response = await fetch(m3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': `${m3u8UrlObj.protocol}//${m3u8UrlObj.host}/`,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: '获取 m3u8 文件失败' },
        { status: response.status }
      );
    }

    // 后端 MIME Sniffing: 防御伪装成 m3u8 的大文件二进制流
    // 使用白名单策略：只有明确属于文本/m3u8 类型的才放行解析
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isTextType = (
      contentType === '' ||                                        // 无 Content-Type 时保守放行（后续有内容校验兜底）
      contentType.includes('application/vnd.apple.mpegurl') ||     // 标准 m3u8
      contentType.includes('application/x-mpegurl') ||             // 兼容 m3u8
      contentType.includes('audio/mpegurl') ||                     // 兼容 m3u8
      contentType.includes('text/') ||                             // text/plain 等
      contentType.includes('application/json')                     // 部分 API 返回 JSON 格式的错误
    );

    if (!isTextType) {
      if (source === DIRECT_PLAY_SOURCE) {
        console.log(`[Proxy-M3U8] 检测到非文本媒体流 (Content-Type: ${contentType}), 针对 directplay 直链代理模式，直接透传二进制流, URL: ${m3u8Url}`);
        // 构造一个新的 Response 对象用于二进制直接透传，确保包含了支持跨域的 header
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');

        // 如果源站返回了跨站相关的禁止头，尽量移除它们
        newHeaders.delete('X-Frame-Options');
        newHeaders.delete('Content-Security-Policy');

        return new NextResponse(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      console.warn(`[Proxy-M3U8] 拦截到非文本媒体流 (Content-Type: ${contentType}), 拒绝按文本解析, URL: ${m3u8Url}`);
      return NextResponse.json(
        {
          error: 'Unsupported Media Type',
          details: `The source returned Content-Type "${contentType}", which is not a text m3u8 playlist.`,
          fallbackToDirect: true,
          originalUrl: m3u8Url
        },
        { status: 415, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    let m3u8Content = await response.text();

    // 二次内容校验：即使 Content-Type 通过了白名单，检查实际内容是否为有效的 m3u8
    // 有些服务器返回 text/plain 但实际内容是 HTML 错误页或其他格式
    const trimmedContent = m3u8Content.trimStart();
    if (trimmedContent.length > 0 && !trimmedContent.startsWith('#EXTM3U') && !trimmedContent.startsWith('#EXT')) {
      console.warn(`[Proxy-M3U8] 内容校验失败：响应体不以 #EXTM3U 或 #EXT 开头, 可能非有效 m3u8, URL: ${m3u8Url}`);
      // 不直接拒绝（可能是不规范但仍可播放的 m3u8），仅打印警告继续处理
    }

    // 执行去广告逻辑
    const config = await getConfig();
    const customAdFilterCode = config.SiteConfig?.CustomAdFilterCode || '';

    if (customAdFilterCode && customAdFilterCode.trim()) {
      try {
        // 移除 TypeScript 类型注解,转换为纯 JavaScript
        const jsCode = customAdFilterCode
          .replace(/(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g, '$1$3')
          .replace(/\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g, ') {')
          .replace(/(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g, '$1 $2 =');

        // 创建并执行自定义函数
        const customFunction = new Function('type', 'm3u8Content',
          jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
        );
        m3u8Content = customFunction(source, m3u8Content);
      } catch (err) {
        console.error('执行自定义去广告代码失败,使用默认规则:', err);
        // 继续使用默认规则
        m3u8Content = filterAdsFromM3U8Default(source, m3u8Content);
      }
    } else {
      // 使用默认去广告规则
      m3u8Content = filterAdsFromM3U8Default(source, m3u8Content);
    }

    // 处理 m3u8 中的相对链接
    m3u8Content = resolveM3u8Links(m3u8Content, m3u8Url, source, origin, token || '');

    // 返回处理后的 m3u8 内容
    return new NextResponse(m3u8Content, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('代理 m3u8 失败:', error);
    return NextResponse.json(
      { error: '代理失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 默认去广告规则（服务端版本）
 * 注意：前端 page.tsx 中的 filterAdsFromM3U8 是客户端侧的去广告逻辑（用于直连模式下由 HLS.js 的自定义 loader 拦截）。
 * 本函数用于代理模式下，在服务端对 m3u8 内容进行去广告处理后再返回给客户端。
 * 两套逻辑需要保持同步更新。
 */
function filterAdsFromM3U8Default(type: string, m3u8Content: string): string {
  if (!m3u8Content) return '';

  // 广告关键字列表
  const adKeywords = [
    'sponsor',
    '/ad/',
    '/ads/',
    'advert',
    'advertisement',
    '/adjump',
    'redtraffic'
  ];

  // 按行分割M3U8内容
  const lines = m3u8Content.split('\n');
  const filteredLines = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 跳过 #EXT-X-DISCONTINUITY 标识
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      i++;
      continue;
    }

    // 如果是 EXTINF 行，检查下一行 URL 是否包含广告关键字
    if (line.includes('#EXTINF:')) {
      // 检查下一行 URL 是否包含广告关键字
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const containsAdKeyword = adKeywords.some(keyword =>
          nextLine.toLowerCase().includes(keyword.toLowerCase())
        );

        if (containsAdKeyword) {
          // 跳过 EXTINF 行和 URL 行
          i += 2;
          continue;
        }
      }
    }

    // 保留当前行
    filteredLines.push(line);
    i++;
  }

  return filteredLines.join('\n');
}

/**
 * 将 m3u8 中的相对链接转换为绝对链接，并将子 m3u8 链接转为代理链接。
 * 此函数仅在代理模式下由服务端调用。
 * - 子 m3u8 链接 → 指向 /api/proxy-m3u8（递归代理）
 * - ts 分片/密钥 → directplay 模式指向 /api/proxy/vod/segment（解决 CORS）
 */
function resolveM3u8Links(m3u8Content: string, baseUrl: string, source: string, proxyOrigin: string, token: string): string {
  const lines = m3u8Content.split('\n');
  const resolvedLines = [];

  // 解析基础URL
  const base = new URL(baseUrl);
  const baseDir = base.href.substring(0, base.href.lastIndexOf('/') + 1);

  let isNextLineUrl = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 处理 EXT-X-KEY 标签中的 URI
    if (line.startsWith('#EXT-X-KEY:')) {
      // 提取 URI 部分
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch && uriMatch[1]) {
        let keyUri = uriMatch[1];

        // 转换为绝对路径
        if (!keyUri.startsWith('http://') && !keyUri.startsWith('https://')) {
          if (keyUri.startsWith('/')) {
            keyUri = `${base.protocol}//${base.host}${keyUri}`;
          } else {
            keyUri = new URL(keyUri, baseDir).href;
          }
        }

        // 直链播放模式：通过代理访问密钥，避免 CORS 问题
        if (source === 'directplay') {
          keyUri = `${proxyOrigin}/api/proxy/vod/segment?url=${encodeURIComponent(keyUri)}&source=directplay`;
        }

        // 替换原来的 URI
        line = line.replace(/URI="[^"]+"/, `URI="${keyUri}"`);
      }
      resolvedLines.push(line);
      continue;
    }

    // 注释行直接保留
    if (line.startsWith('#')) {
      resolvedLines.push(line);
      // 检查是否是 EXT-X-STREAM-INF，下一行将是子 m3u8
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        isNextLineUrl = true;
      }
      continue;
    }

    // 空行直接保留
    if (line.trim() === '') {
      resolvedLines.push(line);
      continue;
    }

    // 处理 URL 行
    let url = line.trim();

    // 1. 先转换为绝对 URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.startsWith('/')) {
        // 以 / 开头，相对于域名根目录
        url = `${base.protocol}//${base.host}${url}`;
      } else {
        // 相对于当前目录
        url = new URL(url, baseDir).href;
      }
    }

    // 2. 检查是否是子 m3u8，如果是，转换为代理链接
    const isM3u8 = url.includes('.m3u8') || isNextLineUrl;
    if (isM3u8) {
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
      url = `${proxyOrigin}/api/proxy-m3u8?url=${encodeURIComponent(url)}${source ? `&source=${encodeURIComponent(source)}` : ''}${tokenParam}`;
    } else if (source === 'directplay') {
      // 直链播放模式：通过代理访问媒体分片（ts/jpeg/png 等），避免 CORS 问题
      url = `${proxyOrigin}/api/proxy/vod/segment?url=${encodeURIComponent(url)}&source=directplay`;
    }

    resolvedLines.push(url);
    isNextLineUrl = false;
  }

  return resolvedLines.join('\n');
}
