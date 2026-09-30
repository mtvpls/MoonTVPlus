'use client';

import type { VideoContext } from '@/lib/ai-orchestrator';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  retryMessage?: string;
  toolCalls?: Array<{
    name: string;
    key?: string;
    args?: unknown;
    result?: string;
    ok?: boolean;
  }>;
  compressedSummaries?: string[];
}

const HISTORY_PREFIX = 'ai-chat:v2:';
export const AI_CHAT_HISTORY_CHANGED = 'moontv:ai-chat-history-changed';

/** A client-side storage namespace, not a substitute for server authentication. */
export function getAIChatUsername(): string | null {
  const username = getAuthInfoFromBrowserCookie()?.username;
  return typeof username === 'string' && username.trim() ? username : null;
}

export function getAIChatStorageKey(
  username: string | null,
  context?: Pick<VideoContext, 'title' | 'year' | 'type'>
): string | null {
  if (!username?.trim()) return null;
  const scope = context?.title
    ? ['video', context.title, context.year || '', context.type || '']
    : ['general'];
  // JSON tuples avoid collisions between usernames/titles containing separators.
  return `${HISTORY_PREFIX}${JSON.stringify([username, scope])}`;
}

function belongsToCurrentUser(key: string | null): key is string {
  if (typeof window === 'undefined' || !key?.startsWith(HISTORY_PREFIX)) {
    return false;
  }
  try {
    const scope: unknown = JSON.parse(key.slice(HISTORY_PREFIX.length));
    const username = getAIChatUsername();
    return !!username && Array.isArray(scope) && scope[0] === username;
  } catch {
    return false;
  }
}

function isChatMessage(value: unknown): value is AIChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<AIChatMessage>;
  return (
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    (message.error === undefined || typeof message.error === 'boolean') &&
    (message.retryMessage === undefined ||
      typeof message.retryMessage === 'string') &&
    (message.compressedSummaries === undefined ||
      (Array.isArray(message.compressedSummaries) &&
        message.compressedSummaries.every(
          (item) => typeof item === 'string'
        ))) &&
    (message.toolCalls === undefined ||
      (Array.isArray(message.toolCalls) &&
        message.toolCalls.every(
          (item) =>
            item &&
            typeof item === 'object' &&
            typeof item.name === 'string' &&
            (item.key === undefined || typeof item.key === 'string') &&
            (item.result === undefined || typeof item.result === 'string') &&
            (item.ok === undefined || typeof item.ok === 'boolean')
        )))
  );
}

export function readAIChatHistory(key: string | null): AIChatMessage[] {
  if (!belongsToCurrentUser(key)) return [];
  try {
    // Deliberately never fall back to legacy ai-chat-general / ai-chat-* keys:
    // they carry no owner information and cannot be safely assigned to a user.
    const saved: unknown = JSON.parse(
      window.sessionStorage.getItem(key) || '[]'
    );
    return Array.isArray(saved) && saved.every(isChatMessage) ? saved : [];
  } catch {
    // Storage may be disabled, full or contain malformed data.
    return [];
  }
}

function notifyHistoryChanged(key: string): void {
  window.dispatchEvent(
    new CustomEvent(AI_CHAT_HISTORY_CHANGED, { detail: { key } })
  );
}

export function writeAIChatHistory(
  key: string | null,
  messages: AIChatMessage[]
): void {
  // Prevent a late response/effect from persisting after an account switch.
  if (!belongsToCurrentUser(key)) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(messages));
    notifyHistoryChanged(key);
  } catch {
    // An unavailable browser cache must not interrupt the live conversation.
  }
}

export function clearAIChatHistory(key: string | null): void {
  if (!belongsToCurrentUser(key)) return;
  try {
    window.sessionStorage.removeItem(key);
    notifyHistoryChanged(key);
  } catch {
    // Keep the current UI usable when browser storage is blocked.
  }
}
