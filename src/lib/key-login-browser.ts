import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { db } from './db';
import { KeyLoginError } from './key-login';
import { getLegacyKeyBrowserNamespaces } from './key-login-browser-migration';

export const KEY_BROWSER_COOKIE = 'moontv_key_browser';
export const KEY_BROWSER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export interface KeyBrowserIdentity {
  username: string;
  cookieValue: string;
}

/**
 * New identities have no template/account namespace. A verified v1 cookie is
 * upgraded to v2 while keeping its exact database username and private data.
 * Legacy namespaces are upgrade metadata only, never login account bindings.
 */
export function getKeyBrowserIdentity(
  cookieValue?: string,
  legacyNamespaces: readonly string[] = []
): KeyBrowserIdentity {
  const secret = process.env.PASSWORD;
  if (!secret) throw new KeyLoginError('服务器认证配置不完整', 503);
  const sign = (parts: readonly string[]) =>
    createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex');
  const matches = (actual: string, expected: string) =>
    timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  const encode = (id: string, username: string): KeyBrowserIdentity => {
    if (username === process.env.USERNAME) {
      throw new KeyLoginError('浏览器账号配置冲突，请联系站长', 503);
    }
    const signature = sign(['moontv:key-browser:v2', id, username]);
    return {
      username,
      cookieValue: `v2.${id}.${username.slice('keyuser_'.length)}.${signature}`,
    };
  };

  if (!cookieValue) {
    const id = randomBytes(32).toString('hex');
    const username = `keyuser_${sign(['moontv:key-user:v2', id]).slice(0, 40)}`;
    return encode(id, username);
  }

  const current = cookieValue.match(
    /^v2\.([a-f0-9]{64})\.([a-f0-9]{40})\.([a-f0-9]{64})$/
  );
  if (current) {
    const [, id, userHash, signature] = current;
    const username = `keyuser_${userHash}`;
    if (matches(signature, sign(['moontv:key-browser:v2', id, username]))) {
      return encode(id, username);
    }
    throw new KeyLoginError('浏览器身份凭证无效，请联系站长恢复访问', 403);
  }

  const legacy = cookieValue.match(/^v1\.([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (legacy) {
    const [, id, signature] = legacy;
    for (const namespace of Array.from(new Set(['', ...legacyNamespaces]))) {
      if (matches(signature, sign(['moontv:key-browser:v1', namespace, id]))) {
        const username = `keyuser_${sign([
          'moontv:key-user:v1',
          namespace,
          id,
        ]).slice(0, 40)}`;
        return encode(id, username);
      }
    }
    // Keep the cookie intact rather than silently making an empty new account.
    throw new KeyLoginError(
      '无法恢复旧浏览器身份，请联系站长完成身份迁移；请勿清除本站 Cookie',
      503
    );
  }

  throw new KeyLoginError('浏览器身份凭证格式无效，请联系站长恢复访问', 403);
}

/** Called only after the shared key and CAPTCHA have been verified. */
export async function ensureKeyBrowserUser(
  cookieValue?: string,
  defaultUserTags?: string[]
): Promise<KeyBrowserIdentity> {
  // New and already-upgraded browsers never need the migration registry.
  const legacyNamespaces = cookieValue?.startsWith('v1.')
    ? await getLegacyKeyBrowserNamespaces()
    : [];
  const identity = getKeyBrowserIdentity(cookieValue, legacyNamespaces);
  let user = await db.getUserInfoV2(identity.username);
  if (!user) {
    if (cookieValue) {
      // A cookie is issued only after successful account creation. Do not
      // recreate deleted accounts or reset permissions on a failed DB read.
      throw new KeyLoginError('浏览器账号不存在或暂时不可用，请联系站长', 503);
    }
    try {
      await db.createUserV2(
        identity.username,
        randomBytes(32).toString('hex'),
        'user',
        defaultUserTags?.length ? [...defaultUserTags] : undefined,
        undefined,
        undefined
      );
    } catch (error) {
      user = await db.getUserInfoV2(identity.username);
      if (!user) throw error;
    }
    user = user || (await db.getUserInfoV2(identity.username));
    if (!user) throw new KeyLoginError('无法创建浏览器账号，请稍后重试', 503);
  }
  if (user.banned || user.role !== 'user') {
    throw new KeyLoginError('此浏览器账号已禁用或权限不匹配，请联系站长', 403);
  }
  return identity;
}
