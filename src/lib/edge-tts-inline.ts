/**
 * 内联 Edge TTS 客户端 — 不依赖 edge-tts-universal npm 包
 * 使用 Node.js 22+ 内置 WebSocket API + fetch
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

// ── EdgeTTS synthesizer ────────────────────────────────────────

function uuid(): string {
  // Simple UUID v4 using crypto.getRandomValues (available in Node.js 19+)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
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

  synthesize(): Promise<{
    audio: Buffer;
    mimeType: string;
    subtitle: RawBoundary[];
  }> {
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
        // 1. Send config
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

        // 2. Send SSML
        const requestId = uuid().replace(/-/g, '');
        const timestamp = new Date().toISOString();
        const prosodyAttrs = [
          `rate="${this.rate}"`,
          `pitch="${this.pitch}"`,
          `volume="${this.volume}"`,
        ].join(' ');
        const ssml =
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
          `<voice name='${escapeXml(this.voice)}'>` +
          `<prosody ${prosodyAttrs}>${escapeXml(this.text)}</prosody>` +
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
          // Text frame — parse headers
          if (data.includes('Path:turn.end')) {
            ws.close();
            finish();
          } else if (data.includes('Path:audio.metadata')) {
            // Parse word boundary metadata
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
            } catch {
              // ignore metadata parse errors
            }
          }
        } else if (data instanceof ArrayBuffer) {
          // Binary frame — skip 2-byte header
          const buf = Buffer.from(data);
          if (buf.length > 2) {
            audioChunks.push(buf.subarray(2));
          }
        }
      });

      ws.addEventListener('error', (event) => {
        finish(new Error(`Edge TTS WebSocket 错误: ${event.message ?? 'unknown'}`));
      });

      ws.addEventListener('close', () => {
        finish();
      });
    });
  }
}

// ── Export in the same shape as edge-tts-universal ─────────────

export const EdgeTTS = InlineEdgeTTS;
export const VoicesManager = InlineVoicesManager;
export default { EdgeTTS: InlineEdgeTTS, VoicesManager: InlineVoicesManager };
