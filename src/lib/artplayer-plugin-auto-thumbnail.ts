/**
 * 本地版 artplayer-plugin-auto-thumbnail。
 *
 * 上游 1.1.0 有两个无法从外部修复的缺陷：
 * 1. 用游离的 <video> 逐帧 seek 抽图，但不暴露任何取消入口，且 ArtPlayer 不会调用插件的
 *    destroy，导致播放器销毁/换源后这个 video 仍在对旧地址发 Range 请求。
 * 2. 取 url 时 `option.url || art.option.url` 优先用创建播放器那一刻传入的地址，换源后
 *    会重新扫描旧视频。
 */

interface AutoThumbnailOption {
  url?: string;
  width?: number;
  number?: number;
  scale?: number;
}

interface ThumbnailConfig {
  url: string;
  height: number;
}

const COLUMN = 10;

function releaseVideo(video: HTMLVideoElement) {
  video.onloadedmetadata = null;
  video.onseeked = null;
  // 仅置空 src 不足以中断已在飞的 Range 请求，必须再 load() 一次重置媒体元素
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    // ignore
  }
}

function startGeneration(
  url: string,
  width: number,
  number: number,
  onUpdate: (config: ThumbnailConfig) => void
): { cancel: () => void } {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';

  let cancelled = false;
  let blobUrl: string | null = null;

  const revokeBlob = () => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    releaseVideo(video);
    revokeBlob();
  };

  video.onloadedmetadata = () => {
    if (cancelled) return;

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) {
      cancel();
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      cancel();
      return;
    }

    const height = Math.floor((width * video.videoHeight) / video.videoWidth);
    canvas.width = width * COLUMN;
    canvas.height = height * Math.ceil(number / COLUMN);

    const publish = () => {
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        revokeBlob();
        blobUrl = URL.createObjectURL(blob);
        onUpdate({ url: blobUrl, height });
      }, 'image/jpeg');
    };

    const seekAndDraw = (index: number) => {
      if (cancelled) return;

      publish();

      if (index >= number) {
        // 抽帧完成，游离 video 不再需要，但已生成的 blob 仍在使用
        releaseVideo(video);
        return;
      }

      video.currentTime = (duration * index) / number;
      video.onseeked = () => {
        if (cancelled) return;
        ctx.drawImage(
          video,
          (index % COLUMN) * width,
          Math.floor(index / COLUMN) * height,
          width,
          height
        );
        seekAndDraw(index + 1);
      };
    };

    seekAndDraw(0);
  };

  video.src = url;
  return { cancel };
}

export default function artplayerPluginAutoThumbnail(
  option: AutoThumbnailOption = {}
) {
  return (art: any) => {
    const width = option.width || 160;
    const number = option.number || 100;
    const scale = option.scale || 1;

    let generation: { cancel: () => void } | null = null;

    const stop = () => {
      generation?.cancel();
      generation = null;
    };

    const start = () => {
      // 换源同样会触发 loadedmetadata，必须先掐掉上一轮，否则旧地址会被一直扫下去
      stop();

      const url = art.option.url || option.url;
      if (!url) return;

      generation = startGeneration(url, width, number, (config) => {
        if (art.isDestroy) return;
        art.thumbnails = { ...config, column: COLUMN, number, width, scale };
      });
    };

    art.on('video:loadedmetadata', start);
    art.on('destroy', stop);

    return { name: 'artplayerPluginAutoThumbnail', destroy: stop };
  };
}
