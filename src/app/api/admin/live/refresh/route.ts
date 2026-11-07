/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { refreshLiveChannels } from '@/lib/live';
import { syncTVBoxLiveSources } from '@/lib/tvbox-live.server';

export const runtime = 'nodejs';
export const maxDuration = 240;

export async function POST(request: NextRequest) {
  try {
    // 权限检查 - 使用v2用户系统
    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username || '');
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    let tvboxSyncError = false;
    try {
      await syncTVBoxLiveSources(true);
    } catch (error) {
      tvboxSyncError = true;
      console.warn('同步 TVBox 直播源失败:', error);
    }
    // 并发刷新所有启用的直播源
    const refreshPromises = (config.LiveConfig || [])
      .filter(
        (liveInfo) =>
          !liveInfo.disabled &&
          (!liveInfo.tvbox || config.TVBoxBridgeConfig?.Enabled)
      )
      .map(async (liveInfo) => {
        try {
          const nums = await refreshLiveChannels(liveInfo);
          liveInfo.channelNumber = nums;
        } catch (error) {
          liveInfo.channelNumber = 0;
        }
      });

    // 等待所有刷新任务完成
    await Promise.all(refreshPromises);

    // 保存配置
    await db.saveAdminConfig(config);

    return NextResponse.json({
      success: true,
      message: tvboxSyncError
        ? '直播源已刷新，TVBox 源同步失败，请检查桥接服务'
        : '直播源刷新成功',
    });
  } catch (error) {
    console.error('直播源刷新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 500 }
    );
  }
}
