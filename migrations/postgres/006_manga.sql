CREATE TABLE IF NOT EXISTS manga_shelf (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover TEXT,
  save_time BIGINT NOT NULL,
  description TEXT,
  author TEXT,
  status TEXT,
  last_chapter_id TEXT,
  last_chapter_name TEXT,
  latest_chapter_id TEXT,
  latest_chapter_name TEXT,
  latest_chapter_count INTEGER,
  unread_chapter_count INTEGER,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manga_shelf_user_time ON manga_shelf(username, save_time DESC);

ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS latest_chapter_id TEXT;
ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS latest_chapter_name TEXT;
ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS latest_chapter_count INTEGER;
ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS unread_chapter_count INTEGER;

CREATE TABLE IF NOT EXISTS manga_read_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover TEXT,
  chapter_id TEXT NOT NULL,
  chapter_name TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  save_time BIGINT NOT NULL,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manga_read_records_user_time ON manga_read_records(username, save_time DESC);
