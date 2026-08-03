import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getConfig } from '@/lib/config';

import { SearchPageClient } from '@/app/search/page';

export const dynamic = 'force-dynamic';

/**
 * /r18 特殊源专属入口。
 * 复用搜索页，仅把 searchBase 换成 /r18；源的双向隔离由
 * getAvailableApiSites(user, specialOnly) 在服务端完成。
 */
export default async function R18Page() {
  const config = await getConfig();
  // site/sp 开关关闭时该入口不存在
  if (!config.SiteConfig.EnableSpecialSources) {
    notFound();
  }

  return (
    <Suspense>
      <SearchPageClient searchBase='/r18' />
    </Suspense>
  );
}
