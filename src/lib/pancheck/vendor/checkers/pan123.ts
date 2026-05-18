// @ts-nocheck

import { request } from './http';

export async function check123(link) {
  const { shareKey, error: parseError } = extractShareKey123(link);
  if (parseError) {
    return { valid: false, reason: '链接格式无效: ' + parseError };
  }

  try {
    const apiURL = `https://www.123pan.com/api/share/info?shareKey=${encodeURIComponent(shareKey)}`;
    const { statusCode, body } = await request(apiURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (statusCode === 403) return { valid: true, reason: '' };
    if (statusCode !== 200) return { valid: true, reason: '' };

    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      return { valid: true, reason: '' };
    }

    if (data.code === 0 || data.data?.HasPwd === true) {
      return { valid: true, reason: '' };
    }

    return { valid: false, reason: '链接已失效' };
  } catch (_) {
    return { valid: true, reason: '' };
  }
}

export function extractShareKey123(urlStr) {
  const patterns = [
    /https?:\/\/(?:www\.)?(?:123684|123685|123912|123pan|123592|123865)\.com\/s\/([a-zA-Z0-9-]+)/,
    /https?:\/\/(?:www\.)?123pan\.cn\/s\/([a-zA-Z0-9-]+)/,
  ];

  for (const pattern of patterns) {
    const match = urlStr.match(pattern);
    if (match && match[1]) {
      return { shareKey: match[1], error: null };
    }
  }

  try {
    const u = new URL(urlStr);
    const pathParts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (pathParts.length > 0 && pathParts[pathParts.length - 1]) {
      return { shareKey: pathParts[pathParts.length - 1], error: null };
    }
  } catch (_) {}

  return { shareKey: '', error: '无法从URL中提取shareKey' };
}
