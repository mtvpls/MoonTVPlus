import { appendSpecialSourceParam } from './special-source.client';
import type {
  TVBoxBridgeProbeItem,
  TVBoxBridgeProbeResult,
} from './tvbox-bridge.shared';
import {
  parseTVBoxBridgePlayUrl,
  TVBOX_BRIDGE_PROBE_BATCH_SIZE,
} from './tvbox-bridge.shared';

interface PlaybackResult {
  url: string;
  mediaType?: string;
  isLive?: boolean;
  needsParse?: boolean;
  qualities?: unknown[];
}

const playbackRequests = new Map<
  string,
  { promise: Promise<PlaybackResult>; expiresAt: number }
>();

function prunePlaybackRequests() {
  const now = Date.now();
  for (const [key, entry] of Array.from(playbackRequests.entries())) {
    if (
      entry.expiresAt &&
      (entry.expiresAt <= now || playbackRequests.size > 200)
    ) {
      playbackRequests.delete(key);
    }
  }
}

function playbackKey(url: string): string {
  const play = parseTVBoxBridgePlayUrl(url);
  return JSON.stringify([
    play?.siteKey,
    play?.flag,
    play?.id,
    new URL(url, 'http://localhost').searchParams.get('special') === '1',
  ]);
}

/** 同一集的播放和视频信息共用解析；测速已解析过的单集也可直接播放。 */
export function resolveTVBoxBridgePlaybackUrl(
  episodeUrl: string
): Promise<PlaybackResult> {
  const url = appendSpecialSourceParam(episodeUrl);
  prunePlaybackRequests();
  const key = playbackKey(url);
  const cached = playbackRequests.get(key);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    return cached.promise;
  }

  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set('format', 'json');
  const entry: { expiresAt: number; promise: Promise<PlaybackResult> } = {
    expiresAt: 0,
    promise: fetch(`${parsed.pathname}${parsed.search}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || typeof data?.url !== 'string' || !data.url.trim()) {
          throw new Error(data?.error || '获取播放链接失败');
        }
        entry.expiresAt = Date.now() + 15000;
        return data as PlaybackResult;
      })
      .catch((error) => {
        if (playbackRequests.get(key) === entry) playbackRequests.delete(key);
        throw error;
      }),
  };
  playbackRequests.set(key, entry);
  return entry.promise;
}

/** 一批线路一次往返，单条失败不会丢掉其他线路的解析结果。 */
export async function probeTVBoxBridgePlaybackLines(
  episodeUrls: string[],
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<Map<string, TVBoxBridgeProbeResult>> {
  const results = new Map<string, TVBoxBridgeProbeResult>();
  const groups = new Map<
    boolean,
    Map<string, { item: TVBoxBridgeProbeItem; urls: string[] }>
  >();
  for (const episodeUrl of episodeUrls) {
    const url = appendSpecialSourceParam(episodeUrl);
    const play = parseTVBoxBridgePlayUrl(url);
    if (!play) continue;
    const special =
      new URL(url, 'http://localhost').searchParams.get('special') === '1';
    const group = groups.get(special) ?? new Map();
    groups.set(special, group);
    const key = playbackKey(url);
    const entry = group.get(key) ?? {
      item: { key: play.siteKey, flag: play.flag, id: play.id },
      urls: [],
    };
    entry.urls.push(episodeUrl);
    group.set(key, entry);
  }

  for (const [special, group] of Array.from(groups.entries())) {
    const entries = Array.from(group.entries());
    for (
      let start = 0;
      start < entries.length;
      start += TVBOX_BRIDGE_PROBE_BATCH_SIZE
    ) {
      const batch = entries.slice(start, start + TVBOX_BRIDGE_PROBE_BATCH_SIZE);
      let probes: TVBoxBridgeProbeResult[];
      const controller = new AbortController();
      let timedOut = false;
      const timeout = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) controller.abort();
      try {
        const response = await fetch(
          `/api/tvbox-bridge/probe${special ? '?special=1' : ''}`,
          {
            signal: controller.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: batch.map(([, entry]) => entry.item),
            }),
          }
        );
        const data = await response.json();
        if (
          !response.ok ||
          !Array.isArray(data.results) ||
          data.results.length !== batch.length
        ) {
          throw new Error(data?.error || '批量解析线路失败');
        }
        probes = data.results;
      } catch (error) {
        probes = batch.map(() => ({
          ok: false,
          error: timedOut
            ? `线路解析超时（${timeoutMs}ms）`
            : signal?.aborted
              ? '线路解析已取消'
              : error instanceof Error ? error.message : String(error),
          errorType: timedOut ? 'timeout' : 'unreachable',
        }));
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
      batch.forEach(([key, entry], index) => {
        const probe = probes[index];
        entry.urls.forEach((url) => results.set(url, probe));
        if (probe.ok) {
          playbackRequests.set(key, {
            expiresAt: Date.now() + 15000,
            promise: Promise.resolve({
              url: probe.url,
              mediaType: probe.mediaType,
            }),
          });
        }
      });
    }
  }
  prunePlaybackRequests();
  return results;
}
