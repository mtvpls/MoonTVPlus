/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const gunzipAsync = promisify(gunzip);

export async function POST(req: NextRequest) {
  try {
    // 检查存储类型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存储进行数据迁移' },
        { status: 400 }
      );
    }

    // 验证身份和权限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 检查用户权限（只有站长可以导入数据）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '权限不足，只有站长可以导入数据' }, { status: 401 });
    }

    // 解析表单数据
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      return NextResponse.json({ error: '请选择备份文件' }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ error: '请提供解密密码' }, { status: 400 });
    }

    // 读取文件内容
    const encryptedData = await file.text();

    // 解密数据
    let decryptedData: string;
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch (error) {
      return NextResponse.json({ error: '解密失败，请检查密码是否正确' }, { status: 400 });
    }

    // 解压缩数据
    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    const decompressedBuffer = await gunzipAsync(compressedBuffer);
    const decompressedData = decompressedBuffer.toString();

    // 解析JSON数据
    let importData: any;
    try {
      importData = JSON.parse(decompressedData);
    } catch (error) {
      return NextResponse.json({ error: '备份文件格式错误' }, { status: 400 });
    }

    // 验证数据格式
    if (!importData.data || !importData.data.adminConfig || !importData.data.userData) {
      return NextResponse.json({ error: '备份文件格式无效' }, { status: 400 });
    }

    // 开始导入数据 - 先清空现有数据
    await db.clearAllData();

    // 额外清除所有V2用户（clearAllData可能只清除旧版用户）
    const existingUsers = await db.getUserListV2(0, 1000000, process.env.USERNAME);
    for (const user of existingUsers.users) {
      await db.deleteUserV2(user.username);
    }
    console.log(`已清除 ${existingUsers.users.length} 个现有V2用户`);

    // 导入管理员配置
    importData.data.adminConfig = configSelfCheck(importData.data.adminConfig);
    await db.saveAdminConfig(importData.data.adminConfig);
    await setCachedConfig(importData.data.adminConfig);

    // 清除短剧视频源缓存（因为导入的配置可能包含不同的视频源）
    try {
      await db.deleteGlobalValue('duanju');
      console.log('已清除短剧视频源缓存');
    } catch (error) {
      console.error('清除短剧视频源缓存失败:', error);
      // 不影响主流程，继续执行
    }

    // 导入用户数据和user:info
    const userData = importData.data.userData;
    const storage = (db as any).storage;
    // 使用前面已声明的 storageType 变量
    const usersV2Map = new Map((importData.data.usersV2 || []).map((u: any) => [u.username, u]));

    const userCount = Object.keys(userData).length;
    console.log(`准备导入 ${userCount} 个用户的数据`);

    let importedCount = 0;
    for (const username in userData) {
      const user = userData[username];

      // 为所有有passwordV2的用户创建user:info
      if (user.passwordV2) {
        const userV2 = usersV2Map.get(username) as any;

        // 确定角色：站长为owner，其他用户从usersV2获取或默认为user
        let role: 'owner' | 'admin' | 'user' = 'user';
        if (username === process.env.USERNAME) {
          role = 'owner';
        } else if (userV2) {
          role = userV2.role === 'owner' ? 'user' : userV2.role;
        }

        const createdAt = userV2?.created_at || Date.now();

        // 根据存储类型使用不同的导入方法
        if (storageType === 'd1') {
          // D1 存储：使用 createUserWithHashedPassword 方法
          try {
            if (typeof storage.createUserWithHashedPassword === 'function') {
              await storage.createUserWithHashedPassword(
                username,
                user.passwordV2, // 已经是hash过的密码
                role,
                createdAt,
                userV2?.tags,
                userV2?.oidcSub,
                userV2?.enabledApis,
                userV2?.banned
              );
              importedCount++;
              console.log(`用户 ${username} 导入成功 (D1)`);
            } else {
              console.error(`D1 storage 缺少 createUserWithHashedPassword 方法`);
            }
          } catch (err) {
            console.error(`导入用户 ${username} 失败:`, err);
          }
        } else if (storageType === 'postgres') {
          // Postgres 存储：使用 createUserWithHashedPassword 方法
          try {
            if (typeof storage.createUserWithHashedPassword === 'function') {
              await storage.createUserWithHashedPassword(
                username,
                user.passwordV2, // 已经是hash过的密码
                role,
                createdAt,
                userV2?.tags,
                userV2?.oidcSub,
                userV2?.enabledApis,
                userV2?.banned
              );
              importedCount++;
              console.log(`用户 ${username} 导入成功 (Postgres)`);
            } else {
              console.error(`Postgres storage 缺少 createUserWithHashedPassword 方法`);
            }
          } catch (err) {
            console.error(`导入用户 ${username} 失败:`, err);
          }
        } else {
          // Redis 存储：直接设置用户信息
          const userInfoKey = `user:${username}:info`;
          const userInfo: Record<string, string> = {
            role,
            banned: String(userV2?.banned || false),
            password: user.passwordV2, // 已经是hash过的密码，直接使用
            created_at: createdAt.toString(),
          };

          if (userV2?.tags && userV2.tags.length > 0) {
            userInfo.tags = JSON.stringify(userV2.tags);
          }

          if (userV2?.oidcSub) {
            userInfo.oidcSub = userV2.oidcSub;
          }

          if (userV2?.enabledApis && userV2.enabledApis.length > 0) {
            userInfo.enabledApis = JSON.stringify(userV2.enabledApis);
          }

          // 使用storage.withRetry直接设置用户信息
          await storage.withRetry(() => storage.client.hSet(userInfoKey, userInfo));

          // 添加到用户列表
          await storage.withRetry(() => storage.client.zAdd('user:list', {
            score: createdAt,
            value: username,
          }));

          // 如果有oidcSub，创建映射
          if (userV2?.oidcSub) {
            const oidcSubKey = `oidc:sub:${userV2.oidcSub}`;
            await storage.withRetry(() => storage.client.set(oidcSubKey, username));
          }

          importedCount++;
          console.log(`用户 ${username} 导入成功 (Redis)`);
        }
      } else {
        console.log(`跳过用户 ${username}：没有passwordV2`);
      }

      // 导入播放记录
      if (user.playRecords) {
        for (const [key, record] of Object.entries(user.playRecords)) {
          await (db as any).storage.setPlayRecord(username, key, record);
        }
      }

      // 导入收藏夹
      if (user.favorites) {
        for (const [key, favorite] of Object.entries(user.favorites)) {
          await (db as any).storage.setFavorite(username, key, favorite);
        }
      }

      // 导入搜索历史
      if (user.searchHistory && Array.isArray(user.searchHistory)) {
        for (const keyword of user.searchHistory.reverse()) { // 反转以保持顺序
          await db.addSearchHistory(username, keyword);
        }
      }

      // 导入跳过片头片尾配置
      if (user.skipConfigs) {
        for (const [key, skipConfig] of Object.entries(user.skipConfigs)) {
          const [source, id] = key.split('+');
          if (source && id) {
            await db.setSkipConfig(username, source, id, skipConfig as any);
          }
        }
      }

      // 导入音乐播放记录
      if (user.musicPlayRecords) {
        for (const [key, record] of Object.entries(user.musicPlayRecords)) {
          const [platform, id] = key.split('+');
          if (platform && id) {
            await db.saveMusicPlayRecord(username, platform, id, record as any);
          }
        }
      }

      // 导入音乐歌单
      if (user.musicPlaylists && Array.isArray(user.musicPlaylists)) {
        for (const playlist of user.musicPlaylists) {
          // 创建歌单
          await db.createMusicPlaylist(username, {
            id: playlist.id,
            name: playlist.name,
            description: playlist.description,
            cover: playlist.cover,
          });

          // 导入歌单中的歌曲
          if (playlist.songs && Array.isArray(playlist.songs)) {
            for (const song of playlist.songs) {
              await db.addSongToPlaylist(playlist.id, {
                platform: song.platform,
                id: song.id,
                name: song.name,
                artist: song.artist,
                album: song.album,
                pic: song.pic,
                duration: song.duration || 0,
              });
            }
          }
        }
      }
    }

    console.log(`成功导入 ${importedCount} 个用户的user:info`);

    return NextResponse.json({
      message: '数据导入成功',
      importedUsers: Object.keys(userData).length,
      importedUsersV2: importData.data.usersV2?.length || 0,
      timestamp: importData.timestamp,
      serverVersion: typeof importData.serverVersion === 'string' ? importData.serverVersion : '未知版本'
    });

  } catch (error) {
    console.error('数据导入失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导入失败' },
      { status: 500 }
    );
  }
}
