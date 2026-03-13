import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { sql } from '@vercel/postgres';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

console.log('📦 Initializing Vercel Postgres database...');

const migrationsDir = path.join(process.cwd(), 'migrations/postgres');
if (!fs.existsSync(migrationsDir)) {
  console.error('❌ Migrations directory not found:', migrationsDir);
  process.exit(1);
}

const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.error('❌ No migration files found in:', migrationsDir);
  process.exit(1);
}

console.log(`📄 Found ${migrationFiles.length} migration file(s):`, migrationFiles.join(', '));

async function main(): Promise<void> {
  try {
    console.log('🔧 Running database migrations...');

    for (const migrationFile of migrationFiles) {
      const sqlPath = path.join(migrationsDir, migrationFile);
      console.log(`  ⏳ Executing ${migrationFile}...`);

      const schemaSql = fs.readFileSync(sqlPath, 'utf8');
      const statements = schemaSql
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

      for (const statement of statements) {
        await sql.query(statement);
      }

      console.log(`  ✅ ${migrationFile} executed successfully`);
    }

    console.log('✅ All migrations completed successfully!');

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
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
}

void main();