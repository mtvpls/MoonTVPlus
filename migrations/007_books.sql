CREATE TABLE IF NOT EXISTS book_shelf (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  format TEXT,
  detail_href TEXT,
  acquisition_href TEXT,
  progress_percent REAL,
  last_read_time INTEGER,
  last_locator_type TEXT,
  last_locator_value TEXT,
  last_chapter_title TEXT,
  save_time INTEGER NOT NULL,
  PRIMARY KEY (username, key)
);
CREATE INDEX IF NOT EXISTS idx_book_shelf_user_time ON book_shelf(username, save_time DESC);

CREATE TABLE IF NOT EXISTS book_read_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  format TEXT NOT NULL,
  detail_href TEXT,
  acquisition_href TEXT,
  locator_type TEXT NOT NULL,
  locator_value TEXT NOT NULL,
  chapter_title TEXT,
  chapter_href TEXT,
  progress_percent REAL NOT NULL DEFAULT 0,
  save_time INTEGER NOT NULL,
  PRIMARY KEY (username, key)
);
CREATE INDEX IF NOT EXISTS idx_book_read_records_user_time ON book_read_records(username, save_time DESC);
