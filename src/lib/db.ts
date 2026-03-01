/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { MusicPlayRecord } from './db.client';
import { KvrocksStorage } from './kvrocks.db';
import { RedisStorage } from './redis.db';
import { DanmakuFilterConfig,Favorite, IStorage, PlayRecord, SkipConfig } from './types';
import { UpstashRedisStorage } from './upstash.db';

// storage type 常量: 'localstorage' | 'redis' | 'upstash' | 'kvrocks' | 'd1' | 'postgres'，默认 'localstorage'
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | 'd1'
    | 'postgres'
    | undefined) || 'localstorage';

// 创建存储实例
function createStorage(): IStorage {
  switch (STORAGE_TYPE) {
    case 'redis':
      return new RedisStorage();
    case 'upstash':
      return new UpstashRedisStorage();
    case 'kvrocks':
      return new KvrocksStorage();
    case 'd1':
      // D1Storage 只能在服务端使用，客户端会报错
      if (typeof window !== 'undefined') {
        throw new Error('D1Storage can only be used on the server side');
      }
      const d1Adapter = getD1Adapter();
      // 动态导入 D1Storage 以避免客户端打包
      const { D1Storage } = require('./d1.db');
      return new D1Storage(d1Adapter);
    case 'postgres':
      // PostgresStorage 只能在服务端使用，客户端会报错
      if (typeof window !== 'undefined') {
        throw new Error('PostgresStorage can only be used on the server side');
      }
      const postgresAdapter = getPostgresAdapter();
      // 动态导入 PostgresStorage 以避免客户端打包
      const { PostgresStorage } = require('./postgres.db');
      return new PostgresStorage(postgresAdapter);
    case 'localstorage':
    default:
      return null as unknown as IStorage;
  }
}

/**
 * 获取 Postgres 适配器
 * 使用 Vercel Postgres (@vercel/postgres)
 */
function getPostgresAdapter(): any {
  // 动态导入适配器以避免客户端打包
  const { PostgresAdapter } = require('./postgres-adapter');

  console.log('Using Vercel Postgres database');

  return new PostgresAdapter();
}

/**
 * 获取 D1 适配器
 * 开发环境：使用 better-sqlite3
 * 生产环境：使用 Cloudflare D1
 */
function getD1Adapter(): any {
  // 动态导入适配器以避免客户端打包
  const { CloudflareD1Adapter, SQLiteAdapter } = require('./d1-adapter');

  // 检查是否为 Cloudflare 构建
  const isCloudflare = process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';

  // 生产环境：Cloudflare Workers/Pages
  if (isCloudflare) {
    // 创建一个懒加载的适配器，延迟到实际使用时才获取 D1 绑定
    let cachedAdapter: any = null;

    return new Proxy({}, {
      get(target, prop) {
        // 懒加载：第一次访问时才获取真实的 D1 适配器
        if (!cachedAdapter) {
          try {
            const { getCloudflareContext } = require('@opennextjs/cloudflare');
            const { env } = getCloudflareContext();

            if (!env.DB) {
              throw new Error('D1 database binding (DB) not found in Cloudflare environment');
            }

            console.log('Using Cloudflare D1 database');
            cachedAdapter = new CloudflareD1Adapter(env.DB);
          } catch (error) {
            console.error('Failed to initialize Cloudflare D1:', error);
            throw error;
          }
        }

        return cachedAdapter[prop];
      }
    });
  }

  // 开发环境：better-sqlite3
  const Database = require('better-sqlite3');
  const path = require('path');

  const dbPath = path.join(process.cwd(), '.data', 'moontv.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // 启用 WAL 模式提升性能

  console.log('Using SQLite database (development mode)');
  console.log('Database location:', dbPath);

  return new SQLiteAdapter(db);
}

// 单例存储实例
let storageInstance: IStorage | null = null;

export function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
export class DbManager {
  private storage: IStorage;

  constructor() {
    this.storage = getStorage();
  }

  // 播放记录相关方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  // 收藏相关方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // 音乐播放记录相关方法
  async saveMusicPlayRecord(
    userName: string,
    platform: string,
    id: string,
    record: MusicPlayRecord
  ): Promise<void> {
    const key = generateStorageKey(platform, id);
    await this.storage.setMusicPlayRecord(userName, key, record);
  }

  async batchSaveMusicPlayRecords(
    userName: string,
    records: Array<{ platform: string; id: string; record: MusicPlayRecord }>
  ): Promise<void> {
    const batchRecords = records.map(({ platform, id, record }) => ({
      key: generateStorageKey(platform, id),
      record,
    }));
    await this.storage.batchSetMusicPlayRecords(userName, batchRecords);
  }

  async getAllMusicPlayRecords(userName: string): Promise<{
    [key: string]: MusicPlayRecord;
  }> {
    return this.storage.getAllMusicPlayRecords(userName);
  }

  async deleteMusicPlayRecord(
    userName: string,
    platform: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(platform, id);
    await this.storage.deleteMusicPlayRecord(userName, key);
  }

  async clearAllMusicPlayRecords(userName: string): Promise<void> {
    await this.storage.clearAllMusicPlayRecords(userName);
  }

  // 音乐歌单相关方法
  async createMusicPlaylist(
    userName: string,
    playlist: {
      id: string;
      name: string;
      description?: string;
      cover?: string;
    }
  ): Promise<void> {
    if (typeof (this.storage as any).createMusicPlaylist === 'function') {
      await (this.storage as any).createMusicPlaylist(userName, playlist);
    }
  }

  async getMusicPlaylist(playlistId: string): Promise<any | null> {
    if (typeof (this.storage as any).getMusicPlaylist === 'function') {
      return (this.storage as any).getMusicPlaylist(playlistId);
    }
    return null;
  }

  async getUserMusicPlaylists(userName: string): Promise<any[]> {
    if (typeof (this.storage as any).getUserMusicPlaylists === 'function') {
      return (this.storage as any).getUserMusicPlaylists(userName);
    }
    return [];
  }

  async updateMusicPlaylist(
    playlistId: string,
    updates: {
      name?: string;
      description?: string;
      cover?: string;
    }
  ): Promise<void> {
    if (typeof (this.storage as any).updateMusicPlaylist === 'function') {
      await (this.storage as any).updateMusicPlaylist(playlistId, updates);
    }
  }

  async deleteMusicPlaylist(playlistId: string): Promise<void> {
    if (typeof (this.storage as any).deleteMusicPlaylist === 'function') {
      await (this.storage as any).deleteMusicPlaylist(playlistId);
    }
  }

  async addSongToPlaylist(
    playlistId: string,
    song: {
      platform: string;
      id: string;
      name: string;
      artist: string;
      album?: string;
      pic?: string;
      duration: number;
    }
  ): Promise<void> {
    if (typeof (this.storage as any).addSongToPlaylist === 'function') {
      await (this.storage as any).addSongToPlaylist(playlistId, song);
    }
  }

  async removeSongFromPlaylist(
    playlistId: string,
    platform: string,
    songId: string
  ): Promise<void> {
    if (typeof (this.storage as any).removeSongFromPlaylist === 'function') {
      await (this.storage as any).removeSongFromPlaylist(playlistId, platform, songId);
    }
  }

  async getPlaylistSongs(playlistId: string): Promise<any[]> {
    if (typeof (this.storage as any).getPlaylistSongs === 'function') {
      return (this.storage as any).getPlaylistSongs(playlistId);
    }
    return [];
  }

  async isSongInPlaylist(
    playlistId: string,
    platform: string,
    songId: string
  ): Promise<boolean> {
    if (typeof (this.storage as any).isSongInPlaylist === 'function') {
      return (this.storage as any).isSongInPlaylist(playlistId, platform, songId);
    }
    return false;
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  // 检查用户是否已存在
  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.storage.changePassword(userName, newPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    await this.storage.deleteUser(userName);
  }

  // ---------- 用户相关（新版本） ----------
  async createUserV2(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[]
  ): Promise<void> {
    if (typeof (this.storage as any).createUserV2 === 'function') {
      await (this.storage as any).createUserV2(userName, password, role, tags, oidcSub, enabledApis);
    }
  }

  async verifyUserV2(userName: string, password: string): Promise<boolean> {
    if (typeof (this.storage as any).verifyUserV2 === 'function') {
      return (this.storage as any).verifyUserV2(userName, password);
    }
    return false;
  }

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
  } | null> {
    if (typeof (this.storage as any).getUserInfoV2 === 'function') {
      return (this.storage as any).getUserInfoV2(userName);
    }
    return null;
  }

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
    if (typeof (this.storage as any).updateUserInfoV2 === 'function') {
      await (this.storage as any).updateUserInfoV2(userName, updates);
    }
  }

  async changePasswordV2(userName: string, newPassword: string): Promise<void> {
    if (typeof (this.storage as any).changePasswordV2 === 'function') {
      await (this.storage as any).changePasswordV2(userName, newPassword);
    }
  }

  async checkUserExistV2(userName: string): Promise<boolean> {
    if (typeof (this.storage as any).checkUserExistV2 === 'function') {
      return (this.storage as any).checkUserExistV2(userName);
    }
    return false;
  }

  async getUserByOidcSub(oidcSub: string): Promise<string | null> {
    if (typeof (this.storage as any).getUserByOidcSub === 'function') {
      return (this.storage as any).getUserByOidcSub(oidcSub);
    }
    return null;
  }

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
    if (typeof (this.storage as any).getUserListV2 === 'function') {
      return (this.storage as any).getUserListV2(offset, limit, ownerUsername);
    }
    return { users: [], total: 0 };
  }

  async deleteUserV2(userName: string): Promise<void> {
    if (typeof (this.storage as any).deleteUserV2 === 'function') {
      await (this.storage as any).deleteUserV2(userName);
    }
  }

  async getUsersByTag(tagName: string): Promise<string[]> {
    if (typeof (this.storage as any).getUsersByTag === 'function') {
      return (this.storage as any).getUsersByTag(tagName);
    }
    return [];
  }

  // ---------- 播放记录迁移 ----------
  async migratePlayRecords(userName: string): Promise<void> {
    if (typeof (this.storage as any).migratePlayRecords === 'function') {
      await (this.storage as any).migratePlayRecords(userName);
    }
  }

  // ---------- 收藏迁移 ----------
  async migrateFavorites(userName: string): Promise<void> {
    if (typeof (this.storage as any).migrateFavorites === 'function') {
      await (this.storage as any).migrateFavorites(userName);
    }
  }

  // ---------- 跳过配置迁移 ----------
  async migrateSkipConfigs(userName: string): Promise<void> {
    if (typeof (this.storage as any).migrateSkipConfigs === 'function') {
      await (this.storage as any).migrateSkipConfigs(userName);
    }
  }

  // ---------- 数据迁移 ----------
  async migrateUsersFromConfig(adminConfig: AdminConfig): Promise<void> {
    if (typeof (this.storage as any).createUserV2 !== 'function') {
      throw new Error('当前存储类型不支持新版用户存储');
    }

    const users = adminConfig.UserConfig.Users;
    if (!users || users.length === 0) {
      return;
    }

    console.log(`开始迁移 ${users.length} 个用户...`);

    for (const user of users) {
      try {
        // 跳过环境变量中的站长（站长使用环境变量认证，不需要迁移）
        if (user.username === process.env.USERNAME) {
          console.log(`跳过站长 ${user.username} 的迁移`);
          continue;
        }

        // 检查用户是否已经迁移
        const exists = await this.checkUserExistV2(user.username);
        if (exists) {
          console.log(`用户 ${user.username} 已存在，跳过迁移`);
          continue;
        }

        // 获取密码
        let password = '';

        // 如果是OIDC用户，生成随机密码（OIDC用户不需要密码登录）
        if ((user as any).oidcSub) {
          password = crypto.randomUUID();
          console.log(`用户 ${user.username} (OIDC用户) 使用随机密码迁移`);
        }
        // 尝试从旧的存储中获取密码
        else {
          try {
            if ((this.storage as any).client) {
              const storedPassword = await (this.storage as any).client.get(`u:${user.username}:pwd`);
              if (storedPassword) {
                password = storedPassword;
                console.log(`用户 ${user.username} 使用旧密码迁移`);
              } else {
                // 没有旧密码，使用默认密码
                password = 'defaultPassword123';
                console.log(`用户 ${user.username} 没有旧密码，使用默认密码`);
              }
            } else {
              password = 'defaultPassword123';
            }
          } catch (err) {
            console.error(`获取用户 ${user.username} 的密码失败，使用默认密码`, err);
            password = 'defaultPassword123';
          }
        }

        // 将站长角色转换为普通角色
        const migratedRole = user.role === 'owner' ? 'user' : user.role;
        if (user.role === 'owner') {
          console.log(`用户 ${user.username} 的角色从 owner 转换为 user`);
        }

        // 创建新用户
        await this.createUserV2(
          user.username,
          password,
          migratedRole,
          user.tags,
          (user as any).oidcSub,
          user.enabledApis
        );

        // 如果用户被封禁，更新状态
        if (user.banned) {
          await this.updateUserInfoV2(user.username, { banned: true });
        }

        console.log(`用户 ${user.username} 迁移成功`);
      } catch (err) {
        console.error(`迁移用户 ${user.username} 失败:`, err);
      }
    }

    console.log('用户迁移完成');
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 获取全部用户名
  async getAllUsers(): Promise<string[]> {
    if (typeof (this.storage as any).getAllUsers === 'function') {
      return (this.storage as any).getAllUsers();
    }
    return [];
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof (this.storage as any).getAdminConfig === 'function') {
      return (this.storage as any).getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof (this.storage as any).setAdminConfig === 'function') {
      await (this.storage as any).setAdminConfig(config);
    }
  }

  // ---------- 跳过片头片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    if (typeof (this.storage as any).getSkipConfig === 'function') {
      return (this.storage as any).getSkipConfig(userName, source, id);
    }
    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    if (typeof (this.storage as any).setSkipConfig === 'function') {
      await (this.storage as any).setSkipConfig(userName, source, id, config);
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    if (typeof (this.storage as any).deleteSkipConfig === 'function') {
      await (this.storage as any).deleteSkipConfig(userName, source, id);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    if (typeof (this.storage as any).getAllSkipConfigs === 'function') {
      return (this.storage as any).getAllSkipConfigs(userName);
    }
    return {};
  }

  // ---------- 弹幕过滤配置 ----------
  async getDanmakuFilterConfig(userName: string): Promise<DanmakuFilterConfig | null> {
    if (typeof (this.storage as any).getDanmakuFilterConfig === 'function') {
      return (this.storage as any).getDanmakuFilterConfig(userName);
    }
    return null;
  }

  async setDanmakuFilterConfig(
    userName: string,
    config: DanmakuFilterConfig
  ): Promise<void> {
    if (typeof (this.storage as any).setDanmakuFilterConfig === 'function') {
      await (this.storage as any).setDanmakuFilterConfig(userName, config);
    }
  }

  async deleteDanmakuFilterConfig(userName: string): Promise<void> {
    if (typeof (this.storage as any).deleteDanmakuFilterConfig === 'function') {
      await (this.storage as any).deleteDanmakuFilterConfig(userName);
    }
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    if (typeof (this.storage as any).clearAllData === 'function') {
      await (this.storage as any).clearAllData();
    } else {
      throw new Error('存储类型不支持清空数据操作');
    }
  }

  // ---------- 通用键值存储 ----------
  async getGlobalValue(key: string): Promise<string | null> {
    if (typeof (this.storage as any).getGlobalValue === 'function') {
      return (this.storage as any).getGlobalValue(key);
    }
    return null;
  }

  async setGlobalValue(key: string, value: string): Promise<void> {
    if (typeof (this.storage as any).setGlobalValue === 'function') {
      await (this.storage as any).setGlobalValue(key, value);
    }
  }

  async deleteGlobalValue(key: string): Promise<void> {
    if (typeof (this.storage as any).deleteGlobalValue === 'function') {
      await (this.storage as any).deleteGlobalValue(key);
    }
  }
}

// 导出默认实例
export const db = new DbManager();
