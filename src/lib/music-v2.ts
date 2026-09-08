import { getConfig } from '@/lib/config';
import { normalizeApiBaseUrl } from '@/lib/url';

export const runtime = 'nodejs';

export type MusicSource = 'wy' | 'tx' | 'kw' | 'kg' | 'mg';
export type MusicQuality = '128k' | '192k' | '320k' | 'flac' | 'flac24bit';

export function normalizeMusicSource(source?: string): MusicSource | '' {
  switch ((source || '').trim()) {
    case 'wy':
    case 'tx':
    case 'kw':
    case 'kg':
    case 'mg':
      return source as MusicSource;
    case 'netease':
      return 'wy';
    case 'qq':
      return 'tx';
    case 'kuwo':
      return 'kw';
    default:
      return '';
  }
}

export function normalizeMusicQuality(quality?: string): Exclude<MusicQuality, 'flac24bit'> {
  switch (quality) {
    case '128k':
    case '192k':
    case '320k':
    case 'flac':
      return quality;
    case 'flac24bit':
      return 'flac';
    default:
      return '320k';
  }
}

export interface MusicV2Song {
  songId: string;
  source: MusicSource;
  songmid?: string;
  name: string;
  artist: string;
  album?: string;
  cover?: string;
  durationText?: string;
  durationSec?: number;
  hash?: string;
  copyrightId?: string;
  albumId?: string;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
}

export interface MusicV2HistoryRecord extends MusicV2Song {
  playProgressSec: number;
  lastPlayedAt: number;
  playCount: number;
  lastQuality?: string;
  createdAt: number;
  updatedAt: number;
  // 播放队列顺序。浮点数，拖拽时取前后邻居中值，因此只需改写被移动的那一条。
  // 旧数据（尤其是 Redis 系无法迁移的历史 hash）可能缺失，读取侧需回退到 createdAt。
  sortOrder?: number;
}

export interface MusicV2PlaylistRecord {
  id: string;
  username: string;
  name: string;
  description?: string;
  cover?: string;
  song_count: number;
  created_at: number;
  updated_at: number;
}

export interface MusicV2PlaylistItem extends MusicV2Song {
  playlistId: string;
  sortOrder: number;
  addedAt: number;
  updatedAt: number;
}

export interface LxServerSong {
  id: string;
  name: string;
  singer: string;
  source: string;
  interval?: string;
  albumName?: string;
  img?: string;
  image?: string;
  imageUrl?: string;
  albumPicUrl?: string;
  pic?: string;
  cover?: string;
  songmid?: string;
  meta?: {
    picUrl?: string;
    albumName?: string;
  };
  album?: {
    picUrl?: string;
    pic?: string;
  };
  al?: {
    picUrl?: string;
  };
}

export function isMusicSource(source: string | null | undefined): source is MusicSource {
  return !!source && ['wy', 'tx', 'kw', 'kg', 'mg'].includes(source);
}

// ---------- 播放队列排序 ----------

// 相邻两首歌之间预留的 sortOrder 间距。新歌追加到队尾时按此步长递增。
export const MUSIC_V2_SORT_STEP = 1000;

// 中值插入的最小可用间距。低于此值说明浮点精度快要耗尽，需要整队重新编号。
const MUSIC_V2_SORT_MIN_GAP = 1e-4;

// 队列顺序的稳定兜底：sortOrder 相同时用歌曲标识排序，避免顺序在两次读取间抖动。
function compareSongIdentity(a: MusicV2HistoryRecord, b: MusicV2HistoryRecord) {
  return `${a.source}:${a.songId}`.localeCompare(`${b.source}:${b.songId}`);
}

// 是否所有记录都已带上 sortOrder。缺一条就不能按 sortOrder 排序——
// 因为遗留记录的回退值 createdAt 是毫秒时间戳，和 sortOrder 的量级完全不同，混排会乱序。
export function hasCompleteSortOrder(records: MusicV2HistoryRecord[]): boolean {
  return records.every((record) => Number.isFinite(record.sortOrder));
}

export function sortMusicV2History(records: MusicV2HistoryRecord[]): MusicV2HistoryRecord[] {
  const useSortOrder = hasCompleteSortOrder(records);
  return [...records].sort((a, b) => {
    const primaryDiff = useSortOrder
      ? (a.sortOrder as number) - (b.sortOrder as number)
      : (a.createdAt || 0) - (b.createdAt || 0);
    if (primaryDiff !== 0) return primaryDiff;
    return compareSongIdentity(a, b);
  });
}

// 按当前顺序重新编号为等距稀疏序号。用于遗留数据回填和精度耗尽后的整队重排。
export function renumberMusicV2History(
  orderedRecords: MusicV2HistoryRecord[],
  updatedAt = Date.now()
): MusicV2HistoryRecord[] {
  return orderedRecords.map((record, index) => ({
    ...record,
    sortOrder: (index + 1) * MUSIC_V2_SORT_STEP,
    updatedAt,
  }));
}

export function nextMusicV2SortOrder(records: MusicV2HistoryRecord[]): number {
  const max = records.reduce(
    (acc, record) => (Number.isFinite(record.sortOrder) ? Math.max(acc, record.sortOrder as number) : acc),
    0
  );
  return max + MUSIC_V2_SORT_STEP;
}

// 计算把一首歌插到 prev / next 之间所需的 sortOrder。
// 返回 null 表示间距不足，调用方应改为整队重新编号。
export function interpolateMusicV2SortOrder(
  prevOrder: number | undefined,
  nextOrder: number | undefined
): number | null {
  const hasPrev = Number.isFinite(prevOrder);
  const hasNext = Number.isFinite(nextOrder);

  if (hasPrev && hasNext) {
    const gap = (nextOrder as number) - (prevOrder as number);
    if (gap <= MUSIC_V2_SORT_MIN_GAP) return null;
    return (prevOrder as number) + gap / 2;
  }
  // 移到队首：往前让出一个完整步长（允许为负，排序不受影响）
  if (hasNext) return (nextOrder as number) - MUSIC_V2_SORT_STEP;
  // 移到队尾
  if (hasPrev) return (prevOrder as number) + MUSIC_V2_SORT_STEP;
  return MUSIC_V2_SORT_STEP;
}

export function parseDurationTextToSec(durationText?: string): number | undefined {
  if (!durationText) return undefined;
  const parts = durationText.split(':').map(part => Number(part));
  if (parts.length !== 2 || parts.some(num => Number.isNaN(num))) {
    return undefined;
  }
  return parts[0] * 60 + parts[1];
}

export function normalizeSong(input: Partial<MusicV2Song> & {
  songId?: string;
  id?: string;
  source?: string;
  name?: string;
  artist?: string;
  singer?: string;
  songmid?: string;
  album?: string;
  albumName?: string;
  cover?: string;
  pic?: string;
  img?: string;
  durationText?: string;
  interval?: string;
  durationSec?: number;
  hash?: string;
  copyrightId?: string;
  albumId?: string;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
}): MusicV2Song {
  const source = normalizeMusicSource(input.source) as MusicSource;
  const rawSongId = (input.songId || input.id || '').trim();
  const derivedSongmid = String(input.songmid || '').trim();
  const songId = rawSongId || (source && derivedSongmid ? `${source}_${derivedSongmid}` : '');
  const durationText = input.durationText || input.interval;
  const durationSec = input.durationSec ?? parseDurationTextToSec(durationText);

  return {
    songId,
    source,
    songmid: derivedSongmid || songId.split('_').slice(1).join('_') || undefined,
    name: (input.name || '').trim(),
    artist: (input.artist || input.singer || '').trim(),
    album: input.album || input.albumName || undefined,
    cover: input.cover || input.pic || input.img || undefined,
    durationText: durationText || undefined,
    durationSec,
    hash: input.hash || undefined,
    copyrightId: input.copyrightId || undefined,
    albumId: input.albumId || undefined,
    lrcUrl: input.lrcUrl || undefined,
    mrcUrl: input.mrcUrl || undefined,
    trcUrl: input.trcUrl || undefined,
  };
}

export function normalizeLxSong(song: LxServerSong): MusicV2Song {
  return normalizeSong({
    songId: song.id,
    source: song.source as MusicSource,
    songmid: song.songmid,
    name: song.name,
    artist: song.singer,
    album: song.albumName || song.meta?.albumName,
    cover:
      song.img ||
      song.pic ||
      song.cover ||
      song.image ||
      song.imageUrl ||
      song.albumPicUrl ||
      song.meta?.picUrl ||
      song.album?.picUrl ||
      song.album?.pic ||
      song.al?.picUrl,
    durationText: song.interval,
  });
}

export function unwrapLxArray<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray(payload?.list)) return payload.list as T[];
  if (Array.isArray(payload?.data)) return payload.data as T[];
  if (Array.isArray(payload?.data?.list)) return payload.data.list as T[];
  if (Array.isArray(payload?.data?.data)) return payload.data.data as T[];
  return [];
}

export async function getMusicV2Config() {
  const config = await getConfig();
  const musicConfig = config?.MusicConfig;

  const enabled = musicConfig?.Enabled ?? false;
  const baseUrl = normalizeApiBaseUrl(
    musicConfig?.BaseUrl || process.env.MUSIC_V2_BASE_URL || ''
  );
  const token = musicConfig?.Token || process.env.MUSIC_V2_TOKEN || '';

  return { enabled, baseUrl, token };
}

type LxFetchAuthMode = 'auto' | 'required' | 'none';

async function lxFetch(path: string, init: RequestInit = {}, authMode: LxFetchAuthMode = 'auto') {
  const { enabled, baseUrl, token } = await getMusicV2Config();

  if (!enabled) {
    throw new Error('音乐功能未开启');
  }
  if (!baseUrl) {
    throw new Error('未配置音乐服务地址');
  }

  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');
  if (authMode !== 'none' && token) {
    headers.set('x-user-token', token);
  } else if (authMode === 'required' && !token) {
    throw new Error('未配置音乐服务访问 Token');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(45000),
    cache: 'no-store',
  });

  return response;
}

export async function lxGetJson<T>(path: string, authMode: LxFetchAuthMode = 'auto'): Promise<T> {
  const response = await lxFetch(path, {}, authMode);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败(${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function lxPostJson<T>(path: string, body: any, authMode: LxFetchAuthMode = 'auto'): Promise<T> {
  const response = await lxFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  }, authMode);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败(${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function extractSongmid(song: Pick<MusicV2Song, 'songId' | 'songmid'>) {
  return song.songmid || song.songId.split('_').slice(1).join('_');
}

function normalizeLyricPayload(payload: any) {
  return {
    lyric: typeof payload?.lyric === 'string'
      ? payload.lyric
      : typeof payload?.lrc === 'string'
        ? payload.lrc
        : '',
    tlyric: typeof payload?.tlyric === 'string'
      ? payload.tlyric
      : typeof payload?.trc === 'string'
        ? payload.trc
        : '',
  };
}

export async function fetchLxLyric(song: MusicV2Song) {
  const songmid = extractSongmid(song);
  const query = new URLSearchParams({
    source: song.source,
    songmid,
  });

  if (song.songId) query.set('id', song.songId);
  if (song.name) query.set('name', song.name);
  if (song.artist) query.set('singer', song.artist);
  if (song.hash) query.set('hash', song.hash);
  if (song.durationText) query.set('interval', song.durationText);
  if (song.copyrightId) query.set('copyrightId', song.copyrightId);
  if (song.albumId) query.set('albumId', song.albumId);
  if (song.lrcUrl) query.set('lrcUrl', song.lrcUrl);
  if (song.mrcUrl) query.set('mrcUrl', song.mrcUrl);
  if (song.trcUrl) query.set('trcUrl', song.trcUrl);

  try {
    const payload = await lxGetJson<any>(`/api/music/lyric?${query.toString()}`, 'none');
    return normalizeLyricPayload(payload);
  } catch {
    const payload = await lxPostJson<any>('/api/music/lyric', {
      songInfo: {
        source: song.source,
        id: song.songId,
        songId: songmid,
        songmid,
        name: song.name,
        singer: song.artist,
        artist: song.artist,
        hash: song.hash,
        interval: song.durationText,
        copyrightId: song.copyrightId,
        albumId: song.albumId,
        lrcUrl: song.lrcUrl,
        mrcUrl: song.mrcUrl,
        trcUrl: song.trcUrl,
      },
    }, 'none');

    return normalizeLyricPayload(payload);
  }
}
