/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { OpenListExtraSource } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  normalizeOpenListPath,
  normalizePathMetaMap,
  type OpenListPathMetaMap,
} from '@/lib/openlist-path-meta';
import { MAIN_SOURCE_NAME } from '@/lib/openlist-sources';
import { normalizeApiBaseUrl } from '@/lib/url';

export const runtime = 'nodejs';

/**
 * 清理字符串中的 BOM 和其他不可见字符
 */
function cleanPath(path: string): string {
  return normalizeOpenListPath(path);
}

function parsePathMeta(raw: unknown): OpenListPathMetaMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return normalizePathMetaMap(raw as OpenListPathMetaMap);
}

/**
 * 规范化备用源列表：trim 名字、规范化 URL
 */
function normalizeExtraSources(raw: unknown): OpenListExtraSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    name: typeof item?.name === 'string' ? item.name.trim() : '',
    url: normalizeApiBaseUrl(item?.url || ''),
    username: item?.username || '',
    password: item?.password || '',
  }));
}

/**
 * 找出「源名@路径」里引用了但不存在的源名。
 * 只在 @ 前缀不含 '/' 时才当作源名（否则视为路径本身含 @）。
 */
function findUnknownSourceRef(
  paths: string[],
  knownNames: Set<string>
): string | null {
  for (const raw of paths) {
    const value = (raw ?? '').toString();
    const at = value.indexOf('@');
    if (at <= 0) continue;
    const name = value.slice(0, at).trim();
    if (!name || name.includes('/')) continue;
    if (!knownNames.has(name)) {
      return `未知的 OpenList 源名：${name}`;
    }
  }
  return null;
}

/**
 * POST /api/admin/openlist
 * 保存 OpenList 配置
 */
export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const {
      action,
      Enabled,
      URL,
      Username,
      Password,
      RootPaths,
      ExtraSources,
      OfflineDownloadPath,
      ScanInterval,
      ScanMode,
      DisableVideoPreview,
      PathMeta,
    } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 获取配置
    const adminConfig = await getConfig();

    // 权限检查 - 使用v2用户系统
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    if (action === 'save') {
      const cleanedPathMeta = parsePathMeta(PathMeta);
      const normalizedURL = normalizeApiBaseUrl(URL);
      const normalizedExtraSources = normalizeExtraSources(ExtraSources);
      const cleanedRootPaths = Array.isArray(RootPaths)
        ? RootPaths.map(cleanPath)
        : [];
      const cleanedOfflinePath = cleanPath(OfflineDownloadPath || '/') || '/';

      // 源名唯一性校验
      const seenNames = new Set<string>();
      for (const source of normalizedExtraSources) {
        if (!source.name) {
          return NextResponse.json({ error: '备用源名字不能为空' }, { status: 400 });
        }
        if (source.name.includes('@')) {
          return NextResponse.json(
            { error: `备用源名字不能包含 @：${source.name}` },
            { status: 400 }
          );
        }
        if (source.name === MAIN_SOURCE_NAME) {
          return NextResponse.json(
            { error: `「${MAIN_SOURCE_NAME}」是主源保留名，不能用作备用源名字` },
            { status: 400 }
          );
        }
        if (seenNames.has(source.name)) {
          return NextResponse.json(
            { error: `备用源名字重复：${source.name}` },
            { status: 400 }
          );
        }
        seenNames.add(source.name);
      }

      const knownNames = new Set<string>([MAIN_SOURCE_NAME]);
      seenNames.forEach((name) => knownNames.add(name));

      // 如果功能未启用，允许保存空配置
      if (!Enabled) {
        adminConfig.OpenListConfig = {
          Enabled: false,
          URL: normalizedURL,
          Username: Username || '',
          Password: Password || '',
          RootPaths: cleanedRootPaths.length ? cleanedRootPaths : ['/'],
          ExtraSources: normalizedExtraSources,
          OfflineDownloadPath: cleanedOfflinePath,
          LastRefreshTime: adminConfig.OpenListConfig?.LastRefreshTime,
          ResourceCount: adminConfig.OpenListConfig?.ResourceCount,
          ScanInterval: 0,
          ScanMode: ScanMode || 'hybrid',
          DisableVideoPreview: DisableVideoPreview || false,
          PathMeta: cleanedPathMeta,
        };

        await db.saveAdminConfig(adminConfig);

        return NextResponse.json({
          success: true,
          message: '保存成功',
        });
      }

      // 功能启用时，验证必填字段
      if (!normalizedURL || !Username || !Password) {
        return NextResponse.json(
          { error: '请提供主 OpenList 的 URL、账号和密码' },
          { status: 400 }
        );
      }

      // 备用源字段完整性
      for (const source of normalizedExtraSources) {
        if (!source.url || !source.username || !source.password) {
          return NextResponse.json(
            { error: `备用源「${source.name}」的 URL、账号和密码不能为空` },
            { status: 400 }
          );
        }
      }

      // 验证 RootPaths
      if (!Array.isArray(RootPaths) || RootPaths.length === 0) {
        return NextResponse.json(
          { error: '请至少提供一个根目录' },
          { status: 400 }
        );
      }

      // 路径前缀引用的源必须存在
      const unknownRef =
        findUnknownSourceRef(cleanedRootPaths, knownNames) ||
        findUnknownSourceRef([cleanedOfflinePath], knownNames);
      if (unknownRef) {
        return NextResponse.json({ error: unknownRef }, { status: 400 });
      }

      // 验证扫描间隔
      const scanInterval = parseInt(ScanInterval) || 0;
      if (scanInterval > 0 && scanInterval < 60) {
        return NextResponse.json(
          { error: '定时扫描间隔最低为 60 分钟' },
          { status: 400 }
        );
      }

      // 验证主源账号密码是否正确
      try {
        console.log('[OpenList Config] 验证主源账号密码');
        await OpenListClient.login(normalizedURL, Username, Password);
        console.log('[OpenList Config] 主源账号密码验证成功');
      } catch (error) {
        console.error('[OpenList Config] 主源账号密码验证失败:', error);
        return NextResponse.json(
          { error: '主源账号密码验证失败: ' + (error as Error).message },
          { status: 400 }
        );
      }

      // 备用源只做表单校验（上方字段完整性），保存时不验证连通性；
      // 连通性由管理面板里每个备用源单独的「检测」按钮负责。

      adminConfig.OpenListConfig = {
        Enabled: true,
        URL: normalizedURL,
        Username,
        Password,
        RootPaths: cleanedRootPaths,
        ExtraSources: normalizedExtraSources,
        OfflineDownloadPath: cleanedOfflinePath,
        LastRefreshTime: adminConfig.OpenListConfig?.LastRefreshTime,
        ResourceCount: adminConfig.OpenListConfig?.ResourceCount,
        ScanInterval: scanInterval,
        ScanMode: ScanMode || 'hybrid',
        DisableVideoPreview: DisableVideoPreview || false,
        PathMeta: cleanedPathMeta,
      };

      await db.saveAdminConfig(adminConfig);

      return NextResponse.json({
        success: true,
        message: '保存成功',
      });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('OpenList 配置操作失败:', error);
    return NextResponse.json(
      { error: '操作失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
