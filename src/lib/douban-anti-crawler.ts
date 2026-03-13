import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

/**
 * Cookie 缓存
 */
interface CookieCache {
  cookie: string;
  expiresAt: number;
}

let cookieCache: CookieCache | null = null;

/**
 * 从 Set-Cookie header 中提取 cookie 值
 */
function extractCookieValue(setCookieHeader: string): string {
  // 提取 dbsawcv1 的值
  const match = setCookieHeader.match(/dbsawcv1=([^;]+)/);
  if (match) {
    return `dbsawcv1=${match[1]}`;
  }
  return setCookieHeader.split(';')[0];
}

/**
 * 检查缓存的 cookie 是否有效
 */
function isCookieCacheValid(): boolean {
  if (!cookieCache) {
    return false;
  }
  // 提前 20 秒过期，确保不会在使用时过期
  return Date.now() < cookieCache.expiresAt - 20000;
}

/**
 * 计算 SHA-512 哈希值
 */
function sha512(data: string): string {
  return createHash('sha512').update(data).digest('hex');
}

/**
 * 工作量证明算法 - 寻找满足难度要求的 nonce
 * @param data 要哈希的数据
 * @param difficulty 难度（前导零的数量）
 * @returns 满足条件的 nonce
 */
function proofOfWork(data: string, difficulty = 4): number {
  let nonce = 0;
  const targetSubStr = '0'.repeat(difficulty);

  while (true) {
    nonce += 1;
    const hash = sha512(data + nonce);
    if (hash.startsWith(targetSubStr)) {
      return nonce;
    }
  }
}

/**
 * 解析豆瓣验证页面，提取表单数据
 */
function parseVerificationPage(html: string): {
  tok: string;
  cha: string;
  red: string;
} | null {
  const $ = cheerio.load(html);

  const tok = $('#tok').val() as string;
  const cha = $('#cha').val() as string;
  const red = $('#red').val() as string;

  if (!tok || !cha || !red) {
    console.error('Failed to extract verification form data');
    return null;
  }

  return { tok, cha, red };
}

/**
 * 获取豆瓣访问 cookie（处理反爬验证）
 * @param url 要访问的豆瓣 URL
 * @param forceRefresh 是否强制刷新 cookie
 * @returns cookie 字符串
 */
export async function getDoubanCookie(
  url: string,
  forceRefresh = false,
): Promise<string> {
  // 检查缓存
  if (!forceRefresh && isCookieCacheValid()) {
    console.log('Using cached douban cookie');
    return cookieCache!.cookie;
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: 'https://movie.douban.com/',
  };

  try {
    // 第一步：访问目标 URL，可能会被重定向到验证页面
    const firstResponse = await fetch(url, {
      headers,
      redirect: 'manual', // 手动处理重定向
    });

    // 如果没有重定向，直接返回 cookie
    if (firstResponse.status === 200) {
      const cookies = firstResponse.headers.get('set-cookie');
      return cookies || '';
    }

    // 如果是 302 重定向到验证页面
    if (firstResponse.status === 302) {
      const location = firstResponse.headers.get('location');
      if (!location || !location.includes('sec.douban.com')) {
        throw new Error('Unexpected redirect location');
      }

      console.log('Detected anti-crawler verification, processing...');

      // 第二步：访问验证页面
      const verifyResponse = await fetch(location, {
        headers,
      });

      if (!verifyResponse.ok) {
        throw new Error(
          `Failed to fetch verification page: ${verifyResponse.status}`,
        );
      }

      const verifyHtml = await verifyResponse.text();

      // 第三步：解析验证页面，提取表单数据
      const formData = parseVerificationPage(verifyHtml);
      if (!formData) {
        throw new Error('Failed to parse verification page');
      }

      console.log('Calculating proof of work...');

      // 第四步：计算工作量证明
      const sol = proofOfWork(formData.cha, 4);

      console.log('Proof of work calculated:', sol);

      // 第五步：提交验证表单
      const formBody = new URLSearchParams({
        tok: formData.tok,
        cha: formData.cha,
        sol: sol.toString(),
        red: formData.red,
      });

      const submitResponse = await fetch('https://sec.douban.com/c', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
        redirect: 'manual', // 手动处理重定向
      });

      // 第六步：从响应中提取 cookie
      const setCookieHeader = submitResponse.headers.get('set-cookie');
      if (!setCookieHeader) {
        throw new Error('No cookie received after verification');
      }

      console.log('Successfully obtained douban cookie');

      // 提取 cookie 值并缓存（有效期 300 秒 = 5 分钟）
      const cookieValue = extractCookieValue(setCookieHeader);
      cookieCache = {
        cookie: cookieValue,
        expiresAt: Date.now() + 300000, // 5 分钟后过期
      };

      return cookieValue;
    }

    throw new Error(`Unexpected response status: ${firstResponse.status}`);
  } catch (error) {
    console.error('Failed to get douban cookie:', error);
    throw error;
  }
}

/**
 * 带反爬验证的豆瓣请求
 * @param url 要访问的豆瓣 URL
 * @param options fetch 选项
 * @returns Response 对象
 */
export async function fetchDoubanWithVerification(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: 'https://movie.douban.com/',
    ...options.headers,
  };

  try {
    // 如果有缓存的 cookie，先尝试使用
    if (isCookieCacheValid()) {
      console.log('Trying with cached cookie...');
      const response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          Cookie: cookieCache!.cookie,
        },
      });

      // 如果成功，直接返回
      if (response.ok) {
        console.log('Request succeeded with cached cookie');
        return response;
      }

      // 如果失败，清除缓存并继续
      console.log('Cached cookie failed, will obtain new one');
      cookieCache = null;
    }

    // 尝试直接访问（不带 cookie）
    let response = await fetch(url, {
      ...options,
      headers,
      redirect: 'manual',
    });

    // 如果被重定向到验证页面，获取 cookie 后重试
    if (response.status === 302) {
      const location = response.headers.get('location');
      if (location && location.includes('sec.douban.com')) {
        console.log('Anti-crawler detected, obtaining cookie...');

        // 获取验证 cookie（会自动缓存）
        const cookie = await getDoubanCookie(url);

        // 使用 cookie 重新请求
        response = await fetch(url, {
          ...options,
          headers: {
            ...headers,
            Cookie: cookie,
          },
        });
      }
    }

    return response;
  } catch (error) {
    console.error('Failed to fetch douban with verification:', error);
    throw error;
  }
}
