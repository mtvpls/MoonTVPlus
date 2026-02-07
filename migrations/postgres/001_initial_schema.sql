-- ============================================
-- MoonTV Plus - Vercel Postgres 数据库结构
-- 版本: 1.0.0
-- 创建时间: 2026-02-07
-- ============================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'user')),
  banned INTEGER DEFAULT 0,
  tags TEXT, -- JSON array: ["vip", "premium"]
  oidc_sub TEXT UNIQUE,
  enabled_apis TEXT, -- JSON array: ["api1", "api2"]
  created_at BIGINT NOT NULL,
  playrecord_migrated INTEGER DEFAULT 0,
  favorite_migrated INTEGER DEFAULT 0,
  skip_migrated INTEGER DEFAULT 0,
  last_movie_request_time BIGINT,
  email TEXT,
  email_notifications INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_oidc_sub ON users(oidc_sub) WHERE oidc_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- 2. 播放记录表
CREATE TABLE IF NOT EXISTS play_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL, -- format: "source+id" (e.g., "tmdb+12345")
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  cover TEXT,
  year TEXT,
  episode_index INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  play_time BIGINT NOT NULL, -- 播放进度（秒）
  total_time BIGINT NOT NULL, -- 总时长（秒）
  save_time BIGINT NOT NULL, -- 保存时间戳
  search_title TEXT,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_play_records_save_time ON play_records(username, save_time DESC);
CREATE INDEX IF NOT EXISTS idx_play_records_source ON play_records(username, source_name);

-- 3. 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  username TEXT NOT NULL,
  key TEXT NOT NULL, -- format: "source+id"
  source_name TEXT NOT NULL,
  total_episodes INTEGER NOT NULL,
  title TEXT NOT NULL,
  year TEXT,
  cover TEXT,
  save_time BIGINT NOT NULL,
  search_title TEXT,
  origin TEXT CHECK(origin IN ('vod', 'live')),
  is_completed INTEGER DEFAULT 0,
  vod_remarks TEXT,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_favorites_save_time ON favorites(username, save_time DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_source ON favorites(username, source_name);

-- 4. 搜索历史表
CREATE TABLE IF NOT EXISTS search_history (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  keyword TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
  UNIQUE(username, keyword)
);

CREATE INDEX IF NOT EXISTS idx_search_history_user_time ON search_history(username, timestamp DESC);

-- 5. 跳过配置表（片头片尾）
CREATE TABLE IF NOT EXISTS skip_configs (
  username TEXT NOT NULL,
  key TEXT NOT NULL, -- format: "source+id"
  enable INTEGER NOT NULL DEFAULT 1,
  intro_time INTEGER NOT NULL DEFAULT 0, -- 片头时长（秒）
  outro_time INTEGER NOT NULL DEFAULT 0, -- 片尾时长（秒）
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 6. 弹幕过滤配置表
CREATE TABLE IF NOT EXISTS danmaku_filter_configs (
  username TEXT PRIMARY KEY,
  rules TEXT NOT NULL, -- JSON array: [{"keyword": "xxx", "type": "normal", "enabled": true}]
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 7. 通知表
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('favorite_update', 'system', 'announcement', 'movie_request', 'request_fulfilled')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  read INTEGER DEFAULT 0,
  metadata TEXT, -- JSON object
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(username, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(username, read, timestamp DESC);

-- 8. 求片请求表
CREATE TABLE IF NOT EXISTS movie_requests (
  id TEXT PRIMARY KEY,
  tmdb_id INTEGER,
  title TEXT NOT NULL,
  year TEXT,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv')),
  season INTEGER,
  poster TEXT,
  overview TEXT,
  requested_by TEXT NOT NULL, -- JSON array: ["user1", "user2"]
  request_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending', 'fulfilled')) DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  fulfilled_at BIGINT,
  fulfilled_source TEXT,
  fulfilled_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_movie_requests_status ON movie_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movie_requests_tmdb ON movie_requests(tmdb_id) WHERE tmdb_id IS NOT NULL;

-- 9. 用户求片关联表（用于快速查询用户的求片记录）
CREATE TABLE IF NOT EXISTS user_movie_requests (
  username TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (username, request_id),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES movie_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_movie_requests_user ON user_movie_requests(username);

-- 10. 全局配置表（键值对存储）
CREATE TABLE IF NOT EXISTS global_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 11. 管理员配置表（单例）
CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY CHECK(id = 1), -- 确保只有一条记录
  config TEXT NOT NULL, -- JSON object
  updated_at BIGINT NOT NULL
);

-- 12. 收藏更新检查时间表
CREATE TABLE IF NOT EXISTS favorite_check_times (
  username TEXT PRIMARY KEY,
  last_check_time BIGINT NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
