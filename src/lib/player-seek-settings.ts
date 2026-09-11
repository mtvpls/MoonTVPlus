export const QUICK_FORWARD_STORAGE_KEY = 'quickForwardSeconds';
export const SEEK_STEP_STORAGE_KEY = 'seekStepSeconds';

export const DEFAULT_QUICK_FORWARD_SECONDS = 90;
export const DEFAULT_SEEK_STEP_SECONDS = 10;

export function normalizeStoredSeconds(value: number): number | null {
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : null;
}

export function loadStoredSeconds(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const saved = normalizeStoredSeconds(
    Number(window.localStorage.getItem(key))
  );
  return saved ?? fallback;
}

export function calculateSeekTime(
  currentTime: number,
  duration: number,
  direction: -1 | 1,
  seconds: number
): number {
  const upperBound = Number.isFinite(duration)
    ? Math.max(0, duration)
    : Infinity;
  return Math.max(
    0,
    Math.min(upperBound, currentTime + direction * seconds)
  );
}
