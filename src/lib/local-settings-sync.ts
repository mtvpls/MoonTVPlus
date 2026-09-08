/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 本地设置云同步 —— 白名单与校验
 * 仅同步"本地设置面板"的键，不上传播放记录、收藏、搜索历史、主题等隐私/非设置数据。
 * 新增本地设置项时，记得同步更新 LOCAL_SETTINGS_KEYS。
 */

export const LOCAL_SETTINGS_SYNC_MODE_KEY = 'moontv_local_settings_sync_mode';
export const LOCAL_SETTINGS_SYNC_LAST_PULL_KEY = 'moontv_local_settings_sync_last_pull';

// 本地设置面板同步白名单（键 = localStorage 中存储的 key）
export const LOCAL_SETTINGS_KEYS: string[] = [
  'defaultAggregateSearch',
  'saveLivePlayRecords',
  'enableOptimization',
  'preferStrategy',
  'speedTestTimeout',
  'maxConcurrentDownloads',
  'downloadThreadsPerTask',
  'downloadSegmentTimeout',
  'downloadMode',
  'filesystemSavePath',
  'fluidSearch',
  'tmdb_backdrop_disabled',
  'enableTrailers',
  'doubanProxyUrl',
  'doubanDataSource',
  'doubanDataSourceBackup',
  'doubanProxyUrlBackup',
  'animeDataSource',
  'animeDataSourceBackup',
  'animeCustomBaseUrl',
  'animeImageBaseUrl',
  'doubanImageProxyType',
  'doubanImageProxyUrl',
  'doubanImageProxyTypeBackup',
  'doubanImageProxyUrlBackup',
  'tmdbImageBaseUrl',
  'bufferStrategy',
  'nextEpisodePreCache',
  'nextEpisodeDanmakuPreload',
  'disablePlaybackThumbnail',
  'disableAutoLoadDanmaku',
  'danmakuMaxCount',
  'danmaku_heatmap_disabled',
  'homeBannerEnabled',
  'homeBannerHeightScale',
  'homeContinueWatchingEnabled',
  'homeModules',
  'danmakuTraditionalToSimplified',
  'searchTraditionalToSimplified',
  'exactSearch',
];

export const LOCAL_SETTINGS_MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB

export interface LocalSettingsPayload {
  version: number; // payload 结构版本，当前固定 1
  data: Record<string, string>; // key -> localStorage 存储值（字符串形式），仅含已设置的键
  updatedAt: number; // 本地设置发生变化的毫秒时间戳
}

// 白名单过滤：只保留允许的键
export function sanitizeLocalSettingsData(
  data: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {};
  const allowed = new Set(LOCAL_SETTINGS_KEYS);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) continue;
    const value = data[key];
    if (typeof value === 'string') {
      result[key] = value;
    } else if (value !== null && value !== undefined) {
      // 布尔/数字/对象统一序列化为字符串，与 localStorage.setItem 语义一致
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}

// 校验并规范化上传的 payload
export function validateLocalSettingsPayload(
  raw: unknown
): { payload: LocalSettingsPayload; size: number } | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'payload 格式错误' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    return { error: '不支持的 payload 版本' };
  }
  if (
    typeof obj.updatedAt !== 'number' ||
    !Number.isFinite(obj.updatedAt)
  ) {
    return { error: 'updatedAt 格式错误' };
  }
  if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    return { error: 'data 格式错误' };
  }

  const data = sanitizeLocalSettingsData(obj.data as Record<string, unknown>);

  const payload: LocalSettingsPayload = {
    version: 1,
    data,
    updatedAt: obj.updatedAt,
  };

  // 超限校验
  const size = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (size > LOCAL_SETTINGS_MAX_PAYLOAD_BYTES) {
    return { error: 'payload 过大' };
  }

  return { payload, size };
}
