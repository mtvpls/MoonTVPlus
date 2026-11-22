/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import bs58 from 'bs58';
import he from 'he';

import { getTmdbImageBaseUrl } from './tmdb-image-base';

export type DoubanImageProxyType =
  | 'direct'
  | 'server'
  | 'img3'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'custom';

function normalizeDoubanImageProxyConfig(
  proxyType: DoubanImageProxyType,
  proxyUrl: string
): {
  proxyType: DoubanImageProxyType;
  proxyUrl: string;
} {
  const normalizedProxyUrl = proxyUrl.trim();

  if (proxyType === 'custom' && !normalizedProxyUrl) {
    return {
      proxyType: 'server',
      proxyUrl: '',
    };
  }

  return {
    proxyType,
    proxyUrl: normalizedProxyUrl,
  };
}

function buildDoubanImageUrl(
  originalUrl: string,
  proxyType: DoubanImageProxyType,
  proxyUrl: string
): string {
  switch (proxyType) {
    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
    case 'img3':
      return originalUrl.replace(/img\d+\.doubanio\.com/g, 'img3.doubanio.com');
    case 'cmliussss-cdn-tencent':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net'
      );
    case 'cmliussss-cdn-ali':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com'
      );
    case 'custom':
      return proxyUrl
        ? `${proxyUrl}${encodeURIComponent(originalUrl)}`
        : originalUrl;
    case 'direct':
    default:
      return originalUrl;
  }
}

function getDoubanImageProxyConfig(): {
  proxyType: DoubanImageProxyType;
  proxyUrl: string;
  backupProxyType: DoubanImageProxyType;
  backupProxyUrl: string;
} {
  // 确保在浏览器环境中执行
  if (typeof window === 'undefined') {
    return {
      proxyType: 'cmliussss-cdn-tencent',
      proxyUrl: '',
      backupProxyType: 'server',
      backupProxyUrl: '',
    };
  }

  const doubanImageProxyType =
    localStorage.getItem('doubanImageProxyType') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
    'cmliussss-cdn-tencent';
  const doubanImageProxy =
    localStorage.getItem('doubanImageProxyUrl') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY ||
    '';
  const doubanImageProxyBackupType =
    (localStorage.getItem(
      'doubanImageProxyTypeBackup'
    ) as DoubanImageProxyType | null) || 'server';
  const doubanImageProxyBackupUrl =
    localStorage.getItem('doubanImageProxyUrlBackup') || '';
  const primaryConfig = normalizeDoubanImageProxyConfig(
    doubanImageProxyType,
    doubanImageProxy
  );
  const backupConfig = normalizeDoubanImageProxyConfig(
    doubanImageProxyBackupType,
    doubanImageProxyBackupUrl
  );
  return {
    proxyType: primaryConfig.proxyType,
    proxyUrl: primaryConfig.proxyUrl,
    backupProxyType: backupConfig.proxyType,
    backupProxyUrl: backupConfig.proxyUrl,
  };
}

export function getDoubanImageFallbackUrl(originalUrl: string): string | null {
  if (!originalUrl || !originalUrl.includes('doubanio.com')) {
    return null;
  }

  const { proxyType, proxyUrl, backupProxyType, backupProxyUrl } =
    getDoubanImageProxyConfig();
  const primaryUrl = buildDoubanImageUrl(originalUrl, proxyType, proxyUrl);
  const backupUrl = buildDoubanImageUrl(
    originalUrl,
    backupProxyType,
    backupProxyUrl
  );

  if (backupUrl === primaryUrl) {
    return null;
  }

  return backupUrl;
}

function isBangumiImageUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'lain.bgm.tv' ||
      hostname === 'r.bgm.tv' ||
      hostname === 'bgm.lat' ||
      hostname.endsWith('.bgm.tv') ||
      hostname.endsWith('.bangumi.tv') ||
      hostname.endsWith('.bgm.lat')
    );
  } catch {
    return false;
  }
}

type AnimeImageSource = 'direct' | 'server-proxy' | 'custom-baseurl' | 'sakura';

const BANGUMI_IMAGE_FALLBACK_UNTIL_KEY = 'bangumiImageFallbackUntil';
const BANGUMI_IMAGE_FALLBACK_SIGNATURE_KEY = 'bangumiImageFallbackSignature';
const BANGUMI_IMAGE_FALLBACK_DURATION = 60 * 60 * 1000;
/** 探测主源图片域主页超时（404 也算通） */
const BANGUMI_IMAGE_PROBE_TIMEOUT_MS = 5000;
/** 探测成功后的内存缓存，避免列表刷屏时重复探测 */
const BANGUMI_IMAGE_PROBE_OK_TTL_MS = 15 * 60 * 1000;

type BangumiImageProbeCache = {
  signature: string;
  reachable: boolean | null;
  okUntil: number;
  inflight: Promise<boolean> | null;
};

let bangumiImageProbeCache: BangumiImageProbeCache = {
  signature: '',
  reachable: null,
  okUntil: 0,
  inflight: null,
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** 官方域名 → 镜像站（bgm.tv → bgm.lat 等） */
function rewriteBangumiUrlToSakura(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'bgm.tv' || hostname === 'bangumi.tv') {
      parsed.hostname = 'bgm.lat';
    } else if (hostname.endsWith('.bgm.tv')) {
      parsed.hostname = `${hostname.slice(0, -'.bgm.tv'.length)}.bgm.lat`;
    } else if (hostname.endsWith('.bangumi.tv')) {
      parsed.hostname = `${hostname.slice(
        0,
        -'.bangumi.tv'.length
      )}.bgm.lat`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeAnimeImageSource(
  value: string | null | undefined
): AnimeImageSource {
  return value === 'server-proxy' ||
    value === 'custom-baseurl' ||
    value === 'direct' ||
    value === 'sakura'
    ? value
    : 'direct';
}

function getPrimaryBangumiImageSource(): AnimeImageSource {
  if (typeof window === 'undefined') {
    return 'direct';
  }

  return normalizeAnimeImageSource(
    localStorage.getItem('animeDataSource') ||
      (window as any).RUNTIME_CONFIG?.BANGUMI_DATA_SOURCE ||
      'direct'
  );
}

function getBackupBangumiImageSource(
  primary: AnimeImageSource
): AnimeImageSource | null {
  if (typeof window === 'undefined') {
    return primary === 'server-proxy' ? null : 'server-proxy';
  }

  const backup = normalizeAnimeImageSource(
    localStorage.getItem('animeDataSourceBackup') || 'server-proxy'
  );

  return backup === primary ? null : backup;
}

function getBangumiImageBaseUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return normalizeBaseUrl(localStorage.getItem('animeImageBaseUrl') || '');
}

function getBangumiImageFallbackSignature(): string {
  if (typeof window === 'undefined') return '';

  return JSON.stringify({
    primary: getPrimaryBangumiImageSource(),
    backup: normalizeAnimeImageSource(
      localStorage.getItem('animeDataSourceBackup') || 'server-proxy'
    ),
    imageBaseUrl: getBangumiImageBaseUrl(),
  });
}

function getBangumiImageProbeSignature(): string {
  return JSON.stringify({
    primary: getPrimaryBangumiImageSource(),
    imageBaseUrl: getBangumiImageBaseUrl(),
  });
}

/** 当前主源图片域 origin；server-proxy 无需探测返回 null */
function getBangumiImageProbeOrigin(): string | null {
  const primary = getPrimaryBangumiImageSource();
  switch (primary) {
    case 'server-proxy':
      return null;
    case 'sakura':
      return 'https://lain.bgm.lat';
    case 'custom-baseurl': {
      const base = getBangumiImageBaseUrl();
      if (!base) return 'https://lain.bgm.tv';
      try {
        return new URL(base).origin;
      } catch {
        return null;
      }
    }
    case 'direct':
    default:
      return 'https://lain.bgm.tv';
  }
}

export function clearBangumiImageProbeCache(): void {
  bangumiImageProbeCache = {
    signature: '',
    reachable: null,
    okUntil: 0,
    inflight: null,
  };
}

/** 仅清除 localStorage 中的 sticky 降级标记，不动内存探测缓存（热路径调用） */
function clearBangumiImageFallbackFlags(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(BANGUMI_IMAGE_FALLBACK_UNTIL_KEY);
  localStorage.removeItem(BANGUMI_IMAGE_FALLBACK_SIGNATURE_KEY);
}

export function clearBangumiImageFallbackCache(): void {
  clearBangumiImageFallbackFlags();
  clearBangumiImageProbeCache();
}

export function markBangumiImageFallbackActive(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    BANGUMI_IMAGE_FALLBACK_UNTIL_KEY,
    String(Date.now() + BANGUMI_IMAGE_FALLBACK_DURATION)
  );
  localStorage.setItem(
    BANGUMI_IMAGE_FALLBACK_SIGNATURE_KEY,
    getBangumiImageFallbackSignature()
  );
}

/**
 * 探测主源图片域是否可达：请求 origin 主页（常见 404），5s 超时 + 防缓存。
 * no-cors 下任意完成（含 404）视为可达；超时/DNS/断网视为不可达。
 * 失败时写入 sticky 降级（若有备源）。全局单飞 + 成功缓存 15 分钟。
 * @returns true=主源可用，false=应走备源
 */
export async function ensureBangumiImagePrimaryProbed(): Promise<boolean> {
  if (typeof window === 'undefined') return true;

  if (isBangumiImageFallbackActive()) {
    return false;
  }

  const origin = getBangumiImageProbeOrigin();
  if (!origin) {
    return true;
  }

  const signature = getBangumiImageProbeSignature();
  const now = Date.now();

  if (
    bangumiImageProbeCache.signature === signature &&
    bangumiImageProbeCache.reachable === true &&
    bangumiImageProbeCache.okUntil > now
  ) {
    return true;
  }

  if (
    bangumiImageProbeCache.signature === signature &&
    bangumiImageProbeCache.inflight
  ) {
    return bangumiImageProbeCache.inflight;
  }

  const probePromise = (async (): Promise<boolean> => {
    const url = `${origin}/?_cb=${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    try {
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(BANGUMI_IMAGE_PROBE_TIMEOUT_MS),
      });
      bangumiImageProbeCache = {
        signature,
        reachable: true,
        okUntil: Date.now() + BANGUMI_IMAGE_PROBE_OK_TTL_MS,
        inflight: null,
      };
      return true;
    } catch {
      bangumiImageProbeCache = {
        signature,
        reachable: false,
        okUntil: 0,
        inflight: null,
      };
      const primary = getPrimaryBangumiImageSource();
      if (getBackupBangumiImageSource(primary)) {
        markBangumiImageFallbackActive();
      }
      return false;
    }
  })();

  bangumiImageProbeCache = {
    signature,
    reachable: bangumiImageProbeCache.reachable,
    okUntil: bangumiImageProbeCache.okUntil,
    inflight: probePromise,
  };

  return probePromise;
}

/** 非阻塞触发主源图片域探测（processImageUrl / 首屏侧调用） */
export function scheduleBangumiImagePrimaryProbe(): void {
  if (typeof window === 'undefined') return;
  void ensureBangumiImagePrimaryProbed();
}

function normalizeComparableUrl(url: string): string {
  if (typeof window === 'undefined') return url;

  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

export function clearBangumiImageFallbackCacheIfFailed(
  target: HTMLImageElement,
  originalUrl: string
): boolean {
  if (!originalUrl || !isBangumiImageUrl(originalUrl)) {
    return false;
  }

  const fallbackUrl = getBangumiImageFallbackUrl(originalUrl);
  if (!fallbackUrl) {
    return false;
  }

  const normalizedFallbackUrl = normalizeComparableUrl(fallbackUrl);
  const failedUrls = [target.currentSrc, target.src]
    .filter(Boolean)
    .map(normalizeComparableUrl);
  const isFallbackFailure =
    target.dataset.bangumiBackupTried === 'true' ||
    failedUrls.includes(normalizedFallbackUrl);

  if (!isFallbackFailure) {
    return false;
  }

  target.dataset.bangumiBackupFailed = 'true';
  delete target.dataset.bangumiBackupTried;
  clearBangumiImageFallbackCache();
  return true;
}

function isBangumiImageFallbackActive(): boolean {
  if (typeof window === 'undefined') return false;

  const until = Number(localStorage.getItem(BANGUMI_IMAGE_FALLBACK_UNTIL_KEY));
  if (!until || Date.now() >= until) {
    clearBangumiImageFallbackFlags();
    return false;
  }

  const signature = localStorage.getItem(BANGUMI_IMAGE_FALLBACK_SIGNATURE_KEY);
  if (signature !== getBangumiImageFallbackSignature()) {
    clearBangumiImageFallbackFlags();
    return false;
  }

  return true;
}

function buildBangumiImageUrl(
  originalUrl: string,
  source: AnimeImageSource
): string {
  switch (source) {
    case 'server-proxy':
      return `/api/image-proxy?url=${encodeURIComponent(
        originalUrl
      )}&source=bangumi`;
    case 'custom-baseurl': {
      const imageBaseUrl = getBangumiImageBaseUrl();
      return imageBaseUrl ? `${imageBaseUrl}/${originalUrl}` : originalUrl;
    }
    case 'sakura':
      return rewriteBangumiUrlToSakura(originalUrl);
    case 'direct':
    default:
      return originalUrl;
  }
}

export function getBangumiImageFallbackUrl(originalUrl: string): string | null {
  if (!originalUrl || !isBangumiImageUrl(originalUrl)) {
    return null;
  }

  const primary = getPrimaryBangumiImageSource();
  const backup = getBackupBangumiImageSource(primary);
  if (!backup) {
    return null;
  }

  const primaryUrl = buildBangumiImageUrl(originalUrl, primary);
  const backupUrl = buildBangumiImageUrl(originalUrl, backup);

  if (backupUrl === primaryUrl) {
    return null;
  }

  return backupUrl;
}

export function tryApplyDoubanImageFallback(
  target: HTMLImageElement,
  originalUrl: string
): boolean {
  if (!originalUrl || !originalUrl.includes('doubanio.com')) {
    return false;
  }

  if (target.dataset.doubanBackupTried === 'true') {
    return false;
  }

  const fallbackUrl = getDoubanImageFallbackUrl(originalUrl);
  if (
    !fallbackUrl ||
    fallbackUrl === target.currentSrc ||
    fallbackUrl === target.src
  ) {
    return false;
  }

  target.dataset.doubanBackupTried = 'true';
  target.src = fallbackUrl;
  return true;
}

export function tryApplyBangumiImageFallback(
  target: HTMLImageElement,
  originalUrl: string
): boolean {
  if (!originalUrl || !isBangumiImageUrl(originalUrl)) {
    return false;
  }

  if (target.dataset.bangumiBackupTried === 'true') {
    return false;
  }

  if (target.dataset.bangumiBackupFailed === 'true') {
    return false;
  }

  const fallbackUrl = getBangumiImageFallbackUrl(originalUrl);
  if (
    !fallbackUrl ||
    fallbackUrl === target.currentSrc ||
    fallbackUrl === target.src
  ) {
    return false;
  }

  target.dataset.bangumiBackupTried = 'true';
  markBangumiImageFallbackActive();
  target.src = fallbackUrl;
  return true;
}

/**
 * 处理图片 URL，根据用户设置使用相应的代理
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 如果已经是代理URL，直接返回
  if (originalUrl.startsWith('/api/image-proxy')) {
    return originalUrl;
  }

  // 处理 TMDB 图片 URL 替换
  if (originalUrl.includes('image.tmdb.org')) {
    if (typeof window !== 'undefined') {
      const tmdbImageBaseUrl = getTmdbImageBaseUrl();
      // 与默认地址一致时无需替换
      if (tmdbImageBaseUrl !== 'https://image.tmdb.org') {
        // 已带有配置的图片前缀时直接返回，避免重复嵌套拼接
        if (originalUrl.startsWith(tmdbImageBaseUrl)) {
          return originalUrl;
        }
        // 仅替换开头的官方图片地址，避免对已拼接的 URL 再次追加前缀
        for (const officialBase of [
          'https://image.tmdb.org',
          'http://image.tmdb.org',
        ]) {
          if (originalUrl.startsWith(officialBase)) {
            return tmdbImageBaseUrl + originalUrl.slice(officialBase.length);
          }
        }
      }
    }
    return originalUrl;
  }

  // 处理 Bangumi 图片代理。直连模式尊重用户选择，不代理图片；
  // 仅在服务器代理 / 自定义 Base URL 模式下使用本站图片代理。
  // sticky 降级中走备源；否则用主源，并非阻塞探测主源图片域主页（5s，404 算通）。
  if (isBangumiImageUrl(originalUrl)) {
    const primary = getPrimaryBangumiImageSource();
    const backup = getBackupBangumiImageSource(primary);
    if (backup && isBangumiImageFallbackActive()) {
      return buildBangumiImageUrl(originalUrl, backup);
    }
    if (primary !== 'server-proxy' && backup) {
      scheduleBangumiImagePrimaryProbe();
    }
    return buildBangumiImageUrl(originalUrl, primary);
  }

  // 处理豆瓣图片代理
  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();
  return buildDoubanImageUrl(originalUrl, proxyType, proxyUrl);
}

/**
 * 处理视频 URL，根据用户设置使用相应的代理
 */
export function processVideoUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 仅处理豆瓣视频代理
  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  // 获取用户配置的代理设置
  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();

  // 根据代理类型处理URL
  switch (proxyType) {
    case 'direct':
      // 直连，不使用代理
      return originalUrl;

    case 'server':
      // 使用服务器代理
      return `/api/video-proxy?url=${encodeURIComponent(originalUrl)}`;

    case 'img3':
      // 使用 img3.doubanio.com 代理
      return originalUrl.replace(/img\d\.doubanio\.com/g, 'img3.doubanio.com');

    case 'cmliussss-cdn-tencent':
      // 使用腾讯云CDN代理
      return originalUrl.replace(
        /https?:\/\/img\d\.doubanio\.com/g,
        'https://douban-img.cmliussss.workers.dev'
      );

    case 'cmliussss-cdn-ali':
      // 使用阿里云CDN代理
      return originalUrl.replace(
        /https?:\/\/img\d\.doubanio\.com/g,
        'https://douban-img-ali.cmliussss.workers.dev'
      );

    case 'custom':
      // 使用自定义代理
      if (proxyUrl) {
        return originalUrl.replace(
          /https?:\/\/img\d\.doubanio\.com/g,
          proxyUrl
        );
      }
      return originalUrl;

    default:
      // 默认使用腾讯云CDN代理
      return originalUrl.replace(
        /https?:\/\/img\d\.doubanio\.com/g,
        'https://douban-img.cmliussss.workers.dev'
      );
  }
}

/**
 * 测速失败类型：
 * - timeout：源可达但在超时窗口内没能拿到元数据/首片（太慢）
 * - unreachable：网络错误、CORS、404、HLS 解析失败等，源无法访问
 */
export type SpeedTestErrorType = 'timeout' | 'unreachable';

export class SpeedTestError extends Error {
  type: SpeedTestErrorType;
  constructor(type: SpeedTestErrorType, message: string) {
    super(message);
    this.name = 'SpeedTestError';
    this.type = type;
  }
}

/**
 * 从m3u8地址获取视频质量等级和网络信息
 * @param m3u8Url m3u8播放列表的URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number, bitrate: string}> 视频质量等级和网络信息
 */
export async function getVideoResolutionFromM3u8(
  m3u8Url: string,
  timeoutMs = 6000,
  signal?: AbortSignal
): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自动转换为KB/s或MB/s
  pingTime: number; // 网络延迟（毫秒）
  bitrate: string; // 视频码率（如 "2.5 Mbps"）
}> {
  try {
    const { default: Hls, FetchLoader } = await import('hls.js');
    if (signal?.aborted) throw new DOMException('测速已取消', 'AbortError');

    // 直接使用m3u8 URL作为视频源，避免CORS问题
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';

      // 测量网络延迟（ping时间） - 使用m3u8 URL而不是ts文件
      const pingStart = performance.now();
      let pingTime = 0;
      const pingController = new AbortController();

      // 测量ping时间（使用m3u8 URL）
      fetch(m3u8Url, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: pingController.signal,
      })
        .then(() => {
          pingTime = performance.now() - pingStart;
        })
        .catch(() => {
          pingTime = performance.now() - pingStart; // 记录到失败为止的时间
        });

      // 绕过浏览器缓存，不改写分片 URL，避免破坏 TVBox / 网盘地址的签名。
      const hls = new Hls({
        loader: FetchLoader,
        fetchSetup: (context, initParams) =>
          new Request(context.url, { ...initParams, cache: 'no-store' }),
      });

      let actualLoadSpeed = '未知';
      let hasSpeedCalculated = false;
      let hasMetadataLoaded = false;
      let estimatedBitrate = 0; // 估算的码率（bps）
      let settled = false;
      let samplingTimeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        clearTimeout(samplingTimeout);
        signal?.removeEventListener('abort', onAbort);
        pingController.abort();
        hls.destroy();
        video.remove();
      };
      const onAbort = () => {
        if (settled) return;
        cleanup();
        reject(new DOMException('测速已取消', 'AbortError'));
      };

      // 提取核心返回逻辑供 resolve 和 timeout 共同调用
      const resolveCurrentState = () => {
        if (settled) return;
        const width = video.videoWidth;
        const quality =
          width >= 3840
            ? '4K'
            : width >= 2560
            ? '2K'
            : width >= 1920
            ? '1080p'
            : width >= 1280
            ? '720p'
            : width >= 854
            ? '480p'
            : width > 0
            ? 'SD'
            : '未知';

        const bitrateStr =
          estimatedBitrate > 0
            ? estimatedBitrate >= 1000000
              ? `${(estimatedBitrate / 1000000).toFixed(1)} Mbps`
              : `${Math.round(estimatedBitrate / 1000)} Kbps`
            : '未知';

        cleanup();

        resolve({
          quality,
          loadSpeed: actualLoadSpeed,
          pingTime: Math.round(pingTime),
          bitrate: bitrateStr,
        });
      };

      // 设置超时处理 - 如果部分数据已拿到，则宽容返回
      const timeout = setTimeout(() => {
        if (hasMetadataLoaded || hasSpeedCalculated) {
          resolveCurrentState();
        } else {
          cleanup();
          reject(
            new SpeedTestError('timeout', 'Timeout loading video metadata')
          );
        }
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });

      video.onerror = () => {
        if (settled) return;
        const mediaError = video.error;
        cleanup();
        reject(
          new SpeedTestError(
            'unreachable',
            `视频元数据加载失败：code=${mediaError?.code || 0} ${mediaError?.message || ''}`
          )
        );
      };

      let sampledBytes = 0;
      let sampledLoadTime = 0;
      let samplingWindowElapsed = false;

      // 检查是否可以相互满足要求
      const checkAndResolve = () => {
        if (
          hasMetadataLoaded &&
          (hasSpeedCalculated || actualLoadSpeed !== '未知')
        ) {
          clearTimeout(timeout);
          resolveCurrentState();
        }
      };

      const updateSampledSpeed = () => {
        if (settled || hasSpeedCalculated) return;
        // 快线路可能在 1 秒内填满缓冲，之后不再下载分片。
        // 采样窗口按墙钟结束，速度仍按实际传输耗时计算，避免空等整个超时。
        if (
          (!samplingWindowElapsed && sampledLoadTime < 1000) ||
          sampledBytes < 256 * 1024 ||
          sampledLoadTime <= 0
        )
          return;

        const speedKBps = sampledBytes / 1024 / (sampledLoadTime / 1000);
        actualLoadSpeed =
          speedKBps >= 1024
            ? `${(speedKBps / 1024).toFixed(1)} MB/s`
            : `${speedKBps.toFixed(1)} KB/s`;
        hasSpeedCalculated = true;
        checkAndResolve();
      };

      // 使用各视频分片自己的传输时间，忽略初始化分片和独立音轨。
      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        if (
          settled ||
          hasSpeedCalculated ||
          data.frag.type !== 'main' ||
          data.frag.sn === 'initSegment'
        )
          return;

        const size = data.payload.byteLength;
        const { start, end } = (data.part?.stats || data.frag.stats).loading;
        const loadTime = end - start;
        if (size <= 0 || loadTime <= 0) return;

        const fragmentDuration = data.part?.duration || data.frag.duration;
        if (fragmentDuration > 0) {
          estimatedBitrate = Math.round((size * 8) / fragmentDuration);
        }

        // 跨域无 Timing-Allow-Origin 时传输大小为 0，不能据此误判缓存。
        const fromCache = performance
          .getEntriesByName(data.part?.url || data.frag.url, 'resource')
          .some((entry) => {
            const resource = entry as PerformanceResourceTiming;
            return (
              resource.startTime >= start &&
              resource.startTime <= end &&
              resource.transferSize === 0 &&
              resource.decodedBodySize > 0
            );
          });
        if (fromCache) return;

        sampledBytes += size;
        sampledLoadTime += loadTime;
        if (samplingTimeout === undefined) {
          samplingTimeout = setTimeout(() => {
            samplingWindowElapsed = true;
            updateSampledSpeed();
          }, 1000);
        }
        updateSampledSpeed();
      });

      // 监听hls.js错误
      hls.on(Hls.Events.ERROR, (event: any, data: any) => {
        if (settled) return;
        const statusCode = data.response?.code || data.response?.status;
        const details = typeof data.details === 'string' ? data.details : '';
        const cause = data.error instanceof Error ? data.error.message : '';
        console.error(`[线路优选] HLS错误 ${JSON.stringify({
          type: data.type,
          details,
          fatal: data.fatal,
          status: statusCode,
          error: cause,
        })}`);
        if (data.fatal) {
          // 防止 415 代理兜底熔断导致正常的二进制源在优选逻辑中被剔除
          if (
            statusCode === 415 &&
            (m3u8Url.includes('/api/proxy-m3u8') ||
              m3u8Url.includes('/api/proxy/vod/m3u8'))
          ) {
            console.log(
              '[测速] 测速通道嗅探到这是底层的媒体流文件，免测速通过'
            );
            cleanup();
            resolve({
              quality: '原生画质',
              loadSpeed: '直连',
              pingTime: 10,
              bitrate: '未知',
            });
            return;
          }

          cleanup();
          // HLS 的 *TimeOut 类 details（manifestLoadTimeOut 等）归为超时，
          // 其余致命错误（网络不可达、404、解析失败）归为无法访问
          const isTimeout = details.toLowerCase().includes('timeout');
          reject(
            new SpeedTestError(
              isTimeout ? 'timeout' : 'unreachable',
              `HLS测速失败：${data.type}/${details}${statusCode ? ` HTTP ${statusCode}` : ''}${cause ? ` ${cause}` : ''}`
            )
          );
        }
      });

      // 监听视频元数据加载完成
      video.onloadedmetadata = () => {
        hasMetadataLoaded = true;
        checkAndResolve(); // 尝试返回结果
      };
      // 先绑定错误和元数据事件，再开始加载，避免同步报错被漏掉。
      hls.loadSource(m3u8Url);
      hls.attachMedia(video);
    });
  } catch (error) {
    if (
      error instanceof SpeedTestError ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    throw new Error(
      `Error getting video resolution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';

  const cleanedText = text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .trim(); // 去掉首尾空格

  // 使用 he 库解码 HTML 实体
  return he.decode(cleanedText);
}

/**
 * 将字符串编码为 Base58
 * @param str 要编码的字符串
 * @returns Base58 编码后的字符串
 */
export function base58Encode(str: string): string {
  if (!str) return '';

  // 在浏览器环境中使用 TextEncoder
  if (typeof window !== 'undefined') {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    return bs58.encode(bytes);
  }

  // 在 Node.js 环境中使用 Buffer
  const buffer = Buffer.from(str, 'utf-8');
  return bs58.encode(buffer);
}

/**
 * 将 Base58 字符串解码为原始字符串
 * @param encoded Base58 编码的字符串
 * @returns 解码后的原始字符串
 */
export function base58Decode(encoded: string): string {
  if (!encoded) return '';

  const bytes = bs58.decode(encoded);

  // 在浏览器环境中使用 TextDecoder
  if (typeof window !== 'undefined') {
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

  // 在 Node.js 环境中使用 Buffer
  return Buffer.from(bytes).toString('utf-8');
}
