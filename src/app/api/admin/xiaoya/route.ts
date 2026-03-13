/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { XiaoyaClient } from '@/lib/xiaoya.client';

export const runtime = 'nodejs';

/**
 * POST /api/admin/xiaoya
 * 管理小雅配置
 */
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { action, ...configData } = body;

    if (action === 'test') {
      // 测试连接
      try {
        const client = new XiaoyaClient(
          configData.ServerURL,
          configData.Username,
          configData.Password,
          configData.Token,
        );

        // 尝试列出根目录
        await client.listDirectory('/');

        return NextResponse.json({ success: true, message: '连接成功' });
      } catch (error) {
        return NextResponse.json(
          { success: false, message: (error as Error).message },
          { status: 400 },
        );
      }
    }

    if (action === 'save') {
      // 保存配置
      const config = await getConfig();

      config.XiaoyaConfig = {
        Enabled: configData.Enabled || false,
        ServerURL: configData.ServerURL || '',
        Token: configData.Token,
        Username: configData.Username,
        Password: configData.Password,
        DisableVideoPreview: configData.DisableVideoPreview || false,
      };

      await db.saveAdminConfig(config);

      return NextResponse.json({ success: true, message: '保存成功' });
    }

    return NextResponse.json({ error: '无效的操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
