/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { checkAnimeSubscriptions } from '@/lib/anime-subscription';
import { getConfig, refineConfig } from '@/lib/config';
import { db, getStorage } from '@/lib/db';
import { EmailService } from '@/lib/email.service';
import {
  FavoriteUpdate,
  getBatchFavoriteUpdateEmailTemplate,
  getBatchMangaUpdateEmailTemplate,
  MangaShelfUpdate,
} from '@/lib/email.templates';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import {
  getLastGlobalLiveRefreshTime,
  getLiveRefreshIntervalHours,
  refreshLiveChannels,
  setLastGlobalLiveRefreshTime,
} from '@/lib/live';
import { MangaChapter, MangaShelfItem } from '@/lib/manga.types';
import { startOpenListRefresh } from '@/lib/openlist-refresh';
import { getSuwayomiConfig, loginWithSimpleAuth, SuwayomiClient } from '@/lib/suwayomi.client';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
const MAX_INLINE_MANGA_COVERS = 3;
const MAX_INLINE_MANGA_COVER_BYTES = 350 * 1024;
const TARGET_INLINE_MANGA_COVER_WIDTH = 480;

function buildSuwayomiBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function fetchMangaCoverAsDataUri(coverUrl?: string): Promise<string | undefined> {
  if (!coverUrl) return undefined;

  try {
    let requestUrl = coverUrl;
    let headers: HeadersInit | undefined;

    if (!/^https?:\/\//i.test(coverUrl)) {
      if (!coverUrl.startsWith('/api/manga/image?')) {
        return undefined;
      }

      const config = await getSuwayomiConfig();
      const parsedProxyUrl = new URL(`http://localhost${coverUrl}`);
      const rawPath = parsedProxyUrl.searchParams.get('path')?.trim();
      if (!rawPath) return undefined;

      if (/^https?:\/\//i.test(rawPath)) {
        const target = new URL(rawPath);
        const base = new URL(config.serverBaseUrl);
        if (target.origin !== base.origin) {
          return undefined;
        }
        requestUrl = target.toString();
      } else {
        requestUrl = `${config.serverBaseUrl}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
      }

      if (config.authMode === 'basic_auth') {
        if (!config.username || !config.password) return undefined;
        headers = new Headers({
          Authorization: buildSuwayomiBasicAuthHeader(config.username, config.password),
        });
      } else if (config.authMode === 'simple_login') {
        headers = new Headers({
          Cookie: await loginWithSimpleAuth(config),
        });
      }
    }

    const response = await fetch(requestUrl, {
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return undefined;
    }

    let buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      return undefined;
    }

    let finalContentType = contentType;

    if (buffer.length > MAX_INLINE_MANGA_COVER_BYTES) {
      const sharp = (await import('sharp')).default;
      const transformer = sharp(buffer, { failOn: 'none' }).rotate().resize({
        width: TARGET_INLINE_MANGA_COVER_WIDTH,
        withoutEnlargement: true,
      });
      const metadata = await transformer.metadata();

      if (metadata.hasAlpha) {
        buffer = await transformer.png({
          compressionLevel: 9,
          palette: true,
          quality: 80,
          effort: 10,
        }).toBuffer();
        finalContentType = 'image/png';
      } else {
        const qualities = [72, 60, 48];
        let compressed: Buffer | null = null;
        for (const quality of qualities) {
          const next = await sharp(buffer, { failOn: 'none' })
            .rotate()
            .resize({
              width: TARGET_INLINE_MANGA_COVER_WIDTH,
              withoutEnlargement: true,
            })
            .jpeg({
              quality,
              mozjpeg: true,
            })
            .toBuffer();
          compressed = next;
          if (next.length <= MAX_INLINE_MANGA_COVER_BYTES) {
            break;
          }
        }
        buffer = compressed || buffer;
        finalContentType = 'image/jpeg';
      }
    }

    if (buffer.length > MAX_INLINE_MANGA_COVER_BYTES) {
      return undefined;
    }

    return `data:${finalContentType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn('漫画封面转 base64 失败:', error);
    return undefined;
  }
}

// 内存中记录最后执行时间（毫秒时间戳）
let lastExecutionTime = 0;
const COOLDOWN_MS = 10 * 60 * 1000; // 10分钟冷却时间

export async function GET(
  request: NextRequest,
  { params }: { params: { password: string } }
) {
  console.log(request.url);

  const cronPassword = process.env.CRON_PASSWORD || 'mtvpls';
  if (params.password !== cronPassword) {
    return NextResponse.json(
      { success: false, message: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 检查冷却时间
  const now = Date.now();
  const timeSinceLastExecution = now - lastExecutionTime;

  if (lastExecutionTime > 0 && timeSinceLastExecution < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastExecution) / 1000);
    const remainingMinutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    console.log(`Cron job skipped: cooldown period active. Remaining: ${remainingMinutes}m ${seconds}s`);

    return NextResponse.json({
      success: false,
      message: 'Cron job is in cooldown period',
      remainingSeconds,
      nextAvailableTime: new Date(lastExecutionTime + COOLDOWN_MS).toISOString(),
      timestamp: new Date().toISOString(),
    }, { status: 429 });
  }

  try {
    console.log('Cron job triggered:', new Date().toISOString());

    // 更新最后执行时间
    lastExecutionTime = now;

    // 环境变量控制是否等待定时任务完全结束后再返回响应（默认 false）
    // 用于防止 Vercel 等平台杀后台进程
    const waitForCompletion = process.env.CRON_WAIT_FOR_COMPLETION === 'true';

    if (waitForCompletion) {
      // 等待定时任务完成后再返回 200
      await cronJob();
      return NextResponse.json({
        success: true,
        message: 'Cron job executed successfully',
        timestamp: new Date().toISOString(),
      });
    } else {
      // 立即返回 202，定时任务在后台执行
      cronJob();
      return NextResponse.json({
        success: true,
        message: 'Cron job accepted and running in background',
        timestamp: new Date().toISOString(),
      }, { status: 202 });
    }
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function cronJob() {
  // 先刷新配置，确保其他任务使用最新配置
  await refreshConfig();

  // 其余任务并行执行
  await Promise.all([
    refreshAllLiveChannels(),
    refreshOpenList(),
    refreshRecordAndFavorites(),
    checkAnimeSubscriptions(),
  ]);
}

async function refreshAllLiveChannels() {
  const config = await getConfig();
  const refreshIntervalHours = getLiveRefreshIntervalHours(config.LiveRefreshIntervalHours);
  const lastRefreshTime = getLastGlobalLiveRefreshTime();
  const now = Date.now();
  const intervalMs = refreshIntervalHours * 60 * 60 * 1000;
  const timeSinceLastRefresh = now - lastRefreshTime;

  if (lastRefreshTime > 0 && timeSinceLastRefresh < intervalMs) {
    const remainingHours = Math.ceil((intervalMs - timeSinceLastRefresh) / (60 * 60 * 1000));
    console.log(`跳过刷新电视直播：距离上次刷新仅 ${Math.floor(timeSinceLastRefresh / (60 * 60 * 1000))} 小时，还需等待 ${remainingHours} 小时`);
    return;
  }

  // 并发刷新所有启用的直播源
  const refreshPromises = (config.LiveConfig || [])
    .filter(liveInfo => !liveInfo.disabled)
    .map(async (liveInfo) => {
      try {
        const nums = await refreshLiveChannels(liveInfo);
        liveInfo.channelNumber = nums;
      } catch (error) {
        console.error(`刷新直播源失败 [${liveInfo.name || liveInfo.key}]:`, error);
        liveInfo.channelNumber = 0;
      }
    });

  // 等待所有刷新任务完成
  await Promise.all(refreshPromises);

  setLastGlobalLiveRefreshTime(Date.now());

  // 保存配置
  await db.saveAdminConfig(config);
}

async function refreshConfig() {
  let config = await getConfig();
  if (config && config.ConfigSubscribtion && config.ConfigSubscribtion.URL && config.ConfigSubscribtion.AutoUpdate) {
    try {
      const response = await fetch(config.ConfigSubscribtion.URL);

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }

      const configContent = await response.text();

      // 对 configContent 进行 base58 解码
      let decodedContent;
      try {
        const bs58 = (await import('bs58')).default;
        const decodedBytes = bs58.decode(configContent);
        decodedContent = new TextDecoder().decode(decodedBytes);
      } catch (decodeError) {
        console.warn('Base58 解码失败:', decodeError);
        throw decodeError;
      }

      try {
        JSON.parse(decodedContent);
      } catch (e) {
        throw new Error('配置文件格式错误，请检查 JSON 语法');
      }
      config.ConfigFile = decodedContent;
      config.ConfigSubscribtion.LastCheck = new Date().toISOString();
      config = refineConfig(config);
      await db.saveAdminConfig(config);

      // 清除短剧视频源缓存（因为配置文件可能包含新的视频源）
      try {
        await db.deleteGlobalValue('duanju');
        console.log('已清除短剧视频源缓存');
      } catch (error) {
        console.error('清除短剧视频源缓存失败:', error);
        // 不影响主流程，继续执行
      }
    } catch (e) {
      console.error('刷新配置失败:', e);
    }
  } else {
    console.log('跳过刷新：未配置订阅地址或自动更新');
  }
}

async function refreshRecordAndFavorites() {
  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }

    // 环境变量控制是否跳过特定源（默认为 false，即默认跳过）
    const includeSpecialSources = process.env.CRON_INCLUDE_SPECIAL_SOURCES === 'true';

    // 检查是否应该跳过该源
    const shouldSkipSource = (source: string): boolean => {
      if (includeSpecialSources) {
        return false; // 如果开启了包含特殊源，则不跳过任何源
      }
      // 默认跳过 emby 开头、openlist、xiaoya 和 live 开头的源
      return source.startsWith('emby') || source === 'openlist' || source === 'xiaoya' || source.startsWith('live');
    };

    // 函数级缓存：key 为 `${source}+${id}`，值为 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();
    const mangaDetailCache = new Map<
      string,
      Promise<{ chapters: MangaChapter[]; shelfItem: Partial<MangaShelfItem> } | null>
    >();
    const suwayomiClient = new SuwayomiClient();

    // 获取详情 Promise（带缓存和错误处理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        // 立即缓存Promise，避免并发时的竞态条件
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        })
          .then((detail) => {
            return detail;
          })
          .catch((err) => {
            console.error(`获取视频详情失败 (${source}+${id}):`, err);
            // 失败时从缓存中移除，下次可以重试
            detailCache.delete(key);
            return null;
          });
        detailCache.set(key, promise);
      }
      return promise;
    };

    const getMangaDetail = async (
      item: MangaShelfItem
    ): Promise<{ chapters: MangaChapter[]; shelfItem: Partial<MangaShelfItem> } | null> => {
      const key = `${item.sourceId}+${item.mangaId}`;
      let promise = mangaDetailCache.get(key);
      if (!promise) {
        promise = suwayomiClient
          .getMangaDetail({
            mangaId: item.mangaId,
            sourceId: item.sourceId,
            title: item.title,
            cover: item.cover,
            sourceName: item.sourceName,
            description: item.description,
            author: item.author,
            status: item.status,
          })
          .then((detail) => {
            const chapters = [...(detail.chapters || [])].sort((a, b) => {
              const diff = (a.chapterNumber || 0) - (b.chapterNumber || 0);
              if (diff !== 0) return diff;
              return a.id.localeCompare(b.id);
            });

            const latestChapter = chapters[chapters.length - 1];
            return {
              chapters,
              shelfItem: {
                title: detail.title || item.title,
                cover: detail.cover || item.cover,
                description: detail.description || item.description,
                author: detail.author || item.author,
                status: detail.status || item.status,
                latestChapterId: latestChapter?.id,
                latestChapterName: latestChapter?.name,
                latestChapterCount: chapters.length,
              },
            };
          })
          .catch((err) => {
            console.error(`获取漫画详情失败 (${key}):`, err);
            mangaDetailCache.delete(key);
            return null;
          });
        mangaDetailCache.set(key, promise);
      }
      return promise;
    };

    // 处理单个用户的函数
    const processUser = async (user: string) => {
      console.log(`开始处理用户: ${user}`);
      const storage = getStorage();

      // 播放记录
      try {
        const playRecords = await db.getAllPlayRecords(user);
        const totalRecords = Object.keys(playRecords).length;
        let processedRecords = 0;

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`跳过无效的播放记录键: ${key}`);
              continue;
            }

            // 检查是否应该跳过该源
            if (shouldSkipSource(source)) {
              console.log(`跳过播放记录 (源被过滤): ${key}`);
              processedRecords++;
              continue;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              console.warn(`跳过无法获取详情的播放记录: ${key}`);
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              // 计算新增的剧集数量
              const newEpisodesCount = episodeCount > record.total_episodes
                ? episodeCount - record.total_episodes
                : 0;

              // 如果有新增剧集，累加到现有的 new_episodes 字段
              const updatedNewEpisodes = (record.new_episodes || 0) + newEpisodesCount;

              await db.savePlayRecord(user, source, id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
                new_episodes: updatedNewEpisodes > 0 ? updatedNewEpisodes : undefined,
              });
              console.log(
                `更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount}, 新增 ${newEpisodesCount} 集)`
              );
            }

            processedRecords++;
          } catch (err) {
            console.error(`处理播放记录失败 (${key}):`, err);
            // 继续处理下一个记录
          }
        }

        console.log(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`获取用户播放记录失败 (${user}):`, err);
      }

      // 收藏
      try {
        let favorites = await db.getAllFavorites(user);
        favorites = Object.fromEntries(
          Object.entries(favorites).filter(([_, fav]) => fav.origin !== 'live')
        );
        const totalFavorites = Object.keys(favorites).length;
        let processedFavorites = 0;
        const now = Date.now();
        const userUpdates: FavoriteUpdate[] = []; // 收集该用户的所有更新

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`跳过无效的收藏键: ${key}`);
              continue;
            }

            // 检查是否应该跳过该源
            if (shouldSkipSource(source)) {
              console.log(`跳过收藏 (源被过滤): ${key}`);
              processedFavorites++;
              continue;
            }

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              console.warn(`跳过无法获取详情的收藏: ${key}`);
              continue;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(user, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              console.log(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );

              // 创建通知
              const notification = {
                id: `fav_update_${source}_${id}_${now}`,
                type: 'favorite_update' as const,
                title: '收藏更新',
                message: `《${fav.title}》有新集数更新！从 ${fav.total_episodes} 集更新到 ${favEpisodeCount} 集`,
                timestamp: now,
                read: false,
                metadata: {
                  source,
                  id,
                  title: fav.title,
                  old_episodes: fav.total_episodes,
                  new_episodes: favEpisodeCount,
                },
              };

              await storage.addNotification(user, notification);
              console.log(`已为用户 ${user} 创建收藏更新通知: ${fav.title}`);

              // 收集更新信息用于邮件
              const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
              const playUrl = `${siteUrl}/play?source=${source}&id=${id}&title=${encodeURIComponent(fav.title)}`;
              userUpdates.push({
                title: fav.title,
                oldEpisodes: fav.total_episodes,
                newEpisodes: favEpisodeCount,
                url: playUrl,
                cover: favDetail.poster || fav.cover,
              });
            }

            processedFavorites++;
          } catch (err) {
            console.error(`处理收藏失败 (${key}):`, err);
            // 继续处理下一个收藏
          }
        }

        console.log(`收藏处理完成: ${processedFavorites}/${totalFavorites}`);

        // 如果有更新，异步发送汇总邮件（不阻塞主流程）
        if (userUpdates.length > 0) {
          (async () => {
            try {
              const userEmail = storage.getUserEmail ? await storage.getUserEmail(user) : null;
              const emailNotifications = storage.getEmailNotificationPreference
                ? await storage.getEmailNotificationPreference(user)
                : false;

              if (userEmail && emailNotifications) {
                const config = await getConfig();
                const emailConfig = config?.EmailConfig;

                if (emailConfig?.enabled) {
                  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
                  const siteName = config?.SiteConfig?.SiteName || 'MoonTVPlus';

                  await EmailService.send(emailConfig, {
                    to: userEmail,
                    subject: `📺 收藏更新汇总 - ${userUpdates.length} 部影片有更新`,
                    html: getBatchFavoriteUpdateEmailTemplate(
                      user,
                      userUpdates,
                      siteUrl,
                      siteName
                    ),
                  });

                  console.log(`邮件汇总已发送至: ${userEmail} (${userUpdates.length} 个更新)`);
                }
              }
            } catch (emailError) {
              console.error(`发送邮件汇总失败 (${user}):`, emailError);
            }
          })().catch(err => console.error(`邮件发送异步任务失败 (${user}):`, err));
        }
      } catch (err) {
        console.error(`获取用户收藏失败 (${user}):`, err);
      }

      // 漫画书架
      try {
        const shelf = await db.getAllMangaShelf(user);
        const totalShelfItems = Object.keys(shelf).length;
        let processedShelfItems = 0;
        const now = Date.now();
        const mangaUpdates: MangaShelfUpdate[] = [];
        let inlinedCoverCount = 0;

        for (const [key, item] of Object.entries(shelf)) {
          try {
            const detail = await getMangaDetail(item);
            if (!detail) {
              continue;
            }

            const latestChapterCount = detail.chapters.length;
            const previousChapterCount = item.latestChapterCount;
            const latestChapterId = detail.shelfItem.latestChapterId;
            const latestChapterName = detail.shelfItem.latestChapterName;
            const baseItem: MangaShelfItem = {
              ...item,
              ...detail.shelfItem,
            };

            if (!latestChapterId || latestChapterCount <= 0) {
              await db.saveMangaShelf(user, item.sourceId, item.mangaId, {
                ...baseItem,
                unreadChapterCount: item.unreadChapterCount ?? 0,
              });
              processedShelfItems++;
              continue;
            }

            // 首次为老数据补齐基线，不触发通知
            if (!previousChapterCount || !item.latestChapterId) {
              await db.saveMangaShelf(user, item.sourceId, item.mangaId, {
                ...baseItem,
                latestChapterId,
                latestChapterName,
                latestChapterCount,
                unreadChapterCount: item.unreadChapterCount ?? 0,
              });
              processedShelfItems++;
              continue;
            }

            const addedChapters = latestChapterCount - previousChapterCount;
            const hasNewChapters = addedChapters > 0 && latestChapterId !== item.latestChapterId;
            const nextUnreadChapterCount = hasNewChapters
              ? Math.max((item.unreadChapterCount || 0) + addedChapters, 0)
              : item.unreadChapterCount ?? 0;

            const nextItem: MangaShelfItem = {
              ...baseItem,
              latestChapterId,
              latestChapterName,
              latestChapterCount,
              unreadChapterCount: nextUnreadChapterCount,
            };

            if (hasNewChapters) {
              await storage.addNotification(user, {
                id: `manga_update_${item.sourceId}_${item.mangaId}_${now}`,
                type: 'manga_update',
                title: '漫画更新',
                message: `《${item.title}》新增 ${addedChapters} 话，已更新至 ${latestChapterName || '最新章节'}`,
                timestamp: now,
                read: false,
                metadata: {
                  sourceId: item.sourceId,
                  mangaId: item.mangaId,
                  title: item.title,
                  cover: detail.shelfItem.cover || item.cover,
                  sourceName: item.sourceName,
                  latestChapterId,
                  latestChapterName,
                  unreadChapterCount: nextUnreadChapterCount,
                },
              });

              const inlineCover =
                inlinedCoverCount < MAX_INLINE_MANGA_COVERS
                  ? await fetchMangaCoverAsDataUri(detail.shelfItem.cover || item.cover)
                  : undefined;
              if (inlineCover) {
                inlinedCoverCount++;
              }

              mangaUpdates.push({
                title: item.title,
                previousChapterCount,
                latestChapterCount,
                latestChapterName,
                url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/manga/detail?mangaId=${encodeURIComponent(item.mangaId)}&sourceId=${encodeURIComponent(item.sourceId)}&title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(detail.shelfItem.cover || item.cover || '')}&sourceName=${encodeURIComponent(item.sourceName)}`,
                cover: inlineCover,
              });
            }

            await db.saveMangaShelf(user, item.sourceId, item.mangaId, nextItem);
            processedShelfItems++;
          } catch (err) {
            console.error(`处理漫画书架失败 (${key}):`, err);
          }
        }

        console.log(`漫画书架处理完成: ${processedShelfItems}/${totalShelfItems}`);

        if (mangaUpdates.length > 0) {
          (async () => {
            try {
              const userEmail = storage.getUserEmail ? await storage.getUserEmail(user) : null;
              const emailNotifications = storage.getEmailNotificationPreference
                ? await storage.getEmailNotificationPreference(user)
                : false;

              if (userEmail && emailNotifications) {
                const config = await getConfig();
                const emailConfig = config?.EmailConfig;

                if (emailConfig?.enabled) {
                  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
                  const siteName = config?.SiteConfig?.SiteName || 'MoonTVPlus';

                  await EmailService.send(emailConfig, {
                    to: userEmail,
                    subject: `漫画书架更新汇总 - ${mangaUpdates.length} 部漫画有新章节`,
                    html: getBatchMangaUpdateEmailTemplate(
                      user,
                      mangaUpdates,
                      siteUrl,
                      siteName
                    ),
                  });
                }
              }
            } catch (emailError) {
              console.error(`发送漫画更新邮件失败 (${user}):`, emailError);
            }
          })().catch((err) => console.error(`漫画更新邮件异步任务失败 (${user}):`, err));
        }
      } catch (err) {
        console.error(`获取用户漫画书架失败 (${user}):`, err);
      }
    };

    // 分批并行处理用户，避免并发过高
    // 可通过环境变量 CRON_USER_BATCH_SIZE 配置批处理大小，默认为 3
    const BATCH_SIZE = parseInt(process.env.CRON_USER_BATCH_SIZE || '3', 10);
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      console.log(`处理用户批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(users.length / BATCH_SIZE)}: ${batch.join(', ')}`);
      await Promise.all(batch.map(user => processUser(user)));
    }

    console.log('刷新播放记录/收藏任务完成');
  } catch (err) {
    console.error('刷新播放记录/收藏任务启动失败', err);
  }
}

async function refreshOpenList() {
  try {
    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    // 检查功能是否启用
    if (!openListConfig || !openListConfig.Enabled) {
      console.log('跳过 OpenList 扫描：功能未启用');
      return;
    }

    // 检查是否配置了 OpenList 和定时扫描
    if (!openListConfig.URL || !openListConfig.Username || !openListConfig.Password) {
      console.log('跳过 OpenList 扫描：未配置');
      return;
    }

    const scanInterval = openListConfig.ScanInterval || 0;
    if (scanInterval === 0) {
      console.log('跳过 OpenList 扫描：定时扫描已关闭');
      return;
    }

    // 检查间隔时间是否满足最低要求（60分钟）
    if (scanInterval < 60) {
      console.log(`跳过 OpenList 扫描：间隔时间 ${scanInterval} 分钟小于最低要求 60 分钟`);
      return;
    }

    // 检查上次扫描时间
    const lastRefreshTime = openListConfig.LastRefreshTime || 0;
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime;
    const intervalMs = scanInterval * 60 * 1000;

    if (timeSinceLastRefresh < intervalMs) {
      const remainingMinutes = Math.ceil((intervalMs - timeSinceLastRefresh) / 60000);
      console.log(`跳过 OpenList 扫描：距离上次扫描仅 ${Math.floor(timeSinceLastRefresh / 60000)} 分钟，还需等待 ${remainingMinutes} 分钟`);
      return;
    }

    console.log(`开始 OpenList 定时扫描（间隔: ${scanInterval} 分钟）`);

    // 直接调用扫描函数（立即扫描模式，不清空 metainfo）
    const { taskId } = await startOpenListRefresh(false);
    console.log('OpenList 定时扫描已启动，任务ID:', taskId);
  } catch (err) {
    console.error('OpenList 定时扫描失败:', err);
  }
}

