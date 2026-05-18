import { base58Decode, base58Encode } from '@/lib/utils';

import type { Pan115ShareVideoFile } from './pan115.client';

export interface Pan115NetdiskSession {
  id: string;
  provider: '115';
  title: string;
  shareUrl: string;
  passcode?: string;
  files: Pan115ShareVideoFile[];
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessionStore = new Map<string, Pan115NetdiskSession>();

export function buildPan115NetdiskId(input: { shareUrl: string; passcode?: string }) {
  return base58Encode(JSON.stringify({ shareUrl: input.shareUrl, passcode: input.passcode || '' }));
}

export function parsePan115NetdiskId(id: string): { shareUrl: string; passcode?: string } {
  try {
    const decoded = base58Decode(id);
    const parsed = JSON.parse(decoded);
    if (!parsed?.shareUrl || typeof parsed.shareUrl !== 'string') throw new Error('invalid 115 netdisk id');
    return {
      shareUrl: parsed.shareUrl,
      passcode: typeof parsed.passcode === 'string' ? parsed.passcode : '',
    };
  } catch {
    throw new Error('无效的115网盘播放 ID');
  }
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, value] of Array.from(sessionStore.entries())) {
    if (value.expiresAt <= now) sessionStore.delete(key);
  }
}

export function createPan115NetdiskSession(input: {
  title: string;
  shareUrl: string;
  passcode?: string;
  files: Pan115ShareVideoFile[];
}): Pan115NetdiskSession {
  pruneExpiredSessions();
  const now = Date.now();
  const id = buildPan115NetdiskId({ shareUrl: input.shareUrl, passcode: input.passcode });
  const session: Pan115NetdiskSession = {
    id,
    provider: '115',
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

export function getPan115NetdiskSession(id: string): Pan115NetdiskSession | null {
  pruneExpiredSessions();
  const session = sessionStore.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(id);
    return null;
  }
  return session;
}

export function refreshPan115NetdiskSession(id: string): Pan115NetdiskSession | null {
  const session = getPan115NetdiskSession(id);
  if (!session) return null;
  session.expiresAt = Date.now() + TTL_MS;
  sessionStore.set(id, session);
  return session;
}
