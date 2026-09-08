/**
 * OpenList 代理播放 URL 构建工具
 * 路径格式：/api/openlist/proxy/{token}/{filename}?folder=xxx&fileName=xxx
 * - token：tvbox 订阅 token（用户/全局）；Web 端使用固定的 'proxy'，依赖登录 cookie 校验
 * - filename：用于 Content-Disposition，统一使用 video.mp4
 */

export function buildOpenListProxyUrl(opts: {
  token: string;
  folder: string;
  fileName: string;
  baseUrl?: string;
}): string {
  const query = `?folder=${encodeURIComponent(opts.folder)}&fileName=${encodeURIComponent(opts.fileName)}`;
  return `${opts.baseUrl || ''}/api/openlist/proxy/${encodeURIComponent(opts.token)}/video.mp4${query}`;
}
