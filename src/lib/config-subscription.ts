import { isCloudflareEnvironment } from '@/lib/bangumi.server';
import { safeFetch } from '@/lib/safe-http';

/**
 * 解析拉取配置代理地址：优先使用配置订阅中的值（ConfigSubscribtion.Proxy），
 * 其次回退到环境变量 CONFIG_SUBSCRIPTION_PROXY。用于拉取配置订阅（手动拉取 /
 * 定时自动更新 / 启动时按环境变量拉取）。
 */
export function resolveConfigSubscriptionProxy(
  configProxy?: string | null
): string {
  return (
    (configProxy || '').trim() ||
    (process.env.CONFIG_SUBSCRIPTION_PROXY || '').trim()
  );
}

/**
 * 拉取配置订阅内容，支持代理（参考 TMDB 系统代理的实现）。
 * - Cloudflare Workers：使用原生 fetch，忽略代理（Workers 不支持代理 Agent）
 * - Node.js：走 safeFetch（node-fetch + HttpsProxyAgent），传入拉取配置代理
 */
export function fetchConfigSubscription(
  url: string,
  proxy?: string | null
): Promise<Response> {
  const resolvedProxy = resolveConfigSubscriptionProxy(proxy);

  if (isCloudflareEnvironment()) {
    return fetch(url, {
      signal: AbortSignal.timeout(15000),
    });
  }

  const signal = resolvedProxy
    ? AbortSignal.timeout(30000)
    : AbortSignal.timeout(15000);
  return safeFetch(url, { signal }, resolvedProxy);
}
