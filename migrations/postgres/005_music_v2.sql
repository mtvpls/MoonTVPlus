-- Music V2 schema
CREATE TABLE IF NOT EXISTS music_v2_history (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  song_id TEXT NOT NULL,
  source TEXT NOT NULL,
  songmid TEXT,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  cover TEXT,
  duration_text TEXT,
  duration_sec DOUBLE PRECISION,
  play_progress_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_played_at BIGINT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_quality TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(username, song_id),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_v2_history_username ON music_v2_history(username, last_played_at DESC);

CREATE TABLE IF NOT EXISTS music_v2_playlists (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  cover TEXT,
  song_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_v2_playlists_username ON music_v2_playlists(username, updated_at DESC);

CREATE TABLE IF NOT EXISTS music_v2_playlist_items (
  id BIGSERIAL PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  username TEXT NOT NULL,
  song_id TEXT NOT NULL,
  source TEXT NOT NULL,
  songmid TEXT,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  cover TEXT,
  duration_text TEXT,
  duration_sec DOUBLE PRECISION,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES music_v2_playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_v2_playlist_items_playlist ON music_v2_playlist_items(playlist_id, sort_order ASC);
