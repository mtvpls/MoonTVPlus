-- ============================================
-- Web Push notifications for Postgres
-- 版本: 008
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
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_success_at BIGINT,
  last_failure_at BIGINT,
  failure_count INTEGER DEFAULT 0,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_username ON notification_push_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_token ON notification_push_subscriptions(username, token_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled ON notification_push_subscriptions(username, enabled);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
