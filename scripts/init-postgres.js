/**
 * Vercel Postgres 数据库初始化脚本
 *
 * 创建数据库表结构并初始化默认管理员用户
 */

const { sql } = require('@vercel/postgres');
const crypto = require('crypto');

// SHA-256 加密密码
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

console.log('📦 Initializing Vercel Postgres database...');

// 读取迁移脚本
const fs = require('fs');
const path = require('path');

// 获取所有迁移文件
const migrationsDir = path.join(__dirname, '../migrations/postgres');
if (!fs.existsSync(migrationsDir)) {
  console.error('❌ Migrations directory not found:', migrationsDir);
  process.exit(1);
}

// 读取并排序所有 .sql 文件
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(file => file.endsWith('.sql'))
  .sort(); // 按文件名排序，确保按顺序执行

if (migrationFiles.length === 0) {
  console.error('❌ No migration files found in:', migrationsDir);
  process.exit(1);
}

console.log(`📄 Found ${migrationFiles.length} migration file(s):`, migrationFiles.join(', '));

async function init() {
  try {
    // 执行所有迁移脚本
    console.log('🔧 Running database migrations...');

    for (const migrationFile of migrationFiles) {
      const sqlPath = path.join(migrationsDir, migrationFile);
      console.log(`  ⏳ Executing ${migrationFile}...`);

      const schemaSql = fs.readFileSync(sqlPath, 'utf8');

      // 将 SQL 脚本按语句分割并逐个执行
      const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const statement of statements) {
        await sql.query(statement);
      }

      console.log(`  ✅ ${migrationFile} executed successfully`);
    }

    console.log('✅ All migrations completed successfully!');

    // 创建默认管理员用户
    const username = process.env.USERNAME || 'admin';
    const password = process.env.PASSWORD || '123456789';
    const passwordHash = hashPassword(password);

    console.log('👤 Creating default admin user...');
    await sql`
      INSERT INTO users (username, password_hash, role, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
      VALUES (${username}, ${passwordHash}, 'owner', ${Date.now()}, 1, 1, 1)
      ON CONFLICT (username) DO NOTHING
    `;
    console.log(`✅ Default admin user created: ${username}`);

    console.log('');
    console.log('🎉 Vercel Postgres database initialized successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Set NEXT_PUBLIC_STORAGE_TYPE=postgres in .env');
    console.log('2. Set POSTGRES_URL environment variable');
    console.log('3. Run: npm run dev');
  } catch (err) {
    console.error('❌ Initialization failed:', err);
    process.exit(1);
  }
}

init();
