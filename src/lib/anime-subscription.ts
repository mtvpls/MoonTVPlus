/* eslint-disable @typescript-eslint/no-explicit-any */
import parseTorrentName from 'parse-torrent-name';
import { parseStringPromise } from 'xml2js';

import {
  matchesExclude,
  matchesFilter,
  pickOnePerEpisode,
} from '@/lib/anime-keyword-expr';
import { getConfig, setCachedConfig } from '@/lib/config';
import { getMagnetBaseUrl, universalMagnetFetch } from '@/lib/magnet.client';
import { db, getStorage } from '@/lib/db';
import { EmailService } from '@/lib/email.service';
import {
  addOpenListOfflineDownload,
  getOfflineDownloadTarget,
  joinOpenListPath,
} from '@/lib/openlist-offline-download';
import { AnimeSubscription, AnimeSubscriptionDownloadTool } from '@/types/anime-subscription';

// 兼容外部从本模块引用匹配工具（仅服务端使用本文件；客户端请直接 import anime-keyword-expr）
export {
  isAnimeCategoryText,
  matchesExclude,
  matchesFilter,
  pickOnePerEpisode,
  scoreTorrentTitle,
  validateKeywordExpr,
} from '@/lib/anime-keyword-expr';

const downloadTools: AnimeSubscriptionDownloadTool[] = ['aria2', 'qBittorrent', 'Transmission'];

const pickRssText = (value: any): string => {
  if (value === undefined || value === null) return '';
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null) return '';
  if (typeof first === 'object') return String(first._ ?? first.$?.url ?? first.$?.href ?? '');
  return String(first);
};

function getAnimeSubscriptionDownloadTool(tool: unknown): AnimeSubscriptionDownloadTool {
  return typeof tool === 'string' && downloadTools.includes(tool as AnimeSubscriptionDownloadTool)
    ? (tool as AnimeSubscriptionDownloadTool)
    : 'aria2';
}

/**
 * 搜索用集数 token：个位数补零（2 → 02），≥10 原样
 */
export function formatEpisodeSearchToken(episode: number): string {
  if (!Number.isFinite(episode) || episode < 0) return '';
  const n = Math.floor(episode);
  return n < 10 ? String(n).padStart(2, '0') : String(n);
}

/**
 * 标题是否明确包含目标集数（避免 1080/720/年份等误命中）
 * 认可形态示例：[02]、[2]、第02集、EP02、E02、 - 02 [
 */
export function titleContainsEpisode(title: string, episode: number): boolean {
  if (!title || !Number.isFinite(episode) || episode <= 0) return false;
  const ep = Math.floor(episode);
  const padded = formatEpisodeSearchToken(ep);
  const raw = String(ep);

  // 先挖掉分辨率/常见非集数数字，降低误判
  const cleaned = title
    .replace(/(?:^|[^0-9])(?:240|360|480|720|1080|1440|2160|4k|8k)(?:p|P|i|I)?(?![0-9])/g, ' ')
    .replace(/(?:19|20)\d{2}/g, ' '); // 年份

  const patterns: RegExp[] = [
    new RegExp(`\\[0*${ep}\\]`), // [02] [2]
    new RegExp(`第0*${ep}[集话話]`),
    new RegExp(`(?:^|[^A-Za-z0-9])EP?0*${ep}(?![0-9])`, 'i'), // EP02 E02
    new RegExp(`(?:^|[^0-9])0*${ep}(?=\\s*[\\]\\-–—_]|\\s+\\[)`), // 02] / 02 - / 02 [
    new RegExp(`[-–—_]\\s*0*${ep}(?![0-9])`), // - 02
    new RegExp(`\\s0*${ep}\\s`), // 空格02空格
  ];

  // padded 与 raw 在部分形态下等价（上面已用 0*ep）；额外允许字面 [02]
  if (padded !== raw) {
    patterns.push(new RegExp(`\\[${padded}\\]`));
  }

  return patterns.some((re) => re.test(cleaned) || re.test(title));
}

/**
 * 校验自定义集数正则：可编译且结果可解析即合法
 */
export function validateEpisodeRegex(regex: string): { ok: boolean; error?: string } {
  const trimmed = regex.trim();
  if (!trimmed) return { ok: true };
  try {
    // eslint-disable-next-line no-new
    new RegExp(trimmed);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '正则无效' };
  }
}

/**
 * 用自定义正则从标题中提取集数（首个捕获组；无捕获组时取整个匹配）
 */
export function extractEpisodeWithRegex(
  title: string,
  regex: string
): number | null {
  const trimmed = regex.trim();
  if (!trimmed) return null;
  let re: RegExp;
  try {
    re = new RegExp(trimmed);
  } catch {
    return null;
  }
  const match = title.match(re);
  if (!match) return null;
  const raw = match[1] ?? match[0];
  const ep = parseInt(raw, 10);
  if (!Number.isFinite(ep) || ep <= 0 || ep >= 1000) return null;
  return ep;
}

/**
 * 从标题中提取集数。
 * episodeRegex：自定义集数正则（可选），填写后优先于内置规则（不匹配则视为无法识别）
 */
export function extractEpisode(title: string, episodeRegex?: string): number | null {
  if (episodeRegex && episodeRegex.trim()) {
    return extractEpisodeWithRegex(title, episodeRegex);
  }

  const parsed = parseTorrentName(title);

  if (parsed.episode) {
    const ep = Number(parsed.episode);
    // 过滤明显非集数（分辨率等）
    if (ep > 0 && ep < 1000 && ![480, 720, 1080, 1440, 2160].includes(ep)) {
      if (titleContainsEpisode(title, ep) || ep < 100) {
        return ep;
      }
    }
  }

  // 备用正则匹配（带集数语义，避免裸数字）
  const patterns: Array<[RegExp, number]> = [
    [/\[(\d{1,3})\]/, 1], // [01]
    [/第(\d{1,3})[集话話]/, 1], // 第01集
    [/(?:^|[^A-Za-z0-9])EP?(\d{1,3})(?![0-9])/i, 1], // EP01, E01
    [/[-–—_]\s*(\d{1,3})(?![0-9])/, 1], // - 01
    [/\s(\d{1,3})\s/, 1], // 空格01空格（最后兜底）
  ];

  for (const [pattern] of patterns) {
    const match = title.match(pattern);
    if (match) {
      const ep = parseInt(match[1], 10);
      if (
        !Number.isFinite(ep) ||
        ep <= 0 ||
        ep >= 1000 ||
        [480, 720, 1080, 1440, 2160].includes(ep)
      ) {
        continue;
      }
      // 空格数字兜底时必须再过 titleContainsEpisode，降低误伤
      if (pattern.source.includes('\\s') && !titleContainsEpisode(title, ep)) {
        continue;
      }
      return ep;
    }
  }

  return null;
}

type AcgSearchItem = {
  title: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  torrentUrl?: string;
  description?: string;
  episode?: number | null;
};

function filterAndParseEpisodes(
  results: AcgSearchItem[],
  subscription: AnimeSubscription,
  opts?: { onlyEpisode?: number; minEpisodeExclusive?: number }
): AcgSearchItem[] {
  const only = opts?.onlyEpisode;
  const minExclusive = opts?.minEpisodeExclusive ?? -Infinity;
  const customRegex = subscription.episodeRegex?.trim();

  return results
    .filter((item) => matchesFilter(item.title, subscription.filterText))
    .filter((item) => !matchesExclude(item.title, subscription.excludeText))
    .map((item) => {
      const episode = extractEpisode(item.title, subscription.episodeRegex);
      return { ...item, episode };
    })
    .filter((item) => {
      if (!item.episode) return false;
      if (only != null) {
        // 自定义正则时信任正则结果，不再叠加内置形态校验
        if (customRegex) return item.episode === only;
        return (
          item.episode === only && titleContainsEpisode(item.title, only)
        );
      }
      return item.episode > minExclusive;
    })
    .sort((a, b) => (a.episode || 0) - (b.episode || 0));
}

/**
 * 集数过滤测试：按表单参数实际搜索一次，返回关键词命中与集数提取结果
 */
export async function testEpisodeFilter(params: {
  title: string;
  filterText: string;
  excludeText?: string;
  source: 'acgrip' | 'mikan' | 'dmhy' | 'nyaa';
  episodeRegex?: string;
  lastEpisode?: number;
}) {
  const results: AcgSearchItem[] = await searchACG(params.title, params.source);
  const filtered = results
    .filter((item) => matchesFilter(item.title, params.filterText))
    .filter((item) => !matchesExclude(item.title, params.excludeText));

  const items: Array<{ title: string; episode: number | null }> = filtered
    .map((item) => ({
      title: item.title,
      episode: extractEpisode(item.title, params.episodeRegex),
    }))
    .sort((a, b) => {
      if (a.episode == null && b.episode == null) return 0;
      if (a.episode == null) return 1;
      if (b.episode == null) return -1;
      return a.episode - b.episode;
    });

  const episodes = Array.from(
    new Set(
      items
        .map((i) => i.episode)
        .filter((ep): ep is number => typeof ep === 'number')
    )
  ).sort((a, b) => a - b);
  const last = params.lastEpisode || 0;
  const newEpisodes = episodes.filter((ep) => ep > last);
  const unparsed = items.filter((i) => i.episode == null).length;

  return {
    total: results.length,
    matched: filtered.length,
    lastEpisode: last,
    episodes,
    newEpisodes,
    unparsed,
    items,
  };
}

/**
 * 缺集补搜：在 (lastEpisode, maxFound] 内对未命中集按「番名 + 补零集数」再搜
 */
async function refillMissingEpisodeResults(
  subscription: AnimeSubscription,
  existing: AcgSearchItem[]
): Promise<AcgSearchItem[]> {
  const last = subscription.lastEpisode || 0;
  const customRegex = subscription.episodeRegex?.trim();
  const foundEps = new Set(
    existing
      .map((i) => i.episode)
      .filter((ep): ep is number => typeof ep === 'number' && ep > last)
  );
  if (foundEps.size === 0) return existing;

  const maxFound = Math.max(...Array.from(foundEps));
  const missing: number[] = [];
  for (let ep = last + 1; ep <= maxFound; ep += 1) {
    if (!foundEps.has(ep)) missing.push(ep);
  }
  if (missing.length === 0) return existing;

  // 单次检查最多补搜 24 集，避免源站压力过大
  const toSearch = missing.slice(0, 24);
  console.log(
    `[AnimeSubscription] ${subscription.title}: 缺集重新检索 ${toSearch.join(
      ','
    )}（上限内；总缺 ${missing.length}）`
  );

  const merged = [...existing];
  const haveEp = new Set(foundEps);

  for (const ep of toSearch) {
    const token = formatEpisodeSearchToken(ep);
    const keyword = `${subscription.title} ${token}`.trim();
    try {
      const results = await searchACG(keyword, subscription.source);
      const matched = filterAndParseEpisodes(results, subscription, {
        onlyEpisode: ep,
      });
      if (matched.length === 0) {
        console.log(
          `[AnimeSubscription] ${subscription.title}: 补搜「${keyword}」未命中第${ep}集`
        );
        continue;
      }
      for (const item of matched) {
        if (item.episode && !haveEp.has(item.episode)) {
          // 同集先都放进池子，后续 onePerEpisode 再择优
        }
        merged.push(item);
      }
      haveEp.add(ep);
      console.log(
        `[AnimeSubscription] ${subscription.title}: 补搜第${ep}集命中 ${matched.length} 条`
      );
    } catch (err) {
      console.error(
        `[AnimeSubscription] ${subscription.title}: 补搜第${ep}集失败`,
        err
      );
    }
  }

  return merged
    .filter(
      (item) =>
        item.episode &&
        item.episode > last &&
        (customRegex ? true : titleContainsEpisode(item.title, item.episode))
    )
    .sort((a, b) => (a.episode || 0) - (b.episode || 0));
}

/**
 * 搜索 ACG 资源（直接调用搜索逻辑，不通过 HTTP）
 */
export async function searchACG(
  keyword: string,
  source: 'acgrip' | 'mikan' | 'dmhy' | 'nyaa'
) {
  const trimmedKeyword = keyword.trim();
  const config = await getConfig();

  let searchUrl: string;

  switch (source) {
    case 'mikan': {
      const baseUrl = getMagnetBaseUrl(
        'https://mikanani.me',
        config.SiteConfig.MagnetMikanReverseProxy
      );
      searchUrl = `${baseUrl}/RSS/Search?searchstr=${encodeURIComponent(trimmedKeyword)}`;
      break;
    }
    case 'dmhy': {
      const baseUrl = getMagnetBaseUrl(
        'http://share.dmhy.org',
        config.SiteConfig.MagnetDmhyReverseProxy
      );
      searchUrl = `${baseUrl}/topics/rss/rss.xml?keyword=${encodeURIComponent(trimmedKeyword)}`;
      break;
    }
    case 'nyaa': {
      const baseUrl = getMagnetBaseUrl(
        'https://nyaa.si',
        config.SiteConfig.MagnetNyaaReverseProxy
      );
      searchUrl = `${baseUrl}/?page=rss&q=${encodeURIComponent(trimmedKeyword)}&c=1_0&f=0`;
      break;
    }
    case 'acgrip':
    default: {
      const baseUrl = getMagnetBaseUrl(
        'https://acg.rip',
        config.SiteConfig.MagnetAcgripReverseProxy
      );
      searchUrl = `${baseUrl}/page/1.xml?term=${encodeURIComponent(trimmedKeyword)}`;
      break;
    }
  }

  const response = await universalMagnetFetch(searchUrl, config.SiteConfig.MagnetProxy, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`${source} API 请求失败: ${response.status}`);
  }

  const xmlData = await response.text();
  const parsed = await parseStringPromise(xmlData);

  if (!parsed?.rss?.channel?.[0]?.item) {
    return [];
  }

  const items = parsed.rss.channel[0].item;

  // 统一格式。注意：Nyaa RSS 的 link 是 .torrent 下载地址，guid 才是详情页。
  return items.map((item: any) => {
    const title = pickRssText(item.title);
    const rawLink = pickRssText(item.link);
    const rawGuid = pickRssText(item.guid);
    const pubDate = pickRssText(item.pubDate);
    const description = pickRssText(item.description) || pickRssText(item['content:encoded']);
    const enclosureUrl =
      pickRssText(item.enclosure?.[0]?.$?.url) ||
      pickRssText(item.enclosure?.[0]?.$?.href);

    const isNyaa = source === 'nyaa';
    const link = isNyaa ? (rawGuid || rawLink) : rawLink;
    const torrentUrl = isNyaa ? rawLink : enclosureUrl;
    const guid = rawGuid || link || torrentUrl || `${title}-${pubDate}`;

    return {
      title,
      link,
      guid,
      pubDate,
      torrentUrl,
      description,
    };
  });
}

/**
 * 添加离线下载任务
 * folderName 为订阅标题，实际目录 = 父目录/订阅标题。
 * 父目录默认取「离线下载目录」，订阅里填了「覆盖路径」(basePathOverride) 时以它为准。
 */
export async function addOfflineDownload(
  torrentUrl: string,
  folderName: string,
  basePathOverride?: string
) {
  const config = await getConfig();
  const downloadTool = getAnimeSubscriptionDownloadTool(
    config.AnimeSubscriptionConfig?.DownloadTool
  );

  const target = getOfflineDownloadTarget(config, undefined, basePathOverride);
  const downloadPath = joinOpenListPath(target.basePath, folderName);
  await addOpenListOfflineDownload(target.source, downloadPath, torrentUrl, downloadTool);
}

/**
 * 发送追番更新通知和邮件
 */
async function sendAnimeUpdateNotifications(
  subscription: AnimeSubscription,
  episodes: number[]
) {
  const config = await getConfig();
  const storage = getStorage();

  // 获取站长用户名 - 从用户列表中查找 owner 角色
  let ownerUsername: string | null = null;
  try {
    const allUsers = await db.getAllUsers();
    for (const username of allUsers) {
      const userInfo = await db.getUserInfoV2(username);
      if (userInfo?.role === 'owner') {
        ownerUsername = username;
        break;
      }
    }
  } catch (error) {
    console.error('[AnimeSubscription] 获取站长用户名失败:', error);
  }

  if (!ownerUsername) {
    console.warn('[AnimeSubscription] 未找到站长用户，跳过通知');
    return;
  }

  // 准备通知内容
  const episodeList = episodes.join('、');
  const notificationTitle = `追番更新：${subscription.title}`;
  const notificationMessage = `您订阅的番剧《${subscription.title}》有新集数更新：第 ${episodeList} 集，已下载到私人影库`;

  // 需要通知的用户列表（去重）
  const usersToNotify: string[] = [ownerUsername];

  // 如果创建者不是站长，也通知创建者
  if (subscription.createdBy && subscription.createdBy !== ownerUsername) {
    usersToNotify.push(subscription.createdBy);
  }

  // 发送站内通知
  for (const username of usersToNotify) {
    try {
      await storage.addNotification(username, {
        id: crypto.randomUUID(),
        type: 'anime_subscription_update',
        title: notificationTitle,
        message: notificationMessage,
        timestamp: Date.now(),
        read: false,
        metadata: {
          subscriptionId: subscription.id,
          subscriptionTitle: subscription.title,
          episodes: episodes,
        },
      });
      console.log(`[AnimeSubscription] 已发送站内通知给用户: ${username}`);
    } catch (error) {
      console.error(`[AnimeSubscription] 发送站内通知失败 (${username}):`, error);
    }
  }

  // 发送邮件通知（如果已启用）
  const emailConfig = config.EmailConfig;
  if (!emailConfig?.enabled) {
    return;
  }

  // 获取需要发送邮件的用户邮箱
  const emailsToSend: Array<{ username: string; email: string }> = [];

  for (const username of usersToNotify) {
    try {
      const userInfo = await db.getUserInfoV2(username);
      // 使用可选的 email 字段
      const email = (userInfo as any)?.email;
      if (email) {
        emailsToSend.push({ username, email });
      }
    } catch (error) {
      console.error(`[AnimeSubscription] 获取用户邮箱失败 (${username}):`, error);
    }
  }

  // 发送邮件
  for (const { username, email } of emailsToSend) {
    try {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">追番更新通知</h2>
          <p>您好，${username}！</p>
          <p>您订阅的番剧有新集数更新：</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #2563eb;">${subscription.title}</h3>
            <p style="margin: 10px 0;">新增集数：第 ${episodeList} 集</p>
            <p style="margin: 10px 0; color: #666;">搜索源：${subscription.source === 'acgrip' ? 'ACG.RIP' : subscription.source === 'mikan' ? '蜜柑' : subscription.source === 'nyaa' ? 'Nyaa' : '动漫花园'}</p>
          </div>
          <p style="color: #666; font-size: 14px;">这些集数已自动添加到 OpenList 离线下载队列。</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">此邮件由系统自动发送，请勿回复。</p>
        </div>
      `;

      if (emailConfig.provider === 'smtp' && emailConfig.smtp) {
        await EmailService.sendViaSMTP(emailConfig.smtp, {
          to: email,
          subject: notificationTitle,
          html: emailHtml,
        });
      } else if (emailConfig.provider === 'resend' && emailConfig.resend) {
        await EmailService.sendViaResend(emailConfig.resend, {
          to: email,
          subject: notificationTitle,
          html: emailHtml,
        });
      }

      console.log(`[AnimeSubscription] 已发送邮件通知给: ${email}`);
    } catch (error) {
      console.error(`[AnimeSubscription] 发送邮件失败 (${email}):`, error);
    }
  }
}

/**
 * 检查单个订阅的更新
 */
export async function checkSubscription(subscription: AnimeSubscription) {
  const config = await getConfig();
  if (!subscription.downloadPath && !config.OpenListConfig?.OfflineDownloadPath) {
    throw new Error('OpenList 离线下载路径未配置');
  }

  // 1. 搜索资源
  const results = await searchACG(subscription.title, subscription.source);

  // 2. 过滤并解析集数（关键词支持 & | ()；旧逗号兼容）
  let newEpisodes = filterAndParseEpisodes(results, subscription, {
    minEpisodeExclusive: subscription.lastEpisode,
  });

  // 2a. 缺集重新检索（可选）：首搜跳集时按「番名 + 补零集数」补搜中间集
  if (subscription.refillMissingEpisodes) {
    newEpisodes = await refillMissingEpisodeResults(subscription, newEpisodes);
  }

  // 2b. 单集只下载一次（每条订阅可选，默认关）
  if (subscription.onePerEpisode) {
    const before = newEpisodes.length;
    newEpisodes = pickOnePerEpisode(
      newEpisodes.filter(
        (item): item is AcgSearchItem & { episode: number; title: string } =>
          typeof item.episode === 'number' && !!item.title
      )
    );
    if (before > newEpisodes.length) {
      console.log(
        `[AnimeSubscription] ${subscription.title}: 单集只下一次，${before} → ${newEpisodes.length} 条`
      );
      for (const item of newEpisodes) {
        console.log(
          `[AnimeSubscription] ${subscription.title}: 第${item.episode}集选用「${item.title}」`
        );
      }
    }
  }

  // 3. 下载新集数
  const downloaded: number[] = [];
  for (const item of newEpisodes) {
    if (typeof item.episode !== 'number' || !item.torrentUrl) {
      continue;
    }
    try {
      await addOfflineDownload(
        item.torrentUrl,
        subscription.title,
        subscription.downloadPath
      );

      // 成功后更新 lastEpisode
      subscription.lastEpisode = item.episode;
      downloaded.push(item.episode);

      console.log(
        `[AnimeSubscription] ${subscription.title}: 已添加第${item.episode}集到下载队列`
      );
    } catch (error) {
      // 失败则停止，下次继续尝试这一集
      console.error(
        `[AnimeSubscription] ${subscription.title}: 下载第${item.episode}集失败`,
        error
      );
      break;
    }
  }

  // 4. 更新检查时间
  subscription.lastCheckTime = Date.now();

  // 5. 发送通知和邮件（如果有下载成功的集数）
  if (downloaded.length > 0) {
    try {
      await sendAnimeUpdateNotifications(subscription, downloaded);
    } catch (error) {
      console.error(`[AnimeSubscription] ${subscription.title}: 发送通知失败`, error);
    }
  }

  return {
    found: newEpisodes.length,
    downloaded: downloaded.length,
    episodes: downloaded,
  };
}

/**
 * 检查所有订阅（定时任务调用）
 */
export async function checkAnimeSubscriptions() {
  console.log('[AnimeSubscription] 开始检查动漫订阅');

  const config = await getConfig();
  const animeConfig = config.AnimeSubscriptionConfig;

  if (!animeConfig?.Enabled) {
    console.log('[AnimeSubscription] 动漫订阅功能未启用，跳过检查');
    return;
  }

  const subscriptions = animeConfig.Subscriptions || [];
  console.log(`[AnimeSubscription] 共有 ${subscriptions.length} 个订阅`);

  const now = Date.now();
  const MIN_CHECK_INTERVAL = 30 * 60 * 1000; // 30分钟
  let configChanged = false;
  let checkedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const sub of subscriptions) {
    if (!sub.enabled) {
      console.log(`[AnimeSubscription] 跳过已禁用的订阅: ${sub.title}`);
      skippedCount++;
      continue;
    }

    // 检查是否距离上次检查超过30分钟
    const timeSinceLastCheck = now - sub.lastCheckTime;
    if (timeSinceLastCheck < MIN_CHECK_INTERVAL) {
      const remainingMinutes = Math.ceil((MIN_CHECK_INTERVAL - timeSinceLastCheck) / 60000);
      console.log(`[AnimeSubscription] 跳过 ${sub.title}: 距离上次检查仅 ${Math.floor(timeSinceLastCheck / 60000)} 分钟，还需等待 ${remainingMinutes} 分钟`);
      skippedCount++;
      continue;
    }

    try {
      console.log(`[AnimeSubscription] 检查订阅: ${sub.title} (源: ${sub.source}, 上次集数: ${sub.lastEpisode})`);
      const result = await checkSubscription(sub);
      console.log(`[AnimeSubscription] ${sub.title}: 找到 ${result.found} 个新集数，成功下载 ${result.downloaded} 个`);
      configChanged = true;
      checkedCount++;
    } catch (error) {
      console.error(`[AnimeSubscription] ${sub.title}: 检查失败`, error);
      errorCount++;
    }
  }

  // 5. 保存配置并刷新缓存
  if (configChanged) {
    await db.saveAdminConfig(config);
    await setCachedConfig(config);
    console.log('[AnimeSubscription] 配置已更新并保存');
  }

  console.log(`[AnimeSubscription] 检查完成 - 总计: ${subscriptions.length}, 已检查: ${checkedCount}, 跳过: ${skippedCount}, 失败: ${errorCount}`);
}
