/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { SimpleCrypto } from '@/lib/crypto';
import { clearProgress, updateProgress } from '@/lib/data-migration-progress';
import { db } from '@/lib/db';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

const gzipAsync = promisify(gzip);

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

    // 检查用户权限（只有站长可以导出数据）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以导出数据' },
        { status: 401 },
      );
    }

    const username = authInfo.username; // 存储到局部变量以便 TypeScript 类型推断

    const config = await db.getAdminConfig();
    if (!config) {
      return NextResponse.json({ error: '无法获取配置' }, { status: 500 });
    }

    // 解析请求体获取密码
    const { password } = await req.json();
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '请提供加密密码' }, { status: 400 });
    }

    // 收集所有数据
    const exportData = {
      timestamp: new Date().toISOString(),
      serverVersion: CURRENT_VERSION,
      data: {
        // 管理员配置
        adminConfig: config,
        // 所有用户数据
        userData: {} as { [username: string]: any },
        // V2用户信息
        usersV2: [] as any[],
      },
    };

    // 获取所有V2用户
    const usersV2Result = await db.getUserListV2(
      0,
      1000000,
      process.env.USERNAME,
    );
    exportData.data.usersV2 = usersV2Result.users;
    console.log(`从getUserListV2获取到 ${usersV2Result.users.length} 个用户`);

    // 获取所有用户（getAllUsers返回的是V2用户）
    let allUsers = await db.getAllUsers();
    allUsers.push(process.env.USERNAME); // 添加站长
    // 添加V2用户列表中的用户
    usersV2Result.users.forEach((user) => {
      if (!allUsers.includes(user.username)) {
        allUsers.push(user.username);
      }
    });
    allUsers = Array.from(new Set(allUsers));
    console.log(`准备导出 ${allUsers.length} 个V2用户（包括站长）`);

    // 为每个用户收集数据（只导出V2用户）- 使用并行处理
    console.log(`开始并行导出 ${allUsers.length} 个用户的数据...`);
    updateProgress(
      username,
      'export',
      'collecting',
      0,
      allUsers.length,
      '开始收集用户数据...',
    );

    // 分块处理用户，每批处理数量可通过环境变量配置
    const CHUNK_SIZE = parseInt(
      process.env.DATA_MIGRATION_CHUNK_SIZE || '10',
      10,
    );
    let exportedCount = 0;

    for (let i = 0; i < allUsers.length; i += CHUNK_SIZE) {
      const chunk = allUsers.slice(i, i + CHUNK_SIZE);
      console.log(
        `处理第 ${Math.floor(i / CHUNK_SIZE) + 1} 批用户 (${chunk.length} 个)`,
      );

      // 并行处理当前批次的用户
      const userDataPromises = chunk.map(async (username) => {
        try {
          // 站长特殊处理：使用环境变量密码
          let finalPasswordV2 =
            username === process.env.USERNAME ? process.env.PASSWORD : null;

          // 如果不是站长，获取V2密码
          if (!finalPasswordV2) {
            finalPasswordV2 = await getUserPasswordV2(username);
          }

          // 跳过没有V2密码的用户
          if (!finalPasswordV2) {
            console.log(`跳过用户 ${username}：没有V2密码`);
            return null;
          }

          // 并行获取用户的所有数据
          const [
            playRecords,
            favorites,
            searchHistory,
            skipConfigs,
            musicPlayRecords,
            playlists,
          ] = await Promise.all([
            db.getAllPlayRecords(username),
            db.getAllFavorites(username),
            db.getSearchHistory(username),
            db.getAllSkipConfigs(username),
            db.getAllMusicPlayRecords(username),
            db.getUserMusicPlaylists(username),
          ]);

          // 并行获取所有歌单的歌曲
          const playlistsWithSongs = await Promise.all(
            playlists.map(async (playlist) => {
              const songs = await db.getPlaylistSongs(playlist.id);
              return { ...playlist, songs };
            }),
          );

          return {
            username,
            userData: {
              playRecords,
              favorites,
              searchHistory,
              skipConfigs,
              musicPlayRecords,
              musicPlaylists: playlistsWithSongs,
              passwordV2: finalPasswordV2,
            },
          };
        } catch (error) {
          console.error(`导出用户 ${username} 数据失败:`, error);
          return null;
        }
      });

      // 等待当前批次完成
      const results = await Promise.all(userDataPromises);

      // 将结果添加到导出数据中，并实时更新进度
      for (const result of results) {
        if (result) {
          exportData.data.userData[result.username] = result.userData;
          exportedCount++;
          // 每处理完一个用户就更新进度
          updateProgress(
            username,
            'export',
            'collecting',
            exportedCount,
            allUsers.length,
            `正在收集用户数据 (${exportedCount}/${allUsers.length})...`,
          );
        }
      }

      console.log(`已完成 ${exportedCount}/${allUsers.length} 个用户`);
    }

    console.log(`成功导出 ${exportedCount} 个用户的数据`);

    // 将数据转换为JSON字符串
    updateProgress(
      username,
      'export',
      'serializing',
      exportedCount,
      exportedCount,
      '正在序列化数据...',
    );
    const jsonData = JSON.stringify(exportData);

    // 先压缩数据
    updateProgress(
      username,
      'export',
      'compressing',
      exportedCount,
      exportedCount,
      '正在压缩数据...',
    );
    const compressedData = await gzipAsync(jsonData);

    // 使用提供的密码加密压缩后的数据
    updateProgress(
      username,
      'export',
      'encrypting',
      exportedCount,
      exportedCount,
      '正在加密数据...',
    );
    const encryptedData = SimpleCrypto.encrypt(
      compressedData.toString('base64'),
      password,
    );

    // 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `moontv-backup-${timestamp}.dat`;

    // 清除进度信息
    updateProgress(
      username,
      'export',
      'completed',
      exportedCount,
      exportedCount,
      '导出完成！',
    );
    setTimeout(() => clearProgress(username, 'export'), 3000);

    // 返回加密的数据作为文件下载
    return new NextResponse(encryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': encryptedData.length.toString(),
      },
    });
  } catch (error) {
    console.error('数据导出失败:', error);
    // 清除进度信息
    const authInfo = getAuthInfoFromCookie(req);
    if (authInfo?.username) {
      clearProgress(authInfo.username, 'export');
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导出失败' },
      { status: 500 },
    );
  }
}

// 辅助函数：获取V2用户的加密密码
async function getUserPasswordV2(username: string): Promise<string | null> {
  try {
    const storage = (db as any).storage;
    if (!storage) return null;

    // 检查存储类型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

    // PostgreSQL 存储：使用 getUserPasswordHash 方法
    if (storageType === 'postgres') {
      if (typeof storage.getUserPasswordHash === 'function') {
        return await storage.getUserPasswordHash(username);
      }
      return null;
    }

    // D1 存储：使用 getUserPasswordHash 方法
    if (storageType === 'd1') {
      if (typeof storage.getUserPasswordHash === 'function') {
        return await storage.getUserPasswordHash(username);
      }
      return null;
    }

    // Redis 存储：直接调用hGetAll获取完整用户信息（包括密码）
    const userInfoKey = `user:${username}:info`;

    if (typeof storage.withRetry === 'function' && storage.client?.hgetall) {
      const userInfo = await storage.withRetry(() =>
        storage.client.hgetall(userInfoKey),
      );
      if (userInfo && userInfo.password) {
        return userInfo.password;
      }
    }

    return null;
  } catch (error) {
    console.error(`获取用户 ${username} V2密码失败:`, error);
    return null;
  }
}
