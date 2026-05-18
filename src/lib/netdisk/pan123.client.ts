/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Pan123ShareVideoFile {
  shareKey: string;
  fileId: string;
  s3KeyFlag: string;
  size: number;
  etag: string;
  fileName: string;
}

export interface Pan123ShareListResult {
  title: string;
  files: Pan123ShareVideoFile[];
}

const SHARE_API_BASE = 'https://www.123684.com/b/api/share/';
const VIDEO_API_BASE = 'https://www.123684.com/b/api/video/';
const LOGIN_URL = 'https://login.123pan.com/api/user/sign_in';
const LOGIN_TTL_MS = 30 * 60 * 1000;
const SHARE_PAGE_TIMEOUT_MS = 15000;
const MAX_TRAVERSE_NODES = 2000;
const MAX_TRAVERSE_DEPTH = 20;
const VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m3u8', '.ts', '.rmvb', '.rm', '.mpeg', '.mpg', '.m4v', '.webm',
];

const authStore = new Map<string, { token: string; expiresAt: number }>();

function makeCacheKey(account: string, password: string) {
  return `${account}\n${password}`;
}

function pruneAuthStore() {
  const now = Date.now();
  for (const [key, value] of Array.from(authStore.entries())) {
    if (value.expiresAt <= now) authStore.delete(key);
  }
}

function baseHeaders(): HeadersInit {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Content-Type': 'application/json;charset=UTF-8',
  };
}

function isPan123VideoFile(name: string) {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function shouldTreatAsPlayableFile(item: any) {
  const fileName = String(item?.FileName || '');
  const category = Number(item?.Category);
  if (category === 0) return false;
  if (isPan123VideoFile(fileName)) return true;
  if (category === 2) return true;
  // 某些 123 分享返回的 Category 不稳定，只要不是目录且有文件标识，就作为候选文件
  return Boolean(item?.FileId && fileName);
}

function decodeJwtExp(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function assertSafe(value: string, label: string) {
  const normalized = value.trim();
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) > 255) {
      throw new Error(`${label} 含有非法字符，请检查是否包含中文标点或说明文字`);
    }
  }
  return normalized;
}

export function normalizePan123Account(value: string) {
  return assertSafe(value, '123网盘账号');
}

export function normalizePan123Password(value: string) {
  return assertSafe(value, '123网盘密码');
}

export function parsePan123ShareUrl(url: string, passcode = ''): { shareKey: string; sharePwd: string } {
  let panUrl = decodeURIComponent(url.trim()).replace(/[#.,，/\s]+$/, '');
  let sharePwd = passcode || '';

  try {
    const parsed = new URL(panUrl);
    if (!sharePwd) {
      sharePwd = parsed.searchParams.get('pwd') || parsed.searchParams.get('password') || '';
    }
    panUrl = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // ignore url parse error, continue with regex fallback
  }

  const pwdMatch = panUrl.match(/[;，,\s]+[\u63d0\u53d6\u7801:：\s]*([a-zA-Z0-9]{4})/);
  if (!sharePwd && pwdMatch?.[1]) {
    sharePwd = pwdMatch[1];
    panUrl = panUrl.substring(0, pwdMatch.index);
  } else if (!sharePwd && panUrl.includes('?')) {
    sharePwd = panUrl.slice(-4);
    panUrl = panUrl.split('?')[0];
  } else if (!sharePwd && panUrl.includes('码')) {
    sharePwd = panUrl.slice(-4);
    const firstChinese = panUrl.match(/[\u4e00-\u9fa5]/);
    if (firstChinese?.index != null) {
      panUrl = panUrl.slice(0, firstChinese.index);
    }
  }

  const regex = /https:\/\/(www\.)?123(684|865|912|pan)\.(com|cn)\/s\/([^\\/]+)/;
  const matches = regex.exec(panUrl);
  if (!matches?.[4]) {
    throw new Error('无法解析123网盘分享链接');
  }
  const shareKey = matches[4];
  return { shareKey, sharePwd };
}

async function parseJsonResponse<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`123网盘接口返回异常：${text.slice(0, 200)}`);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function clearPan123AuthCache(account: string, password: string) {
  authStore.delete(makeCacheKey(normalizePan123Account(account), normalizePan123Password(password)));
}

async function loginPan123(account: string, password: string): Promise<string> {
  const safeAccount = normalizePan123Account(account);
  const safePassword = normalizePan123Password(password);
  const cacheKey = makeCacheKey(safeAccount, safePassword);
  pruneAuthStore();
  const cached = authStore.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      ...baseHeaders(),
      'App-Version': '43',
      Referer:
        'https://login.123pan.com/centerlogin?redirect_url=https%3A%2F%2Fwww.123684.com&source_page=website',
    },
    body: JSON.stringify({
      passport: safeAccount,
      password: safePassword,
      remember: true,
    }),
    cache: 'no-store',
  });
  const data = await parseJsonResponse<any>(response);
  const token = String(data?.data?.token || '');
  if (!response.ok || !token) {
    throw new Error(data?.message || data?.msg || '123网盘登录失败');
  }

  const exp = decodeJwtExp(token);
  authStore.set(cacheKey, {
    token,
    expiresAt: exp && exp > Date.now() ? exp : Date.now() + LOGIN_TTL_MS,
  });
  return token;
}

async function fetchSharePage(
  shareKey: string,
  sharePwd: string,
  next: string | number = 0,
  parentFileId = 0,
  depth = 0
): Promise<any> {
  const query = new URLSearchParams({
    limit: '100',
    next: String(next),
    orderBy: 'file_name',
    orderDirection: 'asc',
    shareKey,
    SharePwd: sharePwd || '',
    ParentFileId: String(parentFileId),
    Page: '1',
  });
  const url = `${SHARE_API_BASE}get?${query.toString()}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: baseHeaders(),
        cache: 'no-store',
      },
      SHARE_PAGE_TIMEOUT_MS
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`123网盘目录请求超时（parentFileId=${parentFileId}, next=${next}, depth=${depth}）`);
    }
    throw error;
  }
  const data = await parseJsonResponse<any>(response);
  if (!response.ok) {
    throw new Error(data?.message || data?.msg || `123网盘接口请求失败 (${response.status})`);
  }
  return data?.data || null;
}

async function collectPan123FilesRecursive(
  shareKey: string,
  sharePwd: string,
  parentFileId = 0,
  fileNameState?: { value: string },
  state?: {
    visitedNodes: number;
    seenFolderIds: Set<string>;
    seenFileIds: Set<string>;
    seenPageKeys: Set<string>;
  },
  depth = 0
): Promise<Pan123ShareVideoFile[]> {
  const files: Pan123ShareVideoFile[] = [];
  let next: string | number = 0;
  let hasMore = true;
  const traverseState = state || {
    visitedNodes: 0,
    seenFolderIds: new Set<string>(),
    seenFileIds: new Set<string>(),
    seenPageKeys: new Set<string>(),
  };
  const parentFolderKey = String(parentFileId);

  if (depth > MAX_TRAVERSE_DEPTH) {
    throw new Error(`123网盘目录层级过深，已超过限制（${MAX_TRAVERSE_DEPTH}）`);
  }

  if (depth > 0) {
    if (traverseState.seenFolderIds.has(parentFolderKey)) {
      return files;
    }
    traverseState.seenFolderIds.add(parentFolderKey);
  }

  while (hasMore) {
    const pageKey = `${parentFolderKey}:${String(next)}`;
    if (traverseState.seenPageKeys.has(pageKey)) {
      break;
    }
    traverseState.seenPageKeys.add(pageKey);

    const data: any = await fetchSharePage(shareKey, sharePwd, next, parentFileId, depth);
    if (!data) break;

    const infoList = Array.isArray(data.InfoList) ? data.InfoList : [];
    traverseState.visitedNodes += infoList.length;
    if (traverseState.visitedNodes > MAX_TRAVERSE_NODES) {
      throw new Error(`123网盘遍历节点过多，已超过限制（${MAX_TRAVERSE_NODES}）`);
    }
    const childFolders: Array<string | number> = [];
    const queuedChildFolderIds = new Set<string>();

    infoList.forEach((item: any) => {
      const fileName = String(item.FileName || '');
      const itemFileId = String(item.FileId || '');
      if (fileNameState && !fileNameState.value) {
        fileNameState.value = fileName;
      }

      if (Number(item.Category) === 0) {
        if (!itemFileId) return;
        if (traverseState.seenFolderIds.has(itemFileId) || queuedChildFolderIds.has(itemFileId)) {
          return;
        }
        queuedChildFolderIds.add(itemFileId);
        childFolders.push(itemFileId);
        return;
      }

      if (shouldTreatAsPlayableFile(item)) {
        if (!itemFileId) return;
        if (traverseState.seenFileIds.has(itemFileId)) {
          return;
        }
        traverseState.seenFileIds.add(itemFileId);
        files.push({
          shareKey,
          fileId: itemFileId,
          s3KeyFlag: String(item.S3KeyFlag || ''),
          size: Number(item.Size || 0),
          etag: String(item.Etag || ''),
          fileName,
        });
      }
    });

    const nestedFiles = await Promise.all(
      childFolders.map((folderId) =>
        collectPan123FilesRecursive(
          shareKey,
          sharePwd,
          Number(folderId),
          fileNameState,
          traverseState,
          depth + 1
        )
      )
    );
    files.push(...nestedFiles.flat());

    const nextCursor: string | number | null | undefined = data.Next;
    if (nextCursor === undefined || nextCursor === null || nextCursor === '' || nextCursor === -1 || nextCursor === '0' || nextCursor === 0) {
      hasMore = false;
    } else {
      next = nextCursor;
    }
  }

  return files;
}

export async function listPan123ShareVideos(shareUrl: string, passcode = ''): Promise<Pan123ShareListResult> {
  const { shareKey, sharePwd } = parsePan123ShareUrl(shareUrl, passcode);
  const fileNameState = { value: '' };
  const files = (await collectPan123FilesRecursive(shareKey, sharePwd, 0, fileNameState))
    .filter((file) => file.fileId)
    .sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));

  if (files.length === 0) {
    throw new Error('123网盘分享中没有视频文件');
  }

  return {
    title: fileNameState.value || (files.length === 1 ? files[0].fileName.replace(/\.[^.]+$/, '') : '123网盘立即播放'),
    files,
  };
}

function decodePan123DownloadUrl(downloadUrl: string) {
  const query = downloadUrl.split('?')[1] || '';
  const params = new URLSearchParams(query);
  const encoded = params.get('params') || '';
  if (!encoded) return downloadUrl;
  return Buffer.from(encoded, 'base64').toString('utf8');
}

export async function getPan123PlayInfo(
  file: Pan123ShareVideoFile,
  account: string,
  password: string
): Promise<{ url: string; qualities: Array<{ name: string; url: string }> }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = await loginPan123(account, password);
    try {
      const downloadResp = await fetch(`${SHARE_API_BASE}download/info`, {
        method: 'POST',
        headers: {
          ...baseHeaders(),
          Authorization: `Bearer ${token}`,
          platform: 'android',
        },
        body: JSON.stringify({
          ShareKey: file.shareKey,
          FileID: file.fileId,
          S3KeyFlag: file.s3KeyFlag,
          Size: file.size,
          Etag: file.etag,
        }),
        cache: 'no-store',
      });
      const downloadData = await parseJsonResponse<any>(downloadResp);
      if (!downloadResp.ok) {
        throw new Error(downloadData?.message || downloadData?.msg || `123网盘播放接口请求失败 (${downloadResp.status})`);
      }

      const rawUrl = String(downloadData?.data?.DownloadURL || '');
      const originalUrl = rawUrl ? decodePan123DownloadUrl(rawUrl) : '';

      const transcodeResp = await fetch(
        `${VIDEO_API_BASE}play/info?${new URLSearchParams({
          etag: file.etag,
          size: String(file.size),
          from: '1',
          shareKey: file.shareKey,
        }).toString()}`,
        {
          headers: {
            ...baseHeaders(),
            Authorization: `Bearer ${token}`,
            platform: 'android',
          },
          cache: 'no-store',
        }
      );
      const transcodeData = await parseJsonResponse<any>(transcodeResp);
      const qualities = Array.isArray(transcodeData?.data?.video_play_info)
        ? transcodeData.data.video_play_info
            .filter((item: any) => item?.url)
            .sort((a: any, b: any) => Number(b.height || 0) - Number(a.height || 0))
            .map((item: any) => ({
              name: String(item.resolution || '转码'),
              url: String(item.url),
            }))
        : [];

      const allQualities = [
        ...(originalUrl ? [{ name: '原画', url: originalUrl }] : []),
        ...qualities,
      ];
      const url = allQualities[0]?.url;
      if (!url) {
        throw new Error('未获取到123网盘播放地址');
      }
      return { url, qualities: allQualities };
    } catch (error) {
      lastError = error;
      clearPan123AuthCache(account, password);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('未获取到123网盘播放地址');
}

export async function validatePan123Credentials(account: string, password: string): Promise<void> {
  await loginPan123(account, password);
}
