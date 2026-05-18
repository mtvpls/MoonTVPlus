import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { opdsClient } from '@/lib/opds.client';

import { getAuthorizedBooksUsername } from '../_utils';

export const runtime = 'nodejs';

type FilePayload = {
  sourceId?: string;
  bookId?: string;
  href?: string;
  format?: 'epub' | 'pdf' | null;
};

async function resolveFileHref(username: string, payload: FilePayload): Promise<{ sourceId: string; href: string }> {
  const sourceId = payload.sourceId?.trim();
  if (!sourceId) throw new Error('缺少 sourceId');

  if (payload.href?.trim()) {
    return { sourceId, href: payload.href.trim() };
  }

  const bookId = payload.bookId?.trim();
  if (!bookId) throw new Error('缺少 bookId 或 href');

  const shelfItem = await db.getBookShelf(username, sourceId, bookId);
  const readRecord = await db.getBookReadRecord(username, sourceId, bookId);
  const directHref = shelfItem?.acquisitionHref || readRecord?.acquisitionHref;
  if (directHref) {
    return { sourceId, href: directHref };
  }

  const detailHref = shelfItem?.detailHref || readRecord?.detailHref;
  if (!detailHref) throw new Error('找不到可下载文件');

  const preferred = await opdsClient.getPreferredAcquisition(sourceId, detailHref);
  if (payload.format && preferred.format !== payload.format) {
    const detail = await opdsClient.getBookDetail(sourceId, detailHref);
    const matched = detail.acquisitionLinks.find((item) => (payload.format === 'pdf' ? item.type.toLowerCase().includes('pdf') : item.type.toLowerCase().includes('epub')));
    if (!matched?.href) throw new Error('找不到对应格式文件');
    return { sourceId, href: matched.href };
  }

  return { sourceId, href: preferred.href };
}

async function proxyFile(request: NextRequest, sourceId: string, href: string) {
  const source = await opdsClient.getSourceById(sourceId);
  const headers = new Headers();
  if (source.authMode === 'basic' && source.username) {
    headers.set('Authorization', `Basic ${Buffer.from(`${source.username}:${source.password || ''}`).toString('base64')}`);
  } else if (source.authMode === 'header' && source.headerName && source.headerValue) {
    headers.set(source.headerName, source.headerValue);
  }
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);

  const response = await fetch(href, {
    headers,
    redirect: 'follow',
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json({ error: `文件代理失败: ${response.status}` }, { status: response.status });
  }

  const outHeaders = new Headers();
  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');
  const acceptRanges = response.headers.get('accept-ranges');
  const contentRange = response.headers.get('content-range');
  const disposition = response.headers.get('content-disposition');
  const normalizedHref = href.toLowerCase();
  const resolvedContentType = contentType || (normalizedHref.endsWith('.pdf') ? 'application/pdf' : normalizedHref.endsWith('.epub') ? 'application/epub+zip' : '');
  if (resolvedContentType) outHeaders.set('Content-Type', resolvedContentType);
  if (contentLength) outHeaders.set('Content-Length', contentLength);
  if (acceptRanges) outHeaders.set('Accept-Ranges', acceptRanges);
  if (contentRange) outHeaders.set('Content-Range', contentRange);
  if (disposition) outHeaders.set('Content-Disposition', disposition);
  outHeaders.set('Cache-Control', 'private, max-age=300');

  return new NextResponse(response.body, {
    status: response.status,
    headers: outHeaders,
  });
}

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const resolved = await resolveFileHref(username, {
      sourceId: searchParams.get('sourceId') || undefined,
      bookId: searchParams.get('bookId') || undefined,
      href: searchParams.get('href') || undefined,
      format: (searchParams.get('format')?.trim() as 'epub' | 'pdf' | null) || null,
    });
    return await proxyFile(request, resolved.sourceId, resolved.href);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const payload = await request.json() as FilePayload;
    const resolved = await resolveFileHref(username, payload);
    return await proxyFile(request, resolved.sourceId, resolved.href);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
