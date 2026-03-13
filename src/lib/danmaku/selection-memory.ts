/**
 * 弹幕选择记忆管理
 * 用于记住用户在多个弹幕源中的选择，避免换集时重复弹出选择对话框
 */

const STORAGE_KEY_PREFIX = 'danmaku_selection_';

/**
 * 保存自动搜索时用户选择的弹幕源下标
 * @param title 视频标题
 * @param selectedIndex 用户选择的弹幕源在搜索结果中的下标
 */
export function saveDanmakuSourceIndex(
  title: string,
  selectedIndex: number,
): void {
  if (typeof window === 'undefined') return;

  try {
    const key = `${STORAGE_KEY_PREFIX}index_${title}`;
    sessionStorage.setItem(key, selectedIndex.toString());
    console.log(`[弹幕记忆] 保存弹幕源下标: ${title} -> ${selectedIndex}`);
  } catch (error) {
    console.error('[弹幕记忆] 保存下标失败:', error);
  }
}

/**
 * 获取自动搜索时上次选择的弹幕源下标
 * @param title 视频标题
 * @returns 上次选择的下标，如果没有记录则返回 null
 */
export function getDanmakuSourceIndex(title: string): number | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = `${STORAGE_KEY_PREFIX}index_${title}`;
    const value = sessionStorage.getItem(key);

    if (value !== null) {
      const index = parseInt(value, 10);
      if (!isNaN(index) && index >= 0) {
        console.log(`[弹幕记忆] 读取弹幕源下标: ${title} -> ${index}`);
        return index;
      }
    }
  } catch (error) {
    console.error('[弹幕记忆] 读取下标失败:', error);
  }

  return null;
}

/**
 * 保存用户手动选择的弹幕剧集 ID
 * @param title 视频标题
 * @param episodeIndex 视频集数下标
 * @param episodeId 弹幕剧集 ID
 */
export function saveManualDanmakuSelection(
  title: string,
  episodeIndex: number,
  episodeId: number,
): void {
  if (typeof window === 'undefined') return;

  try {
    const key = `${STORAGE_KEY_PREFIX}manual_${title}_${episodeIndex}`;
    sessionStorage.setItem(key, episodeId.toString());
    console.log(
      `[弹幕记忆] 保存手动选择: ${title} 第${episodeIndex}集 -> ${episodeId}`,
    );
  } catch (error) {
    console.error('[弹幕记忆] 保存手动选择失败:', error);
  }
}

/**
 * 获取用户手动选择的弹幕剧集 ID
 * @param title 视频标题
 * @param episodeIndex 视频集数下标
 * @returns 弹幕剧集 ID，如果没有记录则返回 null
 */
export function getManualDanmakuSelection(
  title: string,
  episodeIndex: number,
): number | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = `${STORAGE_KEY_PREFIX}manual_${title}_${episodeIndex}`;
    const value = sessionStorage.getItem(key);

    if (value !== null) {
      const episodeId = parseInt(value, 10);
      if (!isNaN(episodeId)) {
        console.log(
          `[弹幕记忆] 读取手动选择: ${title} 第${episodeIndex}集 -> ${episodeId}`,
        );
        return episodeId;
      }
    }
  } catch (error) {
    console.error('[弹幕记忆] 读取手动选择失败:', error);
  }

  return null;
}

/**
 * 清除指定视频的所有弹幕选择记忆
 * @param title 视频标题
 */
export function clearDanmakuSelectionMemory(title: string): void {
  if (typeof window === 'undefined') return;

  try {
    // 清除弹幕源下标记忆
    const indexKey = `${STORAGE_KEY_PREFIX}index_${title}`;
    sessionStorage.removeItem(indexKey);

    // 清除所有手动选择记忆（遍历所有 sessionStorage 键）
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(`${STORAGE_KEY_PREFIX}manual_${title}_`)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => sessionStorage.removeItem(key));

    console.log(`[弹幕记忆] 清除记忆: ${title}`);
  } catch (error) {
    console.error('[弹幕记忆] 清除记忆失败:', error);
  }
}

/**
 * 清除所有弹幕选择记忆
 */
export function clearAllDanmakuSelectionMemory(): void {
  if (typeof window === 'undefined') return;

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => sessionStorage.removeItem(key));

    console.log('[弹幕记忆] 清除所有记忆');
  } catch (error) {
    console.error('[弹幕记忆] 清除所有记忆失败:', error);
  }
}

/**
 * 保存用户搜索的弹幕关键词
 * @param title 视频标题
 * @param keyword 搜索关键词
 */
export function saveDanmakuSearchKeyword(title: string, keyword: string): void {
  if (typeof window === 'undefined') return;

  try {
    const key = `${STORAGE_KEY_PREFIX}keyword_${title}`;
    sessionStorage.setItem(key, keyword);
    console.log(`[弹幕记忆] 保存搜索关键词: ${title} -> ${keyword}`);
  } catch (error) {
    console.error('[弹幕记忆] 保存搜索关键词失败:', error);
  }
}

/**
 * 获取用户搜索的弹幕关键词
 * @param title 视频标题
 * @returns 搜索关键词，如果没有记录则返回 null
 */
export function getDanmakuSearchKeyword(title: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = `${STORAGE_KEY_PREFIX}keyword_${title}`;
    const keyword = sessionStorage.getItem(key);

    if (keyword) {
      console.log(`[弹幕记忆] 读取搜索关键词: ${title} -> ${keyword}`);
      return keyword;
    }
  } catch (error) {
    console.error('[弹幕记忆] 读取搜索关键词失败:', error);
  }

  return null;
}

/**
 * 保存用户手动选择的弹幕动漫ID（用于换集时自动匹配）
 * @param title 视频标题
 * @param animeId 弹幕动漫ID
 */
export function saveDanmakuAnimeId(title: string, animeId: number): void {
  if (typeof window === 'undefined') return;

  try {
    const key = `${STORAGE_KEY_PREFIX}anime_${title}`;
    sessionStorage.setItem(key, animeId.toString());
    console.log(`[弹幕记忆] 保存动漫ID: ${title} -> ${animeId}`);
  } catch (error) {
    console.error('[弹幕记忆] 保存动漫ID失败:', error);
  }
}

/**
 * 获取用户手动选择的弹幕动漫ID
 * @param title 视频标题
 * @returns 弹幕动漫ID，如果没有记录则返回 null
 */
export function getDanmakuAnimeId(title: string): number | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = `${STORAGE_KEY_PREFIX}anime_${title}`;
    const value = sessionStorage.getItem(key);

    if (value !== null) {
      const animeId = parseInt(value, 10);
      if (!isNaN(animeId)) {
        console.log(`[弹幕记忆] 读取动漫ID: ${title} -> ${animeId}`);
        return animeId;
      }
    }
  } catch (error) {
    console.error('[弹幕记忆] 读取动漫ID失败:', error);
  }

  return null;
}
