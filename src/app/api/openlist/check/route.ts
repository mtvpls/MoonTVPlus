/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/check
 * 检查 OpenList 连通性
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '无权限访问私人影库');
    if (authResult instanceof NextResponse) return authResult;
    // 权限检查
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 获取请求参数
    const body = await request.json();
    const { url, username, password } = body;

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 创建客户端并检查连通性
    const client = new OpenListClient(url, username, password);
    const result = await client.checkConnectivity();

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('检查 OpenList 连通性失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '检查失败',
      },
      { status: 500 }
    );
  }
}
