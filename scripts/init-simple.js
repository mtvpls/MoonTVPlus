/**
 * 手动初始化 SQLite 数据库
 * 不依赖 sqlite3 命令行工具
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '.sqlite', 'moontv.db');

// SQL 初始化脚本
const SCHEMA = `
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'user')),
  banned INTEGER DEFAULT 0,
  tags TEXT,
  oidc TEXT UNIQUE,
  enabled_apis TEXT,
  created_at INTEGER NOT NULL,
  playrecord_migrated INTEGER DEFAULT 0,
  favorite_migrated INTEGER DEFAULT 0,
  skip_migrated INTEGER DEFAULT 0,
  last_movie_request_time INTEGER,
  email TEXT,
  email_notifications INTEGER DEFAULT 1
);

-- 播放记录表
CREATE TABLE IF NOT EXISTS play_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  cover TEXT,
  year TEXT,
  episode_index INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  play_time INTEGER NOT NULL,
  total_time INTEGER NOT NULL,
  save_time INTEGER NOT NULL,
  search_title TEXT,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  total_episodes INTEGER NOT NULL,
  title TEXT NOT NULL,
  year TEXT,
  cover TEXT,
  save_time INTEGER NOT NULL,
  search_title TEXT,
  origin TEXT CHECK(origin IN ('vod', 'live')),
  is_completed INTEGER DEFAULT 0,
  vod_remarks TEXT,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 搜索历史表
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  keyword TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
  UNIQUE(username, keyword)
);

-- 跳过配置表
CREATE TABLE IF NOT EXISTS skip_configs (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  enable INTEGER NOT NULL DEFAULT 1,
  intro_time INTEGER NOT NULL DEFAULT 0,
  outro_time INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 弹幕过滤配置表
CREATE TABLE IF NOT EXISTS danmaku_filter_configs (
  username TEXT PRIMARY KEY,
  rules TEXT NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 通知表
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('favorite_update', 'system', 'announcement', 'movie_request', 'request_fulfilled')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  read INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 求片请求表
CREATE TABLE IF NOT EXISTS movie_requests (
  id TEXT PRIMARY KEY,
  tmdb_id INTEGER,
  title TEXT NOT NULL,
  year TEXT,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv')),
  season INTEGER,
  poster TEXT,
  overview TEXT,
  requested_by TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending', 'fulfilled')) DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  fulfilled_at INTEGER,
  fulfilled_source TEXT,
  fulfilled_id TEXT
);

-- 用户求片关联表
CREATE TABLE IF NOT EXISTS user_movie_requests (
  username TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (username, request_id),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES movie_requests(id) ON DELETE CASCADE
);

-- 全局配置表
CREATE TABLE IF NOT EXISTS global_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 管理员配置表
CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  config TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 收藏更新检查时间表
CREATE TABLE IF NOT EXISTS favorite_check_times (
  username TEXT PRIMARY KEY,
  last_check_time INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
`;

function initDatabase() {
  console.log('='.repeat(60));
  console.log('🚀 MoonTVPlus SQLite 数据库初始化');
  console.log('='.repeat(60));

  // 确保目录存在
  const dbDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`✅ 创建目录: ${dbDir}`);
  }

  // 如果数据库已存在，先备份
  if (fs.existsSync(DB_FILE)) {
    const backupFile = DB_FILE + '.backup-' + Date.now();
    fs.copyFileSync(DB_FILE, backupFile);
    console.log(`💾 已备份原数据库: ${backupFile}`);
  }

  // 使用 sql.js (纯JavaScript实现的SQLite)
  // 注意：这里创建一个极简的初始化方式
  console.log('\n📝 由于 better-sqlite3 安装失败，请选择以下方案之一:\n');
  console.log('方案 1: 安装 sql.js (纯JS实现)');
  console.log('   npm install sql.js --legacy-peer-deps\n');
  console.log('方案 2: 使用 D1 数据库 (推荐)');
  console.log('   在 Cloudflare D1 中创建数据库，运行 migrations/*.sql\n');
  console.log('方案 3: 安装原生 SQLite3');
  console.log('   在 Windows 上安装 SQLite3 可能需要编译工具\n');
  console.log('='.repeat(60));

  // 创建一个占位文件，表示数据库需要初始化
  fs.writeFileSync(DB_FILE + '.needs_init', JSON.stringify({
    timestamp: Date.now(),
    message: '数据库需要初始化，请运行 npm run init:sqlite'
  }));
  console.log('\n✅ 已标记数据库需要初始化');
}

initDatabase();
