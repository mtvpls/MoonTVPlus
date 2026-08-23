import parseTorrentName from 'parse-torrent-name';

export interface ParsedVideoInfo {
  episode?: number;
  season?: number;
  title?: string;
  isOVA?: boolean;
}

export function formatEpisodeDisplayTitle(
  parsed: { season?: number; episode?: number; isOVA?: boolean },
  hasMultipleSeasons: boolean
): string | undefined {
  if (!parsed.episode) return undefined;
  if (parsed.isOVA) return `OVA ${parsed.episode}`;
  if (hasMultipleSeasons && parsed.season) {
    return `S${parsed.season.toString().padStart(2, '0')}E${parsed.episode
      .toString()
      .padStart(2, '0')}`;
  }
  return `第${parsed.episode}集`;
}

/**
 * 解析视频文件名
 */
export function parseVideoFileName(fileName: string): ParsedVideoInfo {
  try {
    const parsed = parseTorrentName(fileName);

    // 如果 parse-torrent-name 成功解析出集数，直接返回
    if (parsed.episode) {
      return {
        episode: parsed.episode,
        season: parsed.season,
        title: parsed.title,
      };
    }
  } catch (error) {
    console.error('parse-torrent-name 解析失败:', fileName, error);
  }

  // 降级方案：使用多种正则模式提取集数
  // 按优先级排序：更具体的模式优先
  const patterns: Array<{ pattern: RegExp; isOVA?: boolean; extractSeason?: boolean }> = [
    // OVA01, OVA 01, ova01, ova 01 (OVA特殊处理) - 最优先
    { pattern: /OVA\s*(\d+(?:\.\d+)?)/i, isOVA: true },
    // S01E01, s01e01, S01E1234, S01E01.5 (支持1-4位数字和小数) - 最具体
    { pattern: /[Ss](\d+)[Ee](\d{1,4}(?:\.\d+)?)/, extractSeason: true },
    // S04 - 02, S04-02, S04 02 (带空格/横线分隔的季+集) - 具体
    { pattern: /[Ss](\d{1,2})\s*[-–—]\s*(\d{1,4}(?:\.\d+)?)(?!\d)/, extractSeason: true },
    // [01], (01), [01.5], (01.5) (支持小数，但要排除中文括号内容) - 很具体
    { pattern: /[[(](\d+(?:\.\d+)?)[)\]]/ },
    // E01, E1, e01, e1, E01.5 (支持小数)
    { pattern: /[Ee](\d+(?:\.\d+)?)/ },
    // 第01集, 第1集, 第01话, 第1话, 第1.5集 (支持小数)
    { pattern: /第(\d+(?:\.\d+)?)[集话]/ },
    // _01_, -01-, _01.5_, -01.5- (支持小数)
    { pattern: /[_-](\d+(?:\.\d+)?)[_-]/ },
    // - 02 [, - 01 [..  (横线/空格分隔，数字后是空格或左括号) 如 "S04 - 02 [WebRip"
    { pattern: /[-\s](\d+(?:\.\d+)?)[\s\[]/ },
    // 01.mp4, 001.mp4, 01.5.mp4 (纯数字开头，支持小数) - 最不具体
    { pattern: /^(\d+(?:\.\d+)?)[^\d.]/ },
  ];

  for (const { pattern, isOVA, extractSeason } of patterns) {
    const match = fileName.match(pattern);
    if (match && match[1]) {
      if (extractSeason && match[2]) {
        // 同时提取 season 和 episode
        const season = parseInt(match[1]);
        const episode = parseFloat(match[2]);
        if (season > 0 && season < 100 && episode > 0 && episode < 10000) {
          return { season, episode };
        }
      } else {
        // 只提取 episode
        const episode = parseFloat(match[1]);
        if (episode > 0 && episode < 10000) {
          return { episode, isOVA };
        }
      }
    }
  }

  // 如果所有模式都失败，返回空对象（调用方会处理）
  return {};
}
