/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * 夸克Cookie配置管理API
 * 用于保存和管理夸克网盘的认证信息
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
    const body = (await request.json()) as {
      sourceKey: string;
      cookie?: string;
      ext?: string;
    };

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const { sourceKey, cookie, ext } = body;

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少sourceKey参数' }, { status: 400 });
    }

    // 获取配置
    const adminConfig = await getConfig();

    // 权限校验
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 查找对应的源
    const source = adminConfig.SourceConfig.find((s) => s.key === sourceKey);
    if (!source) {
      return NextResponse.json({ error: '源不存在' }, { status: 404 });
    }

    // 只允许配置网盘源
    if (source.sourceType !== 'quark' && source.sourceType !== 'ali') {
      return NextResponse.json(
        { error: '该源不是网盘源，无需配置Cookie' },
        { status: 400 }
      );
    }

    // 更新认证信息
    if (!source.auth) {
      source.auth = {};
    }

    if (cookie !== undefined) {
      source.auth.cookie = cookie;
    }

    if (ext !== undefined) {
      source.ext = ext;
    }

    // 持久化到存储
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      {
        ok: true,
        message: `${source.sourceType === 'quark' ? '夸克' : '阿里'}网盘认证信息已更新`,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('更新网盘认证信息失败:', error);
    return NextResponse.json(
      {
        error: '更新认证信息失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

/**
 * 获取夸克Cookie配置
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('sourceKey');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少sourceKey参数' }, { status: 400 });
    }

    const adminConfig = await getConfig();

    // 查找对应的源
    const source = adminConfig.SourceConfig.find((s) => s.key === sourceKey);
    if (!source) {
      return NextResponse.json({ error: '源不存在' }, { status: 404 });
    }

    return NextResponse.json(
      {
        cookie: source.auth?.cookie || '',
        ext: source.ext || '',
        sourceType: source.sourceType,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('获取网盘认证信息失败:', error);
    return NextResponse.json(
      {
        error: '获取认证信息失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
