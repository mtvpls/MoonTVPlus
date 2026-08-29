/* eslint-disable @typescript-eslint/no-explicit-any */

import { parseStringPromise } from 'xml2js';

export interface YouTubeVideo {
  id: string;
  title: string;
  publishedAt: string;
  thumbnail: string;
  description: string;
}

export interface YouTubeChannelFeed {
  channelId: string;
  title: string;
  channelUrl: string;
  videos: YouTubeVideo[];
}

const CHANNEL_ID_PATTERN = /^UC[\w-]{20,}$/;

export function normalizeYouTubeInput(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('请输入 YouTube 频道网址、@账号或频道 ID');

  if (CHANNEL_ID_PATTERN.test(value)) return value;

  if (value.startsWith('@')) {
    return `https://www.youtube.com/${encodeURIComponent(value)}`;
  }

  let url: URL;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    throw new Error('YouTube 频道地址格式不正确');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com'].includes(host)) {
    throw new Error('仅支持 youtube.com 的频道地址');
  }

  const directId = url.pathname.match(/^\/channel\/(UC[\w-]{20,})/i)?.[1];
  return directId || `https://www.youtube.com${url.pathname}`;
}

export async function resolveYouTubeChannelId(input: string): Promise<string> {
  const normalized = normalizeYouTubeInput(input);
  if (CHANNEL_ID_PATTERN.test(normalized)) return normalized;

  const response = await fetch(normalized, {
    headers: {
      Accept: 'text/html',
      'User-Agent':
        'Mozilla/5.0 (compatible; MoonTVPlus/1.0; +https://github.com/mtvpls/MoonTVPlus)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('无法读取该 YouTube 频道');

  const html = await response.text();
  const patterns = [
    /<meta\s+itemprop="channelId"\s+content="(UC[\w-]+)"/,
    /"channelId":"(UC[\w-]+)"/,
    /"browseId":"(UC[\w-]+)"/,
    /https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] && CHANNEL_ID_PATTERN.test(match[1])) return match[1];
  }
  throw new Error('找不到频道 ID，请尝试粘贴 /channel/ 开头的网址');
}

export async function fetchYouTubeChannelFeed(
  channelId: string
): Promise<YouTubeChannelFeed> {
  if (!CHANNEL_ID_PATTERN.test(channelId))
    throw new Error('频道 ID 格式不正确');

  const response = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
      channelId
    )}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!response.ok) throw new Error('无法读取频道视频，请检查频道是否存在');

  const parsed = await parseStringPromise(await response.text());
  const feed = parsed?.feed;
  if (!feed) throw new Error('YouTube 返回了无法识别的频道资料');

  const videos: YouTubeVideo[] = (feed.entry || []).map((entry: any) => {
    const media = entry['media:group']?.[0] || {};
    const id = entry['yt:videoId']?.[0] || '';
    return {
      id,
      title: entry.title?.[0] || '未命名视频',
      publishedAt: entry.published?.[0] || '',
      thumbnail:
        media['media:thumbnail']?.[0]?.$?.url ||
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      description: media['media:description']?.[0] || '',
    };
  });

  return {
    channelId,
    title: feed.title?.[0] || 'YouTube 频道',
    channelUrl:
      feed.author?.[0]?.uri?.[0] ||
      `https://www.youtube.com/channel/${channelId}`,
    videos,
  };
}
