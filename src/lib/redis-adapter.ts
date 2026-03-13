/* eslint-disable @typescript-eslint/no-explicit-any */

import { Redis } from '@upstash/redis';
import { RedisClientType } from 'redis';

/**
 * 统一的 Redis 适配器接口
 * 只抽象 API 命名差异，不处理序列化（由调用者负责）
 */
export interface RedisAdapter {
  // Hash 操作
  hSet(key: string, field: string, value: string): Promise<number>;
  hSet(key: string, data: Record<string, string>): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, ...fields: string[]): Promise<number>;

  // String 操作
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  del(keys: string | string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  mGet(keys: string[]): Promise<(string | null)[]>;

  // List 操作
  lPush(key: string, ...values: string[]): Promise<number>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  lRem(key: string, count: number, value: string): Promise<number>;
  lTrim(key: string, start: number, stop: number): Promise<void>;

  // Set 操作
  sAdd(key: string, ...members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  sRem(key: string, ...members: string[]): Promise<number>;

  // Sorted Set 操作
  zAdd(key: string, member: { score: number; value: string }): Promise<number>;
  zRange(key: string, start: number, stop: number): Promise<string[]>;
  zCard(key: string): Promise<number>;
  zRem(key: string, ...members: string[]): Promise<number>;
}

/**
 * 标准 Redis 客户端适配器（用于 Redis 和 Kvrocks）
 * 只处理 API 命名，不处理序列化
 */
export class StandardRedisAdapter implements RedisAdapter {
  constructor(private client: RedisClientType) {}

  // Hash 操作
  async hSet(
    key: string,
    fieldOrData: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    if (typeof fieldOrData === 'string') {
      return this.client.hSet(key, fieldOrData, value!);
    } else {
      return this.client.hSet(key, fieldOrData);
    }
  }

  async hGet(key: string, field: string): Promise<string | null> {
    const val = await this.client.hGet(key, field);
    return val ?? null;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.client.hGetAll(key);
  }

  async hDel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hDel(key, fields);
  }

  // String 操作
  async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(keys: string | string[]): Promise<number> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    if (keyArray.length === 0) return 0;
    return this.client.del(keyArray);
  }

  async exists(...keys: string[]): Promise<number> {
    return this.client.exists(keys);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async mGet(keys: string[]): Promise<(string | null)[]> {
    return this.client.mGet(keys);
  }

  // List 操作
  async lPush(key: string, ...values: string[]): Promise<number> {
    return this.client.lPush(key, values);
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lRange(key, start, stop);
  }

  async lRem(key: string, count: number, value: string): Promise<number> {
    return this.client.lRem(key, count, value);
  }

  async lTrim(key: string, start: number, stop: number): Promise<void> {
    await this.client.lTrim(key, start, stop);
  }

  // Set 操作
  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.client.sAdd(key, members);
  }

  async sMembers(key: string): Promise<string[]> {
    return Array.from(await this.client.sMembers(key));
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.client.sRem(key, members);
  }

  // Sorted Set 操作
  async zAdd(
    key: string,
    member: { score: number; value: string },
  ): Promise<number> {
    return this.client.zAdd(key, member);
  }

  async zRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zRange(key, start, stop);
  }

  async zCard(key: string): Promise<number> {
    return this.client.zCard(key);
  }

  async zRem(key: string, ...members: string[]): Promise<number> {
    return this.client.zRem(key, members);
  }
}

/**
 * Upstash Redis 客户端适配器（用于 Upstash REST API）
 * 处理 API 命名差异和 Upstash 的自动序列化
 */
export class UpstashRedisAdapter implements RedisAdapter {
  constructor(private client: Redis) {}

  // Hash 操作
  async hSet(
    key: string,
    fieldOrData: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    if (typeof fieldOrData === 'string') {
      // Upstash 会自动序列化，但我们传入的已经是字符串，所以直接存储
      return this.client.hset(key, { [fieldOrData]: value! });
    } else {
      return this.client.hset(key, fieldOrData);
    }
  }

  async hGet(key: string, field: string): Promise<string | null> {
    const val = await this.client.hget(key, field);
    if (val === null || val === undefined) return null;
    // Upstash 可能返回对象、字符串或其他类型
    // 需要统一转换为字符串
    if (typeof val === 'string') return val;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const hashData = await this.client.hgetall(key);
    if (!hashData) return {};
    // 确保所有值都是字符串
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(hashData)) {
      if (typeof v === 'string') {
        result[k] = v;
      } else if (typeof v === 'object') {
        result[k] = JSON.stringify(v);
      } else {
        result[k] = String(v);
      }
    }
    return result;
  }

  async hDel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  // String 操作
  async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    const val = await this.client.get(key);
    if (val === null || val === undefined) return null;
    // Upstash 可能返回对象、字符串或其他类型
    if (typeof val === 'string') return val;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  async del(keys: string | string[]): Promise<number> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    if (keyArray.length === 0) return 0;
    return this.client.del(...keyArray);
  }

  async exists(...keys: string[]): Promise<number> {
    return this.client.exists(...keys);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async mGet(keys: string[]): Promise<(string | null)[]> {
    const values = await this.client.mget(...keys);
    return values.map((v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    });
  }

  // List 操作
  async lPush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    const values = await this.client.lrange(key, start, stop);
    return values.map((v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    });
  }

  async lRem(key: string, count: number, value: string): Promise<number> {
    return this.client.lrem(key, count, value);
  }

  async lTrim(key: string, start: number, stop: number): Promise<void> {
    await this.client.ltrim(key, start, stop);
  }

  // Set 操作
  async sAdd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, members[0], ...members.slice(1));
  }

  async sMembers(key: string): Promise<string[]> {
    const members = await this.client.smembers(key);
    return members.map((m) => {
      if (typeof m === 'string') return m;
      if (typeof m === 'object') return JSON.stringify(m);
      return String(m);
    });
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  // Sorted Set 操作
  async zAdd(
    key: string,
    member: { score: number; value: string },
  ): Promise<number> {
    const result = await this.client.zadd(key, {
      score: member.score,
      member: member.value,
    });
    return result || 0;
  }

  async zRange(key: string, start: number, stop: number): Promise<string[]> {
    const values = await this.client.zrange(key, start, stop);
    return values.map((v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    });
  }

  async zCard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async zRem(key: string, ...members: string[]): Promise<number> {
    return this.client.zrem(key, ...members);
  }
}
