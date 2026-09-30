import { db } from './db';
import { KeyLoginError } from './key-login';

// Upgrade metadata only: never an account binding or a source of permissions.
export const KEY_BROWSER_LEGACY_NAMESPACES_KEY =
  'key_login_browser_legacy_namespaces_v1';

const MAX_NAMESPACES = 100;
const MAX_NAMESPACE_LENGTH = 1024;

export async function getLegacyKeyBrowserNamespaces(): Promise<string[]> {
  const raw = await db.getGlobalValue(KEY_BROWSER_LEGACY_NAMESPACES_KEY);
  if (raw === null) return [];

  try {
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Invalid migration record');
    }
    const { version, namespaces } = record as {
      version?: unknown;
      namespaces?: unknown;
    };
    if (
      version !== 1 ||
      !Array.isArray(namespaces) ||
      namespaces.length > MAX_NAMESPACES ||
      namespaces.some(
        (namespace) =>
          typeof namespace !== 'string' ||
          namespace.length > MAX_NAMESPACE_LENGTH
      )
    ) {
      throw new Error('Invalid migration record');
    }
    return Array.from(new Set<string>(namespaces));
  } catch {
    // Do not silently issue a new identity when migration data is unavailable.
    throw new KeyLoginError('旧浏览器身份迁移配置无效，请联系站长', 503);
  }
}

/** One-time, operator-invoked upgrade; normal login never calls this write. */
export async function registerLegacyKeyBrowserNamespace(
  namespace: string
): Promise<void> {
  if (namespace.length > MAX_NAMESPACE_LENGTH) {
    throw new KeyLoginError('旧浏览器命名空间过长', 400);
  }
  // The empty namespace is always accepted by the v1 verifier.
  if (!namespace) return;
  const namespaces = await getLegacyKeyBrowserNamespaces();
  if (namespaces.includes(namespace)) return;
  if (namespaces.length >= MAX_NAMESPACES) {
    throw new KeyLoginError('旧浏览器命名空间数量超出限制', 503);
  }

  const expected = [...namespaces, namespace];
  await db.setGlobalValue(
    KEY_BROWSER_LEGACY_NAMESPACES_KEY,
    JSON.stringify({ version: 1, namespaces: expected })
  );
  // Some storage backends may not implement the optional setter. Verify it
  // before an operator removes the old environment setting.
  const saved = await getLegacyKeyBrowserNamespaces();
  if (expected.some((value) => !saved.includes(value))) {
    throw new KeyLoginError('旧浏览器身份迁移信息未保存，请勿删除旧配置', 503);
  }
}
