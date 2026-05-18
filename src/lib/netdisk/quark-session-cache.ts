import { base58Decode, base58Encode } from '@/lib/utils';

export interface QuarkNetdiskSessionFile {
  fid: string;
  name: string;
  size?: number;
  shareFidToken?: string;
  pdirFid?: string;
}

export interface QuarkNetdiskSession {
  id: string;
  provider: 'quark';
  title: string;
  shareUrl: string;
  passcode?: string;
  shareId: string;
  shareToken: string;
  files: QuarkNetdiskSessionFile[];
  savedFileIds: Record<string, string>;
  playFolderFid?: string;
  playFolderPath?: string;
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessionStore = new Map<string, QuarkNetdiskSession>();

export function buildQuarkNetdiskId(input: { shareUrl: string; passcode?: string }): string {
  return base58Encode(
    JSON.stringify({
      shareUrl: input.shareUrl,
      passcode: input.passcode || '',
    })
  );
}

export function parseQuarkNetdiskId(id: string): { shareUrl: string; passcode?: string } {
  try {
    const decoded = base58Decode(id);
    const parsed = JSON.parse(decoded);
    if (!parsed?.shareUrl || typeof parsed.shareUrl !== 'string') {
      throw new Error('invalid quark netdisk id');
    }
    return {
      shareUrl: parsed.shareUrl,
      passcode: typeof parsed.passcode === 'string' ? parsed.passcode : '',
    };
  } catch {
    throw new Error('无效的夸克网盘播放 ID');
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

export function createQuarkNetdiskSession(input: {
  title: string;
  shareUrl: string;
  passcode?: string;
  shareId: string;
  shareToken: string;
  files: QuarkNetdiskSessionFile[];
}): QuarkNetdiskSession {
  pruneExpiredSessions();
  const now = Date.now();
  const id = buildQuarkNetdiskId({ shareUrl: input.shareUrl, passcode: input.passcode });
  const session: QuarkNetdiskSession = {
    id,
    provider: 'quark',
    title: input.title,
    shareUrl: input.shareUrl,
    passcode: input.passcode,
    shareId: input.shareId,
    shareToken: input.shareToken,
    files: input.files,
    savedFileIds: {},
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  sessionStore.set(id, session);
  return session;
}

export function getQuarkNetdiskSession(id: string): QuarkNetdiskSession | null {
  pruneExpiredSessions();
  const session = sessionStore.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(id);
    return null;
  }
  return session;
}

export function refreshQuarkNetdiskSession(id: string): QuarkNetdiskSession | null {
  const session = getQuarkNetdiskSession(id);
  if (!session) return null;
  session.expiresAt = Date.now() + TTL_MS;
  sessionStore.set(id, session);
  return session;
}

