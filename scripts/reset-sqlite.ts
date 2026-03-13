import fs from 'node:fs';
import path from 'node:path';

const filesToDelete = ['moontv.db', 'moontv.db-shm', 'moontv.db-wal'];
const dataDir = path.join(process.cwd(), '.data');

for (const fileName of filesToDelete) {
  const filePath = path.join(dataDir, fileName);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
    console.log(`🗑 Deleted ${filePath}`);
  }
}

await import('./init-sqlite');