function stripBom(value: string) {
  return value.replace(/^\uFEFF/, '');
}

export function isM3UContent(content: string) {
  const normalized = stripBom(content).trim();
  return normalized.includes('#EXTM3U') || normalized.includes('#EXTINF');
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export function parseTxtLive(
  sourceKey: string,
  txtContent: string
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[] = [];

  const lines = txtContent
    .split('\n')
    .map((line) => stripBom(line).trim())
    .filter((line) => line.length > 0);

  let currentGroup = '无分组';
  let channelIndex = 0;

  for (const line of lines) {
    const commaIndex = line.indexOf(',');
    if (commaIndex === -1) {
      continue;
    }

    const name = line.slice(0, commaIndex).trim();
    const value = line.slice(commaIndex + 1).trim();

    if (!name) {
      continue;
    }

    if (value === '#genre#') {
      currentGroup = name;
      continue;
    }

    if (!value || !isHttpUrl(value)) {
      continue;
    }

    channels.push({
      id: `${sourceKey}-${channelIndex}`,
      tvgId: name,
      name,
      logo: '',
      group: currentGroup,
      url: value,
    });
    channelIndex++;
  }

  return { tvgUrl: '', channels };
}

/**
 * 解析M3U文件内容，提取频道信息
 * @param m3uContent M3U文件的内容字符串
 * @returns 频道信息数组
 */
export function parseM3U(
  sourceKey: string,
  m3uContent: string,
  baseUrl?: string
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[] = [];

  const lines = m3uContent
    .split('\n')
    .map((line) => stripBom(line).trim())
    .filter((line) => line.length > 0);

  let tvgUrl = '';
  let channelIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检查是否是 #EXTM3U 行，提取 tvg-url
    if (line.startsWith('#EXTM3U')) {
      // 支持两种格式：x-tvg-url 和 url-tvg
      const tvgUrlMatch = line.match(/(?:x-tvg-url|url-tvg)="([^"]*)"/);
      tvgUrl = tvgUrlMatch ? tvgUrlMatch[1].split(',')[0].trim() : '';
      continue;
    }

    // 检查是否是 #EXTINF 行
    if (line.startsWith('#EXTINF:')) {
      // 提取 tvg-id
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      let tvgId = tvgIdMatch ? tvgIdMatch[1] : '';

      // 提取 tvg-name
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
      const tvgName = tvgNameMatch ? tvgNameMatch[1] : '';

      // 提取 tvg-logo
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const logo = tvgLogoMatch ? tvgLogoMatch[1] : '';

      // 提取 group-title
      const groupTitleMatch = line.match(/group-title="([^"]*)"/);
      const group = groupTitleMatch ? groupTitleMatch[1] : '无分组';

      // 提取标题（#EXTINF 行最后的逗号后面的内容）
      const titleMatch = line.match(/,([^,]*)$/);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // 优先使用 tvg-name，如果没有则使用标题
      const name = title || tvgName || '';

      // 如果 tvg-id 为空，使用 tvg-name 或频道名称作为备用
      // 这样可以支持没有 tvg-id 的M3U文件
      if (!tvgId) {
        tvgId = tvgName || name;
      }

      // EXTINF 与播放地址之间允许 EXTVLCOPT 等播放器标签。
      let next = i + 1;
      while (
        next < lines.length &&
        lines[next].startsWith('#') &&
        !lines[next].startsWith('#EXTINF:')
      )
        next++;
      if (next < lines.length && !lines[next].startsWith('#')) {
        const url = baseUrl ? new URL(lines[next], baseUrl).href : lines[next];

        // 只有当有名称和URL时才添加到结果中
        if (name && url) {
          channels.push({
            id: `${sourceKey}-${channelIndex}`,
            tvgId,
            name,
            logo,
            group,
            url,
          });
          channelIndex++;
        }

        // 跳过下一行，因为已经处理了
        i = next;
      }
    }
  }

  return { tvgUrl, channels };
}

export type ParsedLivePlaylist = ReturnType<typeof parseM3U>;

/** TVBox 内嵌分组，以及直播代理返回的 JSON 频道清单。 */
export function parseTVBoxLiveGroups(
  sourceKey: string,
  value: unknown,
  baseUrl?: string
): ParsedLivePlaylist {
  const channels: ParsedLivePlaylist['channels'] = [];
  const visit = (value: unknown, group = '无分组') => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, group));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const groupedChannels = Array.isArray(item.channels)
      ? item.channels
      : item.channel;
    if (Array.isArray(groupedChannels)) {
      visit(groupedChannels, typeof item.name === 'string' ? item.name : group);
      return;
    }
    for (const key of ['groups', 'data']) {
      if (item[key]) {
        visit(item[key], group);
        return;
      }
    }
    const name = typeof item.name === 'string' ? item.name : '';
    const urls = Array.isArray(item.urls) ? item.urls : [item.url || item.urls];
    for (const url of urls) {
      if (!name || typeof url !== 'string' || !url) continue;
      let resolved: string;
      try {
        resolved = new URL(url, baseUrl).href;
      } catch {
        continue;
      }
      channels.push({
        id: `${sourceKey}-${channels.length}`,
        tvgId: String(item.tvgId || item['tvg-id'] || name),
        name,
        logo: String(item.logo || item['tvg-logo'] || ''),
        group: String(item.group || item['group-title'] || group),
        url: resolved,
      });
    }
  };
  visit(value);
  return { tvgUrl: '', channels };
}

export function parseLivePlaylist(
  sourceKey: string,
  content: string,
  baseUrl?: string
): ParsedLivePlaylist {
  const normalized = stripBom(content).trim();
  if (normalized.startsWith('[') || normalized.startsWith('{')) {
    return parseTVBoxLiveGroups(sourceKey, JSON.parse(normalized), baseUrl);
  }
  return isM3UContent(content)
    ? parseM3U(sourceKey, content, baseUrl)
    : parseTxtLive(sourceKey, content);
}
