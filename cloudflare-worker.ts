// Cloudflare Workers 自定义入口 —— wrangler.toml 的 main 指向本文件。
//
// OpenNext 生成的 .open-next/worker.js 只导出 fetch，而：
//   * Durable Object 类必须由入口 export 出去才会被注册；
//   * Cloudflare 的定时任务要在入口 export 一个 scheduled。
// 所以这里把 OpenNext 的 fetch 复用过来，再补上上面两样。
//
// 参考：https://opennext.js.org/cloudflare/howtos/custom-worker

// @ts-ignore 构建期由 opennextjs-cloudflare 生成
import openNextWorker from './.open-next/worker.js';
import type { DurableObjectNamespace, ExecutionContext } from './src/worker/cf-runtime';

// 转发 OpenNext 自带的具名导出（DOQueueHandler / DOShardedTagCache / BucketCachePurge）。
// 当前 open-next.config.ts 用的是 dummy 缓存/队列，暂时用不到；但一旦换成真缓存，
// 这些类必须在入口注册，所以这里原样转发。
// @ts-ignore 构建期由 opennextjs-cloudflare 生成
export * from './.open-next/worker.js';

export { WatchRoomHub } from './src/worker/watch-room-hub';

interface Env {
  WATCH_ROOM: DurableObjectNamespace;
  CRON_PASSWORD?: string;
  [key: string]: unknown;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 观影室的 Socket.IO 连接：整体交给 hub DO。
    // 客户端在 internal 模式下连同源 /socket.io（server-config 默认就是 internal），
    // 所以这里在进 Next 之前拦下来。
    if (url.pathname === '/socket.io' || url.pathname.startsWith('/socket.io/')) {
      const id = env.WATCH_ROOM.idFromName('hub');
      return env.WATCH_ROOM.get(id).fetch(request);
    }

    return openNextWorker.fetch(request, env, ctx);
  },

  // 定时任务：直接内部打一次 /api/cron/<password>。
  // wrangler.toml 里 CRON_WAIT_FOR_COMPLETION="true"，路由会等任务跑完再返回，
  // 所以这里 await（不要用 ctx.waitUntil —— 那是"先返回后台继续"的语义）。
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    const password = env.CRON_PASSWORD || 'mtvpls';
    const url = new URL(`/api/cron/${password}`, 'https://internal.invalid');
    await openNextWorker.fetch(new Request(url), env, ctx);
  },
};
