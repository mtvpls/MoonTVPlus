/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites } from '@/lib/config';
import { listEnabledSourceScripts } from '@/lib/source-script';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  console.log('request', request.url);
  try {
    const apiSites = await getAvailableApiSites();
    const scriptSites = (await listEnabledSourceScripts()).map((item) => ({
      key: item.key,
      name: item.name,
      script: true,
    }));

    return NextResponse.json([...apiSites, ...scriptSites]);
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
