-- Music V2 schema
CREATE TABLE IF NOT EXISTS music_v2_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  song_id TEXT NOT NULL,
  source TEXT NOT NULL,
  songmid TEXT,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  cover TEXT,
  duration_text TEXT,
  duration_sec REAL,
  play_progress_sec REAL NOT NULL DEFAULT 0,
  last_played_at INTEGER NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_quality TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_v2_playlists_username ON music_v2_playlists(username, updated_at DESC);

CREATE TABLE IF NOT EXISTS music_v2_playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  duration_sec REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES music_v2_playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_v2_playlist_items_playlist ON music_v2_playlist_items(playlist_id, sort_order ASC);
