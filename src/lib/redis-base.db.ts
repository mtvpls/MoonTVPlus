/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { createClient, RedisClientType } from 'redis';

import { AdminConfig } from './admin.types';
import { RedisAdapter } from './redis-adapter';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';
import { userInfoCache } from './user-cache';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 内存锁：用于防止同一用户的并发播放记录操作（迁移、清理等）
const playRecordLocks = new Map<string, Promise<void>>();

// 连接配置接口
export interface RedisConnectionConfig {
  url: string;
  clientName: string; // 用于日志显示，如 "Redis" 或 "Pika"
}

// 添加Redis操作重试包装器
export function createRetryWrapper(clientName: string, getClient: () => RedisClientType) {
  return async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (err: any) {
        const isLastAttempt = i === maxRetries - 1;
        const isConnectionError =
          err.message?.includes('Connection') ||
          err.message?.includes('ECONNREFUSED') ||
          err.message?.includes('ENOTFOUND') ||
          err.code === 'ECONNRESET' ||
          err.code === 'EPIPE';

        if (isConnectionError && !isLastAttempt) {
          console.log(
            `${clientName} operation failed, retrying... (${i + 1}/${maxRetries})`
          );
          console.error('Error:', err.message);

          // 等待一段时间后重试
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

          // 尝试重新连接
          try {
            const client = getClient();
            if (!client.isOpen) {
              await client.connect();
            }
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr);
          }

          continue;
        }

        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  };
}

// 创建客户端的工厂函数
export function createRedisClient(config: RedisConnectionConfig, globalSymbol: symbol): RedisClientType {
  let client: RedisClientType | undefined = (global as any)[globalSymbol];

  if (!client) {
    if (!config.url) {
      throw new Error(`${config.clientName}_URL env variable not set`);
    }

    // 创建客户端配置
    const clientConfig: any = {
      url: config.url,
      socket: {
        // 重连策略：指数退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(`${config.clientName} reconnection attempt ${retries + 1}`);
          if (retries > 10) {
            console.error(`${config.clientName} max reconnection attempts exceeded`);
            return false; // 停止重连
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指数退避，最大30秒
        },
        connectTimeout: 10000, // 10秒连接超时
        // 设置no delay，减少延迟
        noDelay: true,
      },
      // 添加其他配置
      pingInterval: 30000, // 30秒ping一次，保持连接活跃
    };

    client = createClient(clientConfig);

    // 添加错误事件监听
    client.on('error', (err) => {
      console.error(`${config.clientName} client error:`, err);
    });

    client.on('connect', () => {
      console.log(`${config.clientName} connected`);
    });

    client.on('reconnecting', () => {
      console.log(`${config.clientName} reconnecting...`);
    });

    client.on('ready', () => {
      console.log(`${config.clientName} ready`);
    });

    // 初始连接，带重试机制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log(`${config.clientName} connected successfully`);
      } catch (err) {
        console.error(`${config.clientName} initial connection failed:`, err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (global as any)[globalSymbol] = client;
  }

  return client;
}

// 抽象基类，包含所有通用的Redis操作逻辑
export abstract class BaseRedisStorage implements IStorage {
  protected adapter: RedisAdapter;
  protected withRetry: <T>(operation: () => Promise<T>, maxRetries?: number) => Promise<T>;
  // 保留 client 属性用于向后兼容（数据迁移代码使用）
  client: any;

  constructor(adapter: RedisAdapter, withRetryFn: <T>(operation: () => Promise<T>, maxRetries?: number) => Promise<T>) {
    this.adapter = adapter;
    this.withRetry = withRetryFn;
    // 创建兼容层，同时支持驼峰和小写命名（用于数据迁移代码）
    this.client = {
      hSet: (key: string, ...args: any[]) => {
        if (args.length === 1) {
          return this.adapter.hSet(key, args[0]);
        }
        return this.adapter.hSet(key, args[0], args[1]);
      },
      hset: (key: string, ...args: any[]) => {
        if (args.length === 1) {
          return this.adapter.hSet(key, args[0]);
        }
        return this.adapter.hSet(key, args[0], args[1]);
      },
      hGet: (key: string, field: string) => this.adapter.hGet(key, field),
      hget: (key: string, field: string) => this.adapter.hGet(key, field),
      hGetAll: (key: string) => this.adapter.hGetAll(key),
      hgetall: (key: string) => this.adapter.hGetAll(key),
      zAdd: (key: string, member: { score: number; value: string }) => this.adapter.zAdd(key, member),
      zadd: (key: string, member: { score: number; value: string }) => this.adapter.zAdd(key, member),
      set: (key: string, value: string) => this.adapter.set(key, value),
      get: (key: string) => this.adapter.get(key),
      del: (...keys: string[]) => this.adapter.del(keys),
    };
  }

  // ---------- 播放记录 ----------
  private prHashKey(user: string) {
    return `u:${user}:pr`; // u:username:pr (hash结构)
  }

  // 旧版播放记录key（用于迁移）
  private prOldKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await this.withRetry(() =>
      this.adapter.hGet(this.prHashKey(userName), key)
    );
    return val ? (JSON.parse(val) as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.withRetry(() =>
      this.adapter.hSet(this.prHashKey(userName), key, JSON.stringify(record))
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const hashData = await this.withRetry(() =>
      this.adapter.hGetAll(this.prHashKey(userName))
    );

    const result: Record<string, PlayRecord> = {};
    for (const [key, value] of Object.entries(hashData)) {
      if (value) {
        result[key] = JSON.parse(value) as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.adapter.hDel(this.prHashKey(userName), key));
  }

  // 清理超出限制的旧播放记录
  async cleanupOldPlayRecords(userName: string): Promise<void> {
    // 检查是否已有正在进行的操作
    const existingLock = playRecordLocks.get(userName);
    if (existingLock) {
      console.log(`用户 ${userName} 的播放记录操作正在进行中，跳过清理`);
      await existingLock;
      return;
    }

    // 创建新的操作Promise
    const cleanupPromise = this.doCleanup(userName);
    playRecordLocks.set(userName, cleanupPromise);

    try {
      await cleanupPromise;
    } finally {
      // 操作完成后清除锁
      playRecordLocks.delete(userName);
    }
  }

  // 实际执行清理的方法
  private async doCleanup(userName: string): Promise<void> {
    try {
      // 获取配置的最大播放记录数，默认100
      const maxRecords = parseInt(process.env.MAX_PLAY_RECORDS_PER_USER || '100', 10);
      const threshold = maxRecords + 10; // 超过最大值+10时才触发清理

      // 获取所有播放记录
      const allRecords = await this.getAllPlayRecords(userName);
      const recordCount = Object.keys(allRecords).length;

      // 如果记录数未超过阈值，不需要清理
      if (recordCount <= threshold) {
        return;
      }

      console.log(`用户 ${userName} 的播放记录数 ${recordCount} 超过阈值 ${threshold}，开始清理...`);

      // 将记录转换为数组并按 save_time 排序（从旧到新）
      const sortedRecords = Object.entries(allRecords).sort(
        ([, a], [, b]) => a.save_time - b.save_time
      );

      // 计算需要删除的记录数
      const deleteCount = recordCount - maxRecords;

      // 删除最旧的记录
      const recordsToDelete = sortedRecords.slice(0, deleteCount);
      for (const [key] of recordsToDelete) {
        await this.deletePlayRecord(userName, key);
      }

      console.log(`已删除用户 ${userName} 的 ${deleteCount} 条最旧播放记录`);
    } catch (error) {
      console.error(`清理用户 ${userName} 播放记录失败:`, error);
      // 清理失败不影响主流程，只记录错误
    }
  }

  // 迁移播放记录：从旧的多key结构迁移到新的hash结构
  async migratePlayRecords(userName: string): Promise<void> {
    // 检查是否已有正在进行的迁移
    const existingMigration = playRecordLocks.get(userName);
    if (existingMigration) {
      console.log(`用户 ${userName} 的播放记录正在迁移中，等待完成...`);
      await existingMigration;
      return;
    }

    // 创建新的迁移Promise
    const migrationPromise = this.doMigration(userName);
    playRecordLocks.set(userName, migrationPromise);

    try {
      await migrationPromise;
    } finally {
      // 迁移完成后清除锁
      playRecordLocks.delete(userName);
    }
  }

  // 实际执行迁移的方法
  private async doMigration(userName: string): Promise<void> {
    console.log(`开始迁移用户 ${userName} 的播放记录...`);

    // 1. 检查是否已经迁移过
    const userInfo = await this.getUserInfoV2(userName);
    if (userInfo?.playrecord_migrated) {
      console.log(`用户 ${userName} 的播放记录已经迁移过，跳过`);
      return;
    }

    // 2. 获取旧结构的所有播放记录key
    const pattern = `u:${userName}:pr:*`;
    const oldKeys: string[] = await this.withRetry(() => this.adapter.keys(pattern));

    if (oldKeys.length === 0) {
      console.log(`用户 ${userName} 没有旧的播放记录，标记为已迁移`);
      // 即使没有数据也标记为已迁移
      await this.withRetry(() =>
        this.adapter.hSet(this.userInfoKey(userName), 'playrecord_migrated', 'true')
      );
      // 清除用户信息缓存
      const { userInfoCache } = await import('./user-cache');
      userInfoCache?.delete(userName);
      return;
    }

    console.log(`找到 ${oldKeys.length} 条旧播放记录，开始迁移...`);

    // 3. 批量获取旧数据
    const oldValues = await this.withRetry(() => this.adapter.mGet(oldKeys));

    // 4. 转换为hash格式
    const hashData: Record<string, string> = {};
    oldKeys.forEach((fullKey: string, idx: number) => {
      const raw = oldValues[idx];
      if (raw) {
        // 提取 source+id 部分作为hash的field
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        hashData[keyPart] = raw;
      }
    });

    // 5. 写入新的hash结构
    if (Object.keys(hashData).length > 0) {
      await this.withRetry(() =>
        this.adapter.hSet(this.prHashKey(userName), hashData)
      );
      console.log(`成功迁移 ${Object.keys(hashData).length} 条播放记录到hash结构`);
    }

    // 6. 删除旧的key
    await this.withRetry(() => this.adapter.del(oldKeys));
    console.log(`删除了 ${oldKeys.length} 个旧的播放记录key`);

    // 7. 标记迁移完成
    await this.withRetry(() =>
      this.adapter.hSet(this.userInfoKey(userName), 'playrecord_migrated', 'true')
    );

    // 8. 清除用户信息缓存，确保下次获取时能读取到最新的迁移标识
    const { userInfoCache } = await import('./user-cache');
    userInfoCache?.delete(userName);

    console.log(`用户 ${userName} 的播放记录迁移完成`);
  }

  // ---------- 收藏 ----------
  private favHashKey(user: string) {
    return `u:${user}:fav`; // u:username:fav (hash结构)
  }

  // 旧版收藏key（用于迁移）
  private favOldKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.withRetry(() =>
      this.adapter.hGet(this.favHashKey(userName), key)
    );
    return val ? (JSON.parse(val) as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.withRetry(() =>
      this.adapter.hSet(this.favHashKey(userName), key, JSON.stringify(favorite))
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const hashData = await this.withRetry(() =>
      this.adapter.hGetAll(this.favHashKey(userName))
    );

    const result: Record<string, Favorite> = {};
    for (const [key, value] of Object.entries(hashData)) {
      if (value) {
        result[key] = JSON.parse(value) as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.adapter.hDel(this.favHashKey(userName), key));
  }

  // 迁移收藏：从旧的多key结构迁移到新的hash结构
  async migrateFavorites(userName: string): Promise<void> {
    // 检查是否已有正在进行的迁移
    const existingMigration = playRecordLocks.get(userName);
    if (existingMigration) {
      console.log(`用户 ${userName} 的收藏正在迁移中，等待完成...`);
      await existingMigration;
      return;
    }

    // 创建新的迁移Promise
    const migrationPromise = this.doFavoriteMigration(userName);
    playRecordLocks.set(userName, migrationPromise);

    try {
      await migrationPromise;
    } finally {
      // 迁移完成后清除锁
      playRecordLocks.delete(userName);
    }
  }

  // 实际执行收藏迁移的方法
  private async doFavoriteMigration(userName: string): Promise<void> {
    console.log(`开始迁移用户 ${userName} 的收藏...`);

    // 1. 检查是否已经迁移过
    const userInfo = await this.getUserInfoV2(userName);
    if (userInfo?.favorite_migrated) {
      console.log(`用户 ${userName} 的收藏已经迁移过，跳过`);
      return;
    }

    // 2. 获取旧结构的所有收藏key
    const pattern = `u:${userName}:fav:*`;
    const oldKeys: string[] = await this.withRetry(() => this.adapter.keys(pattern));

    if (oldKeys.length === 0) {
      console.log(`用户 ${userName} 没有旧的收藏，标记为已迁移`);
      // 即使没有数据也标记为已迁移
      await this.withRetry(() =>
        this.adapter.hSet(this.userInfoKey(userName), 'favorite_migrated', 'true')
      );
      // 清除用户信息缓存
      const { userInfoCache } = await import('./user-cache');
      userInfoCache?.delete(userName);
      return;
    }

    console.log(`找到 ${oldKeys.length} 条旧收藏，开始迁移...`);

    // 3. 批量获取旧数据
    const oldValues = await this.withRetry(() => this.adapter.mGet(oldKeys));

    // 4. 转换为hash格式
    const hashData: Record<string, string> = {};
    oldKeys.forEach((fullKey: string, idx: number) => {
      const raw = oldValues[idx];
      if (raw) {
        // 提取 source+id 部分作为hash的field
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        hashData[keyPart] = raw;
      }
    });

    // 5. 写入新的hash结构
    if (Object.keys(hashData).length > 0) {
      await this.withRetry(() =>
        this.adapter.hSet(this.favHashKey(userName), hashData)
      );
      console.log(`成功迁移 ${Object.keys(hashData).length} 条收藏到hash结构`);
    }

    // 6. 删除旧的key
    await this.withRetry(() => this.adapter.del(oldKeys));
    console.log(`删除了 ${oldKeys.length} 个旧的收藏key`);

    // 7. 标记迁移完成
    await this.withRetry(() =>
      this.adapter.hSet(this.userInfoKey(userName), 'favorite_migrated', 'true')
    );

    // 8. 清除用户信息缓存，确保下次获取时能读取到最新的迁移标识
    const { userInfoCache } = await import('./user-cache');
    userInfoCache?.delete(userName);

    console.log(`用户 ${userName} 的收藏迁移完成`);
  }

  // ---------- 音乐播放记录相关 ----------
  private musicPlayRecordHashKey(userName: string) {
    return `u:${userName}:music_play_records`;
  }

  async getMusicPlayRecord(userName: string, key: string): Promise<any | null> {
    const value = await this.withRetry(() =>
      this.adapter.hGet(this.musicPlayRecordHashKey(userName), key)
    );
    return value ? JSON.parse(value) : null;
  }

  async setMusicPlayRecord(userName: string, key: string, record: any): Promise<void> {
    await this.withRetry(() =>
      this.adapter.hSet(
        this.musicPlayRecordHashKey(userName),
        key,
        JSON.stringify(record)
      )
    );
  }

  async batchSetMusicPlayRecords(userName: string, records: { key: string; record: any }[]): Promise<void> {
    if (records.length === 0) return;

    const hashKey = this.musicPlayRecordHashKey(userName);
    const data: Record<string, string> = {};

    for (const { key, record } of records) {
      data[key] = JSON.stringify(record);
    }

    await this.withRetry(() =>
      this.adapter.hSet(hashKey, data)
    );
  }

  async getAllMusicPlayRecords(userName: string): Promise<Record<string, any>> {
    const hashData = await this.withRetry(() =>
      this.adapter.hGetAll(this.musicPlayRecordHashKey(userName))
    );

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(hashData)) {
      if (value) {
        result[key] = JSON.parse(value);
      }
    }
    return result;
  }

  async deleteMusicPlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() =>
      this.adapter.hDel(this.musicPlayRecordHashKey(userName), key)
    );
  }

  async clearAllMusicPlayRecords(userName: string): Promise<void> {
    await this.withRetry(() =>
      this.adapter.del(this.musicPlayRecordHashKey(userName))
    );
  }

  // ---------- 音乐歌单相关 ----------
  private musicPlaylistsKey(userName: string) {
    return `u:${userName}:music_playlists`;
  }

  private musicPlaylistKey(playlistId: string) {
    return `music_playlist:${playlistId}`;
  }

  private musicPlaylistSongsKey(playlistId: string) {
    return `music_playlist:${playlistId}:songs`;
  }

  async createMusicPlaylist(userName: string, playlist: {
    id: string;
    name: string;
    description?: string;
    cover?: string;
  }): Promise<void> {
    const now = Date.now();
    const playlistData = {
      id: playlist.id,
      username: userName,
      name: playlist.name,
      description: playlist.description || '',
      cover: playlist.cover || '',
      created_at: now.toString(),
      updated_at: now.toString(),
    };

    // 存储歌单信息
    await this.withRetry(() =>
      this.adapter.hSet(this.musicPlaylistKey(playlist.id), playlistData)
    );

    // 添加到用户的歌单列表（使用 sorted set，按创建时间排序）
    await this.withRetry(() =>
      this.adapter.zAdd(this.musicPlaylistsKey(userName), {
        score: now,
        value: playlist.id,
      })
    );
  }

  async getMusicPlaylist(playlistId: string): Promise<any | null> {
    const data = await this.withRetry(() =>
      this.adapter.hGetAll(this.musicPlaylistKey(playlistId))
    );

    if (!data || Object.keys(data).length === 0) return null;

    return {
      id: data.id,
      username: data.username,
      name: data.name,
      description: data.description || undefined,
      cover: data.cover || undefined,
      created_at: parseInt(data.created_at, 10),
      updated_at: parseInt(data.updated_at, 10),
    };
  }

  async getUserMusicPlaylists(userName: string): Promise<any[]> {
    // 获取用户的所有歌单ID（按创建时间倒序）
    const playlistIds = await this.withRetry(() =>
      this.adapter.zRange(this.musicPlaylistsKey(userName), 0, -1)
    );

    if (!playlistIds || playlistIds.length === 0) return [];

    // 获取每个歌单的详细信息
    const playlists = [];
    for (const id of playlistIds) {
      const playlist = await this.getMusicPlaylist(ensureString(id));
      if (playlist) {
        playlists.push(playlist);
      }
    }

    // 按创建时间倒序排序
    return playlists.sort((a, b) => b.created_at - a.created_at);
  }

  async updateMusicPlaylist(playlistId: string, updates: {
    name?: string;
    description?: string;
    cover?: string;
  }): Promise<void> {
    const updateData: Record<string, string> = {
      updated_at: Date.now().toString(),
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.description !== undefined) {
      updateData.description = updates.description || '';
    }
    if (updates.cover !== undefined) {
      updateData.cover = updates.cover || '';
    }

    await this.withRetry(() =>
      this.adapter.hSet(this.musicPlaylistKey(playlistId), updateData)
    );
  }

  async deleteMusicPlaylist(playlistId: string): Promise<void> {
    // 获取歌单信息以获取用户名
    const playlist = await this.getMusicPlaylist(playlistId);
    if (!playlist) return;

    // 从用户的歌单列表中移除
    await this.withRetry(() =>
      this.adapter.zRem(this.musicPlaylistsKey(playlist.username), playlistId)
    );

    // 删除歌单信息
    await this.withRetry(() =>
      this.adapter.del(this.musicPlaylistKey(playlistId))
    );

    // 删除歌单的歌曲列表
    await this.withRetry(() =>
      this.adapter.del(this.musicPlaylistSongsKey(playlistId))
    );
  }

  async addSongToPlaylist(playlistId: string, song: {
    platform: string;
    id: string;
    name: string;
    artist: string;
    album?: string;
    pic?: string;
    duration: number;
  }): Promise<void> {
    const now = Date.now();
    const songKey = `${song.platform}+${song.id}`;

    const songData = {
      platform: song.platform,
      id: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album || '',
      pic: song.pic || '',
      duration: song.duration.toString(),
      added_at: now.toString(),
    };

    // 添加歌曲到歌单（使用 hash 存储歌曲信息）
    await this.withRetry(() =>
      this.adapter.hSet(this.musicPlaylistSongsKey(playlistId), songKey, JSON.stringify(songData))
    );

    // 更新歌单的 updated_at
    await this.updateMusicPlaylist(playlistId, {});

    // 如果是第一首歌且有封面，更新歌单封面
    const songs = await this.getPlaylistSongs(playlistId);
    if (songs.length === 1 && song.pic) {
      await this.updateMusicPlaylist(playlistId, { cover: song.pic });
    }
  }

  async removeSongFromPlaylist(playlistId: string, platform: string, songId: string): Promise<void> {
    const songKey = `${platform}+${songId}`;

    await this.withRetry(() =>
      this.adapter.hDel(this.musicPlaylistSongsKey(playlistId), songKey)
    );

    // 更新歌单的 updated_at
    await this.updateMusicPlaylist(playlistId, {});
  }

  async getPlaylistSongs(playlistId: string): Promise<any[]> {
    const songsData = await this.withRetry(() =>
      this.adapter.hGetAll(this.musicPlaylistSongsKey(playlistId))
    );

    if (!songsData || Object.keys(songsData).length === 0) return [];

    const songs = [];
    for (const [, value] of Object.entries(songsData)) {
      if (value) {
        const song = JSON.parse(value);
        songs.push({
          platform: song.platform,
          id: song.id,
          name: song.name,
          artist: song.artist,
          album: song.album || undefined,
          pic: song.pic || undefined,
          duration: parseFloat(song.duration),
          added_at: parseInt(song.added_at, 10),
        });
      }
    }

    // 按添加时间排序
    return songs.sort((a, b) => a.added_at - b.added_at);
  }

  async isSongInPlaylist(playlistId: string, platform: string, songId: string): Promise<boolean> {
    const songKey = `${platform}+${songId}`;
    const exists = await this.withRetry(() =>
      this.adapter.hGet(this.musicPlaylistSongsKey(playlistId), songKey)
    );
    return exists !== null;
  }

  // ---------- 用户注册 / 登录（旧版本，保持兼容） ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.withRetry(() =>
      this.adapter.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    // 确保比较时都是字符串类型
    return ensureString(stored) === password;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await this.withRetry(() =>
      this.adapter.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await this.withRetry(() =>
      this.adapter.set(this.userPwdKey(userName), newPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await this.withRetry(() => this.adapter.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await this.withRetry(() => this.adapter.del(this.shKey(userName)));

    // 删除播放记录（新hash结构）
    await this.withRetry(() => this.adapter.del(this.prHashKey(userName)));

    // 删除旧的播放记录key（如果有）
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await this.withRetry(() =>
      this.adapter.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await this.withRetry(() => this.adapter.del(playRecordKeys));
    }

    // 删除收藏夹（新hash结构）
    await this.withRetry(() => this.adapter.del(this.favHashKey(userName)));

    // 删除旧的收藏key（如果有）
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await this.withRetry(() =>
      this.adapter.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await this.withRetry(() => this.adapter.del(favoriteKeys));
    }

    // 删除跳过片头片尾配置（新hash结构）
    await this.withRetry(() => this.adapter.del(this.skipHashKey(userName)));

    // 删除旧的跳过配置key（如果有）
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await this.withRetry(() =>
      this.adapter.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await this.withRetry(() => this.adapter.del(skipConfigKeys));
    }

    // 删除音乐播放记录
    await this.withRetry(() => this.adapter.del(this.musicPlayRecordHashKey(userName)));

    // 删除用户的所有歌单
    const playlistIds = await this.withRetry(() =>
      this.adapter.zRange(this.musicPlaylistsKey(userName), 0, -1)
    );
    if (playlistIds && playlistIds.length > 0) {
      for (const playlistId of playlistIds) {
        const id = ensureString(playlistId);
        // 删除歌单信息
        await this.withRetry(() => this.adapter.del(this.musicPlaylistKey(id)));
        // 删除歌单的歌曲列表
        await this.withRetry(() => this.adapter.del(this.musicPlaylistSongsKey(id)));
      }
    }
    // 删除用户的歌单列表
    await this.withRetry(() => this.adapter.del(this.musicPlaylistsKey(userName)));
  }

  // ---------- 新版用户存储（使用Hash和Sorted Set） ----------
  private userInfoKey(userName: string) {
    return `user:${userName}:info`;
  }

  private userListKey() {
    return 'user:list';
  }

  private oidcSubKey(oidcSub: string) {
    return `oidc:sub:${oidcSub}`;
  }

  // SHA256加密密码
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 创建新用户（新版本）
  async createUserV2(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[]
  ): Promise<void> {
    const hashedPassword = await this.hashPassword(password);
    const createdAt = Date.now();

    // 存储用户信息到Hash
    const userInfo: Record<string, string> = {
      role,
      banned: 'false',
      password: hashedPassword,
      created_at: createdAt.toString(),
    };

    if (tags && tags.length > 0) {
      userInfo.tags = JSON.stringify(tags);
    }

    if (enabledApis && enabledApis.length > 0) {
      userInfo.enabledApis = JSON.stringify(enabledApis);
    }

    if (oidcSub) {
      userInfo.oidcSub = oidcSub;
      // 创建OIDC映射
      await this.withRetry(() => this.adapter.set(this.oidcSubKey(oidcSub), userName));
    }

    await this.withRetry(() => this.adapter.hSet(this.userInfoKey(userName), userInfo));

    // 添加到用户列表（Sorted Set，按注册时间排序）
    await this.withRetry(() => this.adapter.zAdd(this.userListKey(), {
      score: createdAt,
      value: userName,
    }));

    // 清除用户信息缓存
    userInfoCache?.delete(userName);

    // 如果创建的是站长用户，清除站长存在状态缓存
    if (userName === process.env.USERNAME) {
      const { ownerExistenceCache } = await import('./user-cache');
      ownerExistenceCache.delete(userName);
    }
  }

  // 验证用户密码（新版本）
  async verifyUserV2(userName: string, password: string): Promise<boolean> {
    const userInfo = await this.withRetry(() =>
      this.adapter.hGetAll(this.userInfoKey(userName))
    );

    if (!userInfo || !userInfo.password) {
      return false;
    }

    const hashedPassword = await this.hashPassword(password);
    return userInfo.password === hashedPassword;
  }

  // 获取用户信息（新版本）
  async getUserInfoV2(userName: string): Promise<{
    role: 'owner' | 'admin' | 'user';
    banned: boolean;
    tags?: string[];
    oidcSub?: string;
    enabledApis?: string[];
    created_at: number;
    playrecord_migrated?: boolean;
    favorite_migrated?: boolean;
    skip_migrated?: boolean;
    last_movie_request_time?: number;
    email?: string;
    emailNotifications?: boolean;
  } | null> {
    // 先从缓存获取
    const cached = userInfoCache?.get(userName);
    if (cached) {
      return cached;
    }

    const userInfoRaw = await this.withRetry(() =>
      this.adapter.hGetAll(this.userInfoKey(userName))
    );

    if (!userInfoRaw || Object.keys(userInfoRaw).length === 0) {
      // 如果数据库中没有，检查是否是环境变量中的站长
      if (userName === process.env.USERNAME) {
        // 站长即使数据库没有数据，也返回默认信息
        const ownerInfo = {
          role: 'owner' as const,
          banned: false,
          created_at: Date.now(),
          playrecord_migrated: true,
          favorite_migrated: true,
          skip_migrated: true,
        };

        // 为站长创建数据库记录
        try {
          const userInfo: Record<string, string> = {
            role: 'owner',
            banned: 'false',
            created_at: ownerInfo.created_at.toString(),
            playrecord_migrated: 'true',
            favorite_migrated: 'true',
            skip_migrated: 'true',
          };

          await this.withRetry(() => this.adapter.hSet(this.userInfoKey(userName), userInfo));

          // 添加到用户列表（Sorted Set，按注册时间排序）
          await this.withRetry(() => this.adapter.zAdd(this.userListKey(), {
            score: ownerInfo.created_at,
            value: userName,
          }));

          console.log(`Created database record for site owner: ${userName}`);
        } catch (insertErr) {
          console.error('Failed to create owner record:', insertErr);
          // 即使插入失败，仍然返回默认信息
        }

        // 缓存站长信息
        userInfoCache?.set(userName, ownerInfo);
        return ownerInfo;
      }
      return null;
    }

    const userInfo = {
      role: (userInfoRaw.role as 'owner' | 'admin' | 'user') || 'user',
      banned: userInfoRaw.banned === 'true',
      tags: userInfoRaw.tags ? JSON.parse(userInfoRaw.tags) : undefined,
      oidcSub: userInfoRaw.oidcSub,
      enabledApis: userInfoRaw.enabledApis ? JSON.parse(userInfoRaw.enabledApis) : undefined,
      created_at: parseInt(userInfoRaw.created_at || '0', 10),
      playrecord_migrated: userInfoRaw.playrecord_migrated === 'true',
      favorite_migrated: userInfoRaw.favorite_migrated === 'true',
      skip_migrated: userInfoRaw.skip_migrated === 'true',
      last_movie_request_time: userInfoRaw.last_movie_request_time ? parseInt(userInfoRaw.last_movie_request_time, 10) : undefined,
      email: userInfoRaw.email,
      emailNotifications: userInfoRaw.emailNotifications === 'true',
    };

    // 如果是站长，强制将 role 设置为 owner
    if (userName === process.env.USERNAME) {
      userInfo.role = 'owner';
    }

    // 写入缓存
    userInfoCache?.set(userName, userInfo);

    return userInfo;
  }

  // 更新用户信息（新版本）
  async updateUserInfoV2(
    userName: string,
    updates: {
      role?: 'owner' | 'admin' | 'user';
      banned?: boolean;
      tags?: string[];
      oidcSub?: string;
      enabledApis?: string[];
    }
  ): Promise<void> {
    const userInfo: Record<string, string> = {};

    if (updates.role !== undefined) {
      userInfo.role = updates.role;
    }

    if (updates.banned !== undefined) {
      userInfo.banned = updates.banned ? 'true' : 'false';
    }

    if (updates.tags !== undefined) {
      if (updates.tags.length > 0) {
        userInfo.tags = JSON.stringify(updates.tags);
      } else {
        // 删除tags字段
        await this.withRetry(() => this.adapter.hDel(this.userInfoKey(userName), 'tags'));
      }
    }

    if (updates.enabledApis !== undefined) {
      if (updates.enabledApis.length > 0) {
        userInfo.enabledApis = JSON.stringify(updates.enabledApis);
      } else {
        // 删除enabledApis字段
        await this.withRetry(() => this.adapter.hDel(this.userInfoKey(userName), 'enabledApis'));
      }
    }

    if (updates.oidcSub !== undefined) {
      const oldInfo = await this.getUserInfoV2(userName);
      if (oldInfo?.oidcSub && oldInfo.oidcSub !== updates.oidcSub) {
        // 删除旧的OIDC映射
        await this.withRetry(() => this.adapter.del(this.oidcSubKey(oldInfo.oidcSub!)));
      }
      userInfo.oidcSub = updates.oidcSub;
      // 创建新的OIDC映射
      await this.withRetry(() => this.adapter.set(this.oidcSubKey(updates.oidcSub!), userName));
    }

    if (Object.keys(userInfo).length > 0) {
      await this.withRetry(() => this.adapter.hSet(this.userInfoKey(userName), userInfo));
    }

    // 清除缓存
    userInfoCache?.delete(userName);
  }

  // 修改用户密码（新版本）
  async changePasswordV2(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await this.hashPassword(newPassword);
    await this.withRetry(() =>
      this.adapter.hSet(this.userInfoKey(userName), 'password', hashedPassword)
    );

    // 清除缓存
    userInfoCache?.delete(userName);
  }

  // 检查用户是否存在（新版本）
  async checkUserExistV2(userName: string): Promise<boolean> {
    const exists = await this.withRetry(() =>
      this.adapter.exists(this.userInfoKey(userName))
    );
    return exists === 1;
  }

  // 通过OIDC Sub查找用户名
  async getUserByOidcSub(oidcSub: string): Promise<string | null> {
    const userName = await this.withRetry(() =>
      this.adapter.get(this.oidcSubKey(oidcSub))
    );
    return userName ? ensureString(userName) : null;
  }

  // 获取用户列表（分页，新版本）
  async getUserListV2(
    offset = 0,
    limit = 20,
    ownerUsername?: string
  ): Promise<{
    users: Array<{
      username: string;
      role: 'owner' | 'admin' | 'user';
      banned: boolean;
      tags?: string[];
      oidcSub?: string;
      enabledApis?: string[];
      created_at: number;
    }>;
    total: number;
  }> {
    // 获取总数
    let total = await this.withRetry(() => this.adapter.zCard(this.userListKey()));

    // 检查站长是否在数据库中（使用缓存）
    let ownerInfo = null;
    let ownerInDatabase = false;
    if (ownerUsername) {
      // 先检查缓存
      const { ownerExistenceCache } = await import('./user-cache');
      const cachedExists = ownerExistenceCache.get(ownerUsername);

      if (cachedExists !== null) {
        // 使用缓存的结果
        ownerInDatabase = cachedExists;
        if (ownerInDatabase) {
          // 如果站长在数据库中，获取详细信息
          ownerInfo = await this.getUserInfoV2(ownerUsername);
        }
      } else {
        // 缓存未命中，查询数据库
        ownerInfo = await this.getUserInfoV2(ownerUsername);
        ownerInDatabase = !!ownerInfo;
        // 更新缓存
        ownerExistenceCache.set(ownerUsername, ownerInDatabase);
      }

      // 如果站长不在数据库中，总数+1（无论在哪一页都要加）
      if (!ownerInDatabase) {
        total += 1;
      }
    }

    // 如果站长不在数据库中且在第一页，需要调整获取的用户数量和偏移量
    let actualOffset = offset;
    let actualLimit = limit;

    if (ownerUsername && !ownerInDatabase) {
      if (offset === 0) {
        // 第一页：只获取 limit-1 个用户，为站长留出位置
        actualLimit = limit - 1;
      } else {
        // 其他页：偏移量需要减1，因为站长占据了第一页的一个位置
        actualOffset = offset - 1;
      }
    }

    // 获取用户列表（按注册时间升序）
    const usernames = await this.withRetry(() =>
      this.adapter.zRange(this.userListKey(), actualOffset, actualOffset + actualLimit - 1)
    );

    const users = [];

    // 如果有站长且在第一页，确保站长始终在第一位
    if (ownerUsername && offset === 0) {
      // 即使站长不在数据库中，也要添加站长（站长使用环境变量认证）
      users.push({
        username: ownerUsername,
        role: 'owner' as const,
        banned: ownerInfo?.banned || false,
        tags: ownerInfo?.tags,
        oidcSub: ownerInfo?.oidcSub,
        enabledApis: ownerInfo?.enabledApis,
        created_at: ownerInfo?.created_at || 0,
      });
    }

    // 获取其他用户信息
    for (const username of usernames) {
      const usernameStr = ensureString(username);
      // 跳过站长（已经添加）
      if (ownerUsername && usernameStr === ownerUsername) {
        continue;
      }

      const userInfo = await this.getUserInfoV2(usernameStr);
      if (userInfo) {
        users.push({
          username: usernameStr,
          role: userInfo.role,
          banned: userInfo.banned,
          tags: userInfo.tags,
          oidcSub: userInfo.oidcSub,
          enabledApis: userInfo.enabledApis,
          created_at: userInfo.created_at,
        });
      }
    }

    return { users, total };
  }

  // 删除用户（新版本）
  async deleteUserV2(userName: string): Promise<void> {
    // 获取用户信息
    const userInfo = await this.getUserInfoV2(userName);

    // 删除OIDC映射
    if (userInfo?.oidcSub) {
      await this.withRetry(() => this.adapter.del(this.oidcSubKey(userInfo.oidcSub!)));
    }

    // 删除用户信息Hash
    await this.withRetry(() => this.adapter.del(this.userInfoKey(userName)));

    // 从用���列表中移除
    await this.withRetry(() => this.adapter.zRem(this.userListKey(), userName));

    // 删除用户的其他数据（播放记录、收藏等）
    await this.deleteUser(userName);

    // 清除缓存
    userInfoCache?.delete(userName);
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await this.withRetry(() =>
      this.adapter.lRange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await this.withRetry(() => this.adapter.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await this.withRetry(() => this.adapter.lPush(key, ensureString(keyword)));
    // 限制最大长度
    await this.withRetry(() => this.adapter.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.withRetry(() => this.adapter.lRem(key, 0, ensureString(keyword)));
    } else {
      await this.withRetry(() => this.adapter.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    // 从新版用户列表获取
    const userListKey = this.userListKey();
    const users = await this.withRetry(() =>
      this.adapter.zRange(userListKey, 0, -1)
    );
    const userList = users.map(u => ensureString(u));

    // 确保站长在列表中（站长可能不在数据库中，使用环境变量认证）
    const ownerUsername = process.env.USERNAME;
    if (ownerUsername && !userList.includes(ownerUsername)) {
      userList.unshift(ownerUsername);
    }

    return userList;
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await this.withRetry(() => this.adapter.get(this.adminConfigKey()));
    return val ? (JSON.parse(val) as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.withRetry(() =>
      this.adapter.set(this.adminConfigKey(), JSON.stringify(config))
    );
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipHashKey(user: string) {
    return `u:${user}:skip`; // u:username:skip (hash结构)
  }

  private danmakuFilterConfigKey(user: string) {
    return `u:${user}:danmaku_filter`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const key = `${source}+${id}`;
    const val = await this.withRetry(() =>
      this.adapter.hGet(this.skipHashKey(userName), key)
    );
    return val ? (JSON.parse(val) as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    const key = `${source}+${id}`;
    await this.withRetry(() =>
      this.adapter.hSet(this.skipHashKey(userName), key, JSON.stringify(config))
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = `${source}+${id}`;
    await this.withRetry(() =>
      this.adapter.hDel(this.skipHashKey(userName), key)
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const hashData = await this.withRetry(() =>
      this.adapter.hGetAll(this.skipHashKey(userName))
    );

    const result: Record<string, SkipConfig> = {};
    for (const [key, value] of Object.entries(hashData)) {
      if (value) {
        result[key] = JSON.parse(value) as SkipConfig;
      }
    }
    return result;
  }

  // 迁移跳过配置：从旧的多key结构迁移到新的hash结构
  async migrateSkipConfigs(userName: string): Promise<void> {
    const existingMigration = playRecordLocks.get(`${userName}:skip`);
    if (existingMigration) {
      console.log(`用户 ${userName} 的跳过配置正在迁移中，等待完成...`);
      await existingMigration;
      return;
    }

    const migrationPromise = this.doSkipConfigMigration(userName);
    playRecordLocks.set(`${userName}:skip`, migrationPromise);

    try {
      await migrationPromise;
    } finally {
      playRecordLocks.delete(`${userName}:skip`);
    }
  }

  private async doSkipConfigMigration(userName: string): Promise<void> {
    console.log(`开始迁移用户 ${userName} 的跳过配置...`);

    const userInfo = await this.getUserInfoV2(userName);
    if (userInfo?.skip_migrated) {
      console.log(`用户 ${userName} 的跳过配置已经迁移过，跳过`);
      return;
    }

    const pattern = `u:${userName}:skip:*`;
    const oldKeys: string[] = await this.withRetry(() => this.adapter.keys(pattern));

    if (oldKeys.length === 0) {
      console.log(`用户 ${userName} 没有旧的跳过配置，标记为已迁移`);
      await this.withRetry(() =>
        this.adapter.hSet(this.userInfoKey(userName), 'skip_migrated', 'true')
      );
      const { userInfoCache } = await import('./user-cache');
      userInfoCache?.delete(userName);
      return;
    }

    const values = await this.withRetry(() => this.adapter.mGet(oldKeys));

    const hashData: Record<string, string> = {};
    oldKeys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          hashData[sourceAndId] = value as string;
        }
      }
    });

    if (Object.keys(hashData).length > 0) {
      await this.withRetry(() =>
        this.adapter.hSet(this.skipHashKey(userName), hashData)
      );
      console.log(`成功迁移 ${Object.keys(hashData).length} 条跳过配置到hash结构`);
    }

    await this.withRetry(() => this.adapter.del(oldKeys));
    console.log(`删除了 ${oldKeys.length} 个旧的跳过配置key`);

    await this.withRetry(() =>
      this.adapter.hSet(this.userInfoKey(userName), 'skip_migrated', 'true')
    );
    const { userInfoCache } = await import('./user-cache');
    userInfoCache?.delete(userName);

    console.log(`用户 ${userName} 的跳过配置迁移完成`);
  }

  // ---------- 弹幕过滤配置 ----------
  async getDanmakuFilterConfig(
    userName: string
  ): Promise<import('./types').DanmakuFilterConfig | null> {
    const val = await this.withRetry(() =>
      this.adapter.get(this.danmakuFilterConfigKey(userName))
    );
    return val ? (JSON.parse(val) as import('./types').DanmakuFilterConfig) : null;
  }

  async setDanmakuFilterConfig(
    userName: string,
    config: import('./types').DanmakuFilterConfig
  ): Promise<void> {
    await this.withRetry(() =>
      this.adapter.set(
        this.danmakuFilterConfigKey(userName),
        JSON.stringify(config)
      )
    );
  }

  async deleteDanmakuFilterConfig(userName: string): Promise<void> {
    await this.withRetry(() =>
      this.adapter.del(this.danmakuFilterConfigKey(userName))
    );
  }

  // 清空所有数据
  async clearAllData(): Promise<void> {
    try {
      // 获取所有用户
      const allUsers = await this.getAllUsers();

      // 删除所有用户及其数据
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 删除管理员配置
      await this.withRetry(() => this.adapter.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }

  // ---------- 通用键值存储 ----------
  private globalValueKey(key: string) {
    return `global:${key}`;
  }

  async getGlobalValue(key: string): Promise<string | null> {
    const val = await this.withRetry(() =>
      this.adapter.get(this.globalValueKey(key))
    );
    return val ? ensureString(val) : null;
  }

  async setGlobalValue(key: string, value: string): Promise<void> {
    await this.withRetry(() =>
      this.adapter.set(this.globalValueKey(key), ensureString(value))
    );
  }

  async deleteGlobalValue(key: string): Promise<void> {
    await this.withRetry(() => this.adapter.del(this.globalValueKey(key)));
  }

  // ---------- 通知相关 ----------
  private notificationsKey(userName: string) {
    return `u:${userName}:notifications`;
  }

  private lastFavoriteCheckKey(userName: string) {
    return `u:${userName}:last_fav_check`;
  }

  async getNotifications(userName: string): Promise<import('./types').Notification[]> {
    const val = await this.withRetry(() =>
      this.adapter.get(this.notificationsKey(userName))
    );
    return val ? (JSON.parse(val) as import('./types').Notification[]) : [];
  }

  async addNotification(
    userName: string,
    notification: import('./types').Notification
  ): Promise<void> {
    const notifications = await this.getNotifications(userName);
    notifications.unshift(notification); // 新通知放在最前面
    // 限制通知数量，最多保留100条
    if (notifications.length > 100) {
      notifications.splice(100);
    }
    await this.withRetry(() =>
      this.adapter.set(this.notificationsKey(userName), JSON.stringify(notifications))
    );
  }

  async markNotificationAsRead(
    userName: string,
    notificationId: string
  ): Promise<void> {
    const notifications = await this.getNotifications(userName);
    const notification = notifications.find((n) => n.id === notificationId);
    if (notification) {
      notification.read = true;
      await this.withRetry(() =>
        this.adapter.set(this.notificationsKey(userName), JSON.stringify(notifications))
      );
    }
  }

  async deleteNotification(
    userName: string,
    notificationId: string
  ): Promise<void> {
    const notifications = await this.getNotifications(userName);
    const filtered = notifications.filter((n) => n.id !== notificationId);
    await this.withRetry(() =>
      this.adapter.set(this.notificationsKey(userName), JSON.stringify(filtered))
    );
  }

  async clearAllNotifications(userName: string): Promise<void> {
    await this.withRetry(() => this.adapter.del(this.notificationsKey(userName)));
  }

  async getUnreadNotificationCount(userName: string): Promise<number> {
    const notifications = await this.getNotifications(userName);
    return notifications.filter((n) => !n.read).length;
  }

  async getLastFavoriteCheckTime(userName: string): Promise<number> {
    const val = await this.withRetry(() =>
      this.adapter.get(this.lastFavoriteCheckKey(userName))
    );
    return val ? parseInt(val, 10) : 0;
  }

  async setLastFavoriteCheckTime(
    userName: string,
    timestamp: number
  ): Promise<void> {
    await this.withRetry(() =>
      this.adapter.set(this.lastFavoriteCheckKey(userName), timestamp.toString())
    );
  }

  async updateLastMovieRequestTime(userName: string, timestamp: number): Promise<void> {
    await this.withRetry(() =>
      this.adapter.hSet(
        this.userInfoKey(userName),
        'last_movie_request_time',
        timestamp.toString()
      )
    );
  }

  // ---------- 求片相关 ----------
  private movieRequestsKey() {
    return 'movie_requests:all';
  }

  private userMovieRequestsKey(userName: string) {
    return `u:${userName}:mr`;
  }

  async getAllMovieRequests(): Promise<import('./types').MovieRequest[]> {
    const data = await this.withRetry(() => this.adapter.hGetAll(this.movieRequestsKey()));
    if (!data || Object.keys(data).length === 0) return [];
    return Object.values(data).map(v => JSON.parse(v) as import('./types').MovieRequest);
  }

  async getMovieRequest(requestId: string): Promise<import('./types').MovieRequest | null> {
    const val = await this.withRetry(() => this.adapter.hGet(this.movieRequestsKey(), requestId));
    return val ? (JSON.parse(val) as import('./types').MovieRequest) : null;
  }

  async createMovieRequest(request: import('./types').MovieRequest): Promise<void> {
    await this.withRetry(() => this.adapter.hSet(this.movieRequestsKey(), request.id, JSON.stringify(request)));
  }

  async updateMovieRequest(requestId: string, updates: Partial<import('./types').MovieRequest>): Promise<void> {
    const existing = await this.getMovieRequest(requestId);
    if (!existing) throw new Error('Movie request not found');
    const updated = { ...existing, ...updates };
    await this.withRetry(() => this.adapter.hSet(this.movieRequestsKey(), requestId, JSON.stringify(updated)));
  }

  async deleteMovieRequest(requestId: string): Promise<void> {
    await this.withRetry(() => this.adapter.hDel(this.movieRequestsKey(), requestId));
  }

  async getUserMovieRequests(userName: string): Promise<string[]> {
    const val = await this.withRetry(() => this.adapter.sMembers(this.userMovieRequestsKey(userName)));
    return val ? ensureStringArray(val) : [];
  }

  async addUserMovieRequest(userName: string, requestId: string): Promise<void> {
    await this.withRetry(() => this.adapter.sAdd(this.userMovieRequestsKey(userName), requestId));
  }

  async removeUserMovieRequest(userName: string, requestId: string): Promise<void> {
    await this.withRetry(() => this.adapter.sRem(this.userMovieRequestsKey(userName), requestId));
  }

  // ---------- 用户邮箱相关 ----------
  async getUserEmail(userName: string): Promise<string | null> {
    const userInfo = await this.getUserInfoV2(userName);
    return userInfo?.email || null;
  }

  async setUserEmail(userName: string, email: string): Promise<void> {
    await this.withRetry(() =>
      this.adapter.hSet(this.userInfoKey(userName), 'email', email)
    );
    // 清除缓存
    userInfoCache?.delete(userName);
  }

  async getEmailNotificationPreference(userName: string): Promise<boolean> {
    const userInfo = await this.getUserInfoV2(userName);
    return userInfo?.emailNotifications || false;
  }

  async setEmailNotificationPreference(userName: string, enabled: boolean): Promise<void> {
    await this.withRetry(() =>
      this.adapter.hSet(this.userInfoKey(userName), 'emailNotifications', enabled.toString())
    );
    // 清除缓存
    userInfoCache?.delete(userName);
  }
}
