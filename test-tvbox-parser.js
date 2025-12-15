// 测试 TVBOX 解析器
const JSON5 = require('json5');

async function test() {
  const url = 'http://www.xn--sss604efuw.com/tv';

  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log('Buffer 长度:', buffer.length);

  // 查找 JPEG 结束标记 (0xFF 0xD9)
  let jpegEndIndex = -1;
  for (let i = buffer.length - 1; i >= 1; i--) {
    if (buffer[i - 1] === 0xFF && buffer[i] === 0xD9) {
      jpegEndIndex = i;
      break;
    }
  }

  if (jpegEndIndex !== -1) {
    console.log('✅ 找到 JPEG 结束标记，位置:', jpegEndIndex);

    // 提取 JPEG 后的数据
    const afterJpeg = buffer.subarray(jpegEndIndex + 1);

    // 使用 latin1 编码读取（保留原始字节）
    const rawText = afterJpeg.toString('latin1');

    // 只保留 Base64 字符
    const base64Text = rawText.replace(/[^A-Za-z0-9+/=\r\n]/g, '').replace(/[\r\n]/g, '');

    console.log('Base64 数据长度:', base64Text.length);
    console.log('Base64 前50字符:', base64Text.substring(0, 50));
    console.log('Base64 后50字符:', base64Text.substring(base64Text.length - 50));

    try {
      // Base64 解码
      const decoded = Buffer.from(base64Text, 'base64').toString('utf-8');

      console.log('\n解码后前200字符:', decoded.substring(0, 200));
      console.log('解码后后200字符:', decoded.substring(decoded.length - 200));

      // 查找 JSON 起始 - 查找 {\r\n" 或 {\n" 模式
      const jsonPattern = /\{\r?\n"/;
      const match = decoded.match(jsonPattern);

      if (match && match.index !== undefined) {
        const jsonStart = match.index;
        console.log('\n找到 JSON 起始位置:', jsonStart);
        let jsonStr = decoded.substring(jsonStart);

        // 清理控制字符（不移除注释，JSON5 支持注释）
        jsonStr = jsonStr
          .replace(/\r/g, '') // 移除回车符
          .replace(/\n\s*\n/g, '\n'); // 移除空行

        console.log('\n清理后的 JSON 前300字符:');
        console.log(jsonStr.substring(0, 300));

        // 使用 JSON5 解析（支持注释和更宽松的语法）
        const parsed = JSON5.parse(jsonStr);

        console.log('\n✅✅ 解析成功！');
        console.log('sites 总数:', parsed.sites?.length || 0);

        if (parsed.sites && parsed.sites.length > 0) {
        console.log('\n=== 前5个源的详细信息 ===');
        parsed.sites.slice(0, 5).forEach((site, idx) => {
          console.log(`\n【源 ${idx + 1}】`);
          console.log('  key:', site.key);
          console.log('  name:', site.name);
          console.log('  type:', site.type);
          console.log('  api:', typeof site.api === 'string' ? site.api.substring(0, 100) : site.api);
          console.log('  ext:', typeof site.ext === 'string' ? site.ext.substring(0, 100) : site.ext);
        });

        // 统计 type 分布
        const typeCount = {};
        parsed.sites.forEach(site => {
          typeCount[site.type] = (typeCount[site.type] || 0) + 1;
        });
        console.log('\n=== 类型分布统计 ===');
        console.log(typeCount);

        // 找出 type=1 的源
        const type1Sources = parsed.sites.filter(s => s.type === 1);
        console.log('\n=== Type 1 (CMS API) 源 ===');
        console.log('数量:', type1Sources.length);
        if (type1Sources.length > 0) {
          type1Sources.slice(0, 3).forEach(s => {
            console.log(`  - ${s.name}: ${s.api}`);
          });
        }

        // 找出 type=3 的源
        const type3Sources = parsed.sites.filter(s => s.type === 3);
        console.log('\n=== Type 3 (Spider/网盘) 源 ===');
        console.log('数量:', type3Sources.length);
        if (type3Sources.length > 0) {
          type3Sources.slice(0, 3).forEach(s => {
            console.log(`  - ${s.name}: ${s.api?.substring(0, 50)}`);
          });
        }
        }
      }
    } catch (e) {
      console.log('❌ 解析失败:', e.message);
    }
  } else {
    console.log('❌ 未找到 JPEG 结束标记');
  }
}

test().catch(console.error);
