-- 源站复用视频 ID、标题完全变更时停用收藏更新检查。
ALTER TABLE favorites ADD COLUMN is_invalid INTEGER NOT NULL DEFAULT 0;
