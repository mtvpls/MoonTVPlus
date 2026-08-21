/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 磁力/种子 Tracker scrape 测活
 * - 单条探测；全站并发上限由 slot / MAGNET_HEALTH_MAX_CONCURRENT 控制
 * - udp:// 先真 UDP scrape，失败再降级同 host 的 HTTP scrape
 * - http(s):// 直接 HTTP scrape
 * - 多 tracker 取 max(seeders)/max(leechers)
 */

import { createHash, randomBytes } from 'crypto';
import dgram from 'dgram';
import { safeFetch } from './safe-http';

export type MagnetHealthLevel = 'good' | 'ok' | 'risk' | 'unknown';

export interface MagnetHealthTrackerResult {
  tracker: string;
  ok: boolean;
  ms: number;
  /** 实际成功或最后尝试的协议 */
  proto?: 'udp' | 'http';
  seeders?: number;
  leechers?: number;
  downloaded?: number;
  error?: string;
}

export interface MagnetHealthResult {
  infoHash: string;
  health: MagnetHealthLevel;
  seeders: number;
  leechers: number;
  peers: number;
  downloaded: number;
  checkedAt: number;
  durationMs: number;
  source: 'scrape' | 'cache';
  trackersTried: number;
  trackersOk: number;
  trackers: MagnetHealthTrackerResult[];
  message: string;
}

const GLOBAL_KEY = Symbol.for('__MOONTV_MAGNET_HEALTH__');

interface HealthGlobalState {
  active: number;
  cache: Map<string, { expires: number; result: MagnetHealthResult }>;
}

/** 全站同时测活上限：MAGNET_HEALTH_MAX_CONCURRENT，默认 10，范围 1–100 */
export function resolveMagnetHealthMaxConcurrent(): number {
  const raw = process.env.MAGNET_HEALTH_MAX_CONCURRENT;
  const n = raw === undefined || raw === '' ? 10 : Number(raw);
  if (!Number.isFinite(n)) return 10;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function getState(): HealthGlobalState {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      active: 0,
      cache: new Map(),
    } satisfies HealthGlobalState;
  }
  return g[GLOBAL_KEY] as HealthGlobalState;
}

/** 全站同时测活占用情况 */
export function getMagnetHealthConcurrency() {
  const s = getState();
  return { active: s.active, max: resolveMagnetHealthMaxConcurrent() };
}

export class MagnetHealthBusyError extends Error {
  code = 'MAGNET_HEALTH_BUSY' as const;
  active: number;
  max: number;
  constructor(active: number, max: number) {
    super(`测活繁忙：当前 ${active}/${max}，请稍后再试`);
    this.name = 'MagnetHealthBusyError';
    this.active = active;
    this.max = max;
  }
}

function tryAcquireSlot(): boolean {
  const s = getState();
  const max = resolveMagnetHealthMaxConcurrent();
  if (s.active >= max) return false;
  s.active += 1;
  return true;
}

function releaseSlot(): void {
  const s = getState();
  s.active = Math.max(0, s.active - 1);
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const PER_TRACKER_TIMEOUT_MS = 2500;
const TOTAL_TIMEOUT_MS = 4500;

/** 公开 HTTP scrape 兜底（magnet 自带 tr 常失效） */
export const DEFAULT_HTTP_TRACKERS = [
  'http://tracker.opentrackr.org:1337/announce',
  'http://opentracker.acgnx.se/announce',
  'http://tracker.bt4g.com:2095/announce',
  'http://nyaa.tracker.wf:7777/announce',
  'http://t.nyaatracker.com/announce',
  'http://open.acgtracker.com:1096/announce',
  'http://tracker.kamigami.org:2710/announce',
  'http://anidex.moe:6969/announce',
  'https://tr.bangumi.moe:9696/announce',
  'http://share.camoe.cn:8080/announce',
  'http://t.acg.rip:6699/announce',
];

// ---------- bencode ----------

function bdecode(data: Buffer, idx = 0): [any, number] {
  const mark = data[idx];
  if (mark === 105) {
    // i...e
    const end = data.indexOf(101, idx + 1); // 'e'
    if (end < 0) throw new Error('invalid bencode int');
    return [parseInt(data.subarray(idx + 1, end).toString('ascii'), 10), end + 1];
  }
  if (mark === 108) {
    // l...e
    let i = idx + 1;
    const list: any[] = [];
    while (data[i] !== 101) {
      const [v, next] = bdecode(data, i);
      list.push(v);
      i = next;
    }
    return [list, i + 1];
  }
  if (mark === 100) {
    // d...e
    let i = idx + 1;
    const dict: Record<string, any> = Object.create(null);
    while (data[i] !== 101) {
      const [k, kNext] = bdecode(data, i);
      const [v, vNext] = bdecode(data, kNext);
      // 二进制 key（如 scrape 的 infoHash）用 latin1 保真，避免 utf8 破坏字节
      let key: string;
      if (typeof k === 'string') key = k;
      else if (Buffer.isBuffer(k)) key = k.toString('latin1');
      else key = String(k);
      dict[key] = v;
      i = vNext;
    }
    return [dict, i + 1];
  }
  // string: <len>:<bytes>
  const colon = data.indexOf(58, idx); // ':'
  if (colon < 0) throw new Error('invalid bencode string');
  const len = parseInt(data.subarray(idx, colon).toString('ascii'), 10);
  const start = colon + 1;
  const end = start + len;
  const slice = data.subarray(start, end);
  // 20 字节大概率是 infoHash，保持二进制语义（经 dict 时转 latin1）
  if (slice.length === 20) {
    return [slice, end];
  }
  // 可打印 utf8 用 string，否则 Buffer
  const asStr = slice.toString('utf8');
  if (
    Buffer.byteLength(asStr, 'utf8') === slice.length &&
    !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(asStr)
  ) {
    return [asStr, end];
  }
  return [slice, end];
}

/** 解码并保留 info 字典原始字节，用于 infohash */
function bdecodeTorrent(data: Buffer): { root: any; infoRaw: Buffer | null } {
  if (data[0] !== 100) throw new Error('torrent 根节点不是 dict');
  let i = 1;
  const root: Record<string, any> = Object.create(null);
  let infoRaw: Buffer | null = null;
  while (data[i] !== 101) {
    const [k, kNext] = bdecode(data, i);
    const key = typeof k === 'string' ? k : Buffer.isBuffer(k) ? k.toString('latin1') : String(k);
    if (key === 'info') {
      const valueStart = kNext;
      const [, valueEnd] = bdecode(data, valueStart);
      infoRaw = data.subarray(valueStart, valueEnd);
      const [v] = bdecode(data, valueStart);
      root[key] = v;
      i = valueEnd;
    } else {
      const [v, vNext] = bdecode(data, kNext);
      root[key] = v;
      i = vNext;
    }
  }
  return { root, infoRaw };
}

function bufferishToString(v: any): string {
  if (typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v ?? '');
}

// ---------- magnet / torrent parse ----------

export function parseMagnetUri(magnet: string): { infoHash: string; trackers: string[] } {
  const raw = magnet.trim();
  if (!raw.toLowerCase().startsWith('magnet:')) {
    throw new Error('不是有效的 magnet 链接');
  }
  const query = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1) : raw.slice('magnet:'.length);
  const parts = query.split('&');
  let infoHash = '';
  const trackers: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = eq >= 0 ? part.slice(0, eq) : part;
    const v = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : '';
    const key = k.toLowerCase();
    if (key === 'xt' || key.startsWith('xt.')) {
      const m = v.match(/urn:btih:([a-zA-Z0-9]+)/i);
      if (m) infoHash = normalizeInfoHash(m[1]);
    } else if (key === 'tr') {
      if (v) trackers.push(v);
    }
  }
  if (!infoHash) throw new Error('magnet 中缺少 infoHash');
  return { infoHash, trackers };
}

function normalizeInfoHash(input: string): string {
  const s = input.trim();
  if (/^[a-fA-F0-9]{40}$/.test(s)) return s.toLowerCase();
  if (/^[a-zA-Z2-7]{32}$/.test(s)) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of s.toUpperCase()) {
      const val = alphabet.indexOf(c);
      if (val < 0) throw new Error('无效的 base32 infoHash');
      bits += val.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length && bytes.length < 20; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    if (bytes.length !== 20) throw new Error('无效的 base32 infoHash');
    return Buffer.from(bytes).toString('hex');
  }
  throw new Error('无效的 infoHash');
}

function extractTrackersFromTorrentRoot(root: any): string[] {
  const out: string[] = [];
  const announce = root?.announce;
  if (announce) out.push(bufferishToString(announce));
  const list = root?.['announce-list'];
  if (Array.isArray(list)) {
    for (const tier of list) {
      if (Array.isArray(tier)) {
        for (const t of tier) out.push(bufferishToString(t));
      } else if (tier) {
        out.push(bufferishToString(tier));
      }
    }
  }
  return out.filter(Boolean);
}

async function fetchBinary(
  url: string,
  proxy?: string,
  timeoutMs = 15000
): Promise<Buffer> {
  const isCf = process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
  if (isCf) {
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  const init: any = {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(timeoutMs),
  };
  const resp = (await safeFetch(url, init, proxy)) as any;
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

export async function resolveTorrentIdentity(
  url: string,
  proxy?: string
): Promise<{ infoHash: string; trackers: string[] }> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('链接不能为空');

  if (/^[a-fA-F0-9]{40}$/.test(trimmed) || /^[a-zA-Z2-7]{32}$/.test(trimmed)) {
    return { infoHash: normalizeInfoHash(trimmed), trackers: [] };
  }

  if (trimmed.toLowerCase().startsWith('magnet:')) {
    return parseMagnetUri(trimmed);
  }

  // .torrent or other http(s) url
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('仅支持 magnet、infoHash 或 http(s) 种子链接');
  }

  const bin = await fetchBinary(trimmed, proxy, 15000);
  // some servers return HTML error pages
  if (bin.length < 16 || bin[0] !== 100) {
    const head = bin.subarray(0, 80).toString('utf8');
    if (/magnet:\?/i.test(head)) {
      const m = head.match(/magnet:\?[^\s"'<>]+/i);
      if (m) return parseMagnetUri(m[0]);
    }
    throw new Error('下载内容不是有效的 .torrent 文件');
  }

  const { root, infoRaw } = bdecodeTorrent(bin);
  if (!infoRaw || infoRaw.length === 0) throw new Error('torrent 缺少 info 字段');
  const infoHash = createHash('sha1').update(infoRaw).digest('hex');
  const trackers = extractTrackersFromTorrentRoot(root);
  return { infoHash, trackers };
}

// ---------- scrape ----------

const UDP_PROTOCOL_ID = BigInt('0x41727101980'); // magic for connect

function announceToHttpScrape(announceUrl: string): string | null {
  try {
    let u = announceUrl.trim();
    if (!u) return null;
    // 仅用于降级：把 udp 换成 http 再构 scrape
    if (/^udp:\/\//i.test(u)) {
      u = u.replace(/^udp:\/\//i, 'http://');
    }
    if (!/^https?:\/\//i.test(u)) return null;
    if (/\/announce(\?.*)?$/i.test(u)) {
      return u.replace(/\/announce(\?.*)?$/i, '/scrape$1');
    }
    if (u.includes('announce')) {
      return u.replace(/announce/gi, 'scrape');
    }
    const parsed = new URL(u);
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '/scrape';
    } else {
      parsed.pathname = parsed.pathname.replace(/\/?$/, '/scrape');
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseUdpTracker(announceUrl: string): { host: string; port: number } | null {
  try {
    const u = new URL(announceUrl.replace(/^udp:\/\//i, 'http://'));
    if (!u.hostname) return null;
    const port = u.port ? parseInt(u.port, 10) : 80;
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host: u.hostname, port };
  } catch {
    return null;
  }
}

function isProbablyDeadHost(hostname: string, ipHint?: string): boolean {
  if (ipHint && /^(10\.|127\.|0\.|221\.229\.|100\.64\.)/.test(ipHint)) return true;
  void hostname;
  return false;
}

function uniqTrackers(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = (raw || '').trim();
    if (!t) continue;
    // 保留协议差异：同一 host 的 udp 与 http 都保留，各自探测
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * BEP-15 UDP tracker scrape
 * connect → scrape(info_hash) → complete / downloaded / incomplete
 */
async function scrapeOneUdp(
  announceUrl: string,
  infoHashHex: string,
  timeoutMs = PER_TRACKER_TIMEOUT_MS
): Promise<MagnetHealthTrackerResult> {
  const t0 = Date.now();
  const parsed = parseUdpTracker(announceUrl);
  if (!parsed) {
    return {
      tracker: announceUrl,
      ok: false,
      ms: 0,
      proto: 'udp',
      error: '无效的 UDP tracker 地址',
    };
  }

  const infoHashRaw = Buffer.from(infoHashHex, 'hex');
  if (infoHashRaw.length !== 20) {
    return {
      tracker: announceUrl,
      ok: false,
      ms: 0,
      proto: 'udp',
      error: 'infoHash 长度错误',
    };
  }

  const { host, port } = parsed;

  return new Promise((resolve) => {
    let settled = false;
    const socket = dgram.createSocket('udp4');
    let step: 'connect' | 'scrape' = 'connect';
    const txnConnect = randomBytes(4).readUInt32BE(0);
    let txnScrape = 0;
    let connId = BigInt(0);

    const finish = (result: MagnetHealthTrackerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        tracker: announceUrl,
        ok: false,
        ms: Date.now() - t0,
        proto: 'udp',
        error: `UDP 超时(${step})`,
      });
    }, timeoutMs);

    socket.on('error', (err) => {
      finish({
        tracker: announceUrl,
        ok: false,
        ms: Date.now() - t0,
        proto: 'udp',
        error: err?.message || 'UDP socket error',
      });
    });

    socket.on('message', (msg) => {
      try {
        if (msg.length < 8) return;
        const action = msg.readUInt32BE(0);
        const txn = msg.readUInt32BE(4);

        if (step === 'connect') {
          if (action !== 0 || txn !== txnConnect || msg.length < 16) {
            // action 3 = error
            if (action === 3) {
              const errMsg = msg.subarray(8).toString('utf8');
              finish({
                tracker: announceUrl,
                ok: false,
                ms: Date.now() - t0,
                proto: 'udp',
                error: `UDP connect 错误: ${errMsg || 'unknown'}`,
              });
            }
            return;
          }
          connId = msg.readBigUInt64BE(8);
          step = 'scrape';
          txnScrape = randomBytes(4).readUInt32BE(0);
          const pkt = Buffer.alloc(16 + 20);
          pkt.writeBigUInt64BE(connId, 0);
          pkt.writeUInt32BE(2, 8); // scrape
          pkt.writeUInt32BE(txnScrape, 12);
          infoHashRaw.copy(pkt, 16);
          socket.send(pkt, port, host);
          return;
        }

        if (step === 'scrape') {
          if (action === 3) {
            const errMsg = msg.subarray(8).toString('utf8');
            finish({
              tracker: announceUrl,
              ok: false,
              ms: Date.now() - t0,
              proto: 'udp',
              error: `UDP scrape 错误: ${errMsg || 'unknown'}`,
            });
            return;
          }
          if (action !== 2 || txn !== txnScrape || msg.length < 20) {
            return;
          }
          const seeders = msg.readUInt32BE(8);
          const downloaded = msg.readUInt32BE(12);
          const leechers = msg.readUInt32BE(16);
          finish({
            tracker: announceUrl,
            ok: true,
            ms: Date.now() - t0,
            proto: 'udp',
            seeders,
            leechers,
            downloaded,
          });
        }
      } catch (e: any) {
        finish({
          tracker: announceUrl,
          ok: false,
          ms: Date.now() - t0,
          proto: 'udp',
          error: e?.message || 'UDP 解析失败',
        });
      }
    });

    try {
      // connect request: protocol_id(8) + action(4)=0 + transaction_id(4)
      const pkt = Buffer.alloc(16);
      pkt.writeBigUInt64BE(UDP_PROTOCOL_ID, 0);
      pkt.writeUInt32BE(0, 8);
      pkt.writeUInt32BE(txnConnect, 12);
      socket.send(pkt, port, host, (err) => {
        if (err) {
          finish({
            tracker: announceUrl,
            ok: false,
            ms: Date.now() - t0,
            proto: 'udp',
            error: err.message || 'UDP 发送失败',
          });
        }
      });
    } catch (e: any) {
      finish({
        tracker: announceUrl,
        ok: false,
        ms: Date.now() - t0,
        proto: 'udp',
        error: e?.message || 'UDP 初始化失败',
      });
    }
  });
}

async function scrapeOneHttp(
  announceUrl: string,
  infoHashHex: string,
  proxy?: string,
  timeoutMs = PER_TRACKER_TIMEOUT_MS
): Promise<MagnetHealthTrackerResult> {
  const t0 = Date.now();
  const scrapeBase = announceToHttpScrape(announceUrl);
  if (!scrapeBase) {
    return {
      tracker: announceUrl,
      ok: false,
      ms: 0,
      proto: 'http',
      error: '无法构造 scrape URL',
    };
  }

  try {
    const host = new URL(scrapeBase).hostname;
    if (isProbablyDeadHost(host)) {
      return {
        tracker: announceUrl,
        ok: false,
        ms: 0,
        proto: 'http',
        error: '跳过不可达 host',
      };
    }
  } catch {
    // ignore
  }

  const infoHashRaw = Buffer.from(infoHashHex, 'hex');
  if (infoHashRaw.length !== 20) {
    return {
      tracker: announceUrl,
      ok: false,
      ms: 0,
      proto: 'http',
      error: 'infoHash 长度错误',
    };
  }
  const q = Array.from(infoHashRaw)
    .map((b) => `%${b.toString(16).padStart(2, '0')}`)
    .join('');
  const url = scrapeBase.includes('?')
    ? `${scrapeBase}&info_hash=${q}`
    : `${scrapeBase}?info_hash=${q}`;

  try {
    const bin = await fetchBinary(url, proxy, timeoutMs);
    const ms = Date.now() - t0;
    let decoded: any;
    try {
      [decoded] = bdecode(bin);
    } catch {
      return {
        tracker: announceUrl,
        ok: false,
        ms,
        proto: 'http',
        error: 'scrape 响应不是 bencode',
      };
    }

    if (!decoded || typeof decoded !== 'object' || !decoded.files) {
      return {
        tracker: announceUrl,
        ok: false,
        ms,
        proto: 'http',
        error: '不支持 scrape 或无 files 字段',
      };
    }

    const files = decoded.files as Record<string, any>;
    let stats: any = null;
    const hashLatin1 = infoHashRaw.toString('latin1');
    const hashHex = infoHashHex.toLowerCase();

    for (const [k, v] of Object.entries(files)) {
      if (k === hashLatin1 || k.toLowerCase() === hashHex) {
        stats = v;
        break;
      }
      const asLatin1 = Buffer.from(k, 'latin1');
      if (asLatin1.length === 20 && asLatin1.equals(infoHashRaw)) {
        stats = v;
        break;
      }
    }

    if (!stats && Object.keys(files).length === 1) {
      stats = Object.values(files)[0];
    }

    if (!stats || typeof stats !== 'object') {
      return {
        tracker: announceUrl,
        ok: false,
        ms,
        proto: 'http',
        error: 'scrape 未包含该 infoHash',
      };
    }

    const seeders = Number(stats.complete ?? stats.seeders ?? 0) || 0;
    const leechers = Number(stats.incomplete ?? stats.leechers ?? 0) || 0;
    const downloaded = Number(stats.downloaded ?? 0) || 0;

    return {
      tracker: announceUrl,
      ok: true,
      ms,
      proto: 'http',
      seeders,
      leechers,
      downloaded,
    };
  } catch (e: any) {
    return {
      tracker: announceUrl,
      ok: false,
      ms: Date.now() - t0,
      proto: 'http',
      error: e?.message || String(e),
    };
  }
}

/**
 * 单 tracker 测活：
 * - udp:// → 先 UDP，失败再降级 HTTP
 * - http(s):// → 仅 HTTP
 */
async function scrapeOneTracker(
  announceUrl: string,
  infoHashHex: string,
  proxy?: string,
  timeoutMs = PER_TRACKER_TIMEOUT_MS
): Promise<MagnetHealthTrackerResult> {
  const isUdp = /^udp:\/\//i.test(announceUrl.trim());

  if (isUdp) {
    // UDP 分一半预算，失败后再用剩余时间打 HTTP，避免总超时翻倍
    const udpBudget = Math.max(800, Math.floor(timeoutMs * 0.55));
    const udpResult = await scrapeOneUdp(announceUrl, infoHashHex, udpBudget);
    if (udpResult.ok) return udpResult;

    const used = udpResult.ms || 0;
    const httpBudget = Math.max(800, timeoutMs - used);
    const httpResult = await scrapeOneHttp(announceUrl, infoHashHex, proxy, httpBudget);
    if (httpResult.ok) {
      return {
        ...httpResult,
        ms: used + httpResult.ms,
        // 标注：UDP 失败后 HTTP 降级成功
        error: undefined,
      };
    }

    return {
      tracker: announceUrl,
      ok: false,
      ms: used + (httpResult.ms || 0),
      proto: 'http',
      error: `UDP失败(${udpResult.error || 'unknown'})；HTTP降级失败(${httpResult.error || 'unknown'})`,
    };
  }

  return scrapeOneHttp(announceUrl, infoHashHex, proxy, timeoutMs);
}

function classifyHealth(seeders: number, peers: number, anyOk: boolean): MagnetHealthLevel {
  if (!anyOk) return 'unknown';
  if (seeders >= 5 && peers > 50) return 'good';
  if (seeders >= 1 || peers >= 5) return 'ok';
  if (seeders === 0 && peers === 0) return 'risk';
  // 有 leecher 但无 seeder
  if (seeders === 0) return 'risk';
  return 'ok';
}

function healthMessage(level: MagnetHealthLevel, seeders: number, leechers: number, peers: number): string {
  switch (level) {
    case 'good':
      return `健康：Seeder ${seeders} / Peer ${peers}`;
    case 'ok':
      return `一般：Seeder ${seeders} / Leecher ${leechers}`;
    case 'risk':
      return seeders === 0
        ? `风险：Seeder 0（Peer ${peers}）`
        : `风险：Seeder ${seeders} / Peer ${peers}`;
    default:
      return '未知：Tracker 均未返回有效数据';
  }
}

function getCached(infoHash: string): MagnetHealthResult | null {
  const s = getState();
  const hit = s.cache.get(infoHash);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    s.cache.delete(infoHash);
    return null;
  }
  return { ...hit.result, source: 'cache', checkedAt: hit.result.checkedAt };
}

function setCache(result: MagnetHealthResult): void {
  const s = getState();
  s.cache.set(result.infoHash, {
    expires: Date.now() + CACHE_TTL_MS,
    result: { ...result, source: 'scrape' },
  });
  // 简单限制缓存规模
  if (s.cache.size > 500) {
    const first = s.cache.keys().next().value;
    if (first) s.cache.delete(first);
  }
}

/**
 * 对单条 magnet / torrent URL / infoHash 做 tracker scrape 测活
 */
export async function probeMagnetHealth(options: {
  url: string;
  extraTrackers?: string[];
  proxy?: string;
  skipCache?: boolean;
}): Promise<MagnetHealthResult> {
  const tAll = Date.now();
  const { infoHash, trackers: parsedTrackers } = await resolveTorrentIdentity(
    options.url,
    options.proxy
  );

  if (!options.skipCache) {
    const cached = getCached(infoHash);
    if (cached) {
      return { ...cached, durationMs: Date.now() - tAll };
    }
  }

  if (!tryAcquireSlot()) {
    const { active, max } = getMagnetHealthConcurrency();
    throw new MagnetHealthBusyError(active, max);
  }

  try {
    // 二次检查缓存（占槽前后可能已有结果）
    if (!options.skipCache) {
      const cached = getCached(infoHash);
      if (cached) {
        return { ...cached, durationMs: Date.now() - tAll };
      }
    }

    const trackers = uniqTrackers([
      ...parsedTrackers,
      ...(options.extraTrackers || []),
      ...DEFAULT_HTTP_TRACKERS,
    ]).slice(0, 16);

    const results: MagnetHealthTrackerResult[] = [];
    let timedOut = false;

    await new Promise<void>((resolve) => {
      const deadline = Date.now() + TOTAL_TIMEOUT_MS;
      let pending = trackers.length;
      if (pending === 0) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, TOTAL_TIMEOUT_MS);

      for (const tr of trackers) {
        const remain = Math.max(500, deadline - Date.now());
        scrapeOneTracker(tr, infoHash, options.proxy, Math.min(PER_TRACKER_TIMEOUT_MS, remain))
          .then((r) => {
            if (!timedOut) results.push(r);
          })
          .catch((e) => {
            if (!timedOut) {
              results.push({
                tracker: tr,
                ok: false,
                ms: 0,
                error: e?.message || String(e),
              });
            }
          })
          .finally(() => {
            pending -= 1;
            if (pending <= 0) {
              clearTimeout(timer);
              resolve();
            }
          });
      }
    });

    const okList = results.filter((r) => r.ok);
    const seeders = okList.reduce((m, r) => Math.max(m, r.seeders ?? 0), 0);
    const leechers = okList.reduce((m, r) => Math.max(m, r.leechers ?? 0), 0);
    const downloaded = okList.reduce((m, r) => Math.max(m, r.downloaded ?? 0), 0);
    const peers = seeders + leechers;
    const health = classifyHealth(seeders, peers, okList.length > 0);

    const result: MagnetHealthResult = {
      infoHash,
      health,
      seeders,
      leechers,
      peers,
      downloaded,
      checkedAt: Date.now(),
      durationMs: Date.now() - tAll,
      source: 'scrape',
      trackersTried: trackers.length,
      trackersOk: okList.length,
      trackers: results.sort((a, b) => Number(b.ok) - Number(a.ok) || (b.seeders ?? 0) - (a.seeders ?? 0)),
      message: healthMessage(health, seeders, leechers, peers),
    };

    if (okList.length > 0) {
      setCache(result);
    }

    return result;
  } finally {
    releaseSlot();
  }
}
