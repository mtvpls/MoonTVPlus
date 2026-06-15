const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const MIGRATION_BASELINE_CUTOFF = '008_web_push_notifications.sql';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getSqliteDbPath() {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), '.data', 'moontv.db');
}

function ensureDataDir(dbPath) {
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function configureDatabase(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function isIgnorableMigrationError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('table') && message.includes('already exists') ||
    message.includes('index') && message.includes('already exists') ||
    message.includes('duplicate column name')
  );
}

function splitSqlStatements(sql) {
  const withoutLineComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

function getAppliedMigrations(db) {
  return new Set(
    db.prepare('SELECT filename FROM schema_migrations').all().map((row) => row.filename)
  );
}

function markMigrationApplied(db, filename) {
  db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)'
  ).run(filename, Date.now());
}

function seedExistingMigrationBaseline(db, migrationFiles, hadExistingSchema) {
  const applied = getAppliedMigrations(db);
  if (!hadExistingSchema || applied.size > 0) return;

  for (const file of migrationFiles) {
    if (file.localeCompare(MIGRATION_BASELINE_CUTOFF) < 0) {
      markMigrationApplied(db, file);
    }
  }
}

function runMigrations(db) {
  const migrationFiles = getMigrationFiles();
  const hadExistingSchema = tableExists(db, 'users');
  ensureMigrationTable(db);
  seedExistingMigrationBaseline(db, migrationFiles, hadExistingSchema);

  for (const file of migrationFiles) {
    const applied = getAppliedMigrations(db);
    if (applied.has(file)) {
      console.log(`⏭️ Migration already applied: ${file}`);
      continue;
    }

    const migrationPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = splitSqlStatements(sql);

    console.log(`▶️ Applying migration: ${file}`);
    for (const statement of statements) {
      try {
        db.exec(statement);
      } catch (error) {
        if (isIgnorableMigrationError(error)) {
          console.log(`⏭️ Statement skipped in ${file}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }
    markMigrationApplied(db, file);
    console.log(`✅ Migration applied: ${file}`);
  }
}

function ensureDefaultAdmin(db) {
  const username = process.env.USERNAME || 'admin';
  const password = process.env.PASSWORD || '123456789';
  const passwordHash = hashPassword(password);

  const existingUser = db
    .prepare('SELECT username FROM users WHERE username = ? LIMIT 1')
    .get(username);

  if (existingUser) {
    console.log(`ℹ️ Admin user already exists: ${username}`);
    return;
  }

  db.prepare(`
    INSERT INTO users (
      username, password_hash, role, created_at,
      playrecord_migrated, favorite_migrated, skip_migrated
    )
    VALUES (?, ?, 'owner', ?, 1, 1, 1)
  `).run(username, passwordHash, Date.now());

  console.log(`✅ Default admin user created: ${username}`);
}

function initSQLiteDatabase() {
  const dbPath = getSqliteDbPath();
  ensureDataDir(dbPath);

  let db;
  try {
    db = new Database(dbPath);
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.includes('Could not locate the bindings file')) {
      console.error('❌ better-sqlite3 native binding is missing or incompatible with current Node.js runtime.');
      console.error('💡 Please run: pnpm rebuild better-sqlite3');
      console.error('💡 If you recently changed Node.js version, reinstall dependencies or rebuild native modules.');
    }
    throw error;
  }

  configureDatabase(db);

  console.log('📦 Initializing SQLite database...');
  console.log('📍 Database location:', dbPath);

  try {
    runMigrations(db);
    ensureDefaultAdmin(db);
  } finally {
    db.close();
  }

  console.log('🎉 SQLite database is ready!');
}

module.exports = {
  initSQLiteDatabase,
  getSqliteDbPath,
};

if (require.main === module) {
  try {
    initSQLiteDatabase();
  } catch (err) {
    console.error('❌ SQLite initialization failed:', err);
    process.exit(1);
  }
}
