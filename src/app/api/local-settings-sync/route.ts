/* eslint-disable no-console */

import { createHash } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { validateLocalSettingsPayload } from '@/lib/local-settings-sync';

export const runtime = 'nodejs';

// 存储类型：仅关系型（D1/Postgres/Turso/SQLite）与 Redis 系列支持云同步
function isSyncStorageSupported(): boolean {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  return (
    storageType === 'd1' ||
    storageType === 'postgres' ||
    storageType === 'turso' ||
    storageType === 'redis' ||
    storageType === 'upstash' ||
    storageType === 'kvrocks'
  );
}

// 获取全局同步模式（来自管理员配置，默认关闭）
async function getSyncMode(): Promise<'off' | 'manual' | 'auto'> {
  try {
    const config = await getConfig();
    const mode = config.SiteConfig?.LocalSettingsSyncMode;
    if (mode === 'manual' || mode === 'auto') return mode;
  } catch (err) {
    console.error('获取云同步模式失败:', err);
  }
  return 'off';
}

function isLoggedIn(request: NextRequest): string | null {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) return null;
  return authInfo.username;
}

// 探测接口：前端初始化时调用，返回模式与可用性
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  if (searchParams.get('mode') === 'config') {
    const supported = isSyncStorageSupported();
    const username = isLoggedIn(request);
    const mode = supported ? await getSyncMode() : 'off';
    return NextResponse.json({
      enabled: supported && Boolean(username),
      mode,
      serverTime: Date.now(),
    });
  }

  // 拉取远端副本
  if (!isSyncStorageSupported()) {
    return NextResponse.json(
      { error: '当前存储类型不支持云同步' },
      { status: 400 }
    );
  }
  const username = isLoggedIn(request);
  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const mode = await getSyncMode();
  if (mode === 'off') {
    return NextResponse.json({ error: '云同步已关闭' }, { status: 400 });
  }

  const record = await db.getUserLocalSettings(username);
  if (!record) {
    return NextResponse.json({ payload: null, updatedAt: null });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(record.payload);
  } catch {
    // payload 损坏时返回 null，前端视为无副本
  }

  return NextResponse.json({
    payload: parsed,
    updatedAt: record.updatedAt,
    serverTime: Date.now(),
  });
}

export async function PUT(request: NextRequest) {
  if (!isSyncStorageSupported()) {
    return NextResponse.json(
      { error: '当前存储类型不支持云同步' },
      { status: 400 }
    );
  }
  const username = isLoggedIn(request);
  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const mode = await getSyncMode();
  if (mode === 'off') {
    return NextResponse.json({ error: '云同步已关闭' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const validated = validateLocalSettingsPayload(
    (body as { payload?: unknown } | null)?.payload
  );
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { payload, size } = validated;

  // 确保用户存在（关系型外键会拒绝不存在的用户；这里显式校验避免脏数据）
  try {
    const exists = await db.checkUserExist(username);
    if (!exists) {
      return NextResponse.json({ error: '用户不存在' }, { status: 401 });
    }
  } catch {
    // checkUserExist 异常时继续尝试写入，交由存储层处理
  }

  const payloadString = JSON.stringify(payload);
  // 内容摘要：仅对 { version, data } 计算（不含 updatedAt），
  // 保证相同设置的多次备份得到一致的 md5，从而支持"无变化则跳过"。
  const payloadMd5 = createHash('md5')
    .update(JSON.stringify({ version: payload.version, data: payload.data }))
    .digest('hex');

  // 幂等去重：云端内容与本次上传一致则跳过写入，避免无意义覆盖与版本号自增
  try {
    const current = await db.getUserLocalSettings(username);
    if (current && current.payloadMd5 === payloadMd5) {
      return NextResponse.json({
        ok: true,
        changed: false,
        version: current.version,
        updatedAt: current.updatedAt,
        payloadMd5,
        serverTime: Date.now(),
      });
    }
  } catch (err) {
    console.error('查询云端设置失败，继续尝试写入:', err);
  }

  try {
    const result = await db.setUserLocalSettings(username, payloadString, {
      payloadMd5,
      payloadSize: size,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: '版本冲突，请重新拉取后重试' },
        { status: 409 }
      );
    }
    return NextResponse.json({
      ok: true,
      changed: true,
      version: result.version,
      updatedAt: result.updatedAt,
      payloadMd5,
      serverTime: Date.now(),
    });
  } catch (err) {
    console.error('保存云同步设置失败:', err);
    return NextResponse.json(
      { error: '保存失败，请稍后重试' },
      { status: 500 }
    );
  }
}
