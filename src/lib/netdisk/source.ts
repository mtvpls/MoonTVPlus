export const LEGACY_QUARK_TEMP_SOURCE = 'quark-temp';
export const NETDISK_QUARK_SOURCE = 'netdisk-quark';
export const NETDISK_MOBILE_SOURCE = 'netdisk-mobile';
export const NETDISK_BAIDU_SOURCE = 'netdisk-baidu';
export const NETDISK_TIANYI_SOURCE = 'netdisk-tianyi';
export const NETDISK_123_SOURCE = 'netdisk-123';
export const NETDISK_UC_SOURCE = 'netdisk-uc';
export const NETDISK_115_SOURCE = 'netdisk-115';

export type NetdiskProvider = 'quark' | 'mobile' | 'baidu' | 'tianyi' | '123' | 'uc' | '115';

export function normalizeNetdiskSource(source?: string | null): string {
  if (!source) return '';
  if (source === LEGACY_QUARK_TEMP_SOURCE) return NETDISK_QUARK_SOURCE;
  return source;
}

export function isNetdiskSource(source?: string | null): boolean {
  const normalized = normalizeNetdiskSource(source);
  return normalized === NETDISK_QUARK_SOURCE || normalized === NETDISK_MOBILE_SOURCE || normalized === NETDISK_BAIDU_SOURCE || normalized === NETDISK_TIANYI_SOURCE || normalized === NETDISK_123_SOURCE || normalized === NETDISK_UC_SOURCE || normalized === NETDISK_115_SOURCE;
}

export function getNetdiskProvider(source?: string | null): NetdiskProvider | null {
  const normalized = normalizeNetdiskSource(source);
  if (normalized === NETDISK_QUARK_SOURCE) return 'quark';
  if (normalized === NETDISK_MOBILE_SOURCE) return 'mobile';
  if (normalized === NETDISK_BAIDU_SOURCE) return 'baidu';
  if (normalized === NETDISK_TIANYI_SOURCE) return 'tianyi';
  if (normalized === NETDISK_123_SOURCE) return '123';
  if (normalized === NETDISK_UC_SOURCE) return 'uc';
  if (normalized === NETDISK_115_SOURCE) return '115';
  return null;
}

export function isNetdiskQuarkSource(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_QUARK_SOURCE;
}

export function isNetdiskMobileSource(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_MOBILE_SOURCE;
}

export function isNetdiskBaiduSource(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_BAIDU_SOURCE;
}

export function isNetdiskTianyiSource(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_TIANYI_SOURCE;
}

export function isNetdisk123Source(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_123_SOURCE;
}

export function isNetdiskUCSource(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_UC_SOURCE;
}

export function isNetdisk115Source(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_115_SOURCE;
}
