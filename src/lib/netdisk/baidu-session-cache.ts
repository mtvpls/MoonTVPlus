import { base58Decode, base58Encode } from '@/lib/utils';

export interface BaiduNetdiskSessionFile {
  fid: string;
  name: string;
  size?: number;
  path?: string;
}

export interface BaiduNetdiskSessionMeta {
  uk: string;
  shareid: string;
  randsk: string;
  shareId: string;
}

export interface BaiduNetdiskSession {
  id: string;
  provider: 'baidu';
  title: string;
  shareUrl: string;
  passcode?: string;
  files: BaiduNetdiskSessionFile[];
  meta: BaiduNetdiskSessionMeta;
  cookie: string;
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessionStore = new Map<string, BaiduNetdiskSession>();

export function buildBaiduNetdiskId(input: { shareUrl: string; passcode?: string }): string {
  return base58Encode(
    JSON.stringify({
      shareUrl: input.shareUrl,
      passcode: input.passcode || '',
    })
  );
}

export function parseBaiduNetdiskId(id: string): { shareUrl: string; passcode?: string } {
  try {
    const decoded = base58Decode(id);
    const parsed = JSON.parse(decoded);
    if (!parsed?.shareUrl || typeof parsed.shareUrl !== 'string') {
      throw new Error('invalid baidu netdisk id');
    }
    return {
      shareUrl: parsed.shareUrl,
      passcode: typeof parsed.passcode === 'string' ? parsed.passcode : '',
    };
  } catch {
    throw new Error('无效的百度网盘播放 ID');
  }
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, value] of Array.from(sessionStore.entries())) {
    if (value.expiresAt <= now) {
      sessionStore.delete(key);
    }
  }
}

export function createBaiduNetdiskSession(input: {
  title: string;
  shareUrl: string;
  passcode?: string;
  files: BaiduNetdiskSessionFile[];
  meta: BaiduNetdiskSessionMeta;
  cookie: string;
}): BaiduNetdiskSession {
  pruneExpiredSessions();
  const now = Date.now();
  const id = buildBaiduNetdiskId({ shareUrl: input.shareUrl, passcode: input.passcode });
  const session: BaiduNetdiskSession = {
    id,
    provider: 'baidu',
    title: input.title,
    shareUrl: input.shareUrl,
    passcode: input.passcode,
    files: input.files,
    meta: input.meta,
    cookie: input.cookie,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  sessionStore.set(id, session);
  return session;
}

export function getBaiduNetdiskSession(id: string): BaiduNetdiskSession | null {
  pruneExpiredSessions();
  const session = sessionStore.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(id);
    return null;
  }
  return session;
}

export function refreshBaiduNetdiskSession(id: string): BaiduNetdiskSession | null {
  const session = getBaiduNetdiskSession(id);
  if (!session) return null;
  session.expiresAt = Date.now() + TTL_MS;
  sessionStore.set(id, session);
  return session;
}
