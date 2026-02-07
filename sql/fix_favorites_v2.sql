-- 修复 favorites 表结构
-- D1 不支持 ALTER TABLE RENAME，所以用这种方法

-- 1. 先复制数据到临时表（只复制正确的字段）
CREATE TABLE favorites_backup AS
SELECT username, key, source_name, total_episodes, title, year, cover, save_time, search_title
FROM favorites;

-- 2. 删除旧表
DROP TABLE favorites;

-- 3. 创建正确结构的表
CREATE TABLE favorites (
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

-- 4. 恢复数据
INSERT INTO favorites (username, key, source_name, total_episodes, title, year, cover, save_time, search_title)
SELECT username, key, source_name, total_episodes, title, year, cover, save_time, search_title FROM favorites_backup;

-- 5. 删除备份表
DROP TABLE favorites_backup;

-- 6. 创建索引
CREATE INDEX IF NOT EXISTS idx_favorites_save_time ON favorites(username, save_time DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_source ON favorites(username, source_name);
