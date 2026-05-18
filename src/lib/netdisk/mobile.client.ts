/* eslint-disable @typescript-eslint/no-explicit-any */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface MobileShareVideoFile {
  name: string;
  contentId: string;
  linkID: string;
  size: number;
}

export interface MobileShareListResult {
  title: string;
  files: MobileShareVideoFile[];
}

function ensureHeaderSafeAuthorization(authorization: string): string {
  const raw = authorization.trim();
  const normalized = /^basic\s+/i.test(raw) ? raw.replace(/^basic\s+/i, 'Basic ') : `Basic ${raw}`;

  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) > 255) {
      throw new Error('移动云盘 Authorization 含有非法字符，请检查是否包含中文标点或说明文字');
    }
  }

  return normalized;
}

export function normalizeMobileAuthorization(authorization: string): string {
  return ensureHeaderSafeAuthorization(authorization);
}

export function assertMobileAuthorizationHeaderSafe(authorization: string): string {
  return ensureHeaderSafeAuthorization(authorization);
}

const SHARE_ID_PATTERNS = [
  /https:\/\/yun\.139\.com\/shareweb\/#\/w\/i\/([^&/]+)/,
  /https:\/\/yun\.139\.com\/sharewap\/#\/m\/i\?([^&/]+)/,
  /https:\/\/caiyun\.139\.com\/m\/i\?([^&/]+)/,
  /https:\/\/caiyun\.139\.com\/w\/i\/([^&/]+)/,
];

const BASE_URL = 'https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/';
const ALTERNATIVE_URLS = [
  'https://cloud.139.com/yun-share/richlifeApp/devapp/IOutLink/',
  'https://yun.139.com/yun-share/richlifeApp/devapp/IOutLink/',
  'https://share.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/',
];
const AES_KEY = Buffer.from('PVGDwmcvfs1uV3d1', 'utf8');
const BASE_HEADERS: HeadersInit = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'hcy-cool-flag': '1',
  'x-deviceinfo': '||3|12.27.0|chrome|136.0.0.0|189f4426ca008b9cbe9bf9bd79723d77||windows 10|1536X695|zh-CN|||',
  Origin: 'https://yun.139.com',
  Referer: 'https://yun.139.com/',
};

function normalizeBase64(input: string): string {
  return input.replace(/-/g, '+').replace(/_/g, '/');
}

function extractAccountFromAuthorization(authorization?: string): string {
  if (!authorization) return '';
  try {
    const normalized = ensureHeaderSafeAuthorization(authorization);
    const matched = normalized.match(/^Basic\s+(.+)$/i);
    if (!matched?.[1]) return '';
    const decoded = Buffer.from(matched[1].trim(), 'base64').toString('utf8');
    const parts = decoded.split(':');
    return parts[1]?.trim() || '';
  } catch {
    return '';
  }
}

function encryptPayload(data: string | object): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', AES_KEY, iv);
  const plain = typeof data === 'string' ? data : JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function decryptPayload(data: string): string {
  const payload = Buffer.from(normalizeBase64(data), 'base64');
  const iv = payload.subarray(0, 16);
  const encrypted = payload.subarray(16);
  const decipher = createDecipheriv('aes-128-cbc', AES_KEY, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function parseShareId(url: string): string {
  for (const pattern of SHARE_ID_PATTERNS) {
    const matched = pattern.exec(url);
    if (matched?.[1]) return matched[1];
  }
  throw new Error('无法解析移动云盘分享链接');
}

async function postPlain(
  url: string,
  body: string | object,
  encrypted = false,
  authorization?: string
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      ...(authorization ? { authorization: ensureHeaderSafeAuthorization(authorization) } : {}),
    },
    body: encrypted ? encryptPayload(body) : JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`移动云盘接口请求失败 (${response.status})`);
  }
  return text;
}

async function fetchShareInfo(linkId: string, pCaID: string, authorization?: string) {
  const requestPayload = {
    getOutLinkInfoReq: {
      account: '',
      linkID: linkId,
      passwd: '',
      caSrt: 1,
      coSrt: 1,
      srtDr: 0,
      bNum: 1,
      pCaID,
      eNum: 200,
    },
    commonAccountInfo: { account: '', accountType: 1 },
  };

  let lastError: unknown;
  for (const baseUrl of [BASE_URL, ...ALTERNATIVE_URLS]) {
    try {
      const raw = await postPlain(`${baseUrl}getOutLinkInfoV6`, requestPayload, true, authorization);
      if (!raw || raw === 'null') {
        continue;
      }

      const decrypted = decryptPayload(raw);
      const parsed = JSON.parse(decrypted);
      return parsed?.data ?? null;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('获取移动云盘分享信息失败');
}

async function collectFiles(linkId: string, path = 'root', authorization?: string): Promise<MobileShareVideoFile[]> {
  const info = await fetchShareInfo(linkId, path, authorization);
  if (!info) return [];

  const currentFiles = Array.isArray(info.coLst)
    ? info.coLst
        .filter((item: any) => item && item.coType === 3)
        .map((item: any) => ({
          name: String(item.coName || '未命名视频'),
          contentId: String(item.path || ''),
          linkID: linkId,
          size: Number(item.coSize || 0),
        }))
        .filter((item: MobileShareVideoFile) => item.contentId)
    : [];

  const childDirs = Array.isArray(info.caLst)
    ? info.caLst
        .map((item: any) => String(item?.path || ''))
        .filter(Boolean)
    : [];

  if (childDirs.length === 0) {
    return currentFiles;
  }

  const nested = await Promise.all(
    childDirs.map((childPath: string) => collectFiles(linkId, childPath, authorization))
  );
  return [...currentFiles, ...nested.flat()];
}

function sortFiles(files: MobileShareVideoFile[]): MobileShareVideoFile[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
}

export async function listMobileShareVideos(shareUrl: string, authorization?: string): Promise<MobileShareListResult> {
  const linkId = parseShareId(shareUrl);
  const files = sortFiles(await collectFiles(linkId, 'root', authorization));
  if (files.length === 0) {
    throw new Error('移动云盘分享中没有视频文件');
  }
  return {
    title: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '移动云盘立即播放',
    files,
  };
}

export async function getMobileSharePlayUrl(contentId: string, linkID: string, authorization?: string): Promise<string> {
  const requestPayload = {
    getContentInfoFromOutLinkReq: {
      contentId: contentId.split('/')[1] || contentId,
      linkID,
      account: '',
    },
    commonAccountInfo: {
      account: '',
      accountType: 1,
    },
  };

  let lastErrorMessage = '未获取到移动云盘播放地址';

  try {
    const response = await fetch(`${BASE_URL}getContentInfoFromOutLink`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Content-Type': 'application/json',
        ...(authorization ? { authorization: ensureHeaderSafeAuthorization(authorization) } : {}),
      },
      body: JSON.stringify(requestPayload),
      cache: 'no-store',
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`移动云盘播放接口请求失败 (${response.status})`);
    }

    let parsed: any;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      throw new Error('移动云盘播放接口返回异常');
    }

    const playUrl =
      parsed?.data?.contentInfo?.presentURL ||
      parsed?.data?.contentInfo?.presentUrl ||
      parsed?.data?.contentInfo?.playUrl ||
      parsed?.data?.contentInfo?.url ||
      parsed?.contentInfo?.presentURL ||
      parsed?.contentInfo?.presentUrl ||
      parsed?.data?.presentURL ||
      parsed?.data?.url;

    if (playUrl) {
      return playUrl;
    }

    lastErrorMessage =
      parsed?.message ||
      parsed?.msg ||
      parsed?.data?.message ||
      parsed?.data?.msg ||
      '未获取到移动云盘播放地址';
  } catch (error) {
    lastErrorMessage =
      error instanceof Error ? error.message : '未获取到移动云盘播放地址';
  }

  throw new Error(lastErrorMessage);
}

export async function getMobileShareDownloadUrl(
  contentId: string,
  linkID: string,
  authorization?: string
): Promise<string> {
  if (!authorization) {
    throw new Error('移动云盘未配置验证头');
  }

  const account = extractAccountFromAuthorization(authorization);
  if (!account) {
    throw new Error('无法从移动云盘验证头中解析账号');
  }

  const requestPayload = {
    dlFromOutLinkReqV3: {
      linkID,
      account,
      coIDLst: {
        item: [contentId],
      },
    },
    commonAccountInfo: {
      account,
      accountType: 1,
    },
  };

  const raw = await postPlain(
    `${BASE_URL}dlFromOutLinkV3`,
    requestPayload,
    true,
    authorization
  );

  let parsed: any;
  try {
    const decrypted = decryptPayload(raw);
    parsed = JSON.parse(decrypted);
  } catch {
    throw new Error('移动云盘下载接口返回异常');
  }

  const downloadUrl =
    parsed?.data?.redrUrl ||
    parsed?.data?.downloadUrl ||
    parsed?.data?.url;

  if (!downloadUrl) {
    throw new Error(
      parsed?.message ||
        parsed?.msg ||
        parsed?.data?.message ||
        parsed?.data?.msg ||
        '未获取到移动云盘下载地址'
    );
  }

  return downloadUrl;
}
