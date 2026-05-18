/* eslint-disable @typescript-eslint/no-explicit-any */

import { constants,publicEncrypt } from 'crypto';

export interface TianyiShareVideoFile {
  name: string;
  fileId: string;
  shareId: string;
  size: number;
}

export interface TianyiShareListResult {
  title: string;
  files: TianyiShareVideoFile[];
  shareId: string;
  shareMode: string;
  isFolder: string | number | boolean;
  accessCode: string;
}

const API_BASE = 'https://cloud.189.cn/api';
const LOGIN_URL = 'https://open.e.189.cn';
const VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m3u8', '.ts', '.rmvb', '.rm', '.mpeg', '.mpg', '.m4v', '.webm',
];

const NORMAL_HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json;charset=UTF-8',
};

const loginCookieStore = new Map<string, { cookie: string; expiresAt: number }>();
const LOGIN_TTL_MS = 30 * 60 * 1000;

export function normalizeTianyiAccount(value: string): string {
  return value.trim();
}

export function normalizeTianyiPassword(value: string): string {
  return value.trim();
}

function makeLoginCacheKey(account: string, password: string) {
  return `${account}\n${password}`;
}

export function clearTianyiLoginCache(account: string, password: string) {
  loginCookieStore.delete(
    makeLoginCacheKey(normalizeTianyiAccount(account), normalizeTianyiPassword(password))
  );
}

function pruneLoginCookies() {
  const now = Date.now();
  for (const [key, value] of Array.from(loginCookieStore.entries())) {
    if (value.expiresAt <= now) {
      loginCookieStore.delete(key);
    }
  }
}

function assertHeaderSafe(value: string, label: string) {
  const normalized = value.trim();
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) > 255) {
      throw new Error(`${label} 含有非法字符，请检查是否包含中文标点或说明文字`);
    }
  }
  return normalized;
}

function isVideoFile(name: string) {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function extractSetCookies(response: Response): string[] {
  const headersAny = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headersAny.getSetCookie === 'function') {
    return headersAny.getSetCookie();
  }
  const raw = response.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function mergeCookies(...cookieGroups: Array<string | string[] | undefined>) {
  const map = new Map<string, string>();
  for (const group of cookieGroups) {
    const list = Array.isArray(group) ? group : group ? [group] : [];
    for (const item of list) {
      for (const chunk of item.split(/,(?=[^;,]+=)/g)) {
        const pair = chunk.split(';')[0]?.trim();
        if (!pair || !pair.includes('=')) continue;
        const index = pair.indexOf('=');
        const key = pair.slice(0, index);
        const value = pair.slice(index + 1);
        map.set(key, value);
      }
    }
  }
  return Array.from(map.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

function toFormBody(data: Record<string, any>) {
  return new URLSearchParams(
    Object.entries(data).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {})
  ).toString();
}

async function parseJsonResponse<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    const normalized = text.replace(/(:\s*)(-?\d{15,})(\s*[,}])/g, '$1"$2"$3');
    return JSON.parse(normalized) as T;
  } catch {
    throw new Error(`天翼云盘接口返回异常：${text.slice(0, 200)}`);
  }
}

function encryptCredential(value: string, pubKey: string) {
  const encrypted = publicEncrypt(
    {
      key: `-----BEGIN PUBLIC KEY-----\n${pubKey}\n-----END PUBLIC KEY-----`,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(value, 'utf8')
  );
  return `{NRP}${encrypted.toString('hex')}`;
}

export function parseTianyiShareUrl(url: string, passcode = ''): { shareCode: string; accessCode: string } {
  const decoded = decodeURIComponent(url);
  const patterns = [
    /https:\/\/cloud\.189\.cn\/web\/share\?code=([A-Za-z0-9]+)/i,
    /https:\/\/cloud\.189\.cn\/t\/([A-Za-z0-9]+)/i,
    /https:\/\/h5\.cloud\.189\.cn\/share\.html#\/t\/([A-Za-z0-9]+)/i,
  ];
  let shareCode = '';
  let rawCode = '';
  for (const pattern of patterns) {
    const matched = decoded.match(pattern);
    if (matched?.[1]) {
      rawCode = matched[1];
      break;
    }
  }
  if (!rawCode) {
    throw new Error('无法解析天翼云盘分享链接');
  }

  const cleanMatch = rawCode.match(/^([A-Za-z0-9]+)/);
  shareCode = cleanMatch?.[1] || rawCode.trim();

  const pwdMatch = decoded.match(/[?&]pwd=([^&]+)/i);
  const inlineAccessCodeMatch1 = rawCode.match(/[（(]\s*访问码[：:]\s*([A-Za-z0-9]+)\s*[）)]/i);
  const inlineAccessCodeMatch2 = rawCode.match(/\s+访问码[：:]\s*([A-Za-z0-9]+)/i);

  return {
    shareCode,
    accessCode: passcode || pwdMatch?.[1] || inlineAccessCodeMatch1?.[1] || inlineAccessCodeMatch2?.[1] || '',
  };
}

async function fetchLoginCookie(account: string, password: string) {
  const safeAccount = assertHeaderSafe(normalizeTianyiAccount(account), '天翼云盘账号');
  const safePassword = assertHeaderSafe(normalizeTianyiPassword(password), '天翼云盘密码');
  const cacheKey = makeLoginCacheKey(safeAccount, safePassword);
  pruneLoginCookies();
  const cached = loginCookieStore.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.cookie;
  }

  const encryptConfResp = await fetch(`${LOGIN_URL}/api/logbox/config/encryptConf.do?appId=cloud`, {
    method: 'POST',
    cache: 'no-store',
  });
  const encryptConf = await parseJsonResponse<any>(encryptConfResp);
  const pubKey = String(encryptConf?.data?.pubKey || '');
  if (!pubKey) {
    throw new Error('获取天翼云盘登录公钥失败');
  }

  const loginUrlResp = await fetch(
    `${API_BASE}/portal/loginUrl.action?redirectURL=https://cloud.189.cn/web/redirect.html?returnURL=/main.action`,
    { cache: 'no-store' }
  );
  const finalUrl = loginUrlResp.url;
  const reqId = finalUrl.match(/reqId=(\w+)/)?.[1] || '';
  const lt = finalUrl.match(/lt=(\w+)/)?.[1] || '';
  if (!reqId || !lt) {
    throw new Error('获取天翼云盘登录参数失败');
  }

  const loginHeaders: HeadersInit = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json;charset=UTF-8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:74.0) Gecko/20100101 Firefox/76.0',
    Referer: 'https://open.e.189.cn/',
    Lt: lt,
    Reqid: reqId,
  };

  const appConfResp = await fetch(`${LOGIN_URL}/api/logbox/oauth2/appConf.do`, {
    method: 'POST',
    headers: loginHeaders,
    body: toFormBody({ version: '2.0', appKey: 'cloud' }),
    cache: 'no-store',
  });
  const appConf = await parseJsonResponse<any>(appConfResp);
  const returnUrl = appConf?.data?.returnUrl;
  const paramId = appConf?.data?.paramId;
  if (!returnUrl || !paramId) {
    throw new Error('获取天翼云盘登录配置失败');
  }

  const loginSubmitResp = await fetch(`${LOGIN_URL}/api/logbox/oauth2/loginSubmit.do`, {
    method: 'POST',
    headers: loginHeaders,
    body: toFormBody({
      appKey: 'cloud',
      version: '2.0',
      accountType: '01',
      mailSuffix: '@189.cn',
      validateCode: '',
      returnUrl,
      paramId,
      captchaToken: '',
      dynamicCheck: 'FALSE',
      clientType: '1',
      cb_SaveName: '0',
      isOauth2: false,
      userName: encryptCredential(safeAccount, pubKey),
      password: encryptCredential(safePassword, pubKey),
    }),
    cache: 'no-store',
  });
  const loginSubmit = await parseJsonResponse<any>(loginSubmitResp);
  const toUrl = String(loginSubmit?.toUrl || '');
  if (!toUrl) {
    throw new Error(loginSubmit?.msg || loginSubmit?.message || '天翼云盘登录失败');
  }

  const firstCookies = mergeCookies(extractSetCookies(loginSubmitResp));
  const redirectResp = await fetch(toUrl, {
    headers: {
      Cookie: firstCookies,
      Referer: 'https://m.cloud.189.cn/',
    },
    redirect: 'manual',
    cache: 'no-store',
  });

  const finalCookie = mergeCookies(firstCookies, extractSetCookies(redirectResp));
  if (!finalCookie) {
    throw new Error('天翼云盘登录未获取到 Cookie');
  }

  loginCookieStore.set(cacheKey, {
    cookie: finalCookie,
    expiresAt: Date.now() + LOGIN_TTL_MS,
  });
  return finalCookie;
}

async function fetchJsonWithRetry<T = any>(url: string, options?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 3; i += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`天翼云盘接口请求失败 (${response.status}): ${url}`);
      }
      return await parseJsonResponse<T>(response);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('天翼云盘接口请求失败');
}

async function getShareInfo(input: { shareCode: string; accessCode: string }) {
  let info: any = null;

  if (input.accessCode) {
    try {
      await fetchJsonWithRetry(
        `${API_BASE}/open/share/checkAccessCode.action?shareCode=${encodeURIComponent(input.shareCode)}&accessCode=${encodeURIComponent(input.accessCode)}`,
        { headers: NORMAL_HEADERS }
      );
    } catch {
      // 部分分享即使带了提取码文本，checkAccessCode 也可能直接 400；
      // 这里不立刻失败，继续尝试直接取分享信息。
    }
  }

  try {
    const infoUrl = input.accessCode
      ? `${API_BASE}/open/share/getShareInfoByCodeV2.action?key=noCache&shareCode=${encodeURIComponent(input.shareCode)}`
      : `${API_BASE}/open/share/getShareInfoByCodeV2.action?noCache=${Math.random()}&shareCode=${encodeURIComponent(input.shareCode)}`;
    info = await fetchJsonWithRetry<any>(infoUrl, { headers: NORMAL_HEADERS });
  } catch (error) {
    if (input.accessCode) {
      throw new Error(`获取天翼云盘分享信息失败，可能是访问码错误或链接已失效：${error instanceof Error ? error.message : 'unknown error'}`);
    }
    throw error;
  }

  return {
    fileId: String(info?.fileId || ''),
    shareId: String(info?.shareId || ''),
    shareMode: String(info?.shareMode || ''),
    isFolder: info?.isFolder,
    fileName: String(info?.fileName || ''),
  };
}

async function listShareDir(input: {
  fileId: string;
  shareId: string;
  shareMode: string;
  isFolder: string | number | boolean;
  accessCode: string;
  pageNum?: number;
}) {
  const pageNum = input.pageNum || 1;
  const isFolderCandidates = Array.from(
    new Set([
      String(input.isFolder),
      input.isFolder === true ? '1' : '',
      input.isFolder === false ? '0' : '',
    ].filter(Boolean))
  );

  const accessCodeCandidates = Array.from(
    new Set(input.accessCode ? [input.accessCode, ''] : [''])
  );

  const candidates: string[] = [];
  for (const isFolderValue of isFolderCandidates) {
    for (const accessCodeValue of accessCodeCandidates) {
      const baseParams = new URLSearchParams({
        pageNum: String(pageNum),
        pageSize: '60',
        fileId: input.fileId,
        shareDirFileId: input.fileId,
        isFolder: isFolderValue,
        shareId: input.shareId,
        shareMode: input.shareMode,
        iconOption: '5',
        orderBy: 'filename',
        descending: 'false',
      });
      if (accessCodeValue) {
        baseParams.set('accessCode', accessCodeValue);
      }

      candidates.push(
        `${API_BASE}/open/share/listShareDir.action?key=noCache&${baseParams.toString()}&noCache=${Math.random()}`,
        `${API_BASE}/open/share/listShareDir.action?${baseParams.toString()}`,
        `${API_BASE}/open/share/listShareDir.action?pageNum=${pageNum}&pageSize=60&fileId=${encodeURIComponent(input.fileId)}&shareDirFileId=${encodeURIComponent(input.fileId)}&isFolder=${encodeURIComponent(isFolderValue)}&shareId=${encodeURIComponent(input.shareId)}&shareMode=${encodeURIComponent(input.shareMode)}&iconOption=5&orderBy=lastOpTime&descending=true${accessCodeValue ? `&accessCode=${encodeURIComponent(accessCodeValue)}` : ''}`
      );
    }
  }

  const errors: string[] = [];
  for (const url of candidates) {
    try {
      return await fetchJsonWithRetry<any>(url, { headers: NORMAL_HEADERS });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`获取天翼云盘目录失败：${errors[errors.length - 1] || 'unknown error'}`);
}

async function collectShareFiles(input: {
  fileId: string;
  shareId: string;
  shareMode: string;
  isFolder: string | number | boolean;
  accessCode: string;
}): Promise<TianyiShareVideoFile[]> {
  const result: TianyiShareVideoFile[] = [];
  const stack = [input.fileId];

  while (stack.length > 0) {
    const currentFileId = stack.pop();
    if (!currentFileId) {
      continue;
    }
    let pageNum = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await listShareDir({
        ...input,
        fileId: currentFileId,
        pageNum,
      });
      const fileListAO = data?.fileListAO || {};
      const folderList = Array.isArray(fileListAO.folderList) ? fileListAO.folderList : [];
      const fileList = Array.isArray(fileListAO.fileList) ? fileListAO.fileList : [];

      folderList.forEach((item: any) => {
        if (item?.id) {
          stack.push(String(item.id));
        }
      });

      fileList.forEach((item: any) => {
        const name = String(item?.name || '');
        const isVideo = item?.mediaType === 3 || isVideoFile(name);
        if (!isVideo) return;
        result.push({
          name,
          fileId: String(item?.id || ''),
          shareId: input.shareId,
          size: Number(item?.size || 0),
        });
      });

      const totalCount = Number(fileListAO?.count || 0);
      if (totalCount <= pageNum * 60) {
        hasMore = false;
      } else {
        pageNum += 1;
      }
    }
  }

  return result
    .filter((item) => item.fileId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
}

export async function listTianyiShareVideos(shareUrl: string, account: string, password: string, passcode = ''): Promise<TianyiShareListResult> {
  normalizeTianyiAccount(account);
  normalizeTianyiPassword(password);
  const parsed = parseTianyiShareUrl(shareUrl, passcode);
  const info = await getShareInfo(parsed);
  if (!info.fileId || !info.shareId) {
    throw new Error('获取天翼云盘分享信息失败');
  }
  const files = await collectShareFiles({
    fileId: info.fileId,
    shareId: info.shareId,
    shareMode: info.shareMode,
    isFolder: info.isFolder,
    accessCode: parsed.accessCode,
  });
  if (files.length === 0) {
    throw new Error('天翼云盘分享中没有视频文件');
  }
  return {
    title: info.fileName || (files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '天翼云盘立即播放'),
    files,
    shareId: info.shareId,
    shareMode: info.shareMode,
    isFolder: info.isFolder,
    accessCode: parsed.accessCode,
  };
}

export async function getTianyiSharePlayUrl(
  fileId: string,
  shareId: string,
  account: string,
  password: string
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cookie = await fetchLoginCookie(account, password);
    const response = await fetch(
      `${API_BASE}/portal/getNewVlcVideoPlayUrl.action?shareId=${encodeURIComponent(shareId)}&dt=1&fileId=${encodeURIComponent(fileId)}&type=4&key=noCache`,
      {
        headers: {
          ...NORMAL_HEADERS,
          Cookie: cookie,
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 400 && attempt < 2) {
        clearTianyiLoginCache(account, password);
        lastError = new Error(`获取天翼云盘播放地址失败 (${response.status})`);
        continue;
      }
      throw new Error(`获取天翼云盘播放地址失败 (${response.status})${errorText ? `: ${errorText.slice(0, 200)}` : ''}`);
    }

    const data = await parseJsonResponse<any>(response);
    const rawUrl = String(data?.normal?.url || data?.url || '');
    if (!rawUrl) {
      throw new Error('未获取到天翼云盘播放地址');
    }

    const redirectResponse = await fetch(rawUrl, {
      redirect: 'manual',
      cache: 'no-store',
    });
    return redirectResponse.headers.get('location') || rawUrl;
  }

  throw lastError instanceof Error ? lastError : new Error('获取天翼云盘播放地址失败');
}

export async function validateTianyiCredentials(account: string, password: string): Promise<void> {
  await fetchLoginCookie(account, password);
}
