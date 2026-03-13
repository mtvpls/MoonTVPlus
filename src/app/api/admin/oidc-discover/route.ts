/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 },
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issuerUrl } = await request.json();

    if (!issuerUrl || typeof issuerUrl !== 'string') {
      return NextResponse.json(
        { error: 'Issuer URL不能为空' },
        { status: 400 },
      );
    }

    // 构建well-known URL
    const wellKnownUrl = `${issuerUrl}/.well-known/openid-configuration`;

    console.log('正在获取OIDC配置:', wellKnownUrl);

    // 通过后端获取配置，避免CORS问题
    const response = await fetch(wellKnownUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      // 设置超时
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    if (!response.ok) {
      console.error('获取OIDC配置失败:', response.status, response.statusText);
      return NextResponse.json(
        {
          error: `无法获取OIDC配置: ${response.status} ${response.statusText}`,
        },
        { status: 400 },
      );
    }

    const data = await response.json();

    // 验证返回的数据包含必需的端点
    if (
      !data.authorization_endpoint ||
      !data.token_endpoint ||
      !data.userinfo_endpoint
    ) {
      return NextResponse.json(
        {
          error: 'OIDC配置不完整，缺少必需的端点',
        },
        { status: 400 },
      );
    }

    // 返回端点配置
    return NextResponse.json({
      authorization_endpoint: data.authorization_endpoint,
      token_endpoint: data.token_endpoint,
      userinfo_endpoint: data.userinfo_endpoint,
      issuer: data.issuer,
    });
  } catch (error) {
    console.error('OIDC自动发现失败:', error);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { error: '请求超时，请检查Issuer URL是否正确' },
          { status: 408 },
        );
      }
      return NextResponse.json(
        { error: `获取配置失败: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: '获取配置失败，请检查Issuer URL是否正确' },
      { status: 500 },
    );
  }
}
