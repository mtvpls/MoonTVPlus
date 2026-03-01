/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { TOKEN_CONFIG } from '@/lib/refresh-token';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    // 如果未配置密码，重定向到警告页面
    const warningUrl = new URL('/warning', request.url);
    return warningUrl.pathname === pathname ? NextResponse.next() : NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage模式：在middleware中完成验证
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return handleAuthFailure(request, pathname);
    }
    return NextResponse.next();
  }

  // 其他模式：验证签名和时间戳，支持自动续期
  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.role || !authInfo.signature || !authInfo.timestamp) {
    return handleAuthFailure(request, pathname);
  }

  // 强制要求新版 Cookie（必须包含 tokenId 和 refreshToken）
  if (!authInfo.tokenId || !authInfo.refreshToken || !authInfo.refreshExpires) {
    console.log(`Old cookie format detected for ${authInfo.username}, forcing re-login`);
    return handleAuthFailure(request, pathname);
  }

  // 验证 Token 时间戳
  const ACCESS_TOKEN_AGE = TOKEN_CONFIG.ACCESS_TOKEN_AGE;
  const now = Date.now();
  const age = now - authInfo.timestamp;

  // 先检查 Refresh Token 是否过期
  if (now >= authInfo.refreshExpires) {
    console.log(`Refresh token expired for ${authInfo.username}, redirecting to login`);
    return handleAuthFailure(request, pathname);
  }

  // Access Token 已过期
  if (age > ACCESS_TOKEN_AGE) {
    console.log(`Access token expired for ${authInfo.username}`);
    // 对于 API 请求，返回 401，让前端拦截器刷新并重试
    if (pathname.startsWith('/api')) {
      return new NextResponse('Access token expired', { status: 401 });
    }
    // 对于页面请求，允许通过，让前端 TokenRefreshManager 在页面加载后刷新
    // 不能返回 401 或重定向，否则页面无法加载，前端代码无法运行
    console.log(`Allowing page request to pass, frontend will refresh token`);
  }

  // Access Token 未过期，验证签名
  const isValidSignature = await verifySignature(
    authInfo.username,
    authInfo.role,
    authInfo.timestamp,
    authInfo.signature,
    process.env.PASSWORD || ''
  );

  if (!isValidSignature) {
    return handleAuthFailure(request, pathname);
  }

  // 签名验证通过
  // 注意：Token 续期由前端负责，Middleware 不再自动刷新
  return NextResponse.next();
}

// 验证签名
async function verifySignature(
  username: string,
  role: string,
  timestamp: number,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);

  // 构造与生成签名时相同的数据结构
  const dataToSign = JSON.stringify({
    username,
    role,
    timestamp
  });
  const messageData = encoder.encode(dataToSign);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|register|oidc-register|warning|api/login|api/register|api/logout|api/auth/oidc|api/auth/refresh|api/cron/|api/server-config|api/proxy-m3u8|api/cms-proxy|api/tvbox/subscribe|api/theme/css|api/openlist/cms-proxy|api/openlist/play|api/emby/cms-proxy|api/emby/play|api/emby/sources|tvbox/).*)',
  ],
};
