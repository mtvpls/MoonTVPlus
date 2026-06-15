export const SPECIAL_SOURCE_STORAGE_KEY = 'specialSourcesEnabled';

export function isSpecialSourcesEnabledOnDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SPECIAL_SOURCE_STORAGE_KEY) === '1';
}

export function setSpecialSourcesEnabledOnDevice(enabled: boolean) {
  if (typeof window === 'undefined') return;
  if (enabled) {
    localStorage.setItem(SPECIAL_SOURCE_STORAGE_KEY, '1');
  } else {
    localStorage.removeItem(SPECIAL_SOURCE_STORAGE_KEY);
  }
}

export function appendSpecialSourceParam(url: string): string {
  if (!isSpecialSourcesEnabledOnDevice()) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}special=1`;
}

export function appendSpecialSourceSearchParam(params: URLSearchParams) {
  if (isSpecialSourcesEnabledOnDevice()) {
    params.set('special', '1');
  }
  return params;
}
