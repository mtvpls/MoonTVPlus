'use client';

import { useEffect } from 'react';

import { initStartupCacheCleanup } from '@/lib/startup/cacheCleanup';

/**
 * 启动缓存清理组件
 * 在应用启动时异步执行一次缓存清理
 */
export function StartupCacheCleanup() {
  useEffect(() => {
    initStartupCacheCleanup();
  }, []);

  return null;
}
