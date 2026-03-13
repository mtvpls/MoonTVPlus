import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const apiSites = await getAvailableApiSites(authInfo.username);

    return NextResponse.json({
      sources: apiSites.map((site) => ({
        key: site.key,
        name: site.name,
        api: site.api,
      })),
    });
  } catch (error) {
    console.error('Failed to get available API sites:', error);
    return NextResponse.json(
      { error: 'Failed to load sources' },
      { status: 500 },
    );
  }
}
