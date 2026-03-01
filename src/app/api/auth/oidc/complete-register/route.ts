/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  generateRefreshToken,
  generateTokenId,
  storeRefreshToken,
  TOKEN_CONFIG,
} from '@/lib/refresh-token';

export const runtime = 'nodejs';

// 生成签名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 获取设备信息
function getDeviceInfo(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  // 检查是否为 MoonTVPlus APP
  if (ua.includes('moontvplus')) {
    return 'MoonTVPlus APP';
  }

  // 检查是否为 OrionTV
  if (ua.includes('oriontv')) {
    return 'OrionTV';
  }

  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    if (ua.includes('android')) return 'Android Mobile';
    if (ua.includes('iphone')) return 'iPhone';
    return 'Mobile Device';
  }

  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'Tablet';
  }

  if (ua.includes('windows')) return 'Windows PC';
  if (ua.includes('mac')) return 'Mac';
  if (ua.includes('linux')) return 'Linux';

  return 'Unknown Device';
}

// 生成认证Cookie
async function generateAuthCookie(
  username: string,
  role: 'owner' | 'admin' | 'user',
  deviceInfo: string
): Promise<string> {
  const authData: any = { role };

  if (username && process.env.PASSWORD) {
    authData.username = username;
    authData.timestamp = Date.now();

    // 生成签名（包含 username, role, timestamp）
    const dataToSign = JSON.stringify({
      username: authData.username,
      role: authData.role,
      timestamp: authData.timestamp
    });
    const signature = await generateSignature(dataToSign, process.env.PASSWORD);
    authData.signature = signature;

    // 生成双 Token
    const tokenId = generateTokenId();
    const refreshToken = generateRefreshToken();
    const now = Date.now();
    const refreshExpires = now + TOKEN_CONFIG.REFRESH_TOKEN_AGE;

    authData.tokenId = tokenId;
    authData.refreshToken = refreshToken;
    authData.refreshExpires = refreshExpires;

    // 存储 Refresh Token
    await storeRefreshToken(username, tokenId, {
      token: refreshToken,
      deviceInfo,
      createdAt: now,
      expiresAt: refreshExpires,
      lastUsed: now,
    });
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json();

    // 验证用户名
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }

    // 验证用户名格式
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用户名只能包含字母、数字、下划线，长度3-20位' },
        { status: 400 }
      );
    }

    // 获取OIDC session
    const oidcSessionCookie = request.cookies.get('oidc_session')?.value;
    if (!oidcSessionCookie) {
      return NextResponse.json(
        { error: 'OIDC会话已过期，请重新登录' },
        { status: 400 }
      );
    }

    let oidcSession: any;
    try {
      oidcSession = JSON.parse(oidcSessionCookie);
    } catch {
      return NextResponse.json(
        { error: 'OIDC会话无效' },
        { status: 400 }
      );
    }

    // 检查session是否过期(10分钟)
    if (Date.now() - oidcSession.timestamp > 600000) {
      return NextResponse.json(
        { error: 'OIDC会话已过期，请重新登录' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const siteConfig = config.SiteConfig;

    // 检查是否启用OIDC注册
    if (!siteConfig.EnableOIDCRegistration) {
      return NextResponse.json(
        { error: 'OIDC注册未启用' },
        { status: 403 }
      );
    }

    // 检查最低信任等级
    const minTrustLevel = siteConfig.OIDCMinTrustLevel || 0;
    if (minTrustLevel > 0) {
      const userTrustLevel = oidcSession.trust_level ?? 0;
      if (userTrustLevel < minTrustLevel) {
        return NextResponse.json(
          { error: `您的信任等级(${userTrustLevel})不满足最低要求(${minTrustLevel})` },
          { status: 403 }
        );
      }
    }

    // 检查是否与站长同名
    if (username === process.env.USERNAME) {
      return NextResponse.json(
        { error: '该用户名不可用' },
        { status: 409 }
      );
    }

    // 检查用户名是否已存在
    const userExists = await db.checkUserExistV2(username);
    if (userExists) {
      return NextResponse.json(
        { error: '用户名已存在' },
        { status: 409 }
      );
    }

    // 检查OIDC sub是否已被使用
    const existingOIDCUsername = await db.getUserByOidcSub(oidcSession.sub);
    if (existingOIDCUsername) {
      return NextResponse.json(
        { error: '该OIDC账号已被注册' },
        { status: 409 }
      );
    }

    // 创建用户
    try {
      // 生成随机密码(OIDC用户不需要密码登录)
      const randomPassword = crypto.randomUUID();

      // 获取默认用户组
      const defaultTags = siteConfig.DefaultUserTags && siteConfig.DefaultUserTags.length > 0
        ? siteConfig.DefaultUserTags
        : undefined;

      // 使用新版本创建用户（带SHA256加密和OIDC绑定）
      await db.createUserV2(username, randomPassword, 'user', defaultTags, oidcSession.sub);

      // 设置认证cookie
      const response = NextResponse.json({ ok: true, message: '注册成功' });
      const userAgent = request.headers.get('user-agent') || 'Unknown';
      const deviceInfo = getDeviceInfo(userAgent);
      const cookieValue = await generateAuthCookie(username, 'user', deviceInfo);
      const expires = new Date(Date.now() + TOKEN_CONFIG.REFRESH_TOKEN_AGE);

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure: false,
      });

      // 清除OIDC session
      response.cookies.delete('oidc_session');

      return response;
    } catch (err) {
      console.error('创建用户失败', err);
      return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
    }
  } catch (error) {
    console.error('OIDC注册完成失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
