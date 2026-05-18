import { base58Decode, base58Encode } from '@/lib/utils';

export interface TianyiNetdiskSessionFile {
  name: string;
  fileId: string;
  shareId: string;
  size?: number;
}

export interface TianyiNetdiskSession {
  id: string;
  provider: 'tianyi';
  title: string;
  shareUrl: string;
  passcode?: string;
  shareId: string;
  shareMode: string;
  isFolder: string | number | boolean;
  accessCode: string;
  files: TianyiNetdiskSessionFile[];
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessionStore = new Map<string, TianyiNetdiskSession>();

export function buildTianyiNetdiskId(input: { shareUrl: string; passcode?: string }): string {
  return base58Encode(JSON.stringify({ shareUrl: input.shareUrl, passcode: input.passcode || '' }));
}

export function parseTianyiNetdiskId(id: string): { shareUrl: string; passcode?: string } {
  try {
    const decoded = base58Decode(id);
    const parsed = JSON.parse(decoded);
    if (!parsed?.shareUrl || typeof parsed.shareUrl !== 'string') {
      throw new Error('invalid tianyi netdisk id');
    }
    return {
      shareUrl: parsed.shareUrl,
      passcode: typeof parsed.passcode === 'string' ? parsed.passcode : '',
    };
  } catch {
    throw new Error('无效的天翼云盘播放 ID');
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

export function createTianyiNetdiskSession(input: {
  title: string;
  shareUrl: string;
  passcode?: string;
  shareId: string;
  shareMode: string;
  isFolder: string | number | boolean;
  accessCode: string;
  files: TianyiNetdiskSessionFile[];
}) {
  pruneExpiredSessions();
  const now = Date.now();
  const id = buildTianyiNetdiskId({ shareUrl: input.shareUrl, passcode: input.passcode });
  const session: TianyiNetdiskSession = {
    id,
    provider: 'tianyi',
    title: input.title,
    shareUrl: input.shareUrl,
    passcode: input.passcode,
    shareId: input.shareId,
    shareMode: input.shareMode,
    isFolder: input.isFolder,
    accessCode: input.accessCode,
    files: input.files,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  sessionStore.set(id, session);
  return session;
}

export function getTianyiNetdiskSession(id: string): TianyiNetdiskSession | null {
  pruneExpiredSessions();
  const session = sessionStore.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(id);
    return null;
  }
  return session;
}

export function refreshTianyiNetdiskSession(id: string): TianyiNetdiskSession | null {
  const session = getTianyiNetdiskSession(id);
  if (!session) return null;
  session.expiresAt = Date.now() + TTL_MS;
  sessionStore.set(id, session);
  return session;
}
