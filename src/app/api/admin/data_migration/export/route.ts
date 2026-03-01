/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { SimpleCrypto } from '@/lib/crypto';
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
        { status: 400 }
      );
    }

    // 验证身份和权限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 检查用户权限（只有站长可以导出数据）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '权限不足，只有站长可以导出数据' }, { status: 401 });
    }

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
        usersV2: [] as any[]
      }
    };

    // 获取所有V2用户
    const usersV2Result = await db.getUserListV2(0, 1000000, process.env.USERNAME);
    exportData.data.usersV2 = usersV2Result.users;
    console.log(`从getUserListV2获取到 ${usersV2Result.users.length} 个用户`);

    // 获取所有用户（getAllUsers返回的是V2用户）
    let allUsers = await db.getAllUsers();
    allUsers.push(process.env.USERNAME); // 添加站长
    // 添加V2用户列表中的用户
    usersV2Result.users.forEach(user => {
      if (!allUsers.includes(user.username)) {
        allUsers.push(user.username);
      }
    });
    allUsers = Array.from(new Set(allUsers));
    console.log(`准备导出 ${allUsers.length} 个V2用户（包括站长）`);

    // 为每个用户收集数据（只导出V2用户）
    let exportedCount = 0;
    for (const username of allUsers) {
      // 站长特殊处理：使用环境变量密码
      let finalPasswordV2 = username === process.env.USERNAME ? process.env.PASSWORD : null;

      // 如果不是站长，获取V2密码
      if (!finalPasswordV2) {
        finalPasswordV2 = await getUserPasswordV2(username);
      }

      // 跳过没有V2密码的用户
      if (!finalPasswordV2) {
        console.log(`跳过用户 ${username}：没有V2密码`);
        continue;
      }

      // 获取用户的所有歌单
      const playlists = await db.getUserMusicPlaylists(username);
      const playlistsWithSongs = [];
      for (const playlist of playlists) {
        const songs = await db.getPlaylistSongs(playlist.id);
        playlistsWithSongs.push({
          ...playlist,
          songs
        });
      }

      const userData = {
        // 播放记录
        playRecords: await db.getAllPlayRecords(username),
        // 收藏夹
        favorites: await db.getAllFavorites(username),
        // 搜索历史
        searchHistory: await db.getSearchHistory(username),
        // 跳过片头片尾配置
        skipConfigs: await db.getAllSkipConfigs(username),
        // 音乐播放记录
        musicPlayRecords: await db.getAllMusicPlayRecords(username),
        // 音乐歌单（包含歌曲）
        musicPlaylists: playlistsWithSongs,
        // V2用户的加密密码
        passwordV2: finalPasswordV2
      };

      exportData.data.userData[username] = userData;
      exportedCount++;
    }

    console.log(`成功导出 ${exportedCount} 个用户的数据`);

    // 将数据转换为JSON字符串
    const jsonData = JSON.stringify(exportData);

    // 先压缩数据
    const compressedData = await gzipAsync(jsonData);

    // 使用提供的密码加密压缩后的数据
    const encryptedData = SimpleCrypto.encrypt(compressedData.toString('base64'), password);

    // 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `moontv-backup-${timestamp}.dat`;

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导出失败' },
      { status: 500 }
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
      const userInfo = await storage.withRetry(() => storage.client.hgetall(userInfoKey));
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
