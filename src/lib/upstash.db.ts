/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { UpstashRedisAdapter } from './redis-adapter';
import { BaseRedisStorage } from './redis-base.db';

const DEFAULT_UPSTASH_TIMEOUT_MS =
  process.env.NODE_ENV === 'development' ? 2500 : 8000;
const UPSTASH_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.UPSTASH_TIMEOUT_MS || DEFAULT_UPSTASH_TIMEOUT_MS)
);
const DEFAULT_UPSTASH_RETRIES =
  process.env.NODE_ENV === 'development' ? 1 : 3;
const UPSTASH_MAX_RETRIES = Math.max(
  1,
  Number(process.env.UPSTASH_MAX_RETRIES || DEFAULT_UPSTASH_RETRIES)
);

function createUpstashAbortSignal() {
  return AbortSignal.timeout(UPSTASH_TIMEOUT_MS);
}

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = UPSTASH_MAX_RETRIES
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.name === 'AbortError' ||
        err.name === 'TimeoutError' ||
        err.message?.includes('Aborted') ||
        err.message?.includes('Timeout') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage extends BaseRedisStorage {
  constructor() {
    const client = getUpstashRedisClient();
    const adapter = new UpstashRedisAdapter(client);
    super(adapter, withRetry);
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 创建 Upstash Redis 客户端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      signal: createUpstashAbortSignal,
      // 可选配置
      retry: {
        retries: UPSTASH_MAX_RETRIES,
        backoff: (retryCount: number) =>
          Math.min(500 * Math.pow(2, retryCount), 5000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}
