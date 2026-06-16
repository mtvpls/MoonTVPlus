export type TVPlayerUpDownAction = 'wake-menu' | 'volume';

export const TV_PLAYER_UP_DOWN_ACTION_KEY = 'tv_player_up_down_action';
export const DEFAULT_TV_PLAYER_UP_DOWN_ACTION: TVPlayerUpDownAction =
  'wake-menu';

export function normalizeTVPlayerUpDownAction(
  value: unknown
): TVPlayerUpDownAction {
  return value === 'volume' ? 'volume' : DEFAULT_TV_PLAYER_UP_DOWN_ACTION;
}

export function loadTVPlayerUpDownAction(): TVPlayerUpDownAction {
  if (typeof window === 'undefined') return DEFAULT_TV_PLAYER_UP_DOWN_ACTION;

  try {
    return normalizeTVPlayerUpDownAction(
      localStorage.getItem(TV_PLAYER_UP_DOWN_ACTION_KEY)
    );
  } catch {
    return DEFAULT_TV_PLAYER_UP_DOWN_ACTION;
  }
}

export function saveTVPlayerUpDownAction(action: TVPlayerUpDownAction): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(TV_PLAYER_UP_DOWN_ACTION_KEY, action);
  } catch {
    // ignore localStorage failures in private/limited modes
  }
}
