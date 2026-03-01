/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * 清理字符串中的 BOM 和其他不可见字符
 */
function cleanPath(path: string): string {
  // 移除 UTF-8 BOM (U+FEFF) 和其他零宽度字符
  let cleaned = path
    .replace(/^\uFEFF/, '') // 移除开头的 BOM
    .replace(/\uFEFF/g, '') // 移除所有 BOM
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // 移除零宽度字符
    .trim(); // 移除首尾空白

  // 移除末尾的 /（除非路径就是 /）
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned;
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
    const { action, Enabled, URL, Username, Password, RootPaths, OfflineDownloadPath, ScanInterval, ScanMode, DisableVideoPreview } = body;

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
      // 如果功能未启用，允许保存空配置
      if (!Enabled) {
        adminConfig.OpenListConfig = {
          Enabled: false,
          URL: URL || '',
          Username: Username || '',
          Password: Password || '',
          RootPaths: RootPaths || ['/'],
          OfflineDownloadPath: OfflineDownloadPath || '/',
          LastRefreshTime: adminConfig.OpenListConfig?.LastRefreshTime,
          ResourceCount: adminConfig.OpenListConfig?.ResourceCount,
          ScanInterval: 0,
          ScanMode: ScanMode || 'hybrid',
          DisableVideoPreview: DisableVideoPreview || false,
        };

        await db.saveAdminConfig(adminConfig);

        return NextResponse.json({
          success: true,
          message: '保存成功',
        });
      }

      // 功能启用时，验证必填字段
      if (!URL || !Username || !Password) {
        return NextResponse.json(
          { error: '请提供 URL、账号和密码' },
          { status: 400 }
        );
      }

      // 验证 RootPaths
      if (!Array.isArray(RootPaths) || RootPaths.length === 0) {
        return NextResponse.json(
          { error: '请至少提供一个根目录' },
          { status: 400 }
        );
      }

      // 清理 RootPaths 中的 BOM 和不可见字符
      const cleanedRootPaths = RootPaths.map(cleanPath);

      // 验证扫描间隔
      const scanInterval = parseInt(ScanInterval) || 0;
      if (scanInterval > 0 && scanInterval < 60) {
        return NextResponse.json(
          { error: '定时扫描间隔最低为 60 分钟' },
          { status: 400 }
        );
      }

      // 验证账号密码是否正确
      try {
        console.log('[OpenList Config] 验证账号密码');
        await OpenListClient.login(URL, Username, Password);
        console.log('[OpenList Config] 账号密码验证成功');
      } catch (error) {
        console.error('[OpenList Config] 账号密码验证失败:', error);
        return NextResponse.json(
          { error: '账号密码验证失败: ' + (error as Error).message },
          { status: 400 }
        );
      }

      adminConfig.OpenListConfig = {
        Enabled: true,
        URL,
        Username,
        Password,
        RootPaths: cleanedRootPaths,
        OfflineDownloadPath: OfflineDownloadPath || '/',
        LastRefreshTime: adminConfig.OpenListConfig?.LastRefreshTime,
        ResourceCount: adminConfig.OpenListConfig?.ResourceCount,
        ScanInterval: scanInterval,
        ScanMode: ScanMode || 'hybrid',
        DisableVideoPreview: DisableVideoPreview || false,
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
