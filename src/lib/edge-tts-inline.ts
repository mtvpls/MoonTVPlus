/**
 * 内联 Edge TTS 客户端 — 不依赖 edge-tts-universal npm 包
 * 优先使用 WebSocket（Docker 环境），WebSocket 不可用时 fallback 到 HTTP TTS
 * 兼容 Docker / Vercel / EdgeOne Cloud Function 等所有 Node.js 运行时
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

// ── Voice listing ──────────────────────────────────────────────

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

let cachedVoices: RawVoice[] | null = null;

async function fetchVoices(): Promise<RawVoice[]> {
  if (cachedVoices) return cachedVoices;
  const res = await fetch(VOICES_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`获取语音列表失败: ${res.status}`);
  cachedVoices = (await res.json()) as RawVoice[];
  return cachedVoices;
}

// ── VoicesManager shim ─────────────────────────────────────────

class InlineVoicesManager {
  voices: RawVoice[] = [];

  static async create(): Promise<InlineVoicesManager> {
    const mgr = new InlineVoicesManager();
    mgr.voices = await fetchVoices();
    return mgr;
  }

  async getVoices(): Promise<RawVoice[]> {
    return this.voices;
  }
}

// ── UUID helper ────────────────────────────────────────────────

function uuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── WebSocket-based synthesis ──────────────────────────────────

function synthesizeViaWebSocket(
  text: string,
  voice: string,
  rate: string,
  pitch: string,
  volume: string
): Promise<{ audio: Buffer; mimeType: string; subtitle: RawBoundary[] }> {
  return new Promise((resolve, reject) => {
    const connId = uuid().replace(/-/g, '');
    const url = `${WSS_URL}&ConnectionId=${connId}`;
    const audioChunks: Buffer[] = [];
    const boundaries: RawBoundary[] = [];
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws.close(); } catch {}
        reject(new Error('Edge TTS WebSocket 超时'));
      }
    }, 30_000);

    const finish = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (err) return reject(err);
      const audio = Buffer.concat(audioChunks);
      resolve({ audio, mimeType: 'audio/mpeg', subtitle: boundaries });
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      clearTimeout(timeout);
      return reject(e);
    }

    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      const configMsg =
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: 'false',
                  wordBoundaryEnabled: 'true',
                },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        });
      ws.send(configMsg);

      const requestId = uuid().replace(/-/g, '');
      const timestamp = new Date().toISOString();
      const prosodyAttrs = `rate="${rate}" pitch="${pitch}" volume="${volume}"`;
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
        `<voice name='${escapeXml(voice)}'>` +
        `<prosody ${prosodyAttrs}>${escapeXml(text)}</prosody>` +
        `</voice></speak>`;
      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${timestamp}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      ws.send(ssmlMsg);
    });

    ws.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) {
          ws.close();
          finish();
        } else if (data.includes('Path:audio.metadata')) {
          try {
            const jsonStart = data.indexOf('\r\n\r\n');
            if (jsonStart !== -1) {
              const meta = JSON.parse(data.slice(jsonStart + 4));
              for (const item of meta.Metadata ?? []) {
                if (item.Type === 'WordBoundary' && item.Data) {
                  boundaries.push({
                    offset: item.Data.Offset ?? 0,
                    duration: item.Data.Duration ?? 0,
                    text: item.Data.text?.Text ?? '',
                  });
                }
              }
            }
          } catch { /* ignore */ }
        }
      } else if (data instanceof ArrayBuffer) {
        const buf = Buffer.from(data);
        if (buf.length > 2) {
          audioChunks.push(buf.subarray(2));
        }
      }
    });

    ws.addEventListener('error', () => {
      finish(new Error('Edge TTS WebSocket 错误'));
    });

    ws.addEventListener('close', () => {
      finish();
    });
  });
}

// ── HTTP-based synthesis (EdgeOne fallback) ────────────────────
// 当 WebSocket 不可用时（如 EdgeOne Cloud Function），使用 Google Translate TTS
// 每次请求最多 200 字符，自动分段拼接

const MAX_HTTP_TTS_CHARS = 200;

async function synthesizeViaHttp(
  text: string,
  voice: string,
  _rate: string,
  _pitch: string,
  _volume: string
): Promise<{ audio: Buffer; mimeType: string; subtitle: RawBoundary[] }> {
  // 从 voice name 提取 locale（如 zh-CN-XiaoxiaoNeural → zh-CN）
  const locale = voice.split('-').slice(0, 2).join('-') || 'zh-CN';

  // 分段合成（Google TTS 每次最多 ~200 字符）
  const chunks = splitText(text, MAX_HTTP_TTS_CHARS);
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const audio = await googleTtsChunk(chunk, locale);
    audioBuffers.push(Buffer.from(audio));
  }

  return {
    audio: Buffer.concat(audioBuffers),
    mimeType: 'audio/mpeg',
    subtitle: [], // HTTP 模式不支持 word boundary
  };
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // 在标点符号处断句
    let splitAt = -1;
    for (let i = maxLen; i >= maxLen * 0.5; i--) {
      if ('。！？；\n.!?;'.includes(remaining[i])) {
        splitAt = i + 1;
        break;
      }
    }
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

// HTTP 代理地址（用于访问 Google Translate TTS）
const HTTP_PROXY = process.env.TTS_HTTP_PROXY || 'http://hc.wwszxc.tax:20543';

let proxyAgent: unknown = null;
function getProxyAgent() {
  if (proxyAgent) return proxyAgent;
  try {
    // Node.js 18+ 内置 undici，支持 ProxyAgent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProxyAgent } = eval('require')('undici');
    proxyAgent = new ProxyAgent({
      uri: HTTP_PROXY,
      requestTls: { rejectUnauthorized: false },
    });
  } catch {
    // undici ProxyAgent 不可用，不使用代理
    proxyAgent = null;
  }
  return proxyAgent;
}

async function googleTtsChunk(
  text: string,
  locale: string
): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    'ie': 'UTF-8',
    'q': text,
    'tl': locale,
    'client': 'tw-ob',
  });

  const url = `https://translate.google.com/translate_tts?${params.toString()}`;

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  let res: Response | null = null;

  // 优先使用代理访问 Google TTS
  const agent = getProxyAgent();
  if (agent) {
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': ua },
        ...({ dispatcher: agent } as unknown as RequestInit),
      } as RequestInit);
    } catch (proxyErr) {
      console.warn('[edge-tts-inline] 代理访问失败，尝试直连:', (proxyErr as Error).message);
      res = null;
    }
  }

  // 代理失败或无代理时，直连
  if (!res) {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': ua },
    });
  }

  if (!res.ok) {
    throw new Error(`Google TTS 请求失败: ${res.status}`);
  }

  return await res.arrayBuffer();
}

// ── EdgeTTS synthesizer (auto-detect transport) ────────────────

class InlineEdgeTTS {
  private text: string;
  private voice: string;
  private rate: string;
  private pitch: string;
  private volume: string;

  constructor(
    text: string,
    voice: string,
    options?: { rate?: string; pitch?: string; volume?: string }
  ) {
    this.text = text;
    this.voice = voice;
    this.rate = options?.rate ?? '+0%';
    this.pitch = options?.pitch ?? '+0Hz';
    this.volume = options?.volume ?? '+0%';
  }

  async synthesize(): Promise<{
    audio: Buffer;
    mimeType: string;
    subtitle: RawBoundary[];
  }> {
    // 先尝试 WebSocket（Docker 环境支持）
    try {
      return await synthesizeViaWebSocket(
        this.text,
        this.voice,
        this.rate,
        this.pitch,
        this.volume
      );
    } catch {
      // WebSocket 不可用时 fallback 到 HTTP（EdgeOne 等 serverless 环境）
      return await synthesizeViaHttp(
        this.text,
        this.voice,
        this.rate,
        this.pitch,
        this.volume
      );
    }
  }
}

// ── Export in the same shape as edge-tts-universal ─────────────

export const EdgeTTS = InlineEdgeTTS;
export const VoicesManager = InlineVoicesManager;
export default { EdgeTTS: InlineEdgeTTS, VoicesManager: InlineVoicesManager };
