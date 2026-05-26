-- ============================================
-- MoonTV Plus - 访问统计表 (PostgreSQL)
-- 版本: 1.0.0
-- 创建时间: 2026-05-26
-- ============================================

-- 访问统计表（按日期统计 PV/UV）
CREATE TABLE IF NOT EXISTS visit_stats (
  date TEXT PRIMARY KEY, -- 格式: YYYY-MM-DD
  pv INTEGER NOT NULL DEFAULT 0, -- 页面访问量
  uv INTEGER NOT NULL DEFAULT 0, -- 独立访客数
  updated_at INTEGER NOT NULL
);

-- 访问记录表（用于统计 UV）
CREATE TABLE IF NOT EXISTS visit_records (
  id SERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL, -- 访客唯一标识（基于 IP 或浏览器指纹）
  date TEXT NOT NULL, -- 格式: YYYY-MM-DD
  first_visit INTEGER NOT NULL, -- 首次访问时间戳
  CONSTRAINT unique_visitor_date UNIQUE(visitor_id, date)
);

CREATE INDEX IF NOT EXISTS idx_visit_records_date ON visit_records(date);
CREATE INDEX IF NOT EXISTS idx_visit_records_visitor ON visit_records(visitor_id);
