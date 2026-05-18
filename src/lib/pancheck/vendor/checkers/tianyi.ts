// @ts-nocheck

import { request } from './http';

export async function checkTianyi(link) {
  const { codeValue, accessCode, refererValue, error: parseError } = extractCodeFromURL(link);
  if (parseError) {
    return { valid: false, reason: '链接格式无效: ' + parseError };
  }

  try {
    const noCache = Math.random();
    let shareCodeParam = codeValue;
    if (accessCode) {
      shareCodeParam = `${codeValue}（访问码：${accessCode}）`;
    }

    const apiURL = `https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action?noCache=${noCache}&shareCode=${encodeURIComponent(shareCodeParam)}`;
    const { statusCode, body } = await request(apiURL, {
      headers: {
        Priority: 'u=1, i',
        Referer: refererValue,
        'Sec-Ch-Ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sign-Type': '1',
      },
    });

    if (statusCode !== 200) {
      return { valid: false, reason: `API返回错误状态码: ${statusCode}` };
    }

    const data = JSON.parse(body);
    if (data.shareId > 0) {
      return { valid: true, reason: '' };
    }

    const failReason = data.res_message || `无法获取分享信息 (ShareId=${data.shareId || 0})`;
    return { valid: false, reason: failReason };
  } catch (err) {
    if (err.message === '请求超时') return { valid: false, reason: '请求超时' };
    return { valid: false, reason: `检测失败: ${err.message}` };
  }
}

export function extractCodeFromURL(urlStr) {
  try {
    const u = new URL(urlStr);
    let codeValue = '';
    let accessCode = '';
    codeValue = u.searchParams.get('code') || '';

    if (!codeValue && u.pathname.startsWith('/t/')) {
      codeValue = u.pathname.replace('/t/', '').split('/')[0];
    }

    if (!codeValue && u.hash) {
      const fragment = u.hash.replace(/^#/, '');
      if (fragment.startsWith('/t/')) {
        codeValue = fragment.replace('/t/', '').split('/')[0];
      } else if (fragment.startsWith('#/t/')) {
        codeValue = fragment.replace('#/t/', '').split('/')[0];
      }
    }

    if (!codeValue) {
      return { codeValue: '', accessCode: '', refererValue: '', error: '输入URL中未找到code参数' };
    }

    const match = urlStr.match(/[（(]访问码[：:]\s*([a-zA-Z0-9]+)[）)]/);
    if (match && match[1]) {
      accessCode = match[1];
    }

    return { codeValue, accessCode, refererValue: urlStr, error: null };
  } catch (e) {
    return { codeValue: '', accessCode: '', refererValue: '', error: e.message };
  }
}
