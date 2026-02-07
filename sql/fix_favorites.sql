-- 修复 favorites 表结构
-- 删除旧表（保留数据）
DROP TABLE IF EXISTS favorites_new;

-- 创建临时表（正确结构）
CREATE TABLE favorites_new (
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

-- 复制数据（只复制存在的字段）
INSERT INTO favorites_new (username, key, source_name, total_episodes, title, year, cover, save_time, search_title)
SELECT username, key, source_name, total_episodes, title, year, cover, save_time, search_title FROM favorites;

-- 删除旧表
DROP TABLE favorites;

-- 重命名新表
ALTER TABLE favorites_new RENAME TO favorites;

-- 重新创建索引
CREATE INDEX IF NOT EXISTS idx_favorites_save_time ON favorites(username, save_time DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_source ON favorites(username, source_name);
