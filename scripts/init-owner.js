/**
 * 初始化站长用户
 * 使用方法: node scripts/init-owner.js
 */

const { webcrypto } = require('crypto');

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await webcrypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
  const username = process.env.USERNAME || 'admin';
  const password = process.env.PASSWORD || 'password';

  const passwordHash = await hashPassword(password);

  console.log(`Username: ${username}`);
  console.log(`Password Hash: ${passwordHash}`);

  // 生成 SQL
  const sql = `
INSERT INTO users (username, password_hash, role, banned, tags, oidc_sub, enabled_apis, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
VALUES ('${username}', '${passwordHash}', 'owner', 0, NULL, NULL, NULL, ${Date.now()}, 1, 1, 1)
ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'owner';
`;

  console.log('\nSQL to execute:');
  console.log(sql);

  // 写入临时 SQL 文件
  const fs = require('fs');
  fs.writeFileSync('./init_owner.sql', sql);
  console.log('\n已生成 init_owner.sql 文件');
  console.log('运行命令: npx wrangler d1 execute mdhfuep --file=init_owner.sql --remote');
}

main().catch(console.error);
