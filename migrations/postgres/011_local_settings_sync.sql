-- 本地设置云同步（单表、每用户一行）for Postgres
-- 单副本：UPSERT 覆盖，不保留历史版本

CREATE TABLE IF NOT EXISTS user_local_settings (
  username     TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
  payload      TEXT NOT NULL,        -- 本地设置 JSON 快照 { version, data, updatedAt }
  payload_md5  TEXT NOT NULL,        -- payload 摘要，用于变化判断/去重
  payload_size INTEGER NOT NULL,     -- 字节数，用于非法/超大请求拦截
  version      INTEGER NOT NULL,     -- 乐观锁版本号，随每次覆盖自增
  updated_at   BIGINT NOT NULL       -- 毫秒时间戳
);

CREATE INDEX IF NOT EXISTS idx_user_local_settings_updated_at
  ON user_local_settings(updated_at DESC);
