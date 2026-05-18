/* eslint-disable @typescript-eslint/no-explicit-any */

import crypto from 'node:crypto';

const UC_SHARE_API_BASE = 'https://pc-api.uc.cn/1/clouddrive';
const UC_DRIVE_API_BASE = 'https://pc-api.uc.cn/1/clouddrive';
const UC_OPEN_API_BASE = 'https://open-api-drive.uc.cn';
const UC_QUERY_TEMPLATE = 'pr=UCBrowser&fr=pc&sys=darwin&ve=1.8.6&ut={ut}';
const UC_OPEN_API_CLIENT_ID = '5acf882d27b74502b7040b0c65519aa7';
const UC_OPEN_API_SIGN_KEY = 'l3srvtd7p42l0d0x1u8d7yc8ye9kki4d';
const UC_OPEN_API_APP_VER = '1.6.8';
const UC_OPEN_API_CHANNEL = 'UCTVOFFICIALWEB';

export interface UCShareLinkInfo {
  pwdId: string;
  passcode: string;
}

export interface UCShareItem {
  fid: string;
  fileName: string;
  dir: boolean;
  shareFidToken?: string;
  pdirFid?: string;
  size?: number;
}

export interface UCShareVideoListResult {
  title: string;
  shareId: string;
  shareToken: string;
  files: Array<{
    fid: string;
    name: string;
    size?: number;
    shareFidToken?: string;
    pdirFid?: string;
  }>;
}

const VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts', '.mov', '.wmv', '.webm', '.rmvb', '.rm', '.mpg', '.mpeg', '.3gp', '.f4v', '.m4v', '.vob',
];

const utCache = new Map<string, string>();

function buildApiUrl(base: string, path: string, ut: string, query = '') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const queryPrefix = ut
    ? UC_QUERY_TEMPLATE.replace('{ut}', encodeURIComponent(ut))
    : 'pr=UCBrowser&fr=pc&sys=darwin&ve=1.8.6';
  return `${base}${normalizedPath}?${queryPrefix}${query ? `&${query}` : ''}`;
}

function getHeaders(cookie: string): HeadersInit {
  return {
    'content-type': 'application/json',
    cookie,
    referer: 'https://drive.uc.cn',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) uc-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch',
  };
}

export function getUCPlayHeaders(cookie: string): Record<string, string> {
  const keepKeys = ['_UP_A4A_11_', 'tfstk', '__uid', '__pus', '__kp', '__puus'];
  const filteredCookie = cookie
    .split(';')
    .map((item) => item.trim())
    .filter((item) => keepKeys.some((key) => item.includes(key)))
    .join('; ');

  return {
    cookie: filteredCookie,
    referer: 'https://drive.uc.cn/',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) uc-cloud-drive/1.8.6 Chrome/100.0.4896.160 Electron/18.3.5.16-b62cf9c50d Safari/537.36 Channel/ucpan_other_ch',
  };
}

export function normalizeUCCookie(cookie: string): string {
  return cookie
    .replace(/；/g, ';')
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .trim();
}

export function assertUCCookieHeaderSafe(cookie: string): string {
  const normalized = normalizeUCCookie(cookie);
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) > 255) {
      throw new Error('UC Cookie 含有非法字符，请确认没有中文标点、中文空格或说明文字');
    }
  }
  return normalized;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function joinPath(...parts: string[]) {
  const joined = parts.filter(Boolean).join('/').replace(/\/+/g, '/');
  return normalizePath(joined);
}

function sanitizeFolderName(name: string) {
  return (name || 'uc-temp')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function parseJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`UC 接口返回异常：${text.slice(0, 200)}`);
  }
}

function ensureOk(data: any, fallbackMessage: string) {
  if (data?.code === 0 || data?.code === 200 || data?.status === 200) return;
  throw new Error(data?.message || data?.msg || fallbackMessage);
}

async function resolveUCUt(cookie: string) {
  const safeCookie = assertUCCookieHeaderSafe(cookie);
  const cached = utCache.get(safeCookie);
  if (cached) return cached;

  const tryFetchUt = async (headers?: HeadersInit) => {
    const response = await fetch(`${UC_DRIVE_API_BASE}/file`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
    const text = (await response.text()).trim();
    if (!response.ok || !text) return '';
    return text;
  };

  let ut = await tryFetchUt();
  if (!ut) {
    ut = await tryFetchUt(getHeaders(safeCookie));
  }

  if (!ut) {
    utCache.set(safeCookie, '');
    return '';
  }

  utCache.set(safeCookie, ut);
  return ut;
}

function getDriveItemName(item: any): string {
  return String(item?.file_name || item?.name || '');
}

function buildInstantPlayFolderName(pwdId: string, title?: string) {
  const baseName = sanitizeFolderName(title || 'uc-temp') || 'uc-temp';
  return `${baseName}_${pwdId}`.slice(0, 120);
}

export function parseUCShareUrl(url: string, passcode = ''): UCShareLinkInfo {
  const parsed = new URL(url);
  const pwdId = parsed.pathname.match(/\/s\/([A-Za-z0-9_-]+)/)?.[1] || '';
  if (!pwdId) {
    throw new Error('无法解析 UC 分享链接');
  }
  return {
    pwdId,
    passcode: passcode || parsed.searchParams.get('pwd') || parsed.searchParams.get('passcode') || '',
  };
}

async function fetchShareToken(cookie: string, share: UCShareLinkInfo, ut: string) {
  const response = await fetch(buildApiUrl(UC_SHARE_API_BASE, '/share/sharepage/token', ut), {
    method: 'POST',
    headers: getHeaders(cookie),
    body: JSON.stringify({
      pwd_id: share.pwdId,
      passcode: share.passcode,
    }),
    cache: 'no-store',
  });

  const data = await parseJson(response);
  ensureOk(data, '获取 UC 分享 token 失败');
  const stoken = data?.data?.stoken || data?.data?.share_token || data?.data?.token;
  if (!stoken) {
    throw new Error('UC 分享 token 缺失');
  }
  return {
    stoken,
    shareTitle: data?.data?.title || '',
  };
}

async function fetchShareFolderItems(cookie: string, pwdId: string, stoken: string, ut: string, pdirFid = '0', page = 1): Promise<{ items: UCShareItem[]; total?: number }> {
  const query = new URLSearchParams({
    pwd_id: pwdId,
    stoken,
    pdir_fid: pdirFid,
    force: '0',
    _page: String(page),
    _size: '100',
    _sort: 'file_type:asc,file_name:asc',
  });
  const response = await fetch(buildApiUrl(UC_SHARE_API_BASE, '/share/sharepage/detail', ut, query.toString()), {
    method: 'GET',
    headers: getHeaders(cookie),
    cache: 'no-store',
  });

  const data = await parseJson(response);
  ensureOk(data, '获取 UC 分享详情失败');
  const list = data?.data?.list || [];
  return {
    items: list.map((item: any) => ({
      fid: String(item.fid || item.file_id || ''),
      fileName: String(item.file_name || item.name || ''),
      dir: Boolean(item.dir || item.is_dir || item.file_type === 0),
      shareFidToken: item.share_fid_token || item.fid_token || item.share_token || undefined,
      pdirFid: String(item.pdir_fid || pdirFid || '0'),
      size: Number(item.size || 0),
    })),
    total: Number(data?.metadata?._total || 0),
  };
}

async function collectShareItemsRecursive(cookie: string, pwdId: string, stoken: string, ut: string, pdirFid = '0'): Promise<UCShareItem[]> {
  const result: UCShareItem[] = [];
  const pageSize = 100;
  for (let page = 1; page < 100; page += 1) {
    const { items, total } = await fetchShareFolderItems(cookie, pwdId, stoken, ut, pdirFid, page);
    for (const item of items) {
      if (item.dir) {
        const children = await collectShareItemsRecursive(cookie, pwdId, stoken, ut, item.fid);
        result.push(...children);
      } else {
        result.push(item);
      }
    }
    if (items.length < pageSize || page >= Math.ceil((total || 0) / pageSize)) break;
  }
  return result;
}

function isVideoFile(fileName: string) {
  const lower = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function fetchDriveFolderItems(cookie: string, ut: string, pdirFid = '0', page = 1, size = 200): Promise<any[]> {
  const query = new URLSearchParams({
    pdir_fid: pdirFid,
    _page: String(page),
    _size: String(size),
    _sort: 'file_type:asc,file_name:asc',
  });
  const response = await fetch(buildApiUrl(UC_DRIVE_API_BASE, '/file/sort', ut, query.toString()), {
    method: 'GET',
    headers: getHeaders(cookie),
    cache: 'no-store',
  });
  const data = await parseJson(response);
  ensureOk(data, '获取 UC 目录列表失败');
  return data?.data?.list || [];
}

async function fetchAllDriveFolderItems(cookie: string, ut: string, pdirFid = '0'): Promise<any[]> {
  const allItems: any[] = [];
  const pageSize = 200;
  for (let page = 1; page < 100; page += 1) {
    const items = await fetchDriveFolderItems(cookie, ut, pdirFid, page, pageSize);
    allItems.push(...items);
    if (items.length < pageSize) break;
  }
  return allItems;
}

async function createDriveFolder(cookie: string, ut: string, parentFid: string, folderName: string) {
  const response = await fetch(buildApiUrl(UC_DRIVE_API_BASE, '/file', ut), {
    method: 'POST',
    headers: getHeaders(cookie),
    body: JSON.stringify({
      pdir_fid: parentFid,
      file_name: folderName,
      dir_path: '',
      dir_init_lock: false,
    }),
    cache: 'no-store',
  });
  const data = await parseJson(response);
  ensureOk(data, `创建 UC 目录失败：${folderName}`);
  const fid = data?.data?.fid || data?.data?.file_id || data?.metadata?.fid;
  if (!fid) throw new Error(`UC 目录创建成功但未返回 fid：${folderName}`);
  return String(fid);
}

async function findDirectoryByName(cookie: string, ut: string, parentFid: string, folderName: string): Promise<any | null> {
  const items = await fetchAllDriveFolderItems(cookie, ut, parentFid);
  return items.find((item: any) => Boolean(item.dir || item.is_dir) && getDriveItemName(item) === folderName) || null;
}

export async function validateUCCookieReadable(cookie: string): Promise<void> {
  const safeCookie = assertUCCookieHeaderSafe(cookie);
  const ut = await resolveUCUt(safeCookie);
  await fetchDriveFolderItems(safeCookie, ut, '0');
}

export async function listUCShareVideos(shareUrl: string, cookie: string, passcode = ''): Promise<UCShareVideoListResult> {
  const safeCookie = assertUCCookieHeaderSafe(cookie);
  const ut = await resolveUCUt(safeCookie);
  const share = parseUCShareUrl(shareUrl, passcode);
  const { stoken, shareTitle } = await fetchShareToken(safeCookie, share, ut);
  const allItems = await collectShareItemsRecursive(safeCookie, share.pwdId, stoken, ut, '0');
  const files = allItems
    .filter((item) => !item.dir && isVideoFile(item.fileName) && Number(item.size || 0) >= 5 * 1024 * 1024)
    .map((item) => ({
      fid: item.fid,
      name: item.fileName,
      size: item.size,
      shareFidToken: item.shareFidToken,
      pdirFid: item.pdirFid,
    }));
  if (files.length === 0) throw new Error('分享中没有可播放的视频文件');
  return {
    title: shareTitle || 'UC网盘立即播放',
    shareId: share.pwdId,
    shareToken: stoken,
    files,
  };
}

export async function ensureUCDrivePath(cookie: string, inputPath: string): Promise<{ fid: string; path: string }> {
  const safeCookie = assertUCCookieHeaderSafe(cookie);
  const ut = await resolveUCUt(safeCookie);
  const normalized = normalizePath(inputPath);
  if (normalized === '/') return { fid: '0', path: normalized };

  const segments = normalized.split('/').filter(Boolean);
  let currentFid = '0';
  let currentPath = '';
  for (const segment of segments) {
    const items = await fetchDriveFolderItems(safeCookie, ut, currentFid);
    const existed = items.find((item: any) => Boolean(item.dir || item.is_dir) && getDriveItemName(item) === segment);
    currentPath = joinPath(currentPath, segment);
    if (existed) {
      currentFid = String(existed.fid || existed.file_id);
      continue;
    }
    currentFid = await createDriveFolder(safeCookie, ut, currentFid, segment);
  }
  return { fid: currentFid, path: currentPath || '/' };
}

async function submitSaveTask(cookie: string, ut: string, share: UCShareLinkInfo, stoken: string, toPdirFid: string, items: UCShareItem[]) {
  if (items.length === 0) throw new Error('没有可保存的文件');
  const response = await fetch(buildApiUrl(UC_SHARE_API_BASE, '/share/sharepage/save', ut), {
    method: 'POST',
    headers: getHeaders(cookie),
    body: JSON.stringify({
      pwd_id: share.pwdId,
      stoken,
      pdir_fid: '0',
      to_pdir_fid: toPdirFid,
      scene: 'link',
      filelist: items.map((item) => item.fid),
      fid_list: items.map((item) => item.fid),
      fid_token_list: items.map((item) => item.shareFidToken || ''),
      share_fid_token_list: items.map((item) => item.shareFidToken || ''),
    }),
    cache: 'no-store',
  });
  const data = await parseJson(response);
  ensureOk(data, '提交 UC 转存任务失败');
  return data?.data?.task_id ? String(data.data.task_id) : undefined;
}

async function _pollTask(cookie: string, ut: string, taskId: string) {
  for (let i = 0; i < 25; i += 1) {
    const query = new URLSearchParams({ task_id: taskId, retry_index: String(i) });
    const response = await fetch(buildApiUrl(UC_SHARE_API_BASE, '/task', ut, query.toString()), {
      method: 'GET', headers: getHeaders(cookie), cache: 'no-store',
    });
    const data = await parseJson(response);
    ensureOk(data, '查询 UC 任务状态失败');
    const task = data?.data || {};
    if (task?.status === 2 || task?.status === 'finished' || task?.status === 'success' || task?.finished_at) return;
    if (task?.status === -1 || task?.status === 'failed' || task?.err_code) {
      throw new Error(task?.message || task?.err_msg || 'UC 任务执行失败');
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error('UC 任务处理超时');
}

export async function ensureUCPlayFolder(cookie: string, playTempSavePath: string, shareId: string, title?: string): Promise<{ folderFid: string; folderPath: string; folderName: string }> {
  const safeCookie = assertUCCookieHeaderSafe(cookie);
  const ut = await resolveUCUt(safeCookie);
  const tempRoot = await ensureUCDrivePath(safeCookie, playTempSavePath);
  const folderName = buildInstantPlayFolderName(shareId, title);
  const existedFolder = await findDirectoryByName(safeCookie, ut, tempRoot.fid, folderName);
  if (existedFolder) {
    return {
      folderFid: String(existedFolder.fid || existedFolder.file_id),
      folderPath: joinPath(tempRoot.path, folderName),
      folderName,
    };
  }
  const folderFid = await createDriveFolder(safeCookie, ut, tempRoot.fid, folderName);
  return { folderFid, folderPath: joinPath(tempRoot.path, folderName), folderName };
}

export async function saveUCShareFile(cookie: string, input: { shareId: string; shareToken: string; fileId: string; shareFileToken?: string; playFolderFid: string; }): Promise<string> {
  const safeCookie = assertUCCookieHeaderSafe(cookie);
  const ut = await resolveUCUt(safeCookie);
  const taskId = await submitSaveTask(safeCookie, ut, { pwdId: input.shareId, passcode: '' }, input.shareToken, input.playFolderFid, [{ fid: input.fileId, fileName: '', dir: false, shareFidToken: input.shareFileToken }]);
  if (!taskId) throw new Error('UC 转存任务创建失败');

  for (let i = 0; i < 25; i += 1) {
    const query = new URLSearchParams({ task_id: taskId, retry_index: String(i) });
    const response = await fetch(buildApiUrl(UC_SHARE_API_BASE, '/task', ut, query.toString()), { method: 'GET', headers: getHeaders(safeCookie), cache: 'no-store' });
    const data = await parseJson(response);
    ensureOk(data, '查询 UC 任务状态失败');
    const saveAsTopFids = data?.data?.save_as?.save_as_top_fids;
    if (Array.isArray(saveAsTopFids) && saveAsTopFids.length > 0) {
      return String(saveAsTopFids[0]);
    }
    const status = data?.data?.status;
    if (status === -1 || status === 'failed' || data?.data?.err_code) {
      throw new Error(data?.data?.message || data?.data?.err_msg || 'UC 任务执行失败');
    }
    if (status === 2 || status === 'finished' || status === 'success' || data?.data?.finished_at) break;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error('UC 转存结果获取失败');
}

function generateDeviceID(timestamp: string) {
  return crypto.createHash('md5').update(timestamp).digest('hex').slice(0, 16);
}

function generateReqId(deviceID: string, timestamp: string) {
  return crypto.createHash('md5').update(deviceID + timestamp).digest('hex').slice(0, 16);
}

function generateXPanToken(method: string, pathname: string, timestamp: string, key: string) {
  return crypto.createHash('sha256').update(`${method}&${pathname}&${timestamp}&${key}`).digest('hex');
}

export async function getUCPlayUrls(cookie: string, savedFileId: string, token = ''): Promise<Array<{ name: string; url: string; priority: number; headers?: Record<string, string> }>> {
  const safeCookie = assertUCCookieHeaderSafe(cookie);
  const ut = await resolveUCUt(safeCookie);
  const urls: Array<{ name: string; url: string; priority: number; headers?: Record<string, string> }> = [];

  if (token) {
    try {
      const pathname = '/file';
      const timestamp = `${Math.floor(Date.now() / 1000)}000`;
      const deviceId = generateDeviceID(timestamp);
      const reqId = generateReqId(deviceId, timestamp);
      const xPanToken = generateXPanToken('GET', pathname, timestamp, UC_OPEN_API_SIGN_KEY);
      const query = new URLSearchParams({
        req_id: reqId,
        access_token: token,
        app_ver: UC_OPEN_API_APP_VER,
        device_id: deviceId,
        device_brand: 'Xiaomi',
        platform: 'tv',
        device_name: 'M2004J7AC',
        device_model: 'M2004J7AC',
        build_device: 'M2004J7AC',
        build_product: 'M2004J7AC',
        device_gpu: 'Adreno (TM) 550',
        activity_rect: '{}',
        channel: UC_OPEN_API_CHANNEL,
        method: 'streaming',
        group_by: 'source',
        fid: savedFileId,
        resolution: 'low,normal,high,super,2k,4k',
        support: 'dolby_vision',
      });
      const response = await fetch(`${UC_OPEN_API_BASE}${pathname}?${query.toString()}`, {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (Linux; Android 9) AppleWebKit/533.1 (KHTML, like Gecko) Mobile Safari/533.1',
          connection: 'Keep-Alive',
          'accept-encoding': 'gzip',
          'x-pan-tm': timestamp,
          'x-pan-token': xPanToken,
          'content-type': 'text/plain;charset=UTF-8',
          'x-pan-client-id': UC_OPEN_API_CLIENT_ID,
        },
        cache: 'no-store',
      });
      const data = await parseJson(response);
      const openVideoInfo = Array.isArray(data?.data?.video_info)
        ? data.data.video_info.find((item: any) => item?.accessable && item?.url)
        : null;
      if (openVideoInfo?.url) {
        urls.push({ name: '原画', url: String(openVideoInfo.url), priority: 9999, headers: {} });
      }
    } catch {
      // ignore token failure, fallback to cookie mode
    }
  }

  try {
    const response = await fetch(buildApiUrl(UC_DRIVE_API_BASE, '/file/download', ut), {
      method: 'POST',
      headers: getHeaders(safeCookie),
      body: JSON.stringify({ fids: [savedFileId] }),
      cache: 'no-store',
    });
    const data = await parseJson(response);
    ensureOk(data, '获取 UC 下载地址失败');
    const downloadUrl = data?.data?.[0]?.download_url;
    if (downloadUrl) {
      urls.push({ name: '原画', url: String(downloadUrl), priority: 9999, headers: getUCPlayHeaders(safeCookie) });
    }
  } catch {
    // ignore
  }

  try {
    const response = await fetch(buildApiUrl(UC_DRIVE_API_BASE, '/file/v2/play', ut), {
      method: 'POST',
      headers: getHeaders(safeCookie),
      body: JSON.stringify({
        fid: savedFileId,
        resolutions: 'normal,low,high,super,2k,4k',
        supports: 'fmp4',
      }),
      cache: 'no-store',
    });
    const data = await parseJson(response);
    ensureOk(data, '获取 UC 转码地址失败');
    const nameMap: Record<string, string> = { FOUR_K: '4K', SUPER: '超清', HIGH: '高清', NORMAL: '流畅', LOW: '低清' };
    if (Array.isArray(data?.data?.video_list)) {
      for (const video of data.data.video_list) {
        const resolution = video?.video_info?.resoultion;
        const playUrl = video?.video_info?.url;
        const priority = Number(video?.video_info?.width || 0);
        if (resolution && playUrl) {
          urls.push({ name: nameMap[String(resolution)] || String(resolution), url: String(playUrl), priority, headers: getUCPlayHeaders(safeCookie) });
        }
      }
    }
  } catch {
    // ignore
  }

  const deduped = urls.filter((item, index, array) => array.findIndex((v) => v.url === item.url) === index);
  deduped.sort((a, b) => b.priority - a.priority);
  if (deduped.length === 0) throw new Error('未获取到 UC 播放地址');
  return deduped;
}
