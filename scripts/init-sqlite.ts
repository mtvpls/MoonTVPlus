import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

const dataDir = path.join(process.cwd(), '.data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'moontv.db');
const db = new Database(dbPath);

console.log('📦 Initializing SQLite database for development...');
console.log('📍 Database location:', dbPath);

const migrationPath = path.join(process.cwd(), 'migrations/001_initial_schema.sql');
if (!fs.existsSync(migrationPath)) {
  console.error('❌ Migration file not found:', migrationPath);
  process.exit(1);
}

const migrationSql = fs.readFileSync(migrationPath, 'utf8');

try {
  db.exec(migrationSql);
  console.log('✅ Database schema created successfully!');

  const username = process.env.USERNAME || 'admin';
  const password = process.env.PASSWORD || '123456789';
  const passwordHash = hashPassword(password);

  const statement = db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, role, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
    VALUES (?, ?, 'owner', ?, 1, 1, 1)
  `);

  statement.run(username, passwordHash, Date.now());
  console.log(`✅ Default admin user created: ${username}`);
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}

console.log('');
console.log('🎉 SQLite database initialized successfully!');
console.log('');
console.log('Next steps:');
console.log('1. Set NEXT_PUBLIC_STORAGE_TYPE=d1 in .env');
console.log('2. Run: npm run dev');