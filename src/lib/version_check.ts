/* eslint-disable no-console */

'use client';

import { CURRENT_VERSION } from '@/lib/version';

// 版本检查结果枚举
export enum UpdateStatus {
  HAS_UPDATE = 'has_update', // 有新版本
  NO_UPDATE = 'no_update', // 无新版本
  FETCH_FAILED = 'fetch_failed', // 获取失败
}

// 远程版本检查URL配置
const VERSION_CHECK_URLS = [
  'https://raw.githubusercontent.com/mtvpls/MoonTVPlus/main/VERSION.txt',
];

/**
 * 检查是否有新版本可用
 * @returns Promise<UpdateStatus> - 返回版本检查状态
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    // 尝试从主要URL获取版本信息
    const primaryVersion = await fetchVersionFromUrl(VERSION_CHECK_URLS[0]);
    if (primaryVersion) {
      return compareVersions(primaryVersion);
    }

    // 如果主要URL失败，尝试备用URL
    const backupVersion = await fetchVersionFromUrl(VERSION_CHECK_URLS[1]);
    if (backupVersion) {
      return compareVersions(backupVersion);
    }

    // 如果两个URL都失败，返回获取失败状态
    return UpdateStatus.FETCH_FAILED;
  } catch (error) {
    console.error('版本检查失败:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

/**
 * 从指定URL获取版本信息
 * @param url - 版本信息URL
 * @returns Promise<string | null> - 版本字符串或null
 */
async function fetchVersionFromUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

    // 添加时间戳参数以避免缓存
    const timestamp = Date.now();
    const urlWithTimestamp = url.includes('?')
      ? `${url}&_t=${timestamp}`
      : `${url}?_t=${timestamp}`;

    const response = await fetch(urlWithTimestamp, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const version = await response.text();
    return version.trim();
  } catch (error) {
    console.warn(`从 ${url} 获取版本信息失败:`, error);
    return null;
  }
}

/**
 * 比较版本号
 * @param remoteVersion - 远程版本号
 * @returns UpdateStatus - 返回版本比较结果
 */
export function compareVersions(remoteVersion: string): UpdateStatus {
  // 如果版本号相同，无需更新
  if (remoteVersion === CURRENT_VERSION) {
    return UpdateStatus.NO_UPDATE;
  }

  try {
    // 解析版本号为数字数组 [X, Y, Z]
    const currentParts = CURRENT_VERSION.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`无效的版本号格式: ${CURRENT_VERSION}`);
      }
      return num;
    });

    const remoteParts = remoteVersion.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`无效的版本号格式: ${remoteVersion}`);
      }
      return num;
    });

    // 标准化版本号到3个部分
    const normalizeVersion = (parts: number[]) => {
      if (parts.length >= 3) {
        return parts.slice(0, 3); // 取前三个元素
      } else {
        // 不足3个的部分补0
        const normalized = [...parts];
        while (normalized.length < 3) {
          normalized.push(0);
        }
        return normalized;
      }
    };

    const normalizedCurrent = normalizeVersion(currentParts);
    const normalizedRemote = normalizeVersion(remoteParts);

    // 逐级比较版本号
    for (let i = 0; i < 3; i++) {
      if (normalizedRemote[i] > normalizedCurrent[i]) {
        return UpdateStatus.HAS_UPDATE;
      } else if (normalizedRemote[i] < normalizedCurrent[i]) {
        return UpdateStatus.NO_UPDATE;
      }
      // 如果当前级别相等，继续比较下一级
    }

    // 所有级别都相等，无需更新
    return UpdateStatus.NO_UPDATE;
  } catch (error) {
    console.error('版本号比较失败:', error);
    // 如果版本号格式无效，回退到字符串比较
    return remoteVersion !== CURRENT_VERSION
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
}
