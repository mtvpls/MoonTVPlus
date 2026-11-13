/**
 * 解析 JSON，并把超出 JS 安全整数范围的整数字面量保留为字符串。
 *
 * 部分采集站会把 vod_id 等 ID 作为 JSON number 返回（如 641923321063014840）。
 * 该值超过 Number.MAX_SAFE_INTEGER 后，JSON.parse 会按 IEEE-754 double 解析而
 * 丢失精度（→ 641923321063014800），导致用错 ID 请求详情时上游查不到数据。
 *
 * 这里在解析前扫描原文，只把字符串之外、无法安全表示的整数字面量加上引号；
 * 字符串内容、浮点数和合法整数保持原样。
 */
export function parseJsonLosslessIntegers<T = unknown>(text: string): T {
  let out = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (ch === '\\') {
        // 原样复制转义序列，避免把 \" 误判为字符串结束
        if (i + 1 < text.length) {
          out += text[i + 1];
          i += 2;
          continue;
        }
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    // 字符串之外的 '-' 或数字一定是 JSON 数字字面量的开头
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j])) {
        j++;
      }

      const token = text.slice(i, j);
      const unsafeInteger =
        /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token));
      out += unsafeInteger ? `"${token}"` : token;
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  return JSON.parse(out) as T;
}
