/**
 * TVBox 桥接源的纯函数工具。
 *
 * 这个文件会被客户端组件 import，因此**不得**引用 @/lib/db、@/lib/config 等
 * 带副作用的服务端模块（会导致客户端白屏）。
 *
 * 概念映射：
 * - 源（site）：桥接 /api/sites 里的一个 site，本地表示为一个独立源条目
 *   key = `tvbox:<siteKey>`（可被用户组 enabledApis / 权重 / 停用单独控制）
 * - 线路（line）：桥接 /api/detail 返回的 sources[]，播放时作为 /api/play 的 flag
 */

export const TVBOX_BRIDGE_SOURCE_PREFIX = 'tvbox:';

/** 多源优选时单个站点最多测速的线路数；单源线路优选不受此限制。 */
export const TVBOX_BRIDGE_MAX_TEST_LINES = 5;

/** 优选阶段最多参与测速的 tvbox 源数量（进入播放后的线路测速不受此限制） */
export const TVBOX_BRIDGE_MAX_SEARCH_SOURCES = 10;

export const TVBOX_BRIDGE_PROBE_BATCH_SIZE = 100;

export interface TVBoxBridgeProbeItem {
  key: string;
  flag: string;
  id: string;
}

export type TVBoxBridgeProbeResult =
  | { ok: true; url: string; mediaType: string }
  | {
      ok: false;
      unsupported?: boolean;
      reason?: string;
      error?: string;
      errorType?: 'timeout' | 'unreachable';
    };

/**
 * 管理面板用的只读视图类型（与 tvbox-bridge.server 的接口结构一致）。
 * 放这里是为了让客户端组件不必 import 服务端模块。
 */
export interface TVBoxBridgeSiteInfo {
  key: string;
  name: string;
  type: number;
  api: string;
  usesCompanion?: boolean;
  engine?: 'java' | 'python' | 'cms';
  unsupported?: boolean;
  searchable?: number;
  loginSiteKey?: string;
  loaded?: boolean;
}

export interface TVBoxBridgeStatusInfo {
  version: string;
  auth: boolean;
  configLoaded: boolean;
  configUrl: string | null;
  sites: number;
  loadedSites?: Array<{ key: string; ok: boolean; error?: string; at?: number }>;
  companion?: {
    running: boolean;
    port: number;
    startedAt: number;
    lastError?: string;
  } | null;
}

export interface TVBoxBridgeDepotInfo {
  configUrl: string;
  entries: Array<{ name: string; url: string }>;
}

export interface TVBoxBridgeCredentialInfo {
  ok: boolean;
  configured: boolean;
  updatedAt: string | null;
}

/** 网盘登录凭据的提供方：quark/uc 用 Cookie，ali 用 32 位 refresh_token */
export const TVBOX_BRIDGE_NETDISK_PROVIDERS = [
  { key: 'quark', label: '夸克网盘', field: 'cookie' },
  { key: 'uc', label: 'UC 网盘', field: 'cookie' },
  { key: 'ali', label: '阿里云盘', field: 'token' },
] as const;

export type TVBoxBridgeNetdiskProvider =
  (typeof TVBOX_BRIDGE_NETDISK_PROVIDERS)[number];

/**
 * 站点接口地址是否为本地文件（file:// 、相对路径、无协议的 .json/.js/.jar 等）。
 *
 * 这类来源的文件只在 TVBox 客户端本地，桥接服务端读不到，通常需要屏蔽。
 * 注意别把 `csp_xxx` 这类 Spider 标识当成本地文件。
 */
export function isTVBoxBridgeLocalSite(site: { api?: string }): boolean {
  const api = (site.api || '').trim();
  if (!api) return true;
  if (/^https?:\/\//i.test(api)) return false;
  if (
    api.startsWith('file:') ||
    api.startsWith('/') ||
    api.startsWith('./') ||
    api.startsWith('../') ||
    /^[a-zA-Z]:[\\/]/.test(api)
  ) {
    return true;
  }
  return /\.(json|js|jar|py|txt)$/i.test(api);
}

export interface TVBoxBridgeLine {
  /** 线路名，即 /api/play 的 flag */
  name: string;
  /** 该线路的剧集标识（/api/play 的 id） */
  episodes: string[];
  /** 该线路的剧集名 */
  episodes_titles: string[];
}

export function buildTVBoxBridgeSourceValue(siteKey: string) {
  return `${TVBOX_BRIDGE_SOURCE_PREFIX}${siteKey}`;
}

export function isTVBoxBridgeSource(source?: string): boolean {
  return !!source && source.startsWith(TVBOX_BRIDGE_SOURCE_PREFIX);
}

export function parseTVBoxBridgeSourceValue(source: string): string | null {
  if (!isTVBoxBridgeSource(source)) return null;
  const siteKey = source.slice(TVBOX_BRIDGE_SOURCE_PREFIX.length);
  return siteKey || null;
}

/**
 * 从 tvbox 线路的懒解析地址（/api/tvbox-bridge/play?...）里读出探测参数。
 * 换源面板的线路测速要用它去调 /api/tvbox-bridge/probe。
 */
export function parseTVBoxBridgePlayUrl(
  url: string
): { siteKey: string; flag: string; id: string } | null {
  if (!url.startsWith('/api/tvbox-bridge/play?')) return null;
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const siteKey = params.get('key');
    const id = params.get('id');
    if (!siteKey || !id) return null;
    return { siteKey, flag: params.get('flag') || '', id };
  } catch {
    return null;
  }
}

/**
 * 线路标识：同一源内用线路名区分。线路名可能重复或含特殊字符，
 * 因此对外用索引，对内用名字。
 */
export function normalizeTVBoxBridgeLines(
  lines: TVBoxBridgeLine[] | undefined
): TVBoxBridgeLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (line) => line && typeof line.name === 'string' && Array.isArray(line.episodes)
  );
}

/** 按序号保持切线路时的集号；线路集数不够时落到最后一集 */
export function resolveEpisodeIndexForLine(
  episodeCount: number,
  currentIndex: number
): number {
  if (episodeCount <= 0) return 0;
  if (currentIndex < 0) return 0;
  return Math.min(currentIndex, episodeCount - 1);
}

/**
 * 从备注里猜集数（"全80集"、"更新至25集"、"更新到第12话"）。
 *
 * tvbox 源走详情懒加载，搜索阶段的 episodes 一定是空的，
 * 搜索结果卡片只能靠备注显示集数，否则聚合卡上永远是 0 集。
 */
export function parseTVBoxBridgeEpisodeCount(remarks?: string): number {
  const text = String(remarks || '').trim();
  if (!text) return 0;
  let max = 0;
  const pattern = /(\d{1,4})\s*(?:集|话|期)/g;
  let matched: RegExpExecArray | null;
  while ((matched = pattern.exec(text)) !== null) {
    const count = Number(matched[1]);
    if (count > max && count < 10000) max = count;
  }
  return max;
}

/**
 * 测速结果 key。
 *
 * tvbox 源是「一源一卡 + 卡内多线路」，同一条线路才有可比性，
 * 所以 key 里带上线路名；其他源保持原来的「源-id」不变。
 */
export function buildSourceTestKey(
  source: string,
  id: string,
  line?: string
): string {
  return line ? `${source}-${id}#${line}` : `${source}-${id}`;
}

/** 取某个源的线路列表（非 tvbox 源返回空数组） */
export function getTVBoxBridgeLines(source: {
  source?: string;
  lines?: TVBoxBridgeLine[];
}): TVBoxBridgeLine[] {
  if (!isTVBoxBridgeSource(source?.source)) return [];
  return normalizeTVBoxBridgeLines(source.lines);
}

/** 取某个源当前生效的线路（无 lines 时返回 undefined） */
export function getActiveTVBoxBridgeLine(source: {
  source?: string;
  lines?: TVBoxBridgeLine[];
  activeLine?: string;
}): TVBoxBridgeLine | undefined {
  const lines = getTVBoxBridgeLines(source);
  if (lines.length === 0) return undefined;
  if (source.activeLine) {
    const matched = lines.find((line) => line.name === source.activeLine);
    if (matched) return matched;
  }
  return lines[0];
}
