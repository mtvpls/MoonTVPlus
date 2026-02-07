/**
 * 简单域名检测 - 只用DNS解析
 */

const fs = require('fs');
const path = require('path');
const dns = require('dns');

const CONFIG_FILE = path.join(__dirname, 'config.json');

const stats = { total: 0, valid: 0, invalid: 0, validList: [], invalidList: [] };

function checkDomain(hostname) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ valid: false, error: '超时' });
    }, 2000);

    dns.resolve4(hostname, (err) => {
      clearTimeout(timeout);
      resolve({ valid: !err, error: err ? 'DNS失败' : null });
    });
  });
}

async function main() {
  console.log('='.repeat(50));
  console.log('检测域名有效性');
  console.log('='.repeat(50));

  const rawData = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config = JSON.parse(rawData);
  const sites = config.api_site || {};
  const keys = Object.keys(sites);

  stats.total = keys.length;
  console.log(`总源数: ${stats.total}\n`);

  for (const key of keys) {
    const site = sites[key];
    try {
      const url = new URL(site.api);
      const result = await checkDomain(url.hostname);

      if (result.valid) {
        stats.valid++;
        stats.validList.push({ key, name: site.name, api: site.api, domain: url.hostname });
      } else {
        stats.invalid++;
        stats.invalidList.push({ key, name: site.name, api: site.api, domain: url.hostname, error: result.error });
      }
    } catch (e) {
      stats.invalid++;
      stats.invalidList.push({ key, name: site.name, api: site.api, error: e.message });
    }

    // 进度
    process.stdout.write(`\r${stats.checked}/${stats.total} 有效:${stats.valid} 无效:${stats.invalid}`);
  }

  console.log('\n\n' + '='.repeat(50));
  console.log(`结果: 有效 ${stats.valid} | 无效 ${stats.invalid}`);
  console.log('='.repeat(50));

  if (stats.invalidList.length > 0) {
    console.log('\n无效域名:');
    stats.invalidList.forEach((s, i) => {
      console.log(`${i+1}. [${s.domain}] ${s.name} - ${s.error}`);
    });
  }

  // 生成新配置
  const newConfig = {
    cache_time: config.cache_time,
    api_site: {}
  };

  stats.validList.forEach(s => {
    newConfig.api_site[s.key] = { api: s.api, name: s.name };
  });

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));

  console.log('\n✅ 已更新 config.json');
  console.log(`📊 剩余有效源: ${stats.valid}`);
  console.log(`🗑️  已移除: ${stats.invalid}`);
}

main();
