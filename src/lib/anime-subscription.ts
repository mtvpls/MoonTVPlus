/* eslint-disable @typescript-eslint/no-explicit-any */
import parseTorrentName from 'parse-torrent-name';
import { parseStringPromise } from 'xml2js';

import { getConfig, setCachedConfig } from '@/lib/config';
import { db, getStorage } from '@/lib/db';
import { EmailService } from '@/lib/email.service';
import { OpenListClient } from '@/lib/openlist.client';
import { AnimeSubscription } from '@/types/anime-subscription';

/**
 * 从标题中提取集数
 */
export function extractEpisode(title: string): number | null {
  const parsed = parseTorrentName(title);

  if (parsed.episode) {
    return parsed.episode;
  }

  // 备用正则匹配
  const patterns = [
    /\[(\d+)\]/, // [01]
    /第(\d+)[集话]/, // 第01集
    /EP?(\d+)/i, // EP01, E01
    /\s(\d+)\s/, // 空格01空格
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * 检查标题是否匹配过滤条件
 */
export function matchesFilter(title: string, filterText: string): boolean {
  if (!filterText) return true;

  // 支持多个关键词，用逗号分隔，必须全部匹配
  const keywords = filterText.split(',').map((k) => k.trim()).filter(Boolean);

  return keywords.every((keyword) => title.includes(keyword));
}

/**
 * 搜索 ACG 资源（直接调用搜索逻辑，不通过 HTTP）
 */
export async function searchACG(
  keyword: string,
  source: 'acgrip' | 'mikan' | 'dmhy'
) {
  const trimmedKeyword = keyword.trim();

  let searchUrl: string;

  switch (source) {
    case 'mikan':
      searchUrl = `https://mikanani.me/RSS/Search?searchstr=${encodeURIComponent(trimmedKeyword)}`;
      break;
    case 'dmhy':
      searchUrl = `http://share.dmhy.org/topics/rss/rss.xml?keyword=${encodeURIComponent(trimmedKeyword)}`;
      break;
    case 'acgrip':
    default:
      searchUrl = `https://acg.rip/page/1.xml?term=${encodeURIComponent(trimmedKeyword)}`;
      break;
  }

  const response = await fetch(searchUrl, {
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

  // 统一格式
  return items.map((item: any) => {
    const title = item.title?.[0] || '';
    const link = item.link?.[0] || '';
    const guid = item.guid?.[0] || link || `${title}-${item.pubDate?.[0] || ''}`;
    const pubDate = item.pubDate?.[0] || '';
    const torrentUrl = item.enclosure?.[0]?.$?.url || '';
    const description = item.description?.[0] || '';

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
 */
export async function addOfflineDownload(
  torrentUrl: string,
  downloadPath: string
) {
  const config = await getConfig();
  const openlistConfig = config.OpenListConfig;

  if (!openlistConfig?.Enabled) {
    throw new Error('私人影库功能未启用');
  }

  if (
    !openlistConfig.URL ||
    !openlistConfig.Username ||
    !openlistConfig.Password
  ) {
    throw new Error('OpenList 配置不完整');
  }

  const client = new OpenListClient(
    openlistConfig.URL,
    openlistConfig.Username,
    openlistConfig.Password
  );

  const token = await (client as any).getToken();
  const openlistUrl = `${openlistConfig.URL.replace(/\/$/, '')}/api/fs/add_offline_download`;

  const response = await fetch(openlistUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({
      path: downloadPath,
      urls: [torrentUrl],
      tool: 'aria2',
    }),
  });

  const data = await response.json();

  if (!response.ok || data.code !== 200) {
    throw new Error(data.message || '添加离线下载任务失败');
  }
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
            <p style="margin: 10px 0; color: #666;">搜索源：${subscription.source === 'acgrip' ? 'ACG.RIP' : subscription.source === 'mikan' ? '蜜柑' : '动漫花园'}</p>
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
  const openlistConfig = config.OpenListConfig;

  if (!openlistConfig?.OfflineDownloadPath) {
    throw new Error('OpenList 离线下载路径未配置');
  }

  // 1. 搜索资源
  const results = await searchACG(subscription.title, subscription.source);

  // 2. 过滤并解析集数
  const newEpisodes = results
    .filter((item: any) => matchesFilter(item.title, subscription.filterText))
    .map((item: any) => ({
      episode: extractEpisode(item.title),
      ...item,
    }))
    .filter((item: any) => item.episode && item.episode > subscription.lastEpisode)
    .sort((a: any, b: any) => a.episode! - b.episode!);

  // 3. 下载新集数
  const downloaded = [];
  for (const item of newEpisodes) {
    try {
      const downloadPath = `${openlistConfig.OfflineDownloadPath.replace(/\/$/, '')}/${subscription.title}`;
      await addOfflineDownload(item.torrentUrl, downloadPath);

      // 成功后更新 lastEpisode
      subscription.lastEpisode = item.episode!;
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
