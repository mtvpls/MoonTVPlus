/* eslint-disable @typescript-eslint/no-explicit-any */

import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

/**
 * 针对 Node.js 24 + node-fetch v2 的 keep-alive 竞态修复。
 *
 * 背景：当一条 chunked 响应（含结束块）在单个 TCP 段内到达时，Node 的 http 解析器
 * 会在 node-fetch 挂上 body 的 data 监听器之前就把连接归还空闲池并触发 'close'，
 * node-fetch 的 fixResponseChunkedTransferBadEnding() 会把这种正常响应误判为
 * “Premature close”，抛 ERR_STREAM_PREMATURE_CLOSE。
 *
 * 这是时序竞态：同样代码在部分机器上 100% 必现，在其他机器上 0% 复现（与 Node 版本无关）。
 * 因此不能按环境/版本判断，只能按“错误是否真的发生”来判断。
 *
 * 策略（对其他机器零影响）：
 * - 进程级门闩 useNonKeepAliveAgent 初始为 false，行为与现状完全一致
 *   （无代理 → node-fetch 默认 keep-alive；有代理 → HttpsProxyAgent keepAlive:false）。
 * - 只有真正捕获到 ERR_STREAM_PREMATURE_CLOSE 时才翻转门闩，此后无代理请求改用
 *   keepAlive:false 的 agent。其他机器上该错误从不发生 → 门闩永不翻转 → 行为零变化。
 */

/** 进程级门闩：是否已在本机命中 PREMATURE_CLOSE 竞态 */
let useNonKeepAliveAgent = false;

/** 代理路径保持现状（keepAlive:false）；无代理路径由门闩控制 keep-alive */
export function makeFetchAgent(proxy?: string | null): https.Agent | HttpsProxyAgent<string> | undefined {
  if (proxy) {
    return new HttpsProxyAgent(proxy, {
      timeout: 30000,
      keepAlive: false,
    });
  }
  if (useNonKeepAliveAgent) {
    return new https.Agent({ keepAlive: false });
  }
  return undefined;
}

function isPrematureClose(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === 'ERR_STREAM_PREMATURE_CLOSE'
  );
}

/**
 * 真正执行一次 node-fetch 请求。
 * init 中若带有 agent 会被剔除，agent 一律由 makeFetchAgent(proxy) 按门闩状态决定，
 * 保证无代理路径的 keep-alive 行为完全由门闩控制。
 */
function doFetch(
  url: string,
  init: RequestInit | undefined,
  proxy?: string | null,
  forceNonKeepAlive = false
): Promise<Response> {
  const opts: any = { ...(init || {}) };
  delete opts.agent;

  // 仅用于重试时的临时强制（门闩尚未翻转但当前请求已确认命中竞态）
  if (forceNonKeepAlive && !proxy && !useNonKeepAliveAgent) {
    opts.agent = new https.Agent({ keepAlive: false });
  } else {
    const agent = makeFetchAgent(proxy);
    if (agent) opts.agent = agent;
  }

  return nodeFetch(url, opts) as unknown as Promise<Response>;
}

/**
 * 包装响应对象：json/text/arrayBuffer 等 body 读取在命中 PREMATURE_CLOSE 时自动
 * 用非 keep-alive agent 重试一次（仅 GET），其余属性/方法透传底层 node-fetch 响应。
 * 这样调用方既有的 response.json()/.text()/.ok/.status 等用法无需改动。
 */
function wrapResponse(
  res: Response,
  url: string,
  init: RequestInit | undefined,
  proxy?: string | null
): Response {
  let readRetried = false;
  const target = res as any;
  const methodNames = ['json', 'text', 'arrayBuffer', 'buffer', 'blob', 'formData'];

  return new Proxy(target, {
    get(inner, prop, receiver) {
      if (typeof prop === 'string' && methodNames.includes(prop)) {
        return (...args: unknown[]) => {
          const read = () => inner[prop](...args);
          if (readRetried) return read();
          return read().catch((err: unknown) => {
            if (isPrematureClose(err) && !(init?.method && init.method !== 'GET')) {
              // 只在 GET 时重试，避免 POST/webhook 等重复投递
              readRetried = true;
              useNonKeepAliveAgent = true; // 翻转门闩：后续请求全部走非 keep-alive
              const retried = doFetch(url, init, proxy, true);
              return retried.then((r2) => {
                const inner2 = r2 as any;
                return inner2[prop](...args);
              });
            }
            throw err;
          });
        };
      }
      const value = Reflect.get(inner, prop, receiver);
      return typeof value === 'function' ? value.bind(inner) : value;
    },
  });
}

/**
 * 安全的 node-fetch 封装（GET/POST 通用）。
 * - 其他机器：门闩恒 false，行为与直接 node-fetch 完全一致（keep-alive 默认、无额外请求）。
 * - 命中竞态的机器：body 读取遇 PREMATURE_CLOSE 时，GET 自动用非 keep-alive agent 重试一次
 *   并锁定门闩，后续全部请求直通安全路径。
 *
 * @param url 请求地址
 * @param init 与 node-fetch 相同的请求配置（method/headers/body/signal…）
 * @param proxy 代理地址（有代理时使用 HttpsProxyAgent，keepAlive:false，与现状一致）
 */
export function safeFetch(
  url: string,
  init?: RequestInit,
  proxy?: string | null
): Promise<Response> {
  return doFetch(url, init, proxy).then((res) => wrapResponse(res, url, init, proxy));
}
