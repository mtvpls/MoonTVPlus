export const SPECIAL_SOURCE_PATH = '/under';

/**
 * 特殊源入口开关的 cookie 名。
 * 用 cookie 而不是 localStorage：/under 是服务端渲染的，只有 cookie 服务端读得到，
 * 否则未开开关的人直接敲 /under 照样能进。
 */
export const SPECIAL_SOURCE_COOKIE = 'special_source';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 本机是否开启了特殊源入口（按设备生效，人人可自行切换） */
export function isSpecialSourceEnabledOnDevice(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .some((item) => item.trim() === `${SPECIAL_SOURCE_COOKIE}=1`);
}

export function setSpecialSourceEnabledOnDevice(enabled: boolean) {
  if (typeof document === 'undefined') return;
  // path=/ 是必须的：/under 的服务端渲染要读到这个 cookie
  document.cookie = enabled
    ? `${SPECIAL_SOURCE_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
    : `${SPECIAL_SOURCE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * 是否处于特殊源（/under）上下文。
 * 判定依据是当前路径，与开关无关：/under 下只出特殊源，其余路径只出普通源。
 * 从 /under 跳出去的页面（如 /play）靠 special=1 查询参数延续上下文。
 */
export function isSpecialSourceContext(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, search } = window.location;
  if (
    pathname === SPECIAL_SOURCE_PATH ||
    pathname.startsWith(`${SPECIAL_SOURCE_PATH}/`)
  ) {
    return true;
  }
  return new URLSearchParams(search).get('special') === '1';
}

export function appendSpecialSourceParam(url: string): string {
  if (!isSpecialSourceContext()) return url;
  if (/[?&]special=1(&|$)/.test(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}special=1`;
}

export function appendSpecialSourceSearchParam(params: URLSearchParams) {
  if (isSpecialSourceContext()) {
    params.set('special', '1');
  }
  return params;
}

/**
 * 当前站点被标记为特殊源的采集源 key 集合，由 layout 注入 RUNTIME_CONFIG。
 * ponytail: 私人影库（emby/openlist/xiaoya）不在 SpecialSourceApis 里，
 * 与服务端 getAvailableApiSites 的口径保持一致，始终归普通入口。
 */
function getSpecialSourceKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const apis = (window as { RUNTIME_CONFIG?: { SPECIAL_SOURCE_APIS?: string[] } })
    .RUNTIME_CONFIG?.SPECIAL_SOURCE_APIS;
  return new Set(Array.isArray(apis) ? apis : []);
}

export function isSpecialSourceKey(source: string): boolean {
  return getSpecialSourceKeys().has(source);
}

/**
 * 按当前入口过滤收藏 / 播放记录，key 形如 `source+id`。
 * 普通路径不出特殊源的记录，/under 只出特殊源的记录。
 */
export function filterRecordsBySpecialSourceContext<T>(
  records: Record<string, T>
): Record<string, T> {
  const specialOnly = isSpecialSourceContext();
  const specialKeys = getSpecialSourceKeys();
  if (specialKeys.size === 0) {
    // 没有特殊源时，普通入口全给，/under 什么都没有
    return specialOnly ? {} : records;
  }
  const result: Record<string, T> = {};
  Object.entries(records).forEach(([key, value]) => {
    const source = key.split('+')[0];
    if (specialKeys.has(source) === specialOnly) {
      result[key] = value;
    }
  });
  return result;
}
