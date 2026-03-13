/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { lockManager } from '@/lib/lock';

export const runtime = 'nodejs';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

// 验证Cloudflare Turnstile Token
async function verifyTurnstileToken(
  token: string,
  secretKey: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          secret: secretKey,
          response: token,
        }),
      },
    );

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('Turnstile验证失败:', error);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // localStorage 模式不支持注册
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: 'localStorage模式不支持注册功能' },
        { status: 400 },
      );
    }

    // 获取站点配置
    const config = await getConfig();
    const siteConfig = config.SiteConfig;

    // 检查是否开启注册
    if (!siteConfig.EnableRegistration) {
      return NextResponse.json({ error: '注册功能未开启' }, { status: 403 });
    }

    const { username, password, turnstileToken } = await req.json();

    // 验证输入
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 验证用户名格式（只允许字母、数字、下划线，长度3-20）
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用户名只能包含字母、数字、下划线，长度3-20位' },
        { status: 400 },
      );
    }

    // 验证密码长度
    if (password.length < 6) {
      return NextResponse.json({ error: '密码长度至少为6位' }, { status: 400 });
    }

    // 检查是否与站长同名
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '该用户名不可用' }, { status: 409 });
    }

    // 获取用户名锁，防止并发注册
    let releaseLock: (() => void) | null = null;
    try {
      releaseLock = await lockManager.acquire(`register:${username}`);
    } catch (error) {
      return NextResponse.json(
        { error: '服务器繁忙，请稍后重试' },
        { status: 503 },
      );
    }

    try {
      // 检查用户是否已存在（只检查V2存储）
      const userExists = await db.checkUserExistV2(username);
      if (userExists) {
        return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
      }

      // 如果开启了Turnstile验证
      if (siteConfig.RegistrationRequireTurnstile) {
        if (!turnstileToken) {
          return NextResponse.json(
            { error: '请完成人机验证' },
            { status: 400 },
          );
        }

        if (!siteConfig.TurnstileSecretKey) {
          console.error('Turnstile Secret Key未配置');
          return NextResponse.json(
            { error: '服务器配置错误' },
            { status: 500 },
          );
        }

        // 验证Turnstile Token
        const isValid = await verifyTurnstileToken(
          turnstileToken,
          siteConfig.TurnstileSecretKey,
        );
        if (!isValid) {
          return NextResponse.json(
            { error: '人机验证失败，请重试' },
            { status: 400 },
          );
        }
      }

      // 创建用户
      try {
        // 使用新版本创建用户（带SHA256加密）
        const defaultTags =
          siteConfig.DefaultUserTags && siteConfig.DefaultUserTags.length > 0
            ? siteConfig.DefaultUserTags
            : undefined;

        await db.createUserV2(username, password, 'user', defaultTags);

        // 注册成功
        return NextResponse.json({ ok: true, message: '注册成功' });
      } catch (err: any) {
        console.error('创建用户失败', err);
        // 如果是用户已存在的错误，返回409
        if (err.message === '用户已存在') {
          return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
        }
        return NextResponse.json(
          { error: '注册失败，请稍后重试' },
          { status: 500 },
        );
      }
    } finally {
      // 释放锁
      if (releaseLock) {
        releaseLock();
      }
    }
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
