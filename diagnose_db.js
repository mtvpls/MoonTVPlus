/**
 * 数据库诊断工具
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_FILE = path.join(__dirname, '.sqlite', 'moontv.db');

async function diagnose() {
  console.log('='.repeat(60));
  console.log('🔍 MoonTVPlus 数据库诊断');
  console.log('='.repeat(60));

  // 1. 检查数据库文件
  console.log('\n1️⃣ 检查数据库文件...');
  if (fs.existsSync(DB_FILE)) {
    console.log(`✅ 数据库文件存在: ${DB_FILE}`);
    const stats = fs.statSync(DB_FILE);
    console.log(`   大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.log(`❌ 数据库文件不存在: ${DB_FILE}`);
    console.log('💡 建议：运行 npm run init:sqlite 初始化数据库');
    return;
  }

  // 2. 检查关键表
  console.log('\n2️⃣ 检查关键表...');
  const db = new Database(DB_FILE);

  const tables = ['users', 'play_records', 'favorites'];
  for (const table of tables) {
    try {
      const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
      console.log(`✅ ${table}: ${result.count} 条记录`);
    } catch (e) {
      console.log(`❌ ${table}: 表不存在或查询失败 - ${e.message}`);
    }
  }

  // 3. 检查用户
  console.log('\n3️⃣ 检查用户表...');
  try {
    const users = db.prepare('SELECT username, role, playrecord_migrated FROM users LIMIT 10').all();
    console.log(`找到 ${users.length} 个用户:`);
    users.forEach(u => {
      console.log(`   - ${u.username} (${u.role}) - 播放记录迁移: ${u.playrecord_migrated ? '✅' : '❌'}`);
    });
  } catch (e) {
    console.log(`❌ 查询用户失败: ${e.message}`);
  }

  // 4. 检查播放记录
  console.log('\n4️⃣ 检查播放记录表结构...');
  try {
    const info = db.prepare('PRAGMA table_info(play_records)').all();
    console.log('播放记录表字段:');
    info.forEach(col => {
      console.log(`   ${col.name} (${col.type})`);
    });
  } catch (e) {
    console.log(`❌ 查询表结构失败: ${e.message}`);
  }

  // 5. 尝试插入测试数据
  console.log('\n5️⃣ 测试播放记录插入...');
  try {
    // 检查是否已有测试数据
    const existing = db.prepare('SELECT * FROM play_records WHERE username = ?').get('test_user');
    if (existing) {
      console.log('✅ 已有测试数据，尝试更新...');
      const update = db.prepare(`
        UPDATE play_records SET title = ? WHERE username = ?
      `);
      update.run('测试标题', 'test_user');
      console.log('✅ 更新测试数据成功');
    } else {
      console.log('🆕 插入测试数据...');
      const insert = db.prepare(`
        INSERT INTO play_records (username, key, title, source_name, cover, year, episode_index, total_episodes, play_time, total_time, save_time, search_title)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        'test_user',
        'test+123',
        '测试标题',
        '测试源',
        '',
        '',
        1,
        10,
        100,
        3600,
        Date.now(),
        '测试'
      );
      console.log('✅ 插入测试数据成功');
    }

    // 清理测试数据
    db.prepare('DELETE FROM play_records WHERE username = ?').run('test_user');
    console.log('🧹 已清理测试数据');

  } catch (e) {
    console.log(`❌ 测试失败: ${e.message}`);
    if (e.message.includes('FOREIGN KEY')) {
      console.log('💡 原因：用户不存在，需要先创建用户');
    }
  }

  db.close();

  console.log('\n' + '='.repeat(60));
  console.log('💡 建议:');
  console.log('='.repeat(60));
  console.log('1. 如果用户表为空，请先注册用户');
  console.log('2. 如果播放记录表不存在，运行 npm run init:sqlite');
  console.log('3. 如果外键约束失败，确保用户已存在于 users 表');
  console.log('4. 检查环境变量 NEXT_PUBLIC_STORAGE_TYPE 是否正确设置');
}

diagnate();
