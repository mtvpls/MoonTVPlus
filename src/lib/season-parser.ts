/**
 * 季度标识解析工具
 * 用于从文件夹名称中识别和提取季度信息
 */

export interface SeasonInfo {
  /** 清理后的标题（移除季度标识和年份） */
  cleanTitle: string;
  /** 季度编号，如果未识别则为 null */
  seasonNumber: number | null;
  /** 年份，如果未识别则为 null */
  year: number | null;
  /** 原始标题 */
  originalTitle: string;
}

/**
 * 从文件夹名称中提取季度信息
 * 支持多种格式：
 * - S01, S1, s01, s1
 * - [S01], [S1]
 * - Season 1, Season 01
 * - 第一季, 第1季, 第01季
 * - [第一季], [第1季]
 * - 第一部, 第1部
 * - 年份: 2023, [2023], (2023)
 */
export function parseSeasonFromTitle(title: string): SeasonInfo {
  const originalTitle = title;
  // 先将下划线替换成空格，方便后续解析和搜索
  let cleanTitle = title.replace(/_/g, ' ');
  let seasonNumber: number | null = null;
  let year: number | null = null;

  // 定义季度匹配模式（按优先级排序）
  const patterns = [
    // [S01], [S1], [s01], [s1] 格式（方括号包裹）
    {
      regex: /\[([Ss]\d{1,2})\]/,
      extract: (match: RegExpMatchArray) => {
        const seasonMatch = match[1].match(/[Ss](\d{1,2})/);
        return seasonMatch ? parseInt(seasonMatch[1], 10) : null;
      },
    },
    // S01, S1, s01, s1 格式
    {
      regex: /\b[Ss](\d{1,2})\b/,
      extract: (match: RegExpMatchArray) => parseInt(match[1], 10),
    },
    // [Season 1], [Season 01] 格式（方括号包裹）
    {
      regex: /\[Season\s+(\d{1,2})\]/i,
      extract: (match: RegExpMatchArray) => parseInt(match[1], 10),
    },
    // Season 1, Season 01 格式
    {
      regex: /\bSeason\s+(\d{1,2})\b/i,
      extract: (match: RegExpMatchArray) => parseInt(match[1], 10),
    },
    // [第一季], [第1季], [第01季] 格式（方括号包裹）
    {
      regex: /\[第([一二三四五六七八九十\d]{1,2})季\]/,
      extract: (match: RegExpMatchArray) => chineseNumberToInt(match[1]),
    },
    // 第一季, 第1季, 第01季 格式
    {
      regex: /第([一二三四五六七八九十\d]{1,2})季/,
      extract: (match: RegExpMatchArray) => chineseNumberToInt(match[1]),
    },
    // [第一部], [第1部] 格式（方括号包裹）
    {
      regex: /\[第([一二三四五六七八九十\d]{1,2})部\]/,
      extract: (match: RegExpMatchArray) => chineseNumberToInt(match[1]),
    },
    // 第一部, 第1部, 第01部 格式
    {
      regex: /第([一二三四五六七八九十\d]{1,2})部/,
      extract: (match: RegExpMatchArray) => chineseNumberToInt(match[1]),
    },
  ];

  // 尝试匹配每个模式
  for (const pattern of patterns) {
    const match = cleanTitle.match(pattern.regex);
    if (match) {
      const extracted = pattern.extract(match);
      if (extracted !== null) {
        seasonNumber = extracted;
        // 移除匹配到的季度标识
        cleanTitle = cleanTitle.replace(pattern.regex, '').trim();
        break;
      }
    }
  }

  // 提取年份（支持多种格式）
  const yearPatterns = [
    /\[(\d{4})\]/, // [2023]
    /\((\d{4})\)/, // (2023)
    /\b(\d{4})\b/, // 2023
  ];

  for (const yearPattern of yearPatterns) {
    const yearMatch = cleanTitle.match(yearPattern);
    if (yearMatch) {
      const extractedYear = parseInt(yearMatch[1], 10);
      // 验证年份合理性（1900-2100）
      if (extractedYear >= 1900 && extractedYear <= 2100) {
        year = extractedYear;
        cleanTitle = cleanTitle.replace(yearPattern, '').trim();
        break;
      }
    }
  }

  // 清理标题：移除空的方括号和多余的空格
  cleanTitle = cleanTitle
    .replace(/\[\s*\]/g, '') // 移除空方括号
    .replace(/\(\s*\)/g, '') // 移除空圆括号
    .replace(/\s+/g, ' ') // 合并多个空格
    .replace(/[·\-_\s]+$/, '') // 移除末尾的特殊字符
    .trim();

  return {
    cleanTitle,
    seasonNumber,
    year,
    originalTitle,
  };
}

/**
 * 将中文数字转换为阿拉伯数字
 */
function chineseNumberToInt(str: string): number {
  // 如果已经是数字，直接返回
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }

  const chineseNumbers: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  // 处理"十"的特殊情况
  if (str === '十') {
    return 10;
  }

  // 处理"十X"的情况（如"十一"）
  if (str.startsWith('十')) {
    const unit = str.substring(1);
    return 10 + (chineseNumbers[unit] || 0);
  }

  // 处理"X十"的情况（如"二十"）
  if (str.endsWith('十')) {
    const tens = str.substring(0, str.length - 1);
    return (chineseNumbers[tens] || 0) * 10;
  }

  // 处理"X十Y"的情况（如"二十一"）
  const tenIndex = str.indexOf('十');
  if (tenIndex !== -1) {
    const tens = str.substring(0, tenIndex);
    const units = str.substring(tenIndex + 1);
    return (chineseNumbers[tens] || 0) * 10 + (chineseNumbers[units] || 0);
  }

  // 单个中文数字
  return chineseNumbers[str] || parseInt(str, 10) || 1;
}

/**
 * 测试示例
 */
export function testSeasonParser() {
  const testCases = [
    '权力的游戏 第一季',
    'Breaking Bad S01',
    'Game of Thrones Season 1',
    '绝命毒师 第1季',
    '权力的游戏 S1',
    '权力的游戏',
    '绝命毒师 第二部',
    'Stranger Things S03',
  ];

  console.log('Season Parser Test Results:');
  testCases.forEach((title) => {
    const result = parseSeasonFromTitle(title);
    console.log(`Input: "${title}"`);
    console.log(`  Clean Title: "${result.cleanTitle}"`);
    console.log(`  Season: ${result.seasonNumber}`);
    console.log('');
  });
}
