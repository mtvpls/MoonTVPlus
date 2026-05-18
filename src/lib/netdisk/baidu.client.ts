/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from 'crypto';

import type { BaiduNetdiskSessionFile, BaiduNetdiskSessionMeta } from './baidu-session-cache';

export interface BaiduShareListResult {
  title: string;
  files: BaiduNetdiskSessionFile[];
  meta: BaiduNetdiskSessionMeta;
  cookie: string;
}

const API_BASE = 'https://pan.baidu.com/';
const VIDEO_EXTS = [
  '.mp4', '.mkv', '.avi', '.rmvb', '.mov', '.flv', '.wmv', '.webm', '.3gp', '.mpeg', '.mpg', '.ts', '.mts', '.m2ts', '.vob', '.divx', '.xvid', '.m4v', '.ogv', '.f4v', '.rm', '.asf', '.dat', '.dv', '.m2v',
];

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

export function normalizeBaiduCookie(cookie: string): string {
  return cookie.replace(/；/g, ';').replace(/：/g, ':').replace(/，/g, ',').trim();
}

export function assertBaiduCookieHeaderSafe(cookie: string): string {
  const normalized = normalizeBaiduCookie(cookie);
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) > 255) {
      throw new Error('百度网盘 Cookie 含有非法字符，请确认没有中文标点、中文空格或说明文字');
    }
  }
  return normalized;
}

export function parseBaiduShareUrl(url: string, passcode = ''): { shareId: string; sharePwd: string } {
  const decoded = decodeURIComponent(url).replace(/\s+/g, '');
  const match = decoded.match(/pan\.baidu\.com\/(s\/|wap\/init\?surl=)([^?&#]+)/);
  if (!match) {
    throw new Error('无法解析百度网盘分享链接');
  }
  const shareId = match[2].replace(/^1+/, '').split('?')[0].split('#')[0];
  const pwdMatch = decoded.match(/(提取码|密码|pwd)=([^&\s]{4})/i);
  return { shareId, sharePwd: passcode || pwdMatch?.[2] || '' };
}

function getBaseHeaders(cookie: string): HeadersInit {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Encoding': 'gzip',
    Referer: 'https://pan.baidu.com',
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: assertBaiduCookieHeaderSafe(cookie),
  };
}

function mergeCookie(cookie: string, key: string, value: string): string {
  let next = cookie.replace(new RegExp(`${key}=[^;]*;?\\s*`, 'g'), '');
  if (next.length > 0 && !next.trim().endsWith(';')) next += '; ';
  next += `${key}=${value}`;
  return next;
}

async function requestApi(
  path: string,
  {
    cookie,
    data = {},
    method = 'post',
    extraHeaders = {},
    retry = 2,
  }: {
    cookie: string;
    data?: Record<string, any>;
    method?: 'get' | 'post';
    extraHeaders?: Record<string, string>;
    retry?: number;
  }
): Promise<any> {
  const headers = { ...getBaseHeaders(cookie), ...extraHeaders };
  const objectToQuery = (obj: Record<string, any>) =>
    Object.entries(obj)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');

  try {
    const url = `${API_BASE}${path}`;
    const response = await fetch(method === 'get' ? `${url}${objectToQuery(data) ? `?${objectToQuery(data)}` : ''}` : url, {
      method: method.toUpperCase(),
      headers,
      body: method === 'post' ? objectToQuery(data) : undefined,
      cache: 'no-store',
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`百度网盘接口返回异常：${text.slice(0, 200)}`);
    }
  } catch (error) {
    if (retry > 0) {
      await new Promise((resolve) => setTimeout(resolve, (3 - retry) * 1000));
      return requestApi(path, { cookie, data, method, extraHeaders, retry: retry - 1 });
    }
    throw error;
  }
}

async function getUid(cookie: string): Promise<string | null> {
  try {
    const response = await fetch(
      'https://mbd.baidu.com/userx/v1/info/get?appname=baiduboxapp&fields=%5B%22bg_image%22,%22member%22,%22uid%22,%22avatar%22,%22avatar_member%22%5D&client&clientfrom&lang=zh-cn&tpl&ttt',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Cookie: assertBaiduCookieHeaderSafe(cookie),
        },
        cache: 'no-store',
      }
    );
    const data = await response.json();
    return data?.data?.fields?.uid || null;
  } catch {
    return null;
  }
}

async function verifyShare(share: { shareId: string; sharePwd: string }, cookie: string) {
  const result = await requestApi(`share/verify?t=${Date.now()}&surl=${share.shareId}`, {
    cookie,
    data: { pwd: share.sharePwd || '' },
    method: 'post',
  });
  if (result?.errno !== 0) {
    throw new Error(result?.errmsg || result?.show_msg || '验证百度网盘分享失败');
  }
  const nextCookie = result?.randsk ? mergeCookie(cookie, 'BDCLND', result.randsk) : cookie;
  return { result, cookie: nextCookie };
}

async function getShareToken(share: { shareId: string; sharePwd: string }, cookie: string) {
  const verified = await verifyShare(share, cookie);
  const listData = await requestApi('share/list', {
    cookie: verified.cookie,
    data: {
      shorturl: share.shareId,
      root: 1,
      page: 1,
      num: 100,
    },
    method: 'get',
  });
  if (listData?.errno !== 0) {
    throw new Error(listData?.errmsg || listData?.show_msg || '获取百度网盘文件列表失败');
  }
  return {
    cookie: verified.cookie,
    meta: {
      uk: String(listData.uk || listData.share_uk || ''),
      shareid: String(listData.share_id || verified.result?.share_id || ''),
      randsk: String(verified.result?.randsk || ''),
      shareId: share.shareId,
    },
    rootList: Array.isArray(listData.list) ? listData.list : [],
  };
}

async function listShareDirectory(
  cookie: string,
  meta: BaiduNetdiskSessionMeta,
  dirPath: string,
  dirFsId: string
): Promise<any[]> {
  const shareDir = `/sharelink${meta.shareid}-${dirFsId}${dirPath}`;
  const data = await requestApi('share/list', {
    cookie,
    data: {
      sekey: meta.randsk,
      uk: meta.uk,
      shareid: meta.shareid,
      page: 1,
      num: 100,
      dir: shareDir,
    },
    method: 'get',
  });
  if (data?.errno !== 0 || !Array.isArray(data?.list)) return [];
  return data.list;
}

async function collectVideosFromList(
  cookie: string,
  meta: BaiduNetdiskSessionMeta,
  list: any[],
  parentPath = ''
): Promise<BaiduNetdiskSessionFile[]> {
  const videos: BaiduNetdiskSessionFile[] = [];
  for (const item of list) {
    if (item.isdir === 1 || item.isdir === '1') {
      const dirPath = `${parentPath}/${item.server_filename}`;
      const nested = await listShareDirectory(cookie, meta, dirPath, String(item.fs_id));
      videos.push(...(await collectVideosFromList(cookie, meta, nested, dirPath)));
      continue;
    }
    const name = String(item.server_filename || '');
    const ext = name.substring(name.lastIndexOf('.') || 0).toLowerCase();
    if (!VIDEO_EXTS.includes(ext)) continue;
    videos.push({
      fid: String(item.fs_id),
      name,
      size: Number(item.size || 0),
      path: parentPath,
    });
  }
  return videos;
}

export async function listBaiduShareVideos(shareUrl: string, cookie: string, passcode = ''): Promise<BaiduShareListResult> {
  const safeCookie = assertBaiduCookieHeaderSafe(cookie);
  const share = parseBaiduShareUrl(shareUrl, passcode);
  const tokenData = await getShareToken(share, safeCookie);
  const files = await collectVideosFromList(tokenData.cookie, tokenData.meta, tokenData.rootList);
  if (files.length === 0) {
    throw new Error('百度网盘分享中没有视频文件');
  }
  return {
    title: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '百度网盘立即播放',
    files,
    meta: tokenData.meta,
    cookie: tokenData.cookie,
  };
}

export async function getBaiduDirectPlayUrl(
  meta: BaiduNetdiskSessionMeta,
  fid: string,
  cookie: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const uid = await getUid(cookie);
  if (!uid) {
    throw new Error('获取百度网盘 UID 失败');
  }
  const devuid = '73CED981D0F186D12BC18CAE1684FFD5|VSRCQTF6W';
  const time = String(Date.now());
  const bduss = assertBaiduCookieHeaderSafe(cookie).match(/BDUSS=([^;]+)/)?.[1];
  if (!bduss) {
    throw new Error('百度网盘 Cookie 缺少 BDUSS');
  }
  const rand = sha1(
    sha1(bduss) + uid + 'ebrcUYiuxaZv2XGu7KIYKxUrqfnOfpDF' + time + devuid + '11.30.2ae5821440fab5e1a61a025f014bd8972'
  );
  const path = `share/list?shareid=${meta.shareid}&uk=${meta.uk}&fid=${fid}&sekey=${encodeURIComponent(meta.randsk)}&origin=dlna&devuid=${encodeURIComponent(devuid)}&clienttype=1&channel=android_12_zhao_bd-netdisk_1024266h&version=11.30.2&time=${time}&rand=${rand}`;
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'User-Agent': 'netdisk;P2SP;2.2.91.136;android-android;',
      Cookie: cookie,
    },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  const url = data?.list?.[0]?.dlink;
  if (!url) {
    throw new Error(data?.errmsg || data?.show_msg || '获取百度网盘播放地址失败');
  }
  return {
    url,
    headers: {
      'User-Agent': 'netdisk;P2SP;2.2.91.136;android-android;',
      Referer: 'https://pan.baidu.com',
    },
  };
}
