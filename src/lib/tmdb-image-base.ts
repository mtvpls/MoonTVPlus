// TMDB 图片地址默认值（站点级）
// 该模块保持轻量、无 Node/DB 依赖，可被客户端与服务端共同引用。
// 服务端在加载站点配置后，通过 setServerTmdbImageBaseUrl 同步该值，
// 使 getTMDBImageUrl 等同步函数能在无用户 localStorage 的环境下拿到站点默认图片地址。
const DEFAULT_TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org';

let serverTmdbImageBaseUrl = DEFAULT_TMDB_IMAGE_BASE_URL;

export function setServerTmdbImageBaseUrl(url?: string) {
  serverTmdbImageBaseUrl = url || DEFAULT_TMDB_IMAGE_BASE_URL;
}

export function getServerTmdbImageBaseUrl(): string {
  return serverTmdbImageBaseUrl;
}

export function getDefaultTmdbImageBaseUrl(): string {
  return DEFAULT_TMDB_IMAGE_BASE_URL;
}

/**
 * 解析当前应使用的 TMDB 图片 Base URL。
 * 优先级：用户本地设置（localStorage.tmdbImageBaseUrl）> 站点默认（RUNTIME_CONFIG.TMDB_IMAGE_BASE_URL / 服务端同步值）> 官方默认地址。
 */
export function getTmdbImageBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem('tmdbImageBaseUrl');
    if (local) return local;

    const runtimeBaseUrl = (window as any).RUNTIME_CONFIG?.TMDB_IMAGE_BASE_URL;
    if (typeof runtimeBaseUrl === 'string' && runtimeBaseUrl) {
      return runtimeBaseUrl;
    }
    return DEFAULT_TMDB_IMAGE_BASE_URL;
  }

  return serverTmdbImageBaseUrl || DEFAULT_TMDB_IMAGE_BASE_URL;
}
