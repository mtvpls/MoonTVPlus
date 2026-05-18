import type { NetdiskCheckPlatform, NetdiskCheckResult } from './types';

const CACHE_TTL_MS = {
  valid: 30 * 60 * 1000,
  invalid: 6 * 60 * 60 * 1000,
  unknown: 3 * 60 * 1000,
  rate_limited: 2 * 60 * 1000,
} as const;

const MAX_CACHE_SIZE = 3000;
const CACHE = new Map<string, { expiresAt: number; result: NetdiskCheckResult }>();
const INFLIGHT = new Map<string, Promise<NetdiskCheckResult>>();

function pruneExpired() {
  const now = Date.now();
  for (const [key, value] of Array.from(CACHE.entries())) {
    if (value.expiresAt <= now) CACHE.delete(key);
  }
}

function evictIfNeeded() {
  pruneExpired();
  if (CACHE.size <= MAX_CACHE_SIZE) return;
  const overflow = CACHE.size - MAX_CACHE_SIZE;
  const keys = CACHE.keys();
  for (let i = 0; i < overflow; i += 1) {
    const key = keys.next().value;
    if (!key) break;
    CACHE.delete(key);
  }
}

export function buildNetdiskCheckCacheKey(platform: NetdiskCheckPlatform, normalizedUrl: string) {
  return `${platform}:${normalizedUrl}`;
}

export function getCachedNetdiskCheckResult(cacheKey: string): NetdiskCheckResult | null {
  pruneExpired();
  const cached = CACHE.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    CACHE.delete(cacheKey);
    return null;
  }
  return { ...cached.result, fromCache: true };
}

export function setCachedNetdiskCheckResult(cacheKey: string, result: NetdiskCheckResult) {
  const ttl =
    result.status === 'valid'
      ? CACHE_TTL_MS.valid
      : result.status === 'invalid'
        ? CACHE_TTL_MS.invalid
        : result.status === 'rate_limited'
          ? CACHE_TTL_MS.rate_limited
          : CACHE_TTL_MS.unknown;
  CACHE.set(cacheKey, {
    expiresAt: Date.now() + ttl,
    result: { ...result, fromCache: false },
  });
  evictIfNeeded();
}

export function getNetdiskCheckInflight(cacheKey: string) {
  return INFLIGHT.get(cacheKey) || null;
}

export function setNetdiskCheckInflight(cacheKey: string, promise: Promise<NetdiskCheckResult>) {
  INFLIGHT.set(cacheKey, promise);
}

export function clearNetdiskCheckInflight(cacheKey: string) {
  INFLIGHT.delete(cacheKey);
}
