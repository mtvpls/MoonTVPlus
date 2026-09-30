/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { parseConfigSubscriptionContent } from '@/lib/config-subscription';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 权限检查：仅站长可以拉取配置订阅
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以拉取配置订阅' },
        { status: 401 }
      );
    }

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: '缺少URL参数' }, { status: 400 });
    }

    // 直接 fetch URL 获取配置内容
    const response = await fetch(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: `请求失败: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const configContent = await response.text();
    const parsed = await parseConfigSubscriptionContent(configContent);

    return NextResponse.json({
      success: true,
      configContent: parsed.content,
      format: parsed.format,
      message: parsed.format === 'json' ? '原始 JSON 配置拉取成功' : 'Base58 配置拉取成功'
    });

  } catch (error) {
    console.error('拉取配置失败:', error);
    return NextResponse.json(
      { error: '拉取配置失败' },
      { status: 500 }
    );
  }
}
