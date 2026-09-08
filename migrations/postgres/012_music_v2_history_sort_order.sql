-- ============================================
-- 音乐播放队列可拖拽排序：music_v2_history 增加显式排序字段 for Postgres
-- sort_order 用浮点数，拖拽时取前后邻居的中值，单条写入即可完成重排
-- ============================================

ALTER TABLE music_v2_history
  ADD COLUMN IF NOT EXISTS sort_order DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 回填：沿用原有队列顺序（created_at ASC, id ASC），赋予步长 1000 的稀疏序号。
-- 从小数值起步而非直接用 created_at，是为了给后续的中值插入留足浮点精度。
UPDATE music_v2_history
SET sort_order = 1000.0 * (
  SELECT COUNT(*)
  FROM music_v2_history AS h2
  WHERE h2.username = music_v2_history.username
    AND (
      h2.created_at < music_v2_history.created_at
      OR (h2.created_at = music_v2_history.created_at AND h2.id <= music_v2_history.id)
    )
);

CREATE INDEX IF NOT EXISTS idx_music_v2_history_sort_order
  ON music_v2_history(username, sort_order ASC);
