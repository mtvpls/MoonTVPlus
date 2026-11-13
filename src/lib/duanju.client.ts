/* 短剧分类名判断：纯函数，客户端组件（play 页的「短剧模式」入口）也要用。
   不能留在 lib/duanju.ts —— 那边 import 了 @/lib/db，而 db 在模块加载时就会
   实例化存储（export const db = new DbManager()），客户端在
   NEXT_PUBLIC_STORAGE_TYPE=d1 下会直接抛 "D1Storage can only be used on the server side"，
   把引用它的页面整页打挂。 */

export function isDuanjuTypeName(typeName: string): boolean {
  const normalizedTypeName = typeName.toLowerCase();
  return (
    normalizedTypeName.includes('短剧') ||
    normalizedTypeName.includes('短视频') ||
    normalizedTypeName.includes('微短剧')
  );
}

/* 「禁用短剧竖屏模式」：本地设置 → 播放设置里的开关，存 localStorage。
   开了以后短剧一律走普通播放页（卡片入口和 play 页的「短剧模式」按钮都认它）。
   注意 LOCAL_SETTINGS_KEYS 白名单里也要有这个名字才会跟着云同步。 */
export const DISABLE_DUANJU_VERTICAL_KEY = 'disableDuanjuVertical';

export function isDuanjuVerticalDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(DISABLE_DUANJU_VERTICAL_KEY) === 'true';
  } catch {
    return false;
  }
}
