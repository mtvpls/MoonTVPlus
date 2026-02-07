-- ============================================
-- MoonTVPlus 完整数据库初始化脚本
-- 一键创建所有表、索引、初始数据
-- 使用方法：npx wrangler d1 execute mdhfuep --file=sql/init_complete.sql --remote
-- ============================================

-- 1. 全局配置表（最先创建，无依赖）
CREATE TABLE IF NOT EXISTS global_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_global_config_key ON global_config(key);

-- 2. 管理员配置表（单例）
CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  config TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 3. 用户表（被其他表引用）
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'user')),
  banned INTEGER DEFAULT 0,
  tags TEXT,
  oidc_sub TEXT UNIQUE,
  enabled_apis TEXT,
  created_at INTEGER NOT NULL,
  playrecord_migrated INTEGER DEFAULT 0,
  favorite_migrated INTEGER DEFAULT 0,
  skip_migrated INTEGER DEFAULT 0,
  last_movie_request_time INTEGER,
  email TEXT,
  email_notifications INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_oidc_sub ON users(oidc_sub) WHERE oidc_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- 4. 播放记录表（依赖 users）
CREATE TABLE IF NOT EXISTS play_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  cover TEXT,
  year TEXT,
  episode_index INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  play_time INTEGER NOT NULL,
  total_time INTEGER NOT NULL,
  save_time INTEGER NOT NULL,
  search_title TEXT,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_play_records_save_time ON play_records(username, save_time DESC);
CREATE INDEX IF NOT EXISTS idx_play_records_source ON play_records(username, source_name);

-- 5. 收藏表（依赖 users）
CREATE TABLE IF NOT EXISTS favorites (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  total_episodes INTEGER NOT NULL,
  title TEXT NOT NULL,
  year TEXT,
  cover TEXT,
  save_time INTEGER NOT NULL,
  search_title TEXT,
  origin TEXT CHECK(origin IN ('vod', 'live')),
  is_completed INTEGER DEFAULT 0,
  vod_remarks TEXT,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_favorites_save_time ON favorites(username, save_time DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_source ON favorites(username, source_name);

-- 6. 搜索历史表（依赖 users）
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  keyword TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
  UNIQUE(username, keyword)
);
CREATE INDEX IF NOT EXISTS idx_search_history_user_time ON search_history(username, created_at DESC);

-- 7. 跳过配置表（依赖 users）
CREATE TABLE IF NOT EXISTS skip_configs (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  enable INTEGER NOT NULL DEFAULT 1,
  intro_time INTEGER NOT NULL DEFAULT 0,
  outro_time INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skip_configs_user ON skip_configs(username);

-- 8. 弹幕过滤配置表（依赖 users）
CREATE TABLE IF NOT EXISTS danmaku_filter_configs (
  username TEXT PRIMARY KEY,
  rules TEXT NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 9. 通知表（依赖 users）
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('favorite_update', 'system', 'announcement', 'movie_request', 'request_fulfilled')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  read INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(username, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(username, read, timestamp DESC);

-- 10. 求片请求表（独立）
CREATE TABLE IF NOT EXISTS movie_requests (
  id TEXT PRIMARY KEY,
  tmdb_id INTEGER,
  title TEXT NOT NULL,
  year TEXT,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv')),
  season INTEGER,
  poster TEXT,
  overview TEXT,
  requested_by TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending', 'fulfilled')) DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  fulfilled_at INTEGER,
  fulfilled_source TEXT,
  fulfilled_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_movie_requests_status ON movie_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movie_requests_tmdb ON movie_requests(tmdb_id) WHERE tmdb_id IS NOT NULL;

-- 11. 用户求片关联表（依赖 users, movie_requests）
CREATE TABLE IF NOT EXISTS user_movie_requests (
  username TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (username, request_id),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES movie_requests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_movie_requests_user ON user_movie_requests(username);

-- 12. 收藏更新检查时间表（依赖 users）
CREATE TABLE IF NOT EXISTS favorite_check_times (
  username TEXT PRIMARY KEY,
  last_check_time INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- ============================================
-- 音乐相关表（D1 版本）
-- ============================================

-- 13. 音乐播放记录表（依赖 users）
CREATE TABLE IF NOT EXISTS music_play_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  platform TEXT NOT NULL,
  song_id TEXT NOT NULL,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  pic TEXT,
  play_time INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  save_time INTEGER NOT NULL,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_play_records_user ON music_play_records(username);
CREATE INDEX IF NOT EXISTS idx_music_play_records_save_time ON music_play_records(username, save_time DESC);

-- 14. 音乐歌单表（依赖 users）
CREATE TABLE IF NOT EXISTS music_playlists (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  cover TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_playlists_user ON music_playlists(username);
CREATE INDEX IF NOT EXISTS idx_music_playlists_created ON music_playlists(username, created_at DESC);

-- 15. 音乐歌单歌曲表（依赖 music_playlists）
CREATE TABLE IF NOT EXISTS music_playlist_songs (
  playlist_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  song_id TEXT NOT NULL,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  pic TEXT,
  duration INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, platform, song_id),
  FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_music_playlist_songs_playlist ON music_playlist_songs(playlist_id, sort_order);

-- ============================================
-- 初始数据
-- ============================================

-- 插入默认管理员配置
INSERT OR IGNORE INTO admin_config (id, config, updated_at)
VALUES (1, '{"title":"MoonTVPlus","subtitle":"","description":"","keywords":"","author":"","email":"","beian":"","customCss":"","logo":"","backgroundImage":"","defaultSource":"","search_sources":[""],"filter_configs":[],"danmaku_sources":[]}', 1704067200000);

-- 初始化全局配置
INSERT OR IGNORE INTO global_config (key, value, updated_at)
VALUES ('video.metainfo', '{"version":"1.0","lastUpdate":1704067200000,"sources":[]}', 1704067200000);

SELECT '✅ 数据库初始化完成！共创建 15 个表' as result;
