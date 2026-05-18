import { createHash } from 'crypto';

import { BookTtsBoundary, BookTtsVoice } from './book.types';
import { getConfig } from './config';

type RawVoice = {
  Name?: string;
  ShortName?: string;
  Locale?: string;
  Gender?: string;
  FriendlyName?: string;
  DisplayName?: string;
};

type RawBoundary = {
  offset?: number;
  duration?: number;
  text?: string;
  word?: string;
};

type TtsSynthesizeResult = {
  audioBuffer: Buffer;
  mimeType: string;
  boundaries: BookTtsBoundary[];
};

type EdgeTtsSynthesizer = {
  synthesize: () => Promise<{
    audio?: unknown;
    mimeType?: string;
    subtitle?: RawBoundary[] | { words?: RawBoundary[] };
    subtitles?: RawBoundary[];
  }>;
};

type EdgeTtsVoicesManagerInstance = {
  getVoices?: () => Promise<RawVoice[]>;
  voices?: RawVoice[];
};

type EdgeTtsConstructor = new (
  text: string,
  voice: string,
  options?: {
    rate?: string;
    pitch?: string;
    volume?: string;
  }
) => EdgeTtsSynthesizer;

export type BookTtsRuntimeConfig = {
  enabled: boolean;
  provider: 'edge-tts-universal';
  defaultVoice: string;
  defaultRate: string;
  defaultPitch: string;
  defaultVolume: string;
  maxCharsPerChunk: number;
  prefetchChunks: number;
  cacheEnabled: boolean;
  cacheTtl: number;
  maxTextLengthPerRequest: number;
};

type EdgeTtsModule = {
  EdgeTTS?: EdgeTtsConstructor;
  VoicesManager?: {
    create?: () => Promise<EdgeTtsVoicesManagerInstance>;
    new (): EdgeTtsVoicesManagerInstance;
  };
  default?: {
    EdgeTTS?: EdgeTtsConstructor;
    VoicesManager?: {
      create?: () => Promise<EdgeTtsVoicesManagerInstance>;
      new (): EdgeTtsVoicesManagerInstance;
    };
  };
};

function resolveEdgeTtsModule(): EdgeTtsModule {
  try {
    // eslint-disable-next-line no-eval
    return eval('require')('edge-tts-universal') as EdgeTtsModule;
  } catch (error) {
    throw new Error(`未安装 edge-tts-universal，请先执行 pnpm add edge-tts-universal。${(error as Error).message}`);
  }
}

function normalizeVoice(item: RawVoice): BookTtsVoice {
  const shortName = item.ShortName || item.Name || '';
  const displayName = item.DisplayName || item.FriendlyName || shortName;
  return {
    name: item.Name || shortName,
    shortName,
    locale: item.Locale || '',
    gender: item.Gender || undefined,
    displayName,
  };
}

function normalizeBoundary(item: RawBoundary): BookTtsBoundary {
  return {
    offset: Number(item.offset || 0),
    duration: Number(item.duration || 0),
    text: item.text || item.word || '',
  };
}

function isArrayBufferLike(audio: unknown): audio is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return !!audio && typeof audio === 'object' && typeof (audio as { arrayBuffer?: unknown }).arrayBuffer === 'function';
}

async function toBuffer(audio: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof Uint8Array) return Buffer.from(audio);
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  if (isArrayBufferLike(audio)) return Buffer.from(await audio.arrayBuffer());
  if (typeof audio === 'string') return Buffer.from(audio, 'base64');
  throw new Error('无法识别 edge-tts-universal 返回的音频格式');
}

function buildCacheKey(input: {
  sourceId: string;
  bookId: string;
  chapterHref: string;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  text: string;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export async function getBookTtsConfig(): Promise<BookTtsRuntimeConfig> {
  await getConfig();
  return {
    enabled: true,
    provider: 'edge-tts-universal',
    defaultVoice: 'zh-CN-XiaoxiaoNeural',
    defaultRate: '+0%',
    defaultPitch: '+0Hz',
    defaultVolume: '+0%',
    maxCharsPerChunk: 1200,
    prefetchChunks: 1,
    cacheEnabled: false,
    cacheTtl: 0,
    maxTextLengthPerRequest: 2000,
  };
}

export async function listBookTtsVoices(): Promise<BookTtsVoice[]> {
  const mod = resolveEdgeTtsModule();
  const VoicesManager = mod.VoicesManager || mod.default?.VoicesManager;
  if (!VoicesManager) throw new Error('edge-tts-universal 未导出 VoicesManager');

  let voices: RawVoice[] = [];
  if (typeof VoicesManager.create === 'function') {
    const manager = await VoicesManager.create();
    voices = (await manager.getVoices?.()) || manager.voices || [];
  } else {
    const manager = new VoicesManager();
    voices = (await manager.getVoices?.()) || manager.voices || [];
  }

  return voices
    .map(normalizeVoice)
    .filter((item) => !!item.shortName)
    .sort((a, b) => {
      const zhA = a.locale.startsWith('zh') ? 0 : 1;
      const zhB = b.locale.startsWith('zh') ? 0 : 1;
      return zhA - zhB || a.locale.localeCompare(b.locale) || a.shortName.localeCompare(b.shortName);
    });
}

export async function synthesizeBookTts(input: {
  sourceId: string;
  bookId: string;
  chapterHref: string;
  text: string;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
}): Promise<TtsSynthesizeResult & { cacheKey: string; cacheHit: boolean }> {
  const config = await getBookTtsConfig();
  const normalizedText = input.text.trim();
  if (!normalizedText) throw new Error('缺少朗读文本');
  if (normalizedText.length > config.maxTextLengthPerRequest) {
    throw new Error(`单次朗读文本过长，最多 ${config.maxTextLengthPerRequest} 个字符`);
  }

  const cacheKey = buildCacheKey({
    ...input,
    text: normalizedText,
  });

  const mod = resolveEdgeTtsModule();
  const EdgeTTS = mod.EdgeTTS || mod.default?.EdgeTTS;
  if (!EdgeTTS) throw new Error('edge-tts-universal 未导出 EdgeTTS');

  const tts = new EdgeTTS(
    normalizedText,
    input.voice || config.defaultVoice,
    {
      rate: input.rate || config.defaultRate,
      pitch: input.pitch || config.defaultPitch,
      volume: input.volume || config.defaultVolume,
    }
  );
  const result = await tts.synthesize();

  const payload: TtsSynthesizeResult = {
    audioBuffer: await toBuffer(result?.audio),
    mimeType: result?.mimeType || 'audio/mpeg',
    boundaries: Array.isArray(result?.subtitle)
      ? result.subtitle.map(normalizeBoundary)
      : Array.isArray(result?.subtitle?.words)
        ? result.subtitle?.words?.map(normalizeBoundary) || []
      : Array.isArray(result?.subtitles)
        ? result.subtitles.map(normalizeBoundary)
        : [],
  };

  return { ...payload, cacheKey, cacheHit: false };
}
