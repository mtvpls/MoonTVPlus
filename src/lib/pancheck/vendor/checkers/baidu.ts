// @ts-nocheck

import { request } from './http';

export async function checkBaidu(link) {
  const normalizedLink = normalizeBaiduURL(link);
  if (!normalizedLink) {
    return { valid: false, reason: '未找到有效的百度网盘URL' };
  }

  const surl = extractBaiduShareID(normalizedLink);
  if (!surl) {
    return { valid: false, reason: '无效的分享链接格式' };
  }

  let password = '';
  try {
    const u = new URL(normalizedLink);
    password = u.searchParams.get('pwd') || '';
  } catch (_) {}

  const shorturl = surl.length > 1 ? surl.substring(1) : surl;

  try {
    let bdclnd = '';
    if (password) {
      const verifyURL = `https://pan.baidu.com/share/verify?surl=${encodeURIComponent(shorturl)}&pwd=${encodeURIComponent(password)}`;
      const formBody = `pwd=${encodeURIComponent(password)}&vcode=&vcode_str=`;
      const { statusCode: vStatus, body: vBody } = await request(verifyURL, {
        method: 'POST',
        body: formBody,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: normalizedLink,
        },
      });

      if (vStatus !== 200) {
        return { valid: false, reason: `验证提取码请求失败: ${vStatus}` };
      }

      const vData = JSON.parse(vBody);
      if (vData.errno !== 0) {
        const errmsg = vData.errmsg || vData.err_msg || '未知错误';
        return { valid: false, reason: `验证提取码失败: errno=${vData.errno}, ${errmsg}` };
      }
      bdclnd = vData.randsk || '';
    }

    const apiURL = `https://pan.baidu.com/share/list?web=5&app_id=250528&desc=1&showempty=0&page=1&num=20&order=time&shorturl=${encodeURIComponent(shorturl)}&root=1&view_mode=1&channel=chunlei&web=1&clienttype=0`;
    const reqHeaders = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,zh-CN;q=0.6',
    };
    if (bdclnd) {
      reqHeaders.Cookie = `BDCLND=${bdclnd}`;
    }

    const { statusCode, body } = await request(apiURL, { headers: reqHeaders });
    if (statusCode !== 200) {
      return { valid: false, reason: `API返回错误状态码: ${statusCode}` };
    }

    const result = JSON.parse(body);
    const errno = result.errno;
    const errMsg = result.errmsg || result.err_msg || '';
    if (errno === 0) {
      return { valid: true, reason: '' };
    }

    const failureReason = getFailureReason(errno, errMsg);
    const isRateLimited = errno === -62;
    return { valid: false, reason: failureReason, isRateLimited };
  } catch (err) {
    if (err.message === '请求超时') return { valid: false, reason: '请求超时' };
    return { valid: false, reason: `检测失败: ${err.message}` };
  }
}

export function normalizeBaiduURL(link) {
  const cleaned = link.trim();
  const startIdx = cleaned.indexOf('https://pan.baidu.com/s/');
  if (startIdx === -1) return null;
  let endIdx = startIdx;
  while (endIdx < cleaned.length) {
    const char = cleaned[endIdx];
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') break;
    if (cleaned.substring(endIdx).startsWith('提取码') || cleaned.substring(endIdx).startsWith('密码')) break;
    endIdx++;
  }
  return cleaned.substring(startIdx, endIdx).trim();
}

export function extractBaiduShareID(shareURL) {
  try {
    const u = new URL(shareURL);
    if (u.pathname.startsWith('/s/')) {
      let surl = u.pathname.replace('/s/', '');
      const qIdx = surl.indexOf('?');
      if (qIdx !== -1) surl = surl.substring(0, qIdx);
      return surl;
    }
    if (u.pathname.startsWith('/share/init')) {
      return u.searchParams.get('surl') || '';
    }
  } catch (_) {}
  return '';
}

function getFailureReason(errno, errMsg) {
  if (errMsg) return `分享链接无效 (errno: ${errno}, err_msg: ${errMsg})`;
  switch (errno) {
    case -12: return '缺少提取码 (errno: -12)';
    case -9: return '提取码错误 (errno: -9)';
    case -62: return '请求接口受限 (errno: -62)';
    case -8: return '分享文件已过期 (errno: -8)';
    default: return `分享链接无效 (errno: ${errno})`;
  }
}
