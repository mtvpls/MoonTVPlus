export const R18_PATH = '/r18';

/**
 * 特殊源入口开关的 cookie 名。
 * 用 cookie 而不是 localStorage：/r18 是服务端渲染的，只有 cookie 服务端读得到，
 * 否则未开开关的人直接敲 /r18 照样能进。
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
  // path=/ 是必须的：/r18 的服务端渲染要读到这个 cookie
  document.cookie = enabled
    ? `${SPECIAL_SOURCE_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
    : `${SPECIAL_SOURCE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * 自定义特殊源入口路径的 cookie 名。
 * 存 cookie 而非 localStorage：自定义路径 → /r18 的重定向在 middleware（服务端）里做，
 * 只有 cookie 服务端读得到。
 */
export const SPECIAL_SOURCE_PATH_COOKIE = 'special_source_path';

// 不能当自定义入口的顶层路径（会顶掉真实路由 / 静态资源）。
// ponytail: 手工维护的顶层路由名单，天花板是新增顶层路由后要同步补进来；来源见 src/app/*。
const RESERVED_TOP_SEGMENTS = new Set([
  '', 'api', '_next', 'icons', 'tvbox', 'favicon.ico', 'robots.txt',
  'manifest.json', 'logo.png', 'screenshot.png', 'advanced-recommendation',
  'books', 'douban', 'duanju', 'live', 'login', 'manga', 'movie-request',
  'music', 'oidc-register', 'private-library', 'qr-login', 'register',
  'source-search', 'tv', 'warning', 'watch-room', 'web-live', 'play',
  'search', 'admin', 'r18', 'sp',
]);

/**
 * 规范化并校验自定义入口路径：合法返回规范化路径（/ 开头、无尾斜杠），非法返回 null。
 * 只允许安全字符（同时用作 cookie 值，不做额外编码），且首段不得撞上真实路由。
 */
export function normalizeSpecialSourcePath(raw: string): string | null {
  const pathOnly = raw.trim().split(/[?#]/)[0];
  if (!pathOnly) return null;
  const withSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  const normalized = withSlash.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9\-_/]+$/.test(normalized)) return null;
  if (RESERVED_TOP_SEGMENTS.has(normalized.split('/')[1])) return null;
  return normalized;
}

/**
 * 是否处于特殊源（/r18）上下文。
 * 判定依据是当前路径，与开关无关：/r18 下只出特殊源，其余路径只出普通源。
 * 从 /r18 跳出去的页面（如 /play）靠 special=1 查询参数延续上下文。
 */
export function isSpecialSourceContext(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, search } = window.location;
  if (pathname === R18_PATH || pathname.startsWith(`${R18_PATH}/`)) return true;
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
 * 普通路径不出特殊源的记录，/r18 只出特殊源的记录。
 */
export function filterRecordsBySpecialSourceContext<T>(
  records: Record<string, T>
): Record<string, T> {
  const specialOnly = isSpecialSourceContext();
  const specialKeys = getSpecialSourceKeys();
  if (specialKeys.size === 0) {
    // 没有特殊源时，普通入口全给，/r18 什么都没有
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

/** 本机自定义的特殊源入口路径（未设置返回 ''） */
export function getSpecialSourcePathOnDevice(): string {
  if (typeof document === 'undefined') return '';
  const hit = document.cookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SPECIAL_SOURCE_PATH_COOKIE}=`));
  return hit ? hit.slice(SPECIAL_SOURCE_PATH_COOKIE.length + 1) : '';
}

export function setSpecialSourcePathOnDevice(path: string) {
  if (typeof document === 'undefined') return;
  // path 已由 normalizeSpecialSourcePath 限定为安全字符，直接作 cookie 值不需编码
  document.cookie = path
    ? `${SPECIAL_SOURCE_PATH_COOKIE}=${path}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
    : `${SPECIAL_SOURCE_PATH_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
