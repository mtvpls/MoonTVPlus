import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { SPECIAL_SOURCE_COOKIE } from '@/lib/special-source.client';

import { SearchPageClient } from '@/app/search/page';

export const dynamic = 'force-dynamic';

/**
 * /under 特殊源专属入口。
 * 复用搜索页，仅把 searchBase 换成 /under；源的双向隔离由
 * getAvailableApiSites(user, specialOnly) 在服务端完成。
 */
export default function UnderPage() {
  // 本机开关（在 /sp 切换）没开时，这个入口等于不存在
  if (cookies().get(SPECIAL_SOURCE_COOKIE)?.value !== '1') {
    notFound();
  }

  return (
    <Suspense>
      <SearchPageClient searchBase='/under' />
    </Suspense>
  );
}
