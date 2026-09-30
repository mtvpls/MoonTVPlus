import { createHash, timingSafeEqual } from 'crypto';

import { isKeyLoginEnabled } from './key-login-config';

export type KeyLoginIdentity =
  | { kind: 'user' }
  | { kind: 'admin'; username: string };

export class KeyLoginError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'KeyLoginError';
  }
}

// Compare fixed-size digests so key length does not affect timingSafeEqual.
function keysEqual(value: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(value), digest(expected));
}

/** Server-only credential resolution. No account is created or promoted here. */
export function resolveKeyLogin(accessKey: unknown): KeyLoginIdentity {
  if (
    typeof accessKey !== 'string' ||
    !accessKey.trim() ||
    accessKey.length > 1024
  ) {
    throw new KeyLoginError('请输入有效的访问密钥', 400);
  }

  // Local storage's legacy authentication exposes PASSWORD in the cookie.
  // Never issue that owner credential to a holder of a regular access key.
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    throw new KeyLoginError(
      '本地存储模式请使用密码登录；分角色密钥登录需要数据库存储',
      400
    );
  }

  if (!isKeyLoginEnabled()) {
    throw new KeyLoginError('站点未启用密钥登录，请使用密码登录', 503);
  }
  const userKey = process.env.SITE_USER_ACCESS_KEY || '';
  // The owner reuses the original server-side password, never a second secret.
  const adminKey = process.env.PASSWORD || '';
  if (keysEqual(userKey, adminKey)) {
    throw new KeyLoginError(
      '普通访问密钥不能与管理员密码 PASSWORD 相同，请联系站长修改配置',
      503
    );
  }

  // Always compare both; the client cannot choose a role or target account.
  const userMatch = keysEqual(accessKey, userKey) && !!userKey.trim();
  const adminMatch = keysEqual(accessKey, adminKey) && !!adminKey.trim();
  if (!userMatch && !adminMatch) {
    throw new KeyLoginError('密钥错误', 401);
  }

  // Ordinary keys never select an existing account. PASSWORD authenticates the
  // same env-defined owner as /api/login; the client cannot choose that identity.
  if (!adminMatch) return { kind: 'user' };
  const username = process.env.USERNAME;
  if (!username?.trim()) {
    throw new KeyLoginError('管理员账号配置不完整，请检查 USERNAME', 503);
  }
  return { kind: 'admin', username };
}
