import type { NextRequest } from 'next/server';

export const TVBOX_CMS_PAGE_SIZE = 20;

export function getTVBoxCMSPage(searchParams: URLSearchParams): number {
  const page = Number(searchParams.get('pg') || '1');
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function getTVBoxCMSBaseUrl(request: NextRequest): string {
  if (process.env.SITE_BASE) return process.env.SITE_BASE.replace(/\/+$/, '');
  const host =
    request.headers.get('host') ||
    request.headers.get('x-forwarded-host') ||
    request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** TVBox 不会像浏览器一样将海报相对地址补成本项目域名。 */
export function getTVBoxCMSImageUrl(url: string, request: NextRequest): string {
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${getTVBoxCMSBaseUrl(request)}/${url.replace(/^\/+/, '')}`;
}
