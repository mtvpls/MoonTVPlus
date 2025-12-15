/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * TVBOX订阅解析器
 * 用于解析TVBOX格式的订阅源并提取CMS API
 */

import { ApiSite } from './config';

// TVBOX订阅中的站点定义
interface TvboxSite {
  key: string;
  name: string;
  type: number; // 1=CMS API, 0=其他
  api: string;
  searchable?: number;
  quickSearch?: number;
  filterable?: number;
  ext?: string;
}

// TVBOX订阅格式
interface TvboxSubscription {
  spider?: string;
  wallpaper?: string;
  sites: TvboxSite[];
  lives?: any[];
  parses?: any[];
  rules?: any[];
  ads?: any[];
}

/**
 * 从URL获取TVBOX订阅内容
 * 支持多种格式：
 * 1. 纯 JSON
 * 2. 图片嵌入的 Base64 编码 JSON
 * 3. Base64 编码的 JSON 文本
 */
export async function fetchTvboxSubscription(url: string): Promise<TvboxSubscription> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, image/*, */*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`获取订阅失败: HTTP ${response.status}`);
    }

    let data: any;

    // 先获取为 ArrayBuffer 以正确处理二进制数据
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 尝试作为 UTF-8 文本解析
    const textContent = buffer.toString('utf-8');

    // 1. 尝试直接解析 JSON
    try {
      data = JSON.parse(textContent);
    } catch {
      // 2. 可能是图片嵌入格式，查找 JPEG 结束标记
      data = parseEmbeddedJsonFromBuffer(buffer);
    }

    if (!data || !Array.isArray(data.sites)) {
      throw new Error('订阅格式不正确，缺少sites数组');
    }

    return data as TvboxSubscription;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('获取订阅超时');
    }
    throw new Error(`获取订阅失败: ${error.message}`);
  }
}

/**
 * 从二进制 Buffer 中提取嵌入的 JSON
 * 支持：
 * 1. 图片末尾的 Base64 编码 JSON
 * 2. 纯 Base64 编码文本
 */
function parseEmbeddedJsonFromBuffer(buffer: Buffer): any {
  try {
    // 查找 JPEG 结束标记 (0xFF 0xD9)
    let jpegEndIndex = -1;
    for (let i = buffer.length - 1; i >= 1; i--) {
      if (buffer[i - 1] === 0xFF && buffer[i] === 0xD9) {
        jpegEndIndex = i;
        break;
      }
    }

    if (jpegEndIndex !== -1) {
      // 提取 JPEG 后的数据
      const afterJpeg = buffer.subarray(jpegEndIndex + 1);

      // 使用 latin1 编码读取（保留原始字节）
      const rawText = afterJpeg.toString('latin1');

      // 只保留 Base64 字符（移除换行和其他字符）
      const base64Text = rawText.replace(/[^A-Za-z0-9+/=]/g, '');

      if (base64Text.length > 100) {
        try {
          // Base64 解码
          const decoded = Buffer.from(base64Text, 'base64').toString('utf-8');

          // 查找 JSON 起始 - 查找 {\r?\n" 或 {\n" 模式
          const jsonPattern = /\{\r?\n"/;
          const match = decoded.match(jsonPattern);

          if (match && match.index !== undefined) {
            let jsonStr = decoded.substring(match.index);

            // 移除 JSON 注释（单行 // 和多行 /* */）
            jsonStr = jsonStr
              .replace(/\/\*[\s\S]*?\*\//g, '') // 移除多行注释
              .replace(/\/\/.*/g, ''); // 移除单行注释

            // JSON 解析
            const parsed = JSON.parse(jsonStr);

            if (parsed && Array.isArray(parsed.sites)) {
              return parsed;
            }
          }
        } catch (e) {
          console.error('JPEG 后 Base64 解码失败:', e);
        }
      }
    }

    // 降级：使用原有的文本解析方法
    const textContent = buffer.toString('utf-8');
    return parseEmbeddedJson(textContent);
  } catch (error: any) {
    throw new Error(`解析嵌入配置失败: ${error.message}`);
  }
}

/**
 * 从嵌入格式中提取 JSON
 * 支持：
 * 1. 图片末尾的 Base64 编码 JSON
 * 2. 纯 Base64 编码文本
 */
function parseEmbeddedJson(content: string): any {
  try {
    // 尝试查找 Base64 编码的 JSON
    // TVBOX 通常将 JSON 编码后附加在图片末尾

    // 方法 1: 查找可能的 Base64 数据段
    // Base64 数据通常在文件末尾，以换行符分隔
    const lines = content.split('\n');

    // 从后向前查找可能的 Base64 编码行
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();

      // 跳过空行和太短的行
      if (!line || line.length < 100) continue;

      // 检查是否看起来像 Base64（只包含 Base64 字符集）
      if (!/^[A-Za-z0-9+/=]+$/.test(line)) continue;

      try {
        // 尝试 Base64 解码
        const decoded = Buffer.from(line, 'base64').toString('utf-8');

        // 尝试解析为 JSON
        const parsed = JSON.parse(decoded);

        // 验证是否是有效的 TVBOX 配置
        if (parsed && Array.isArray(parsed.sites)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }

    // 方法 2: 尝试将整个内容作为 Base64 解码
    try {
      const decoded = Buffer.from(content, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (parsed && Array.isArray(parsed.sites)) {
        return parsed;
      }
    } catch {
      // 忽略
    }

    // 方法 3: 查找 JSON 字符串的起始位置
    // 有些格式可能在二进制数据后直接附加 JSON
    const jsonStart = content.lastIndexOf('{');
    if (jsonStart !== -1) {
      try {
        const jsonStr = content.substring(jsonStart);
        const parsed = JSON.parse(jsonStr);
        if (parsed && Array.isArray(parsed.sites)) {
          return parsed;
        }
      } catch {
        // 忽略
      }
    }

    throw new Error('无法解析嵌入的配置数据');
  } catch (error: any) {
    throw new Error(`解析嵌入配置失败: ${error.message}`);
  }
}

/**
 * 从TVBOX订阅中提取CMS API源和网盘源
 * @param subscription TVBOX订阅对象
 * @returns ApiSite数组
 */
export function extractCmsApis(subscription: TvboxSubscription): ApiSite[] {
  const cmsApis: ApiSite[] = [];

  for (const site of subscription.sites) {
    // 验证必要字段
    if (!site.key || !site.name || !site.api) {
      continue;
    }

    let sourceType: 'applecms' | 'quark' | 'ali' | null = null;
    let shouldAdd = false;

    // 处理 type=1 的CMS API源
    if (site.type === 1) {
      const isAppleCms =
        site.api.includes('api.php') ||
        site.api.includes('provide/vod') ||
        site.api.includes('?ac=');

      if (isAppleCms) {
        sourceType = 'applecms';
        shouldAdd = true;
      }
    }

    // 处理 type=3 的网盘源
    if (site.type === 3) {
      // 通过 api 字段识别网盘类型
      const apiLower = site.api.toLowerCase();

      if (apiLower.includes('quark') || apiLower.includes('夸克')) {
        sourceType = 'quark';
        shouldAdd = true;

        // 解析 ext 字段中的配置
        let extConfig: any = {};
        if (site.ext) {
          try {
            // ext 可能是 JSON 字符串
            extConfig = typeof site.ext === 'string'
              ? JSON.parse(site.ext)
              : site.ext;
          } catch (e) {
            // 如果不是 JSON，保持原样
            extConfig = { raw: site.ext };
          }
        }

        // 提取分享链接列表
        let shareLinks = '';
        if (extConfig.shareUrls && Array.isArray(extConfig.shareUrls)) {
          shareLinks = extConfig.shareUrls.join('\n');
        } else if (extConfig.share_url) {
          shareLinks = extConfig.share_url;
        }

        // 注意：TVBOX type=3 源通常不包含 Cookie，需要用户后续在管理页面配置
        cmsApis.push({
          key: site.key,
          name: site.name,
          api: 'https://drive-h.quark.cn', // 使用夸克 API 地址
          detail: undefined,
          sourceType: 'quark',
          ext: shareLinks || site.ext,
        });

        continue; // 跳过后续处理
      } else if (apiLower.includes('ali') || apiLower.includes('阿里') || apiLower.includes('aliyun')) {
        sourceType = 'ali';
        // 暂不支持阿里云盘
        shouldAdd = false;
      }
    }

    if (shouldAdd && sourceType) {
      cmsApis.push({
        key: site.key,
        name: site.name,
        api: site.api,
        detail: site.ext || undefined,
        sourceType,
        ext: site.ext,
      });
    }
  }

  return cmsApis;
}

/**
 * 解析TVBOX订阅URL并提取CMS源
 * @param url 订阅URL
 * @returns ApiSite数组
 */
export async function parseTvboxSubscription(url: string): Promise<ApiSite[]> {
  const subscription = await fetchTvboxSubscription(url);
  return extractCmsApis(subscription);
}

/**
 * 验证TVBOX订阅URL是否有效
 */
export async function validateTvboxSubscription(url: string): Promise<{
  valid: boolean;
  error?: string;
  count?: number;
}> {
  try {
    const apis = await parseTvboxSubscription(url);
    return {
      valid: true,
      count: apis.length,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || '未知错误',
    };
  }
}
