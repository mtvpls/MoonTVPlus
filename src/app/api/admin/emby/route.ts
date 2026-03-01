/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { EmbyClient } from '@/lib/emby.client';
import { clearEmbyCache } from '@/lib/emby-cache';

export const runtime = 'nodejs';

/**
 * POST /api/admin/emby
 * Emby 配置管理接口
 * - test: 测试 Emby 连接
 * - clearCache: 清除 Emby 缓存
 */
export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { action, ServerURL, ApiKey, Username, Password } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 获取配置
    const adminConfig = await getConfig();

    // 权限检查
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    if (action === 'test') {
      // 测试连接
      if (!ServerURL) {
        return NextResponse.json({ error: '请填写 Emby 服务器地址' }, { status: 400 });
      }

      if (!ApiKey && (!Username || !Password)) {
        return NextResponse.json(
          { error: '请填写 API Key 或用户名密码' },
          { status: 400 }
        );
      }

      const testConfig = {
        ServerURL,
        ApiKey,
        Username,
        Password,
      };

      const client = new EmbyClient(testConfig);

      // 如果使用用户名密码，先认证
      if (!ApiKey && Username && Password) {
        try {
          await client.authenticate(Username, Password);
        } catch (error) {
          return NextResponse.json(
            { success: false, message: 'Emby 认证失败: ' + (error as Error).message },
            { status: 200 }
          );
        }
      }

      // 测试连接
      const isConnected = await client.checkConnectivity();
      if (!isConnected) {
        return NextResponse.json(
          { success: false, message: 'Emby 连接失败，请检查服务器地址和认证信息' },
          { status: 200 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Emby 连接测试成功',
      });
    }

    if (action === 'clearCache') {
      // 清除缓存
      const result = clearEmbyCache();
      return NextResponse.json({
        success: true,
        message: `已清除 ${result.cleared} 条 Emby 缓存`,
        cleared: result.cleared,
      });
    }

    return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
  } catch (error) {
    console.error('Emby 配置保存失败:', error);
    return NextResponse.json(
      { error: 'Emby 配置保存失败: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
