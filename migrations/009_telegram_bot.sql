-- Telegram Bot bindings and bind sessions

CREATE TABLE IF NOT EXISTS telegram_bindings (
  username TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  telegram_username TEXT,
  first_name TEXT,
  last_name TEXT,
  notifications_enabled INTEGER DEFAULT 1,
  bound_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_bindings_user_id ON telegram_bindings(telegram_user_id);

CREATE TABLE IF NOT EXISTS telegram_bind_sessions (
  code TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_bind_sessions_expires ON telegram_bind_sessions(expires_at);
