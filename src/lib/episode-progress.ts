const EPISODE_PROGRESS_PREFIX = 'moontv_episode_progress:';
const EPISODE_PROGRESS_MAX_SHOWS = 20;
const EPISODE_PROGRESS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 120;

export interface LocalEpisodeProgressRecord {
  playTime: number;
  totalTime: number;
  updatedAt: number;
}

interface EpisodeProgressContentIdentity {
  doubanId?: number | string;
  tmdbId?: number | string;
  title?: string;
  year?: string;
  searchType?: string;
}

interface LocalEpisodeProgressStore {
  updatedAt: number;
  episodes: Record<string, LocalEpisodeProgressRecord>;
}

function isBrowser() {
  return typeof window !== 'undefined';
}

function isQuotaExceededError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

function parseEpisodeProgressRecord(
  value: unknown
): LocalEpisodeProgressRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const parsed = value as Partial<LocalEpisodeProgressRecord>;
  const playTime = Number(parsed.playTime);
  const totalTime = Number(parsed.totalTime);
  const updatedAt = Number(parsed.updatedAt);

  if (!Number.isFinite(playTime) || playTime <= 0) {
    return null;
  }

  return {
    playTime: Math.floor(playTime),
    totalTime: Number.isFinite(totalTime) && totalTime >= 0 ? Math.floor(totalTime) : 0,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
  };
}

function normalizeEpisodeProgressStore(
  value: unknown
): { store: LocalEpisodeProgressStore | null; changed: boolean } {
  if (!value || typeof value !== 'object') {
    return { store: null, changed: false };
  }

  const parsed = value as Partial<LocalEpisodeProgressStore>;
  const rawEpisodes = parsed.episodes;
  if (!rawEpisodes || typeof rawEpisodes !== 'object') {
    return { store: null, changed: false };
  }

  const now = Date.now();
  const episodes: Record<string, LocalEpisodeProgressRecord> = {};
  let latestUpdatedAt = 0;
  let changed = false;

  for (const [episodeIndex, entry] of Object.entries(rawEpisodes)) {
    const normalized = parseEpisodeProgressRecord(entry);
    if (!normalized) {
      changed = true;
      continue;
    }

    if (
      normalized.updatedAt > 0 &&
      now - normalized.updatedAt > EPISODE_PROGRESS_MAX_AGE_MS
    ) {
      changed = true;
      continue;
    }

    episodes[episodeIndex] = normalized;
    latestUpdatedAt = Math.max(latestUpdatedAt, normalized.updatedAt);
  }

  if (Object.keys(episodes).length === 0) {
    return { store: null, changed: true };
  }

  const rootUpdatedAt = Number(parsed.updatedAt);
  const normalizedUpdatedAt =
    Number.isFinite(rootUpdatedAt) && rootUpdatedAt > 0
      ? Math.max(rootUpdatedAt, latestUpdatedAt)
      : latestUpdatedAt;

  if (normalizedUpdatedAt !== rootUpdatedAt) {
    changed = true;
  }

  return {
    store: {
      updatedAt: normalizedUpdatedAt,
      episodes,
    },
    changed,
  };
}

function readEpisodeProgressStore(contentKey: string): LocalEpisodeProgressStore | null {
  if (!isBrowser()) {
    return null;
  }

  const key = getEpisodeProgressStorageKey(contentKey);
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const { store, changed } = normalizeEpisodeProgressStore(parsed);

    if (!store) {
      localStorage.removeItem(key);
      return null;
    }

    if (changed) {
      localStorage.setItem(key, JSON.stringify(store));
    }

    return store;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function collectEpisodeProgressEntries() {
  if (!isBrowser()) {
    return [];
  }

  const keys = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index)
  ).filter((key): key is string => Boolean(key));

  const entries: Array<{ key: string; updatedAt: number }> = [];

  for (const key of keys) {
    if (!key.startsWith(EPISODE_PROGRESS_PREFIX)) {
      continue;
    }

    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.removeItem(key);
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      const { store, changed } = normalizeEpisodeProgressStore(parsed);
      if (!store) {
        localStorage.removeItem(key);
        continue;
      }

      if (changed) {
        localStorage.setItem(key, JSON.stringify(store));
      }

      entries.push({
        key,
        updatedAt: store.updatedAt,
      });
    } catch {
      localStorage.removeItem(key);
    }
  }

  return entries;
}

function normalizeContentTitle(title: string) {
  return title
    .replace(/\s+/g, '')
    .replace(/[\uff01-\uff5e]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    )
    .replace(/[()（）[\]【】{}「」『』<>《》]/g, '')
    .replace(/[^\w\u4e00-\u9fa5]/g, '')
    .toLowerCase();
}

function normalizeContentIdentityId(value: unknown) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return String(Math.floor(numericValue));
  }

  const text = String(value || '').trim();
  if (/^[1-9]\d*$/.test(text)) {
    return text;
  }

  return null;
}

function buildLegacyEpisodeProgressContentKey(
  identity: EpisodeProgressContentIdentity
) {
  const title = normalizeContentTitle(identity.title || '');
  const year = String(identity.year || '').trim();
  const searchType = String(identity.searchType || '').trim().toLowerCase();

  if (!title) {
    return null;
  }

  return `${title}|${year}|${searchType}`;
}

export function buildEpisodeProgressContentKey(
  identity: EpisodeProgressContentIdentity
) {
  const doubanId = normalizeContentIdentityId(identity.doubanId);
  if (doubanId) {
    return `douban:${doubanId}`;
  }

  const tmdbId = normalizeContentIdentityId(identity.tmdbId);
  if (tmdbId) {
    const searchType = String(identity.searchType || '').trim().toLowerCase();
    return searchType ? `tmdb:${searchType}:${tmdbId}` : `tmdb:${tmdbId}`;
  }

  return buildLegacyEpisodeProgressContentKey(identity);
}

export function getEpisodeProgressStorageKey(contentKey: string) {
  return `${EPISODE_PROGRESS_PREFIX}${contentKey}`;
}

export function loadAllLocalEpisodeProgressRecords(contentKey: string | null) {
  if (!contentKey) {
    return {};
  }

  return readEpisodeProgressStore(contentKey)?.episodes || {};
}

export function loadLocalEpisodeProgressRecord(
  contentKey: string | null,
  episodeIndex: number
) {
  const episodes = loadAllLocalEpisodeProgressRecords(contentKey);
  return episodes[String(episodeIndex)] || null;
}

export function loadLocalEpisodeProgress(
  contentKey: string | null,
  episodeIndex: number
) {
  const record = loadLocalEpisodeProgressRecord(contentKey, episodeIndex);
  if (!record) {
    return null;
  }

  return Number.isFinite(record.playTime) && record.playTime > 1
    ? Math.floor(record.playTime)
    : null;
}

export function pruneLocalEpisodeProgressStorage(
  maxShows = EPISODE_PROGRESS_MAX_SHOWS
) {
  if (!isBrowser()) {
    return;
  }

  const entries = collectEpisodeProgressEntries().sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  if (entries.length <= maxShows) {
    return;
  }

  entries.slice(maxShows).forEach(({ key }) => {
    localStorage.removeItem(key);
  });
}

export function saveLocalEpisodeProgress(
  contentKey: string | null,
  episodeIndex: number,
  playTime: number,
  totalTime: number
) {
  if (
    !isBrowser() ||
    !contentKey ||
    !Number.isFinite(playTime) ||
    playTime <= 0
  ) {
    return;
  }

  const key = getEpisodeProgressStorageKey(contentKey);
  const now = Date.now();
  const currentStore = readEpisodeProgressStore(contentKey);
  const shouldPruneAfterSave = !currentStore;
  const nextStore: LocalEpisodeProgressStore = {
    updatedAt: now,
    episodes: {
      ...(currentStore?.episodes || {}),
      [String(episodeIndex)]: {
        playTime: Math.floor(playTime),
        totalTime: Number.isFinite(totalTime) && totalTime >= 0 ? Math.floor(totalTime) : 0,
        updatedAt: now,
      },
    },
  };

  const payload = JSON.stringify(nextStore);

  try {
    localStorage.setItem(key, payload);
    if (shouldPruneAfterSave) {
      pruneLocalEpisodeProgressStorage();
    }
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }

    pruneLocalEpisodeProgressStorage(
      Math.max(10, Math.floor(EPISODE_PROGRESS_MAX_SHOWS / 2))
    );
    localStorage.setItem(key, payload);
    pruneLocalEpisodeProgressStorage();
  }
}
