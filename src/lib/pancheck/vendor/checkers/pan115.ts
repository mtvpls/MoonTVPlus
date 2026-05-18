// @ts-nocheck

import { request } from './http';

export async function check115(link) {
  const { shareCode, receiveCode, error: parseError } = extractParams115(link);
  if (parseError || !shareCode || !receiveCode) {
    return { valid: false, reason: parseError || (!shareCode ? '缺少分享码' : '缺少提取码') };
  }

  try {
    const apiURL = `https://115cdn.com/webapi/share/snap?share_code=${encodeURIComponent(shareCode)}&offset=0&limit=20&receive_code=${encodeURIComponent(receiveCode)}&cid=`;
    const { statusCode, body } = await request(apiURL, {
      headers: {
        Referer: `https://115cdn.com/s/${shareCode}?password=${receiveCode}&`,
        'Sec-Ch-Ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'X-Requested-With': 'XMLHttpRequest',
        Priority: 'u=1, i',
      },
    });

    if (statusCode !== 200) {
      return { valid: false, reason: `API返回错误状态码: ${statusCode}` };
    }

    const data = JSON.parse(body);
    if (data.state === true && data.errno === 0) {
      let shareState = data.data?.share_state || 0;
      if (shareState === 0 && data.data?.shareinfo?.share_state) {
        shareState = data.data.shareinfo.share_state;
      }

      if (shareState === 1) {
        return { valid: true, reason: '' };
      }

      const failReason = (data.data?.shareinfo?.forbid_reason || '').trim() || `链接状态异常(share_state=${shareState})`;
      return { valid: false, reason: failReason };
    }

    return { valid: false, reason: data.error || '未知错误' };
  } catch (err) {
    if (err.message === '请求超时') return { valid: false, reason: '请求超时' };
    return { valid: false, reason: `检测失败: ${err.message}` };
  }
}

export function extractParams115(urlStr) {
  try {
    const u = new URL(urlStr);
    const pathParts = u.pathname.replace(/\/+$/, '').split('/');
    const shareCode = pathParts[pathParts.length - 1] || '';

    let receiveCode = u.searchParams.get('password') || '';
    if (!receiveCode && u.hash && u.hash.includes('password=')) {
      const hashParams = new URLSearchParams(u.hash.replace(/^#/, ''));
      receiveCode = hashParams.get('password') || '';
    }

    return { shareCode, receiveCode, error: null };
  } catch (e) {
    return { shareCode: '', receiveCode: '', error: e.message };
  }
}
