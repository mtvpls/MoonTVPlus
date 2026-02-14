/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

// 检测是否为 Cloudflare 环境
const isCloudflare = process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';

// 服务器端内存缓存
const serverCache = {
  methodConfigs: new Map<string, { data: any; timestamp: number }>(),
  proxyRequests: new Map<string, { data: any; timestamp: number }>(),
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24小时缓存
};

// 正在下载的音频任务追踪（防止重复下载）
const downloadingTasks = new Map<string, Promise<void>>();

// 获取 TuneHub 配置
async function getTuneHubConfig() {
  const config = await getConfig();
  const musicConfig = config?.MusicConfig;

  const enabled = musicConfig?.TuneHubEnabled ?? false;
  const baseUrl =
    musicConfig?.TuneHubBaseUrl ||
    process.env.TUNEHUB_BASE_URL ||
    'https://tunehub.sayqz.com/api';
  const apiKey = musicConfig?.TuneHubApiKey || process.env.TUNEHUB_API_KEY || '';

  return { enabled, baseUrl, apiKey, musicConfig };
}

// 获取 OpenList 客户端
async function getOpenListClient(): Promise<OpenListClient | null> {
  const config = await getConfig();
  const musicConfig = config?.MusicConfig;

  if (!musicConfig?.OpenListCacheEnabled) {
    return null;
  }

  const url = musicConfig.OpenListCacheURL;
  const username = musicConfig.OpenListCacheUsername;
  const password = musicConfig.OpenListCachePassword;

  if (!url || !username || !password) {
    return null;
  }

  return new OpenListClient(url, username, password);
}

// 异步下载音频文件并上传到 OpenList
async function cacheAudioToOpenList(
  openListClient: OpenListClient,
  audioUrl: string,
  platform: string,
  songId: string,
  quality: string,
  cachePath: string
): Promise<void> {
  const taskKey = `${platform}-${songId}-${quality}`;

  // 检查是否已经有任务在下载
  const existingTask = downloadingTasks.get(taskKey);
  if (existingTask) {
    return existingTask;
  }

  // 创建下载任务
  const downloadTask = (async () => {
    try {
      const audioPath = `${cachePath}/${platform}/audio/${songId}-${quality}.mp3`;

      const audioResponse = await fetch(audioUrl);

      if (!audioResponse.ok) {
        console.error('[Music Cache] 下载音频失败:', audioResponse.status);
        return;
      }

      const audioBuffer = await audioResponse.arrayBuffer();
      const audioBlob = Buffer.from(audioBuffer);

      const token = await (openListClient as any).getToken();

      const uploadResponse = await fetch(`${(openListClient as any).baseURL}/api/fs/put`, {
        method: 'PUT',
        headers: {
          'Authorization': token,
          'Content-Type': 'audio/mpeg',
          'File-Path': encodeURIComponent(audioPath),
          'As-Task': 'false',
        },
        body: audioBlob,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[Music Cache] 上传音频失败:', uploadResponse.status, errorText);
        return;
      }
    } catch (error) {
      console.error('[Music Cache] 缓存音频到 OpenList 失败:', error);
    } finally {
      downloadingTasks.delete(taskKey);
    }
  })();

  downloadingTasks.set(taskKey, downloadTask);

  return downloadTask;
}

// 检查并替换音频 URL 为 OpenList URL
async function replaceAudioUrlsWithOpenList(
  data: any,
  openListClient: OpenListClient | null,
  platform: string,
  quality: string,
  cachePath: string
): Promise<any> {
  // 获取配置，检查是否启用 OpenList 缓存
  const config = await getConfig();
  const cacheEnabled = config?.MusicConfig?.OpenListCacheEnabled ?? false;
  const cacheProxyEnabled = config?.MusicConfig?.OpenListCacheProxyEnabled ?? true;

  // 如果没有启用 OpenList 缓存，直接返回原数据
  if (!cacheEnabled || !openListClient || !data?.data) {
    return data;
  }

  // TuneHub 返回的数据结构是 { code: 0, data: { data: [...], total: 1 } }
  // 需要提取内层的 data 数组
  const songsData = data.data.data || data.data;
  const songs = Array.isArray(songsData) ? songsData : [songsData];

  for (const song of songs) {
    if (!song?.id || !song?.url) {
      continue;
    }

    const audioPath = `${cachePath}/${platform}/audio/${song.id}-${quality}.mp3`;

    // 如果缓存中已经标记为已缓存，且使用代理模式，直接返回代理URL
    if (song.cached === true && cacheProxyEnabled) {
      song.url = `/api/music/audio-proxy?platform=${platform}&id=${song.id}&quality=${quality}`;
      continue;
    }

    try {
      // 只有在未确认缓存状态时才调用 getFile()
      const fileResponse = await openListClient.getFile(audioPath);

      if (fileResponse.code === 200 && fileResponse.data?.raw_url) {
        // 如果启用缓存代理，返回代理URL；否则返回直接URL
        if (cacheProxyEnabled) {
          // 使用代理URL，通过我们的服务器代理OpenList的音频
          song.url = `/api/music/audio-proxy?platform=${platform}&id=${song.id}&quality=${quality}`;
        } else {
          // 直接使用OpenList的raw_url
          song.url = fileResponse.data.raw_url;
        }
        song.cached = true;
      } else {
        song.cached = false;

        cacheAudioToOpenList(openListClient, song.url, platform, song.id, quality, cachePath)
          .catch(error => {
            console.error('[Music Cache] 异步缓存音频失败:', error);
          });
      }
    } catch (error) {
      song.cached = false;

      cacheAudioToOpenList(openListClient, song.url, platform, song.id, quality, cachePath)
        .catch(err => {
          console.error('[Music Cache] 异步缓存音频失败:', err);
        });
    }
  }

  return data;
}

// 通用请求处理函数
async function proxyRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return response;
  } catch (error) {
    console.error('TuneHub API 请求失败:', error);
    throw error;
  }
}

// 获取方法配置并执行请求
async function executeMethod(
  baseUrl: string,
  platform: string,
  func: string,
  variables: Record<string, string> = {}
): Promise<any> {
  // 1. 获取方法配置
  const cacheKey = `method-config-${platform}-${func}`;
  let config: any;

  const cached = serverCache.methodConfigs.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
    config = cached.data.data;
  } else {
    const response = await proxyRequest(`${baseUrl}/v1/methods/${platform}/${func}`);
    const data = await response.json();
    serverCache.methodConfigs.set(cacheKey, { data, timestamp: Date.now() });
    config = data.data;
  }

  if (!config) {
    throw new Error('无法获取方法配置');
  }

  // 2. 替换模板变量
  let url = config.url;
  const params: Record<string, string> = {};

  // 先将 variables 中的值转换为可执行的变量
  const evalContext: Record<string, any> = {};
  for (const [key, value] of Object.entries(variables)) {
    // 尝试将字符串转换为数字（如果可能）
    const numValue = Number(value);
    evalContext[key] = isNaN(numValue) ? value : numValue;
  }

  // 递归处理对象中的模板变量
  function processTemplateValue(value: any): any {
    if (typeof value === 'string') {
      // 处理包含模板变量的表达式
      const expressionRegex = /\{\{(.+?)\}\}/g;
      return value.replace(expressionRegex, (match, expression) => {
        try {
          // 在 Cloudflare 环境下，使用简单的表达式替换
          if (isCloudflare) {
            const expr = expression.trim();

            // 检查是否是单个变量（没有运算符）
            if (evalContext.hasOwnProperty(expr)) {
              // 直接返回变量值
              return String(evalContext[expr]);
            }

            // 处理包含运算的表达式（如 page - 1）
            let result: any = expr;

            // 替换变量为其值
            for (const [key, val] of Object.entries(evalContext)) {
              const regex = new RegExp(`\\b${key}\\b`, 'g');
              // 对于数字直接替换，对于字符串需要加引号以便 eval
              const replacement = typeof val === 'number' ? String(val) : `"${String(val).replace(/"/g, '\\"')}"`;
              result = result.replace(regex, replacement);
            }

            // 尝试计算表达式
            try {
              // eslint-disable-next-line no-eval
              result = eval(result);
            } catch (err) {
              console.error(`[executeMethod] Cloudflare 环境执行表达式失败: ${expr}`, err);
              // 如果计算失败，尝试直接返回替换后的结果（去掉可能的引号）
              result = result.replace(/^["']|["']$/g, '');
            }

            return String(result);
          } else {
            // 在 Node.js 环境下，使用 Function 构造器
            // eslint-disable-next-line no-new-func
            const func = new Function(...Object.keys(evalContext), `return ${expression}`);
            const result = func(...Object.values(evalContext));
            return String(result);
          }
        } catch (err) {
          console.error(`[executeMethod] 执行表达式失败: ${expression}`, err);
          return '0'; // 默认值
        }
      });
    } else if (Array.isArray(value)) {
      return value.map(item => processTemplateValue(item));
    } else if (typeof value === 'object' && value !== null) {
      const result: any = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = processTemplateValue(v);
      }
      return result;
    }
    return value;
  }

  // 处理 URL 参数
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      params[key] = processTemplateValue(value);
    }
  }

  // 处理 POST body
  let processedBody = config.body;
  if (config.body) {
    processedBody = processTemplateValue(config.body);
  }

  // 3. 构建完整 URL
  if (config.method === 'GET' && Object.keys(params).length > 0) {
    const urlObj = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      urlObj.searchParams.append(key, value);
    }
    url = urlObj.toString();
  }

  // 4. 发起请求
  const requestOptions: RequestInit = {
    method: config.method || 'GET',
    headers: config.headers || {},
  };

  if (config.method === 'POST' && processedBody) {
    requestOptions.body = JSON.stringify(processedBody);
    requestOptions.headers = {
      ...requestOptions.headers,
      'Content-Type': 'application/json',
    };
  }

  const response = await proxyRequest(url, requestOptions);
  let data = await response.json();

  // 5. 执行 transform 函数（如果有）
  if (config.transform) {
    // 在 Cloudflare 环境下，将 transform 函数返回给前端执行
    if (isCloudflare) {
      // 将 transform 函数字符串附加到响应数据中
      data.__transform = config.transform;
    } else {
      // 在 Node.js 环境下，直接执行 transform
      try {
        // eslint-disable-next-line no-eval
        const transformFn = eval(`(${config.transform})`);
        data = transformFn(data);
      } catch (err) {
        console.error('[executeMethod] Transform 函数执行失败:', err);
      }
    }
  }

  // 6. 处理酷我音乐的图片 URL（转换为代理 URL）
  if (platform === 'kuwo') {
    const processKuwoImages = (obj: any): any => {
      if (typeof obj === 'string' && obj.startsWith('http://') && obj.includes('kwcdn.kuwo.cn')) {
        // 将 HTTP 图片 URL 转换为代理 URL
        return `/api/music/proxy?url=${encodeURIComponent(obj)}`;
      } else if (Array.isArray(obj)) {
        return obj.map(item => processKuwoImages(item));
      } else if (typeof obj === 'object' && obj !== null) {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = processKuwoImages(value);
        }
        return result;
      }
      return obj;
    };

    data = processKuwoImages(data);
  }

  return data;
}

// GET 请求处理
export async function GET(request: NextRequest) {
  try {
    const { enabled, baseUrl } = await getTuneHubConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音乐功能未开启' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 参数' },
        { status: 400 }
      );
    }

    // 处理不同的 action
    switch (action) {
      case 'toplists': {
        // 获取排行榜列表
        const platform = searchParams.get('platform');
        if (!platform) {
          return NextResponse.json(
            { error: '缺少 platform 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `toplists-${platform}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'toplists');
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'toplist': {
        // 获取排行榜详情
        const platform = searchParams.get('platform');
        const id = searchParams.get('id');

        if (!platform || !id) {
          return NextResponse.json(
            { error: '缺少 platform 或 id 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `toplist-${platform}-${id}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'toplist', { id });
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'playlist': {
        // 获取歌单详情
        const platform = searchParams.get('platform');
        const id = searchParams.get('id');

        if (!platform || !id) {
          return NextResponse.json(
            { error: '缺少 platform 或 id 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `playlist-${platform}-${id}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'playlist', { id });
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'search': {
        // 搜索歌曲
        const platform = searchParams.get('platform');
        const keyword = searchParams.get('keyword');
        const page = searchParams.get('page') || '1';
        const pageSize = searchParams.get('pageSize') || '20';

        if (!platform || !keyword) {
          return NextResponse.json(
            { error: '缺少 platform 或 keyword 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `search-${platform}-${keyword}-${page}-${pageSize}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        // 注意：不同平台可能使用不同的变量名
        // 统一传递 keyword, page, pageSize, limit (limit = pageSize)
        const data = await executeMethod(baseUrl, platform, 'search', {
          keyword,
          page,
          pageSize,
          limit: pageSize, // 有些平台使用 limit 而不是 pageSize
        });

        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音乐 API 错误:', error);
    return NextResponse.json(
      {
        error: '请求失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

// POST 请求处理（用于解析歌曲）
export async function POST(request: NextRequest) {
  try {
    const { enabled, baseUrl, apiKey } = await getTuneHubConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音乐功能未开启' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 参数' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'parse': {
        // 解析歌曲（需要 API Key）
        if (!apiKey) {
          return NextResponse.json(
            {
              code: -1,
              error: '未配置 TuneHub API Key',
              message: '未配置 TuneHub API Key'
            },
            { status: 403 }
          );
        }

        const { platform, ids, quality } = body;
        if (!platform || !ids) {
          return NextResponse.json(
            {
              code: -1,
              error: '缺少 platform 或 ids 参数',
              message: '缺少 platform 或 ids 参数'
            },
            { status: 400 }
          );
        }

        // 添加缓存支持
        const qualityKey = quality || '320k';
        const idsKey = Array.isArray(ids) ? ids.join(',') : ids;
        const cacheKey = `parse-${platform}-${idsKey}-${qualityKey}`;

        // 1. 获取 OpenList 配置
        const openListClient = await getOpenListClient();
        const config = await getConfig();
        const cachePath = config?.MusicConfig?.OpenListCachePath || '/music-cache';

        // 2. 检查内存缓存
        const cached = serverCache.proxyRequests.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          // 如果启用了 OpenList，需要检查并替换音频 URL
          if (openListClient) {
            const updatedData = await replaceAudioUrlsWithOpenList(
              cached.data,
              openListClient,
              platform,
              qualityKey,
              cachePath
            );

            // 更新内存缓存
            serverCache.proxyRequests.set(cacheKey, { data: updatedData, timestamp: Date.now() });

            return NextResponse.json(updatedData);
          } else {
            // 没有 OpenList 配置，直接返回内存缓存
            return NextResponse.json(cached.data);
          }
        }

        // 3. 检查 OpenList JSON 缓存
        if (openListClient) {
          try {
            const openListPath = `${cachePath}/${platform}/${idsKey}-${qualityKey}.json`;

            const fileResponse = await openListClient.getFile(openListPath);
            if (fileResponse.code === 200 && fileResponse.data?.raw_url) {
              // 下载缓存文件
              const cacheResponse = await fetch(fileResponse.data.raw_url);
              if (cacheResponse.ok) {
                const cachedData = await cacheResponse.json();

                // 检查并替换音频 URL
                const updatedData = await replaceAudioUrlsWithOpenList(
                  cachedData,
                  openListClient,
                  platform,
                  qualityKey,
                  cachePath
                );

                // 更新内存缓存
                serverCache.proxyRequests.set(cacheKey, { data: updatedData, timestamp: Date.now() });

                return NextResponse.json(updatedData);
              }
            }
          } catch (error) {
            // OpenList 缓存未命中，继续调用 TuneHub
          }
        }

        // 4. 调用 TuneHub API 解析
        try {
          const response = await proxyRequest(`${baseUrl}/v1/parse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
            },
            body: JSON.stringify({
              platform,
              ids,
              quality: qualityKey,
            }),
          });

          const data = await response.json();

          // 如果 TuneHub 返回错误，包装成统一格式
          if (!response.ok || data.code !== 0) {
            return NextResponse.json({
              code: data.code || -1,
              message: data.message || data.error || '解析失败',
              error: data.error || data.message || '解析失败',
            });
          }

          // 5. 缓存成功的解析结果到内存
          serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

          // 6. 检查并替换音频 URL 为 OpenList URL（如果已缓存）
          // 同时异步下载未缓存的音频
          const finalData = await replaceAudioUrlsWithOpenList(
            data,
            openListClient,
            platform,
            qualityKey,
            cachePath
          );

          // 7. 缓存解析结果到 OpenList（异步，不阻塞响应）
          if (openListClient) {
            const jsonPath = `${cachePath}/${platform}/${idsKey}-${qualityKey}.json`;
            openListClient.uploadFile(jsonPath, JSON.stringify(finalData, null, 2))
              .catch((error) => {
                console.error('[Music Cache] 缓存解析结果到 OpenList 失败:', error);
              });
          }

          return NextResponse.json(finalData);
        } catch (error) {
          console.error('解析歌曲失败:', error);
          return NextResponse.json({
            code: -1,
            message: '解析请求失败',
            error: (error as Error).message,
          });
        }
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音乐 API 错误:', error);
    return NextResponse.json(
      {
        error: '请求失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
