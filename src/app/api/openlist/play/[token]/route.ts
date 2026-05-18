/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/play/{token}?folder=xxx&fileName=xxx
 * 获取单个视频文件的播放链接（懒加载）
 * 返回重定向到真实播放 URL
 *
 * 权限验证：TVBox Token（路径参数） 或 用户登录（满足其一即可）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { searchParams } = new URL(request.url);

    // 双重验证：TVBox Token（全局或用户） 或 用户登录
    const requestToken = params.token;
    const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
    const authInfo = getAuthInfoFromCookie(request);

    // 验证 TVBox Token（全局token或用户token）
    let hasValidToken = false;
    if (globalToken && requestToken === globalToken) {
      // 全局token
      hasValidToken = true;
    } else {
      // 检查是否是用户token
      const { db } = await import('@/lib/db');
      const username = await db.getUsernameByTvboxToken(requestToken);
      if (username) {
        // 检查用户是否被封禁
        const userInfo = await db.getUserInfoV2(username);
        const allowed = await hasFeaturePermission(username, 'private_library');
        if (userInfo && !userInfo.banned && allowed) {
          hasValidToken = true;
        }
      }
    }

    // 验证用户登录
    const hasValidAuth = !!(
      authInfo?.username &&
      (await hasFeaturePermission(authInfo.username, 'private_library'))
    );

    // 两者至少满足其一
    if (!hasValidToken && !hasValidAuth) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const folderName = searchParams.get('folder');
    const fileName = searchParams.get('fileName');

    if (!folderName || !fileName) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未启用' }, { status: 400 });
    }

    const rootPath = openListConfig.RootPath || '/';
    const folderPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folderName}`;
    const filePath = `${folderPath}/${fileName}`;

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 获取文件的播放链接
    const fileResponse = await client.getFile(filePath);

    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      console.error('[OpenList Play] 获取播放URL失败:', {
        fileName,
        code: fileResponse.code,
        message: fileResponse.message,
      });
      return NextResponse.json(
        { error: '获取播放链接失败' },
        { status: 500 }
      );
    }

    // 返回重定向到真实播放 URL
    return NextResponse.redirect(fileResponse.data.raw_url);
  } catch (error) {
    console.error('获取播放链接失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
