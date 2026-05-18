import { NextRequest, NextResponse } from 'next/server';

import { extractSongmid, fetchLxLyric, MusicQuality, normalizeMusicQuality, normalizeSong, lxPostJson } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

const PLAY_META_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

type PlayMetaPayload = {
  song: ReturnType<typeof normalizeSong>;
  lyric: {
    lyric?: string;
    tlyric?: string;
  };
  meta: {
    attempts: any[];
  };
};

const globalMusicPlayMetaCache = globalThis as typeof globalThis & {
  __musicV2PlayMetaCache?: Map<string, { expiresAt: number; payload: PlayMetaPayload }>;
};

const playMetaCache = globalMusicPlayMetaCache.__musicV2PlayMetaCache ?? new Map<string, { expiresAt: number; payload: PlayMetaPayload }>();
globalMusicPlayMetaCache.__musicV2PlayMetaCache = playMetaCache;

function buildStableStreamUrl(song: ReturnType<typeof normalizeSong>, quality: string) {
  const params = new URLSearchParams({
    songId: song.songId,
    source: song.source,
    quality,
    songmid: extractSongmid(song),
    name: song.name,
    artist: song.artist,
  });

  if (song.durationText) params.set('durationText', song.durationText);
  if (song.hash) params.set('hash', song.hash);
  if (song.copyrightId) params.set('copyrightId', song.copyrightId);
  if (song.albumId) params.set('albumId', song.albumId);
  if (song.lrcUrl) params.set('lrcUrl', song.lrcUrl);
  if (song.mrcUrl) params.set('mrcUrl', song.mrcUrl);
  if (song.trcUrl) params.set('trcUrl', song.trcUrl);

  return `/api/music/v2/stream?${params.toString()}`;
}

function getPlayMetaCacheKey(song: ReturnType<typeof normalizeSong>, quality: string) {
  return `${song.source}:${song.songId}:${quality}`;
}

function getCachedPlayMeta(cacheKey: string) {
  const cached = playMetaCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    playMetaCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedPlayMeta(cacheKey: string, payload: PlayMetaPayload) {
  playMetaCache.set(cacheKey, {
    expiresAt: Date.now() + PLAY_META_CACHE_TTL_MS,
    payload,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const requestedQuality = ((body?.quality || '320k') as MusicQuality);
    const quality = normalizeMusicQuality(requestedQuality);
    const includeUrl = body?.includeUrl !== false;
    const song = normalizeSong(body?.song || {});

    if (!song.songId || !song.source || !song.name || !song.artist) {
      return badRequest(`歌曲信息不完整: songId=${song.songId || ''}, source=${song.source || ''}, name=${song.name || ''}, artist=${song.artist || ''}`);
    }

    const cacheKey = getPlayMetaCacheKey(song, quality);
    let cachedMeta = getCachedPlayMeta(cacheKey);

    if (!cachedMeta) {
      let lyric: { lyric?: string; tlyric?: string } = { lyric: '', tlyric: '' };
      try {
        lyric = await fetchLxLyric(song);
      } catch {
        // ignore lyric failure
      }

      cachedMeta = {
        song,
        lyric,
        meta: {
          attempts: [],
        },
      };
      setCachedPlayMeta(cacheKey, cachedMeta);
    }

    let play: {
      url: string;
      directUrl: string;
      quality: string;
      requestedQuality: MusicQuality;
    } | undefined;
    let attempts = cachedMeta.meta.attempts || [];

    if (includeUrl) {
      const urlResult = await lxPostJson<{ url?: string; type?: string; attempts?: any[]; error?: string }>(
        '/api/music/url',
        {
          songInfo: {
            id: song.songId,
            name: song.name,
            singer: song.artist,
            source: song.source,
            songmid: song.songmid || song.songId.split('_').slice(1).join('_'),
          },
          quality,
        },
        'auto'
      );

      if (!urlResult?.url) {
        return NextResponse.json({
          success: false,
          error: {
            code: 'MUSIC_PLAY_FAILED',
            message: urlResult?.error || '获取播放地址失败',
          },
        }, { status: 502 });
      }

      attempts = urlResult.attempts || attempts;
      play = {
        url: buildStableStreamUrl(song, quality),
        directUrl: urlResult.url,
        quality: urlResult.type || quality,
        requestedQuality,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        song: cachedMeta.song,
        ...(play ? { play } : {}),
        lyric: {
          lyric: cachedMeta.lyric.lyric || '',
          tlyric: cachedMeta.lyric.tlyric || '',
        },
        meta: {
          attempts,
          includeUrl,
        },
      },
    });
  } catch (error) {
    console.error('[music-v2] play route error:', error);
    return internalError('获取播放信息失败', (error as Error).message);
  }
}
