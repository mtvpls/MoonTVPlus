/* 繁简转换 —— 独立客户端模块。
 *
 * 服务端 bundle 不应包含 opencc-js（其字典约 1.9MB，会撑爆 Cloudflare Worker）。
 * opencc-js 只在客户端加载（本文件 + search 页面复用），服务端打包 danmaku/api.ts
 * 或 search 路由时不应把本文件的 opencc-js 动态 import 内联进 worker。
 */

type OpenCCConverter = (text: string) => string;

// opencc-js 静态导入。server 构建下由 next.config.js 的 alias 指向 shim，
// 避免把 ~1.9MB 字典内联进 Cloudflare Worker；client 构建用真库做繁简转换。
import { Converter } from 'opencc-js';

let danmakuConverter: OpenCCConverter | null = null;
let danmakuConverterPromise: Promise<OpenCCConverter | null> | null = null;

/**
 * 加载繁简转换器（from: hk → to: cn）。同一进程只加载一次。
 * 仅客户端可调用；服务端（SSR）下 window 未定义时由调用方自行保护。
 */
export function loadTraditionalToSimplifiedConverter(): Promise<OpenCCConverter | null> {
  if (danmakuConverter) return Promise.resolve(danmakuConverter);
  if (!danmakuConverterPromise) {
    danmakuConverterPromise = Promise.resolve()
      .then(() => {
        // 静态导入的 Converter 已可用；包一层 Promise 保持返回签名一致
        danmakuConverter = Converter({ from: 'hk', to: 'cn' });
        return danmakuConverter;
      })
      .catch((error) => {
        console.error('初始化繁简转换器失败:', error);
        danmakuConverter = null;
        return null;
      });
  }
  return danmakuConverterPromise;
}

// 客户端加载时预热转换器（服务端 SSR 时 window 未定义，无副作用）
if (typeof window !== 'undefined') {
  void loadTraditionalToSimplifiedConverter();
}

export function convertDanmakuText(text: string): string {
  if (
    typeof window === 'undefined' ||
    localStorage.getItem('danmakuTraditionalToSimplified') !== 'true'
  ) {
    return text;
  }

  // 转换器尚未就绪时原样返回（预热后通常已加载完成）
  if (!danmakuConverter) return text;

  try {
    return danmakuConverter(text);
  } catch (error) {
    console.error('弹幕繁简转换失败:', error);
    return text;
  }
}
