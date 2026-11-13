-- ============================================
-- 补齐历史库 manga_shelf 缺的列
-- 006 在「书架更新通知」时追加了这几个列，但当时 006 已被历史库标记为
-- 已执行；play_records.is_duanju 由 013 负责，无需在此重复。
-- ============================================

ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS latest_chapter_id TEXT;
ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS latest_chapter_name TEXT;
ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS latest_chapter_count INTEGER;
ALTER TABLE manga_shelf ADD COLUMN IF NOT EXISTS unread_chapter_count INTEGER;
