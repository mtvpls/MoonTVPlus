/**
 * 统一的 fetch 函数，支持可选的代理
 *
 * 在所有环境下使用原生 fetch。Node.js 环境下通过 undici ProxyAgent 支持代理。
 * Cloudflare 环境下忽略代理参数。
 */
export async function universalFetch(
  url: string,
  proxy?: string,
): Promise<Response> {
  const isCloudflare =
    process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';

  if (!isCloudflare && proxy) {
    // Dynamic import to avoid bundling undici (node:crypto) into client-side code
    const { ProxyAgent } = await import('undici');
    return fetch(url, {
      signal: AbortSignal.timeout(30000),
      // @ts-expect-error -- dispatcher is a Node.js-only undici option
      dispatcher: new ProxyAgent({
        uri: proxy,
        requestTls: { timeout: 30000 },
      }),
    });
  }

  return fetch(url, {
    signal: AbortSignal.timeout(15000),
  });
}
