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

const MIGRATION_BASELINE_CUTOFF = '008_web_push_notifications.sql';

function splitSqlStatements(schemaSql) {
  const withoutLineComments = schemaSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function tableExists(tableName) {
  const result = await sql.query(
    "SELECT to_regclass($1) AS table_name",
    [`public.${tableName}`]
  );
  return Boolean(result.rows?.[0]?.table_name);
}

async function ensureMigrationTable() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )
  `);
}

async function getAppliedMigrations() {
  const result = await sql.query('SELECT filename FROM schema_migrations');
  return new Set((result.rows || []).map((row) => row.filename));
}

async function markMigrationApplied(filename) {
  await sql.query(
    'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
    [filename, Date.now()]
  );
}

async function seedExistingMigrationBaseline(hadExistingSchema) {
  const applied = await getAppliedMigrations();
  if (!hadExistingSchema || applied.size > 0) return;

  for (const file of migrationFiles) {
    if (file.localeCompare(MIGRATION_BASELINE_CUTOFF) < 0) {
      await markMigrationApplied(file);
    }
  }
}

async function init() {
  try {
    // 执行所有迁移脚本
    console.log('🔧 Running database migrations...');
    const hadExistingSchema = await tableExists('users');
    await ensureMigrationTable();
    await seedExistingMigrationBaseline(hadExistingSchema);

    for (const migrationFile of migrationFiles) {
      const applied = await getAppliedMigrations();
      if (applied.has(migrationFile)) {
        console.log(`  ⏭️ ${migrationFile} already applied`);
        continue;
      }

      const sqlPath = path.join(migrationsDir, migrationFile);
      console.log(`  ⏳ Executing ${migrationFile}...`);

      const schemaSql = fs.readFileSync(sqlPath, 'utf8');
      const statements = splitSqlStatements(schemaSql);

      for (const statement of statements) {
        await sql.query(statement);
      }

      await markMigrationApplied(migrationFile);
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
