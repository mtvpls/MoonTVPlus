/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { clearProgress, updateProgress } from '@/lib/data-migration-progress';
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
        { status: 400 },
      );
    }

    // 验证身份和权限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 检查用户权限（只有站长可以导入数据）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以导入数据' },
        { status: 401 },
      );
    }

    const username = authInfo.username; // 存储到局部变量以便 TypeScript 类型推断

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
      return NextResponse.json(
        { error: '解密失败，请检查密码是否正确' },
        { status: 400 },
      );
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
    if (
      !importData.data ||
      !importData.data.adminConfig ||
      !importData.data.userData
    ) {
      return NextResponse.json({ error: '备份文件格式无效' }, { status: 400 });
    }

    // 开始导入数据 - 先清空现有数据
    updateProgress(username, 'import', 'clearing', 0, 1, '正在清空现有数据...');
    await db.clearAllData();

    // 额外清除所有V2用户（clearAllData可能只清除旧版用户）
    const existingUsers = await db.getUserListV2(
      0,
      1000000,
      process.env.USERNAME,
    );
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
    const usersV2Map = new Map(
      (importData.data.usersV2 || []).map((u: any) => [u.username, u]),
    );

    const userCount = Object.keys(userData).length;
    console.log(`准备导入 ${userCount} 个用户的数据`);
    updateProgress(
      username,
      'import',
      'importing',
      0,
      userCount,
      '开始导入用户数据...',
    );

    // 分块处理用户，每批处理数量可通过环境变量配置
    const CHUNK_SIZE = parseInt(
      process.env.DATA_MIGRATION_CHUNK_SIZE || '10',
      10,
    );
    const usernames = Object.keys(userData);
    let importedCount = 0;

    for (let i = 0; i < usernames.length; i += CHUNK_SIZE) {
      const chunk = usernames.slice(i, i + CHUNK_SIZE);
      console.log(
        `处理第 ${Math.floor(i / CHUNK_SIZE) + 1} 批用户 (${chunk.length} 个)`,
      );
      updateProgress(
        username,
        'import',
        'importing',
        importedCount,
        userCount,
        `正在导入用户数据 (${importedCount}/${userCount})...`,
      );

      // 并行导入当前批次的用户
      const importPromises = chunk.map(async (username) => {
        try {
          const user = userData[username];
          // 数据批处理大小（用于播放记录、收藏夹等）
          const DATA_BATCH_SIZE = parseInt(
            process.env.DATA_MIGRATION_CHUNK_SIZE || '10',
            10,
          );

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
              if (typeof storage.createUserWithHashedPassword === 'function') {
                await storage.createUserWithHashedPassword(
                  username,
                  user.passwordV2,
                  role,
                  createdAt,
                  userV2?.tags,
                  userV2?.oidcSub,
                  userV2?.enabledApis,
                  userV2?.banned,
                );
                console.log(`用户 ${username} 导入成功 (D1)`);
              } else {
                console.error(
                  `D1 storage 缺少 createUserWithHashedPassword 方法`,
                );
                return false;
              }
            } else if (storageType === 'postgres') {
              // Postgres 存储：使用 createUserWithHashedPassword 方法
              if (typeof storage.createUserWithHashedPassword === 'function') {
                await storage.createUserWithHashedPassword(
                  username,
                  user.passwordV2,
                  role,
                  createdAt,
                  userV2?.tags,
                  userV2?.oidcSub,
                  userV2?.enabledApis,
                  userV2?.banned,
                );
                console.log(`用户 ${username} 导入成功 (Postgres)`);
              } else {
                console.error(
                  `Postgres storage 缺少 createUserWithHashedPassword 方法`,
                );
                return false;
              }
            } else {
              // Redis 存储：直接设置用户信息
              const userInfoKey = `user:${username}:info`;
              const userInfo: Record<string, string> = {
                role,
                banned: String(userV2?.banned || false),
                password: user.passwordV2,
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

              await storage.withRetry(() =>
                storage.client.hSet(userInfoKey, userInfo),
              );
              await storage.withRetry(() =>
                storage.client.zAdd('user:list', {
                  score: createdAt,
                  value: username,
                }),
              );

              if (userV2?.oidcSub) {
                const oidcSubKey = `oidc:sub:${userV2.oidcSub}`;
                await storage.withRetry(() =>
                  storage.client.set(oidcSubKey, username),
                );
              }

              console.log(`用户 ${username} 导入成功 (Redis)`);
            }
          } else {
            console.log(`跳过用户 ${username}：没有passwordV2`);
            return false;
          }

          // 并行导入用户的各类数据
          await Promise.all([
            // 导入播放记录（批量）
            (async () => {
              if (user.playRecords) {
                const entries = Object.entries(user.playRecords);
                // 使用配置的批处理大小
                for (let j = 0; j < entries.length; j += DATA_BATCH_SIZE) {
                  const batch = entries.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map(([key, record]) =>
                      (db as any).storage.setPlayRecord(username, key, record),
                    ),
                  );
                }
              }
            })(),

            // 导入收藏夹（批量）
            (async () => {
              if (user.favorites) {
                const entries = Object.entries(user.favorites);
                for (let j = 0; j < entries.length; j += DATA_BATCH_SIZE) {
                  const batch = entries.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map(([key, favorite]) =>
                      (db as any).storage.setFavorite(username, key, favorite),
                    ),
                  );
                }
              }
            })(),

            // 导入搜索历史（批量）
            (async () => {
              if (user.searchHistory && Array.isArray(user.searchHistory)) {
                const reversed = user.searchHistory.reverse();
                for (let j = 0; j < reversed.length; j += DATA_BATCH_SIZE) {
                  const batch = reversed.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map((keyword: string) =>
                      db.addSearchHistory(username, keyword),
                    ),
                  );
                }
              }
            })(),

            // 导入跳过片头片尾配置（批量）
            (async () => {
              if (user.skipConfigs) {
                const entries = Object.entries(user.skipConfigs);
                for (let j = 0; j < entries.length; j += DATA_BATCH_SIZE) {
                  const batch = entries.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map(([key, skipConfig]) => {
                      const [source, id] = key.split('+');
                      if (source && id) {
                        return db.setSkipConfig(
                          username,
                          source,
                          id,
                          skipConfig as any,
                        );
                      }
                      return Promise.resolve();
                    }),
                  );
                }
              }
            })(),

            // 导入音乐播放记录（批量）
            (async () => {
              if (user.musicPlayRecords) {
                const entries = Object.entries(user.musicPlayRecords);
                for (let j = 0; j < entries.length; j += DATA_BATCH_SIZE) {
                  const batch = entries.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map(([key, record]) => {
                      const [platform, id] = key.split('+');
                      if (platform && id) {
                        return db.saveMusicPlayRecord(
                          username,
                          platform,
                          id,
                          record as any,
                        );
                      }
                      return Promise.resolve();
                    }),
                  );
                }
              }
            })(),

            // 导入音乐歌单
            (async () => {
              if (user.musicPlaylists && Array.isArray(user.musicPlaylists)) {
                for (const playlist of user.musicPlaylists) {
                  await db.createMusicPlaylist(username, {
                    id: playlist.id,
                    name: playlist.name,
                    description: playlist.description,
                    cover: playlist.cover,
                  });

                  // 批量导入歌单中的歌曲
                  if (playlist.songs && Array.isArray(playlist.songs)) {
                    for (
                      let j = 0;
                      j < playlist.songs.length;
                      j += DATA_BATCH_SIZE
                    ) {
                      const batch = playlist.songs.slice(
                        j,
                        j + DATA_BATCH_SIZE,
                      );
                      await Promise.all(
                        batch.map((song: any) =>
                          db.addSongToPlaylist(playlist.id, {
                            platform: song.platform,
                            id: song.id,
                            name: song.name,
                            artist: song.artist,
                            album: song.album,
                            pic: song.pic,
                            duration: song.duration || 0,
                          }),
                        ),
                      );
                    }
                  }
                }
              }
            })(),
          ]);

          return true;
        } catch (error) {
          console.error(`导入用户 ${username} 失败:`, error);
          return false;
        }
      });

      // 等待当前批次完成
      const results = await Promise.all(importPromises);
      importedCount += results.filter((r) => r).length;

      console.log(`已完成 ${importedCount}/${userCount} 个用户`);
      updateProgress(
        username,
        'import',
        'importing',
        importedCount,
        userCount,
        `已导入 ${importedCount}/${userCount} 个用户`,
      );
    }

    console.log(`成功导入 ${importedCount} 个用户的user:info`);
    updateProgress(
      username,
      'import',
      'completed',
      importedCount,
      userCount,
      '导入完成！',
    );
    setTimeout(() => clearProgress(username, 'import'), 3000);

    return NextResponse.json({
      message: '数据导入成功',
      importedUsers: Object.keys(userData).length,
      importedUsersV2: importData.data.usersV2?.length || 0,
      timestamp: importData.timestamp,
      serverVersion:
        typeof importData.serverVersion === 'string'
          ? importData.serverVersion
          : '未知版本',
    });
  } catch (error) {
    console.error('数据导入失败:', error);
    // 清除进度信息
    const authInfo = getAuthInfoFromCookie(req);
    if (authInfo?.username) {
      clearProgress(authInfo.username, 'import');
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导入失败' },
      { status: 500 },
    );
  }
}
