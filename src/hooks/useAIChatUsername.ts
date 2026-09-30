'use client';

import { useSyncExternalStore } from 'react';

import { getAIChatUsername } from '@/lib/ai-chat-history';

const listeners = new Set<() => void>();
let stopWatching: (() => void) | undefined;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!stopWatching) {
    const notify = () => listeners.forEach((listener) => listener());
    window.addEventListener('focus', notify);
    window.addEventListener('pageshow', notify);
    window.addEventListener('storage', notify);
    document.addEventListener('visibilitychange', notify);
    // Cookie writes do not emit a standard storage event. This shared, local-only
    // check also handles logout/login in another tab while this tab remains open.
    const timer = window.setInterval(notify, 1000);
    stopWatching = () => {
      window.removeEventListener('focus', notify);
      window.removeEventListener('pageshow', notify);
      window.removeEventListener('storage', notify);
      document.removeEventListener('visibilitychange', notify);
      window.clearInterval(timer);
    };
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = undefined;
    }
  };
}

const getServerSnapshot = () => null;

/** No credentials are stored here and no authentication/network request is made. */
export function useAIChatUsername(): string | null {
  return useSyncExternalStore(subscribe, getAIChatUsername, getServerSnapshot);
}
