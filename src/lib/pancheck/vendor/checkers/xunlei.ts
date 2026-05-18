// @ts-nocheck

import crypto from 'crypto';
import zlib from 'zlib';
import { request } from './http';

const XUNLEI_DEVICE_ID = '5505bd0cab8c9469b98e5891d9fb3e0d';
const XUNLEI_CLIENT_ID = 'ZUBzD9J_XPXfn7f7';
const XUNLEI_CLIENT_VERSION = '1.10.0.2633';
const XUNLEI_PACKAGE_NAME = 'com.xunlei.browser';
const XUNLEI_UA = 'ANDROID-com.xunlei.browser/1.10.0.2633 networkType/WIFI appid/22062 deviceName/Xiaomi_M2004j7ac deviceModel/M2004J7AC OSVersion/13 protocolVersion/301 platformVersion/10 sdkVersion/233100 Oauth2Client/0.9 (Linux 4_9_337-perf-sn-uotan-gd9d488809c3d3d) (JAVA 0)';

const CAPTCHA_ALGORITHMS = [
  'uWRwO7gPfdPB/0NfPtfQO+71',
  'F93x+qPluYy6jdgNpq+lwdH1ap6WOM+nfz8/V',
  '0HbpxvpXFsBK5CoTKam',
  'dQhzbhzFRcawnsZqRETT9AuPAJ+wTQso82mRv',
  'SAH98AmLZLRa6DB2u68sGhyiDh15guJpXhBzI',
  'unqfo7Z64Rie9RNHMOB',
  '7yxUdFADp3DOBvXdz0DPuKNVT35wqa5z0DEyEvf',
  'RBG',
  'ThTWPG5eC0UBqlbQ+04nZAptqGCdpv9o55A',
];

export function getCaptchaSign(clientID, clientVersion, packageName, deviceID) {
  const timestamp = Date.now().toString();
  let str = `${clientID}${clientVersion}${packageName}${deviceID}${timestamp}`;
  for (const algorithm of CAPTCHA_ALGORITHMS) {
    str = crypto.createHash('md5').update(str + algorithm).digest('hex');
  }
  return { timestamp, sign: `1.${str}` };
}

export async function getCaptchaToken(action, metas = {}) {
  const { timestamp, sign: captchaSign } = getCaptchaSign(
    XUNLEI_CLIENT_ID, XUNLEI_CLIENT_VERSION, XUNLEI_PACKAGE_NAME, XUNLEI_DEVICE_ID
  );

  metas.timestamp = timestamp;
  metas.captcha_sign = captchaSign;
  metas.client_version = XUNLEI_CLIENT_VERSION;
  metas.package_name = XUNLEI_PACKAGE_NAME;

  const { statusCode, body, headers } = await request(
    'https://xluser-ssl.xunlei.com/v1/shield/captcha/init',
    {
      method: 'POST',
      body: {
        action,
        captcha_token: '',
        client_id: XUNLEI_CLIENT_ID,
        device_id: XUNLEI_DEVICE_ID,
        meta: metas,
        redirect_uri: 'xlaccsdk01://xunlei.com/callback?state=harbor',
      },
      headers: {
        Accept: 'application/json;charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': XUNLEI_UA,
        'X-Device-Id': XUNLEI_DEVICE_ID,
        'X-Client-Id': XUNLEI_CLIENT_ID,
        'X-Client-Version': XUNLEI_CLIENT_VERSION,
      },
    }
  );

  if (statusCode !== 200) {
    throw new Error(`验证码token请求失败，状态码: ${statusCode}`);
  }

  let respBody = body;
  const encoding = (headers['content-encoding'] || '').toLowerCase();
  if (encoding === 'gzip') {
    respBody = zlib.gunzipSync(Buffer.from(body, 'binary')).toString('utf-8');
  } else if (encoding === 'deflate') {
    respBody = zlib.inflateSync(Buffer.from(body, 'binary')).toString('utf-8');
  }

  const data = JSON.parse(respBody);
  if (data.url) throw new Error(`需要验证: ${data.url}`);
  if (!data.captcha_token) throw new Error('未获取到验证码token');
  return data.captcha_token;
}

export async function checkXunlei(link) {
  const shareID = extractShareID(link);
  if (!shareID) {
    return { valid: false, reason: '链接格式无效：无法提取share_id' };
  }

  let passCode = '';
  try {
    const u = new URL(link);
    passCode = u.searchParams.get('pwd') || '';
  } catch (_) {}

  try {
    let captchaToken = '';
    try {
      captchaToken = await getCaptchaToken('get:/drive/v1/share', {
        username: '',
        phone_number: '',
        email: '',
        package_name: 'pan.xunlei.com',
        client_version: '1.92.10',
        user_id: '0',
      });
    } catch (_) {}

    const apiURL = `https://api-pan.xunlei.com/drive/v1/share?share_id=${encodeURIComponent(shareID)}&pass_code=${encodeURIComponent(passCode)}&limit=100&pass_code_token=&page_token=&thumbnail_size=SIZE_SMALL`;
    const reqHeaders = {
      Accept: '*/*',
      'Content-Type': 'application/json',
      Origin: 'https://pan.xunlei.com',
      Referer: 'https://pan.xunlei.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Accept-Encoding': 'gzip, deflate',
      'X-Client-Id': XUNLEI_CLIENT_ID,
      'X-Device-Id': XUNLEI_DEVICE_ID,
    };
    if (captchaToken) {
      reqHeaders['X-Captcha-Token'] = captchaToken;
    }

    const { statusCode, body, headers } = await request(apiURL, { headers: reqHeaders });
    let respBody = body;
    const encoding = (headers['content-encoding'] || '').toLowerCase();
    if (encoding === 'gzip') {
      respBody = zlib.gunzipSync(Buffer.from(body, 'binary')).toString('utf-8');
    } else if (encoding === 'deflate') {
      respBody = zlib.inflateSync(Buffer.from(body, 'binary')).toString('utf-8');
    }

    if (statusCode !== 200) {
      try {
        const errData = JSON.parse(respBody);
        return {
          valid: false,
          reason: `HTTP状态码: ${statusCode}, 响应: ${respBody}`,
          isRateLimited: errData.error_code === 9,
        };
      } catch (_) {
        return { valid: false, reason: `HTTP状态码: ${statusCode}` };
      }
    }

    const apiResp = JSON.parse(respBody);
    if (apiResp.share_status === 'OK') return { valid: true, reason: '' };
    if (apiResp.error) return { valid: false, reason: apiResp.error };
    return { valid: false, reason: apiResp.share_status_text || `分享状态: ${apiResp.share_status}` };
  } catch (err) {
    if (err.message === '请求超时') return { valid: true, reason: '' };
    return { valid: false, reason: `检测失败: ${err.message}` };
  }
}

export function extractShareID(shareURL) {
  const match = shareURL.match(/pan\.xunlei\.com\/s\/([^?/#]+)/);
  return match ? match[1] : '';
}
