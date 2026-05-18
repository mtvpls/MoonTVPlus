/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  buildNetdiskCheckCacheKey,
  clearNetdiskCheckInflight,
  getCachedNetdiskCheckResult,
  getNetdiskCheckInflight,
  setCachedNetdiskCheckResult,
  setNetdiskCheckInflight,
} from './cache';
import type { NetdiskCheckPlatform, NetdiskCheckResult } from './types';
import { check115 } from './vendor/checkers/pan115';
import { checkAliyun } from './vendor/checkers/aliyun';
import { checkBaidu } from './vendor/checkers/baidu';
import { checkCMCC } from './vendor/checkers/cmcc';
import { check123 } from './vendor/checkers/pan123';
import { checkQuark } from './vendor/checkers/quark';
import { checkTianyi } from './vendor/checkers/tianyi';
import { checkUC } from './vendor/checkers/uc';
import { checkXunlei } from './vendor/checkers/xunlei';

const RATE_LIMIT_REASON_PATTERNS = [/频率限制/i, /请求过快/i, /rate.?limit/i, /too many/i, /风控/i];

type RawCheckerResult = {
  valid?: boolean;
  reason?: string;
  isRateLimited?: boolean;
};

const PLATFORM_PATTERNS: Record<NetdiskCheckPlatform, RegExp[]> = {
  '115': [/115(?:cdn)?\.com\/s\//i, /anxia\.com\/s\//i],
  quark: [/pan\.quark\.cn\/s\//i, /pan\.qoark\.cn\/s\//i],
  aliyun: [/aliyundrive\.com\/s\//i, /alipan\.com\/s\//i],
  baidu: [/pan\.baidu\.com\/s\//i, /pan\.baidu\.com\/share\//i],
  tianyi: [/cloud\.189\.cn\/web\/share/i, /cloud\.189\.cn\/t\//i, /h5\.cloud\.189\.cn\/share/i],
  pan123: [/123(?:pan|684|685|912|592|865)\.(?:com|cn)\/s\//i],
  uc: [/drive\.uc\.cn\/s\//i, /yun\.uc\.cn\/s\//i],
  xunlei: [/pan\.xunlei\.com\/s\//i],
  cmcc: [/yun\.139\.com\/shareweb/i, /caiyun\.139\.com\/m\/i/i],
};

const CHECKERS: Record<NetdiskCheckPlatform, (url: string) => Promise<RawCheckerResult>> = {
  '115': check115,
  aliyun: checkAliyun,
  baidu: checkBaidu,
  cmcc: checkCMCC,
  pan123: check123,
  quark: checkQuark,
  tianyi: checkTianyi,
  uc: checkUC,
  xunlei: checkXunlei,
};

export function normalizeNetdiskCheckUrl(url: string) {
  return url.trim().replace(/\s+/g, '').replace(/\/+$/, '');
}

export function detectNetdiskCheckPlatform(url: string): NetdiskCheckPlatform | null {
  const normalized = normalizeNetdiskCheckUrl(url);
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS) as Array<[NetdiskCheckPlatform, RegExp[]]>) {
    if (patterns.some((pattern) => pattern.test(normalized))) return platform;
  }
  return null;
}

function isRateLimitedResult(result: RawCheckerResult) {
  if (result.isRateLimited) return true;
  const reason = String(result.reason || '');
  return RATE_LIMIT_REASON_PATTERNS.some((pattern) => pattern.test(reason));
}

function toFinalResult(
  platform: NetdiskCheckPlatform,
  url: string,
  normalizedUrl: string,
  raw: RawCheckerResult,
  durationMs: number
): NetdiskCheckResult {
  const checkedAt = Date.now();
  const rateLimited = isRateLimitedResult(raw);
  if (rateLimited) {
    return {
      platform,
      url,
      normalizedUrl,
      status: 'rate_limited',
      valid: null,
      reason: raw.reason || '检测受限',
      checkedAt,
      durationMs,
      isRateLimited: true,
    };
  }
  if (raw.valid === true) {
    return {
      platform,
      url,
      normalizedUrl,
      status: 'valid',
      valid: true,
      reason: raw.reason || '',
      checkedAt,
      durationMs,
    };
  }
  if (raw.valid === false) {
    return {
      platform,
      url,
      normalizedUrl,
      status: 'invalid',
      valid: false,
      reason: raw.reason || '链接无效',
      checkedAt,
      durationMs,
    };
  }
  return {
    platform,
    url,
    normalizedUrl,
    status: 'unknown',
    valid: null,
    reason: raw.reason || '无法确认链接状态',
    checkedAt,
    durationMs,
  };
}

export async function checkNetdiskLink(platform: NetdiskCheckPlatform, url: string): Promise<NetdiskCheckResult> {
  const normalizedUrl = normalizeNetdiskCheckUrl(url);
  const cacheKey = buildNetdiskCheckCacheKey(platform, normalizedUrl);
  const cached = getCachedNetdiskCheckResult(cacheKey);
  if (cached) return cached;

  const inflight = getNetdiskCheckInflight(cacheKey);
  if (inflight) return inflight;

  const runner = (async () => {
    const startedAt = Date.now();
    try {
      const checker = CHECKERS[platform];
      if (typeof checker !== 'function') {
        throw new Error(`未找到 ${platform} 检测器`);
      }
      const raw = await checker(normalizedUrl);
      const finalResult = toFinalResult(platform, url, normalizedUrl, raw, Date.now() - startedAt);
      setCachedNetdiskCheckResult(cacheKey, finalResult);
      return finalResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : '检测失败';
      const result: NetdiskCheckResult = {
        platform,
        url,
        normalizedUrl,
        status: 'unknown',
        valid: null,
        reason: message,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      };
      setCachedNetdiskCheckResult(cacheKey, result);
      return result;
    } finally {
      clearNetdiskCheckInflight(cacheKey);
    }
  })();

  setNetdiskCheckInflight(cacheKey, runner);
  return runner;
}
