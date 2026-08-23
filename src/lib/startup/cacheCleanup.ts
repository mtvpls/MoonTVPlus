import { clearExpiredDanmakuCache } from '@/lib/danmaku/cache';
import { initRecommendationCacheModule } from '@/lib/recommendations/cache';

let startupCacheCleanupInitialized = false;

export function initStartupCacheCleanup(): void {
  if (typeof window === 'undefined' || startupCacheCleanupInitialized) {
    return;
  }

  startupCacheCleanupInitialized = true;

  // 直接调用弹幕缓存清理，避免 import 整个 danmaku/api.ts
  // （该文件含 opencc-js 动态加载，会把 ~1.9MB 繁简字典打进服务端 bundle）
  clearExpiredDanmakuCache()
    .then((count) => {
      if (count > 0) {
        console.log(`[弹幕缓存] 启动清理: 已删除 ${count} 个过期缓存`);
      }
    })
    .catch((error) => {
      console.error('[弹幕缓存] 清理失败:', error);
    });

  initRecommendationCacheModule();
}
