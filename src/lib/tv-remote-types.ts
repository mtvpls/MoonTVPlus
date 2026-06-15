export type TVRemoteKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'menu'
  | 'home'
  | 'playPause'
  | 'pageUp'
  | 'pageDown'
  | 'digit';

export type TVRemoteTextMode = 'replace' | 'append' | 'backspace' | 'clear';

export interface TVRemoteDevice {
  deviceId: string;
  deviceName: string;
  currentPath: string;
  title?: string;
  lastActiveAt: number;
}

export interface TVRemoteKeyCommand {
  key: TVRemoteKey;
  repeat?: boolean;
  digit?: string;
}

export interface TVRemoteTextCommand {
  mode: TVRemoteTextMode;
  text?: string;
}
