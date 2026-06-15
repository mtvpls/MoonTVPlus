export type MusicSource = 'wy' | 'tx' | 'kw' | 'kg' | 'mg';

export type MusicQuality = '128k' | '320k' | 'flac' | 'flac24bit';

export interface Song {
  id: string;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
  platform: MusicSource;
  duration?: number;
  durationText?: string;
  songmid?: string;
}

export interface Playlist {
  id: string;
  name: string;
  pic?: string;
  source?: MusicSource;
  updateFrequency?: string;
}
