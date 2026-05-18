/* eslint-disable @typescript-eslint/no-explicit-any */

const SHARE_URL = 'https://webapi.115.com/share/snap';
const PLAY_URL = 'http://pro.api.115.com/app/share/downurl';

export interface Pan115ShareVideoFile {
  name: string;
  fileId: string;
  shareCode: string;
  receiveCode: string;
  size: number;
}

export interface Pan115ShareListResult {
  title: string;
  files: Pan115ShareVideoFile[];
}

const VIDEO_EXTENSIONS = [
  '.mp4', '.webm', '.avi', '.wmv', '.flv', '.mov', '.mkv', '.mpeg', '.3gp', '.ts', '.m2ts', '.mp3', '.wav', '.aac', '.iso',
];

const G_KTS = new Uint8Array([
  0xf0, 0xe5, 0x69, 0xae, 0xbf, 0xdc, 0xbf, 0x8a, 0x1a, 0x45, 0xe8, 0xbe, 0x7d, 0xa6, 0x73, 0xb8,
  0xde, 0x8f, 0xe7, 0xc4, 0x45, 0xda, 0x86, 0xc4, 0x9b, 0x64, 0x8b, 0x14, 0x6a, 0xb4, 0xf1, 0xaa,
  0x38, 0x01, 0x35, 0x9e, 0x26, 0x69, 0x2c, 0x86, 0x00, 0x6b, 0x4f, 0xa5, 0x36, 0x34, 0x62, 0xa6,
  0x2a, 0x96, 0x68, 0x18, 0xf2, 0x4a, 0xfd, 0xbd, 0x6b, 0x97, 0x8f, 0x4d, 0x8f, 0x89, 0x13, 0xb7,
  0x6c, 0x8e, 0x93, 0xed, 0x0e, 0x0d, 0x48, 0x3e, 0xd7, 0x2f, 0x88, 0xd8, 0xfe, 0xfe, 0x7e, 0x86,
  0x50, 0x95, 0x4f, 0xd1, 0xeb, 0x83, 0x26, 0x34, 0xdb, 0x66, 0x7b, 0x9c, 0x7e, 0x9d, 0x7a, 0x81,
  0x32, 0xea, 0xb6, 0x33, 0xde, 0x3a, 0xa9, 0x59, 0x34, 0x66, 0x3b, 0xaa, 0xba, 0x81, 0x60, 0x48,
  0xb9, 0xd5, 0x81, 0x9c, 0xf8, 0x6c, 0x84, 0x77, 0xff, 0x54, 0x78, 0x26, 0x5f, 0xbe, 0xe8, 0x1e,
  0x36, 0x9f, 0x34, 0x80, 0x5c, 0x45, 0x2c, 0x9b, 0x76, 0xd5, 0x1b, 0x8f, 0xcc, 0xc3, 0xb8, 0xf5,
]);

const RSA_E = BigInt(`0x8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b8602136477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad6338c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f10a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683`);
const RSA_N = BigInt(0x10001);

function assertSafe(value: string, label: string) {
  const normalized = value.trim();
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) > 255) {
      throw new Error(`${label} 含有非法字符，请检查是否包含中文标点或说明文字`);
    }
  }
  return normalized;
}

export function normalizePan115Cookie(cookie: string) {
  return assertSafe(cookie.replace(/；/g, ';').replace(/：/g, ':').replace(/，/g, ','), '115 Cookie');
}

export function assertPan115CookieHeaderSafe(cookie: string) {
  return normalizePan115Cookie(cookie);
}

function isMediaFile(filename: string) {
  const lower = filename.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function parsePan115ShareUrl(shareUrl: string, passcode = '') {
  const cleaned = decodeURIComponent(shareUrl.trim()).replace(/[#.,，/\s]+$/, '');
  const matches = /https:\/\/(?:115|anxia|115cdn)\.com\/s\/([a-zA-Z0-9]+)(?:\?password=([^&#\s]+))?/i.exec(cleaned);
  if (!matches) throw new Error('无法解析115分享链接');
  return {
    shareCode: matches[1],
    receiveCode: passcode || matches[2] || '',
  };
}

async function parseJson(response: Response) {
  const text = await response.text();
  try {
    return typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error(`115接口返回异常：${text.slice(0, 200)}`);
  }
}

async function fetchShareDir(shareCode: string, receiveCode: string, cid: string) {
  const url = new URL(SHARE_URL);
  url.searchParams.set('share_code', shareCode);
  url.searchParams.set('receive_code', receiveCode);
  url.searchParams.set('cid', cid);
  url.searchParams.set('limit', '9999');
  url.searchParams.set('offset', '0');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`115分享接口请求失败 (${response.status})`);
  }
  return parseJson(response);
}

async function collectFilesRecursive(shareCode: string, receiveCode: string, cid: string, files: Pan115ShareVideoFile[]) {
  const responseData = await fetchShareDir(shareCode, receiveCode, cid);
  if (!responseData?.data) return;
  if (responseData.data.share_state === 7) {
    throw new Error(responseData.data.shareinfo?.forbid_reason || '链接已过期');
  }

  const list = Array.isArray(responseData.data.list) ? responseData.data.list : [];
  const mediaFiles = list.filter((item: any) => Number(item.fc) === 1 && isMediaFile(String(item.n || '')));
  const folders = list.filter((item: any) => Number(item.fc) === 0);

  mediaFiles.forEach((file: any) => {
    files.push({
      name: String(file.n || ''),
      fileId: String(file.fid || ''),
      shareCode,
      receiveCode,
      size: Number(file.s || 0),
    });
  });

  for (const folder of folders) {
    await collectFilesRecursive(shareCode, receiveCode, String(folder.cid || ''), files);
  }
}

export async function listPan115ShareVideos(shareUrl: string, passcode = ''): Promise<Pan115ShareListResult> {
  const { shareCode, receiveCode } = parsePan115ShareUrl(shareUrl, passcode);
  const files: Pan115ShareVideoFile[] = [];
  await collectFilesRecursive(shareCode, receiveCode, shareCode, files);
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
  if (files.length === 0) {
    throw new Error('115分享中没有可播放的视频文件');
  }
  return {
    title: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '115网盘立即播放',
    files,
  };
}

function bytesToBigInt(bytes: Uint8Array) {
  let value = BigInt(0);
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  return value;
}

function bigIntToBytes(value: bigint, length?: number) {
  const hex = value.toString(16);
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = Buffer.from(padded, 'hex');
  if (!length) return new Uint8Array(bytes);
  if (bytes.length >= length) return new Uint8Array(bytes.slice(-length));
  const buffer = new Uint8Array(length);
  buffer.set(bytes, length - bytes.length);
  return buffer;
}

function* accStep(start: number, stop: number, step = 1): Generator<[number, number, number]> {
  for (let i = start + step; i < stop; i += step) {
    yield [start, i, step];
    start = i;
  }
  if (start !== stop) yield [start, stop, stop - start];
}

function bytesXor(v1: Uint8Array, v2: Uint8Array) {
  const result = new Uint8Array(v1.length);
  for (let i = 0; i < v1.length; i += 1) result[i] = v1[i] ^ v2[i];
  return result;
}

function xor(src: Uint8Array, key: Uint8Array) {
  const buffer = new Uint8Array(src.length);
  const offset = src.length & 0b11;
  if (offset) buffer.set(bytesXor(src.subarray(0, offset), key.subarray(0, offset)));
  const iterator = accStep(offset, src.length, key.length);
  let next = iterator.next();
  while (!next.done) {
    const [j, k] = next.value;
    buffer.set(bytesXor(src.subarray(j, k), key), j);
    next = iterator.next();
  }
  return buffer;
}

function genKey(randKey: Uint8Array, skLen: number) {
  const xorKey = new Uint8Array(skLen);
  let length = skLen * (skLen - 1);
  let index = 0;
  for (let i = 0; i < skLen; i += 1) {
    const x = (randKey[i] + G_KTS[index]) & 0xff;
    xorKey[i] = G_KTS[length] ^ x;
    length -= skLen;
    index += skLen;
  }
  return xorKey;
}

function padPkcs1V15(message: Uint8Array) {
  const buffer = new Uint8Array(128);
  buffer.fill(0x02, 1, 127 - message.length);
  buffer.set(message, 128 - message.length);
  return bytesToBigInt(buffer);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint) {
  let result = BigInt(1);
  let b = base % modulus;
  let e = exponent;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) result = (result * b) % modulus;
    e >>= BigInt(1);
    b = (b * b) % modulus;
  }
  return result;
}

function reverseBytes(bytes: Uint8Array) {
  return Uint8Array.from(Array.from(bytes).reverse());
}

function encrypt115(input: string) {
  const data = new Uint8Array(Buffer.from(input, 'utf8'));
  const xorText = new Uint8Array(16 + data.length);
  xorText.set(
    xor(
      reverseBytes(xor(data, new Uint8Array([0x8d, 0xa5, 0xa5, 0x8d]))),
      new Uint8Array([0x78, 0x06, 0xad, 0x4c, 0x33, 0x86, 0x5d, 0x18, 0x4c, 0x01, 0x3f, 0x46])
    ),
    16
  );
  const cipherData = new Uint8Array(Math.ceil(xorText.length / 117) * 128);
  let start = 0;
  const iterator = accStep(0, xorText.length, 117);
  let next = iterator.next();
  while (!next.done) {
    const [l, r] = next.value;
    cipherData.set(bigIntToBytes(modPow(padPkcs1V15(xorText.subarray(l, r)), RSA_N, RSA_E), 128), start);
    start += 128;
    next = iterator.next();
  }
  return Buffer.from(cipherData).toString('base64');
}

function decrypt115(cipherData: string) {
  const cipherBytes = new Uint8Array(Buffer.from(cipherData, 'base64'));
  const data: number[] = [];
  const iterator = accStep(0, cipherBytes.length, 128);
  let next = iterator.next();
  while (!next.done) {
    const [l, r] = next.value;
    const p = modPow(bytesToBigInt(cipherBytes.subarray(l, r)), RSA_N, RSA_E);
    const b = bigIntToBytes(p);
    const idx = b.indexOf(0);
    data.push(...Array.from(b.subarray(idx + 1)));
    next = iterator.next();
  }
  const keyL = genKey(new Uint8Array(data.slice(0, 16)), 12);
  const tmp = reverseBytes(xor(new Uint8Array(data.slice(16)), keyL));
  const bytes = xor(tmp, new Uint8Array([0x8d, 0xa5, 0xa5, 0x8d]));
  return Buffer.from(bytes).toString('utf8');
}

export async function getPan115PlayUrl(file: Pan115ShareVideoFile, cookie: string) {
  const safeCookie = assertPan115CookieHeaderSafe(cookie);
  const payload = `data=${encodeURIComponent(encrypt115(JSON.stringify({
    share_code: file.shareCode,
    receive_code: file.receiveCode,
    file_id: file.fileId,
  })))}`;

  const response = await fetch(PLAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: safeCookie,
    },
    body: payload,
    cache: 'no-store',
  });

  const responseData = await parseJson(response);
  if (!responseData) {
    throw new Error('115盘无响应数据');
  }
  if (responseData.state === false) {
    const errorMsg = responseData.msg || responseData.error || '未知错误';
    if (String(errorMsg).includes('登录')) {
      throw new Error('115 Cookie 无效，请重新填写');
    }
    throw new Error(`115盘错误: ${errorMsg}`);
  }
  if (!responseData.data || typeof responseData.data !== 'string') {
    throw new Error('115 Cookie 无效，请重新填写');
  }
  const parsed = JSON.parse(decrypt115(responseData.data));
  const playUrl = parsed?.url?.url;
  if (!playUrl) throw new Error('未获取到115播放地址');
  return playUrl as string;
}

export async function validatePan115Cookie(cookie: string): Promise<void> {
  assertPan115CookieHeaderSafe(cookie);
}
