-- ============================================
-- 播放记录增加 is_duanju 字段（继续观看据此进短剧竖屏页 /duanju/play）
-- ============================================

ALTER TABLE play_records ADD COLUMN is_duanju INTEGER DEFAULT 0;
