import crypto from 'crypto';

export type QrLoginStatus = 'pending' | 'scanned' | 'confirmed' | 'expired' | 'cancelled' | 'used';

export interface QrLoginSession {
  token: string;
  status: QrLoginStatus;
  createdAt: number;
  expiresAt: number;
  authToken?: string;
  userAgent?: string;
}

export type QrLoginStoreMode = 'auto' | 'memory' | 'hybrid' | 'shared';
type ResolvedQrLoginStoreMode = Exclude<QrLoginStoreMode, 'auto'>;
type QrLoginStorageAdapter = {
  hSet?: (key: string, field: string, value: string) => Promise<unknown>;
  hGet?: (key: string, field: string) => Promise<string | null>;
  hGetAll?: (key: string) => Promise<Record<string, string>>;
  hDel?: (key: string, field: string) => Promise<unknown>;
};
type QrLoginStorage = { adapter?: QrLoginStorageAdapter };

type GlobalWithQr = typeof globalThis & { __moonTvQrLoginStore?: Map<string, QrLoginSession> };

const g = globalThis as GlobalWithQr;
export const qrLoginStore = g.__moonTvQrLoginStore || new Map<string, QrLoginSession>();
g.__moonTvQrLoginStore = qrLoginStore;

const QR_LOGIN_HASH_KEY = 'qr_login_sessions';
const VALID_STORE_MODES = new Set<QrLoginStoreMode>(['auto', 'memory', 'hybrid', 'shared']);

let getStorage: (() => unknown) | null = null;

function resolveQrLoginStoreMode(): ResolvedQrLoginStoreMode {
  const configuredMode = (process.env.QR_LOGIN_STORE_MODE || 'auto').toLowerCase() as QrLoginStoreMode;
  const mode = VALID_STORE_MODES.has(configuredMode) ? configuredMode : 'auto';

  if (mode !== 'auto') return mode;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const isCloudflare =
    process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';

  if (storageType === 'upstash' || isCloudflare) return 'hybrid';
  return 'memory';
}

async function loadStorage(required = false) {
  try {
    if (!getStorage) {
      const db = await import('@/lib/db');
      getStorage = db.getStorage;
    }
    const storage = getStorage() as QrLoginStorage | null;
    if (storage && typeof storage.adapter?.hGet === 'function') return storage;
  } catch (error) {
    if (required) throw error;
  }

  if (required) {
    throw new Error('QR login shared storage is unavailable');
  }

  return null;
}

async function readSharedQrLoginSession(token: string, required = false) {
  const storage = await loadStorage(required);
  if (!storage || typeof storage.adapter?.hGet !== 'function') return null;

  try {
    const raw = await storage.adapter.hGet(QR_LOGIN_HASH_KEY, token);
    if (!raw) return null;
    return JSON.parse(raw) as QrLoginSession;
  } catch (error) {
    if (required) throw error;
    try {
      await storage.adapter.hDel?.(QR_LOGIN_HASH_KEY, token);
    } catch {
      // ignore best-effort cleanup failures in hybrid mode
    }
    return null;
  }
}

async function persistQrLoginSession(session: QrLoginSession) {
  const mode = resolveQrLoginStoreMode();

  if (mode !== 'shared') {
    qrLoginStore.set(session.token, session);
  }

  if (mode === 'memory') return;

  const storage = await loadStorage(mode === 'shared');
  if (!storage || typeof storage.adapter?.hSet !== 'function') {
    if (mode === 'shared') throw new Error('QR login shared storage does not support hSet');
    return;
  }

  try {
    await storage.adapter.hSet(QR_LOGIN_HASH_KEY, session.token, JSON.stringify(session));
  } catch (error) {
    if (mode === 'shared') throw error;
  }
}

async function deletePersistedQrLoginSession(token: string) {
  const mode = resolveQrLoginStoreMode();

  if (mode !== 'shared') {
    qrLoginStore.delete(token);
  }

  if (mode === 'memory') return;

  const storage = await loadStorage(mode === 'shared');
  if (!storage || typeof storage.adapter?.hDel !== 'function') {
    if (mode === 'shared') throw new Error('QR login shared storage does not support hDel');
    return;
  }

  try {
    await storage.adapter.hDel(QR_LOGIN_HASH_KEY, token);
  } catch (error) {
    if (mode === 'shared') throw error;
  }
}

export async function createQrLoginSession(ttlMs = 120_000) {
  await cleanupQrLoginSessions();
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const session: QrLoginSession = {
    token,
    status: 'pending',
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  await persistQrLoginSession(session);
  return session;
}

export async function getQrLoginSession(token?: string | null) {
  if (!token) return null;
  const mode = resolveQrLoginStoreMode();
  let session: QrLoginSession | null = null;

  if (mode === 'memory') {
    session = qrLoginStore.get(token) || null;
  } else {
    session = await readSharedQrLoginSession(token, mode === 'shared');
    if (session && mode === 'hybrid') {
      qrLoginStore.set(token, session);
    } else if (!session && mode === 'hybrid') {
      session = qrLoginStore.get(token) || null;
    }
  }

  if (session && session.expiresAt <= Date.now() && session.status !== 'confirmed' && session.status !== 'used') {
    session.status = 'expired';
    await persistQrLoginSession(session);
  }
  return session;
}

export async function saveQrLoginSession(session: QrLoginSession) {
  await persistQrLoginSession(session);
}

export async function cleanupQrLoginSessions() {
  const mode = resolveQrLoginStoreMode();
  const now = Date.now();

  if (mode !== 'shared') {
    for (const [token, session] of Array.from(qrLoginStore.entries())) {
      if (session.expiresAt + 300_000 < now || session.status === 'used') {
        await deletePersistedQrLoginSession(token);
      }
    }
  }

  if (mode === 'memory') return;

  const storage = await loadStorage(mode === 'shared');
  if (!storage || typeof storage.adapter?.hGetAll !== 'function') {
    if (mode === 'shared') throw new Error('QR login shared storage does not support hGetAll');
    return;
  }

  let sessions: Record<string, string>;
  try {
    sessions = await storage.adapter.hGetAll(QR_LOGIN_HASH_KEY);
  } catch (error) {
    if (mode === 'shared') throw error;
    return;
  }

  for (const [token, raw] of Object.entries(sessions)) {
    try {
      const session = JSON.parse(raw as string) as QrLoginSession;
      if (session.expiresAt + 300_000 < now || session.status === 'used') {
        await deletePersistedQrLoginSession(token);
      }
    } catch {
      await deletePersistedQrLoginSession(token);
    }
  }
}
