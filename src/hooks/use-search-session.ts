import { useCallback, useRef } from 'react';

/** Opaque IDs follow chat history, never the user's title or identity. */
export function useSearchSession(storageKey: string) {
  const current = useRef<{ key: string; id: string }>();
  const getSessionId = useCallback(() => {
    if (current.current?.key === storageKey) return current.current.id;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(storageKey + ':search-session');
    } catch {
      // A tab-local conversation still works when browser storage is disabled.
    }
    const id =
      saved && /^[a-f0-9]{32}$/.test(saved)
        ? saved
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
            n.toString(16).padStart(2, '0')
          ).join('');
    current.current = { key: storageKey, id };
    try {
      sessionStorage.setItem(storageKey + ':search-session', id);
    } catch {
      // Keep the in-memory ID for follow-up calls and retries.
    }
    return id;
  }, [storageKey]);
  const resetSession = useCallback(() => {
    current.current = undefined;
    try {
      sessionStorage.removeItem(storageKey + ':search-session');
    } catch {
      // Clearing a chat must still reset its in-memory ID.
    }
  }, [storageKey]);
  return { getSessionId, resetSession };
}
