import type { AdminConfig } from '@/lib/admin.types';

export const BUILTIN_DANMAKU_API_BASE = 'https://mtvpls-danmu.netlify.app/87654321';
export const BUILTIN_DANMAKU_API_TOKEN = '87654321';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getDanmakuApiBaseUrl(siteConfig: AdminConfig['SiteConfig']) {
  if (siteConfig.DanmakuSourceType === 'builtin') {
    return BUILTIN_DANMAKU_API_BASE;
  }

  const base = trimTrailingSlash(siteConfig.DanmakuApiBase || 'http://localhost:9321');
  const token = (siteConfig.DanmakuApiToken || BUILTIN_DANMAKU_API_TOKEN).trim();

  return token === BUILTIN_DANMAKU_API_TOKEN ? base : `${base}/${token}`;
}
