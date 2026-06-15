-- ============================================
-- Web Push notifications
-- 版本: 008
-- 说明:
-- - SQLite/D1 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS。
-- - init-sqlite 使用 schema_migrations 保证该迁移只执行一次。
-- - 本地 init-sqlite 会逐条执行并忽略 duplicate column name。
-- ============================================

CREATE TABLE IF NOT EXISTS notification_push_subscriptions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  token_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  failure_count INTEGER DEFAULT 0,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_username ON notification_push_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_token ON notification_push_subscriptions(username, token_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled ON notification_push_subscriptions(username, enabled);

-- Rebuild notifications without type CHECK so TS NotificationType is the source of truth.
CREATE TABLE IF NOT EXISTS notifications_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  read INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

INSERT OR IGNORE INTO notifications_new (id, username, type, title, message, timestamp, read, metadata)
SELECT id, username, type, title, message, timestamp, read, metadata FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(username, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(username, read, timestamp DESC);

