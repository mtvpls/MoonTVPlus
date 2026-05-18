import { base58Decode, base58Encode } from '@/lib/utils';

export interface MobileNetdiskSessionFile {
  name: string;
  contentId: string;
  linkID: string;
  size?: number;
}

export interface MobileNetdiskSession {
  id: string;
  provider: 'mobile';
  title: string;
  shareUrl: string;
  passcode?: string;
  files: MobileNetdiskSessionFile[];
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessionStore = new Map<string, MobileNetdiskSession>();

export function buildMobileNetdiskId(input: {
  shareUrl: string;
  passcode?: string;
}): string {
  return base58Encode(JSON.stringify({
    shareUrl: input.shareUrl,
    passcode: input.passcode || '',
  }));
}

export function parseMobileNetdiskId(id: string): {
  shareUrl: string;
  passcode?: string;
} {
  try {
    const decoded = base58Decode(id);
    const parsed = JSON.parse(decoded);
    if (!parsed?.shareUrl || typeof parsed.shareUrl !== 'string') {
      throw new Error('invalid mobile netdisk id');
    }
    return {
      shareUrl: parsed.shareUrl,
      passcode: typeof parsed.passcode === 'string' ? parsed.passcode : '',
    };
  } catch {
    throw new Error('无效的移动云盘播放 ID');
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

export function createMobileNetdiskSession(input: {
  title: string;
  shareUrl: string;
  passcode?: string;
  files: MobileNetdiskSessionFile[];
}): MobileNetdiskSession {
  pruneExpiredSessions();
  const now = Date.now();
  const id = buildMobileNetdiskId({
    shareUrl: input.shareUrl,
    passcode: input.passcode,
  });
  const session: MobileNetdiskSession = {
    id,
    provider: 'mobile',
    title: input.title,
    shareUrl: input.shareUrl,
    passcode: input.passcode,
    files: input.files,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  sessionStore.set(session.id, session);
  return session;
}

export function getMobileNetdiskSession(id: string): MobileNetdiskSession | null {
  pruneExpiredSessions();
  const session = sessionStore.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(id);
    return null;
  }
  return session;
}

export function refreshMobileNetdiskSession(id: string): MobileNetdiskSession | null {
  const session = getMobileNetdiskSession(id);
  if (!session) return null;
  session.expiresAt = Date.now() + TTL_MS;
  sessionStore.set(id, session);
  return session;
}
