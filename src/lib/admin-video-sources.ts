import type { AdminConfig } from './admin.types';
import {
  buildTVBoxBridgeSourceValue,
  isTVBoxBridgeLocalSite,
  parseTVBoxBridgeSourceValue,
} from './tvbox-bridge.shared';

/** 管理界面使用的统一源列表；桥接站点仍由桥接接口处理，不写入 CMS 源配置。 */
export function getAdminVideoSources(
  config: AdminConfig | null
): AdminConfig['SourceConfig'] {
  if (!config) return [];
  const bridge = config.TVBoxBridgeConfig;
  const blocked = new Set(bridge?.BlockedLocalSites || []);
  const sources = [
    ...(config.SourceConfig || []),
    ...(bridge?.Sites || [])
      .filter(
        (site) =>
          !blocked.has(site.key) &&
          !site.unsupported &&
          site.searchable !== 0 &&
          (site.api === undefined || !isTVBoxBridgeLocalSite(site))
      )
      .map((site) => ({
        key: buildTVBoxBridgeSourceValue(site.key),
        name: site.name || site.key,
        api: '',
        from: 'config' as const,
        disabled: site.enabled === false,
        weight: site.weight ?? 0,
      })),
  ];
  const order = new Map(
    (config.VideoSourceOrder || []).map((key, index) => [key, index])
  );
  return sources.sort(
    (a, b) =>
      (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.key) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function findTVBoxBridgeAdminSite(config: AdminConfig, key: string) {
  const siteKey = parseTVBoxBridgeSourceValue(key);
  if (!siteKey) return undefined;
  return config.TVBoxBridgeConfig?.Sites?.find((site) => site.key === siteKey);
}

/** 已配置的源标识，包含停用或暂时不可用的桥接站点。 */
export function getAdminVideoSourceKeys(config: AdminConfig): Set<string> {
  const sites = config.TVBoxBridgeConfig?.Sites;
  return new Set([
    ...(config.SourceConfig || []).map((source) => source.key),
    ...(Array.isArray(sites) ? sites : []).map((site) =>
      buildTVBoxBridgeSourceValue(site.key)
    ),
  ]);
}

/** 保存混合列表的顺序，同时保持普通源和桥接站点各自的配置结构。 */
export function setAdminVideoSourceOrder(config: AdminConfig, order: string[]) {
  config.VideoSourceOrder = Array.from(new Set(order));
  const positions = new Map(
    config.VideoSourceOrder.map((key, index) => [key, index])
  );
  const position = (key: string) =>
    positions.get(key) ?? Number.MAX_SAFE_INTEGER;
  config.SourceConfig.sort((a, b) => position(a.key) - position(b.key));
  config.TVBoxBridgeConfig?.Sites?.sort(
    (a, b) =>
      position(buildTVBoxBridgeSourceValue(a.key)) -
      position(buildTVBoxBridgeSourceValue(b.key))
  );
}
