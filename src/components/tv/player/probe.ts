import { probeTVBoxBridgePlaybackLines } from '@/lib/tvbox-bridge.client';
import {
  getTVBoxBridgeLines,
  parseTVBoxBridgePlayUrl,
  TVBOX_BRIDGE_MAX_TEST_LINES,
} from '@/lib/tvbox-bridge.shared';
import type { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, SpeedTestError } from '@/lib/utils';

import { resolveTVEpisodePlayback, TVEpisodePlayback } from './utils';

export type TVMediaProbeInfo = Awaited<
  ReturnType<typeof getVideoResolutionFromM3u8>
>;

export type TVSourceProbeResult = {
  item: SearchResult;
  line?: string;
} & (
  | { status: 'ok'; result: TVMediaProbeInfo }
  | { status: 'unsupported' | 'fail'; reason: string }
);

class UnsupportedMediaProbeError extends Error {}

function qualityFromWidth(width: number) {
  if (width >= 3840) return '4K';
  if (width >= 2560) return '2K';
  if (width >= 1920) return '1080p';
  if (width >= 1280) return '720p';
  if (width >= 854) return '480p';
  return width > 0 ? 'SD' : '未知';
}

function mediaSourceType(url: string, mediaType?: string) {
  const type = mediaType?.toLowerCase();
  if (type === 'hls' || type === 'm3u8') return 'm3u8';
  if (type === 'flv' || /\.flv(?:[?#]|$)/i.test(url)) return 'flv';
  if (
    type === 'mp4' ||
    type === 'file' ||
    /\.(mp4|webm|mkv|avi|mov)(?:[?#]|$)/i.test(url)
  )
    return 'native';
  return 'm3u8';
}

async function probeVideoElement(
  url: string,
  type: 'native' | 'flv',
  timeoutMs: number
): Promise<TVMediaProbeInfo> {
  const flvModule = type === 'flv' ? await import('flv.js') : null;
  const flvjs = flvModule?.default;
  if (type === 'flv' && !flvjs?.isSupported()) {
    throw new UnsupportedMediaProbeError('当前设备不支持 FLV 测速');
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', 'true');
    const started = performance.now();
    let metadataTime = 0;
    let loadSpeed = '未知';
    let disposeEngine = () => undefined as void;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        quality: qualityFromWidth(
          Math.max(video.videoWidth, video.videoHeight)
        ),
        // 原生视频未暴露传输字节数时，不伪造下载速度或码率。
        loadSpeed,
        pingTime: Math.round(metadataTime || performance.now() - started),
        bitrate: '未知',
      };
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onerror = null;
      disposeEngine();
      video.removeAttribute('src');
      video.load();
      video.remove();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () => finish(new SpeedTestError('timeout', '媒体加载超时')),
      timeoutMs
    );
    video.onloadedmetadata = () => {
      metadataTime = performance.now() - started;
    };
    video.onloadeddata = () => finish();
    video.onerror = () => {
      finish(
        video.error?.code === 4
          ? new UnsupportedMediaProbeError('当前设备无法检测此媒体格式')
          : new SpeedTestError('unreachable', '媒体加载失败')
      );
    };

    try {
      if (flvjs) {
        const player = flvjs.createPlayer({ type: 'flv', url, isLive: false });
        disposeEngine = () => {
          player.unload();
          player.detachMediaElement();
          player.destroy();
        };
        player.on(flvjs.Events.ERROR, () =>
          finish(new SpeedTestError('unreachable', 'FLV 媒体加载失败'))
        );
        player.on(flvjs.Events.STATISTICS_INFO, (info: { speed?: number }) => {
          if (info.speed && info.speed > 0) {
            loadSpeed =
              info.speed >= 1024
                ? `${(info.speed / 1024).toFixed(1)} MB/s`
                : `${info.speed.toFixed(1)} KB/s`;
          }
        });
        player.attachMediaElement(video);
        player.load();
      } else {
        // 不设置 crossOrigin，原生媒体可加载没有 CORS 许可的 MP4 / HLS。
        video.src = url;
        video.load();
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error('媒体检测失败'));
    }
  });
}

/** 使用与 TV 播放器相同的格式选择，保留签名地址和原生 HLS 能力。 */
export async function probeTVMedia(
  playback: TVEpisodePlayback,
  timeoutMs = 8000
): Promise<TVMediaProbeInfo> {
  if (playback.live) throw new UnsupportedMediaProbeError('直播线路');
  const type = playback.sourceType || mediaSourceType(playback.url);
  if (type !== 'm3u8') return probeVideoElement(playback.url, type, timeoutMs);

  const video = document.createElement('video');
  const nativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
  const { default: Hls } = await import('hls.js');
  if (Hls.isSupported()) {
    try {
      return await getVideoResolutionFromM3u8(playback.url, timeoutMs);
    } catch (error) {
      if (!nativeHls) throw error;
    }
  } else if (!nativeHls) {
    throw new UnsupportedMediaProbeError('当前设备不支持 HLS 测速');
  }
  return probeVideoElement(playback.url, 'native', timeoutMs);
}

async function withParseTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SpeedTestError('timeout', '解析播放地址超时')),
          20000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 默认线路不可测时继续尝试备用线路，二次解析和直播不计为坏源。 */
export async function probeTVSource(
  item: SearchResult
): Promise<TVSourceProbeResult> {
  const lines = getTVBoxBridgeLines(item);
  const candidates = lines.length
    ? [...lines]
        .filter((line) => line.episodes.length > 0)
        .sort(
          (a, b) =>
            Number(b.name === item.activeLine) -
            Number(a.name === item.activeLine)
        )
        .slice(0, TVBOX_BRIDGE_MAX_TEST_LINES)
        .map((line) => ({
          line,
          url: line.episodes[Math.min(1, line.episodes.length - 1)],
        }))
    : item.episodes?.length
    ? [
        {
          line: undefined,
          url: item.episodes[Math.min(1, item.episodes.length - 1)],
        },
      ]
    : [];
  if (!candidates.length) {
    return { item, status: 'fail', reason: '暂无播放地址' };
  }

  let unsupported: { reason: string; line?: string } | undefined;
  let failure = '媒体检测失败';
  try {
    const bridgeUrls = candidates
      .map(({ url }) => url)
      .filter((url) => parseTVBoxBridgePlayUrl(url));
    const probes = bridgeUrls.length
      ? await withParseTimeout(probeTVBoxBridgePlaybackLines(bridgeUrls))
      : null;

    for (const candidate of candidates) {
      try {
        let playback: TVEpisodePlayback;
        if (parseTVBoxBridgePlayUrl(candidate.url)) {
          const probe = probes?.get(candidate.url);
          if (!probe?.ok) {
            if (probe?.unsupported) {
              unsupported ||= {
                reason: probe.reason || '未能获取媒体测速数据',
                line: candidate.line?.name,
              };
            } else {
              failure = probe?.error || '获取媒体地址失败';
            }
            continue;
          }
          playback = {
            url: probe.url,
            sourceType: mediaSourceType(probe.url, probe.mediaType),
          };
        } else {
          playback = await withParseTimeout(
            resolveTVEpisodePlayback(candidate.url, item.source, item.proxyMode)
          );
        }
        const result = await probeTVMedia(playback);
        return {
          item: candidate.line
            ? {
                ...item,
                activeLine: candidate.line.name,
                episodes: candidate.line.episodes,
                episodes_titles: candidate.line.episodes_titles,
              }
            : item,
          line: candidate.line?.name,
          status: 'ok',
          result,
        };
      } catch (error) {
        if (error instanceof UnsupportedMediaProbeError) {
          unsupported ||= { reason: error.message, line: candidate.line?.name };
        } else {
          failure =
            error instanceof SpeedTestError && error.type === 'timeout'
              ? '媒体加载超时'
              : error instanceof Error
              ? error.message
              : '媒体检测失败';
        }
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : '桥接解析失败';
  }
  return unsupported
    ? { item, status: 'unsupported', ...unsupported }
    : { item, status: 'fail', reason: failure };
}
