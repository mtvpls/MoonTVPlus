import { base58Decode, base58Encode } from '@/lib/utils';

import type { Pan123ShareVideoFile } from './pan123.client';

export interface Pan123NetdiskSession {
  id: string;
  provider: 'pan123';
  title: string;
  shareUrl: string;
  passcode?: string;
  files: Pan123ShareVideoFile[];
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessionStore = new Map<string, Pan123NetdiskSession>();

export function buildPan123NetdiskId(input: { shareUrl: string; passcode?: string }) {
  return base58Encode(JSON.stringify({ shareUrl: input.shareUrl, passcode: input.passcode || '' }));
}

export function parsePan123NetdiskId(id: string): { shareUrl: string; passcode?: string } {
  try {
    const decoded = base58Decode(id);
    const parsed = JSON.parse(decoded);
    if (!parsed?.shareUrl || typeof parsed.shareUrl !== 'string') {
      throw new Error('invalid 123 netdisk id');
    }
    return {
      shareUrl: parsed.shareUrl,
      passcode: typeof parsed.passcode === 'string' ? parsed.passcode : '',
    };
  } catch {
    throw new Error('无效的123网盘播放 ID');
  }
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, value] of Array.from(sessionStore.entries())) {
    if (value.expiresAt <= now) sessionStore.delete(key);
  }
}

export function createPan123NetdiskSession(input: {
  title: string;
  shareUrl: string;
  passcode?: string;
  files: Pan123ShareVideoFile[];
}) {
  pruneExpiredSessions();
  const now = Date.now();
  const id = buildPan123NetdiskId({ shareUrl: input.shareUrl, passcode: input.passcode });
  const session: Pan123NetdiskSession = {
    id,
    provider: 'pan123',
    title: input.title,
    shareUrl: input.shareUrl,
    passcode: input.passcode,
    files: input.files,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  sessionStore.set(id, session);
  return session;
}

export function getPan123NetdiskSession(id: string): Pan123NetdiskSession | null {
  pruneExpiredSessions();
  const session = sessionStore.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(id);
    return null;
  }
  return session;
}

export function refreshPan123NetdiskSession(id: string): Pan123NetdiskSession | null {
  const session = getPan123NetdiskSession(id);
  if (!session) return null;
  session.expiresAt = Date.now() + TTL_MS;
  sessionStore.set(id, session);
  return session;
}
