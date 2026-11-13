-- ============================================
-- 补齐历史库 manga_shelf 缺的列
-- 006 在「书架更新通知」时追加了这几个列，但当时 006 已被历史库标记为
-- 已执行；SQLite 不支持 ADD COLUMN IF NOT EXISTS，init-sqlite / init-turso
-- 会忽略 duplicate column name，因此新库上这些语句会被跳过。
-- play_records.is_duanju 由 013 负责，无需在此重复。
-- ============================================

ALTER TABLE manga_shelf ADD COLUMN latest_chapter_id TEXT;
ALTER TABLE manga_shelf ADD COLUMN latest_chapter_name TEXT;
ALTER TABLE manga_shelf ADD COLUMN latest_chapter_count INTEGER;
ALTER TABLE manga_shelf ADD COLUMN unread_chapter_count INTEGER;
