/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { ApiSite, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { parseTvboxSubscription } from '@/lib/tvbox-parser';

export const runtime = 'nodejs';

// 支持的操作类型
type Action = 'add' | 'delete' | 'refresh' | 'enable' | 'disable';

interface BaseBody {
  action?: Action;
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as BaseBody & Record<string, any>;
    const { action } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 基础校验
    const ACTIONS: Action[] = ['add', 'delete', 'refresh', 'enable', 'disable'];
    if (!username || !action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // 获取配置与存储
    const adminConfig = await getConfig();

    // 权限与身份校验
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 确保 TvboxSubscriptions 数组存在
    if (!adminConfig.TvboxSubscriptions) {
      adminConfig.TvboxSubscriptions = [];
    }

    switch (action) {
      case 'add': {
        const { name, url } = body as {
          name?: string;
          url?: string;
        };
        if (!name || !url) {
          return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
        }

        // 验证URL格式
        try {
          new URL(url);
        } catch {
          return NextResponse.json({ error: '无效的URL' }, { status: 400 });
        }

        // 检查是否已存在相同URL的订阅
        if (adminConfig.TvboxSubscriptions.some((s) => s.url === url)) {
          return NextResponse.json({ error: '该订阅已存在' }, { status: 400 });
        }

        // 尝试获取订阅内容
        let apis: ApiSite[];
        let errorMsg = '';
        try {
          apis = await parseTvboxSubscription(url);
        } catch (error: any) {
          errorMsg = error.message || '获取订阅失败';
          apis = [];
        }

        // 生成唯一ID
        const id = `tvbox_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // 添加订阅
        adminConfig.TvboxSubscriptions.push({
          id,
          name,
          url,
          enabled: true,
          lastUpdate: new Date().toISOString(),
          lastError: errorMsg || undefined,
          autoUpdate: true,
        });

        // 如果成功获取到源，添加到 SourceConfig
        if (apis.length > 0) {
          for (const api of apis) {
            // 检查是否已存在相同key的源
            const existingSource = adminConfig.SourceConfig.find(
              (s) => s.key === api.key
            );
            if (!existingSource) {
              adminConfig.SourceConfig.push({
                key: api.key,
                name: api.name,
                api: api.api,
                detail: api.detail,
                from: 'tvbox-subscription',
                disabled: false,
                subscriptionId: id,
                sourceType: api.sourceType || 'applecms', // 保存源类型
                ext: api.ext, // 保存扩展配置（如夸克分享链接）
              });
            }
          }
        }

        break;
      }
      case 'delete': {
        const { id } = body as { id?: string };
        if (!id)
          return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

        const idx = adminConfig.TvboxSubscriptions.findIndex((s) => s.id === id);
        if (idx === -1)
          return NextResponse.json({ error: '订阅不存在' }, { status: 404 });

        // 删除订阅
        adminConfig.TvboxSubscriptions.splice(idx, 1);

        // 删除来自该订阅的所有源
        adminConfig.SourceConfig = adminConfig.SourceConfig.filter(
          (s) => s.subscriptionId !== id
        );

        break;
      }
      case 'refresh': {
        const { id } = body as { id?: string };
        if (!id)
          return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

        const subscription = adminConfig.TvboxSubscriptions.find((s) => s.id === id);
        if (!subscription)
          return NextResponse.json({ error: '订阅不存在' }, { status: 404 });

        // 尝试获取订阅内容
        let apis: ApiSite[];
        let errorMsg = '';
        try {
          apis = await parseTvboxSubscription(subscription.url);
        } catch (error: any) {
          errorMsg = error.message || '获取订阅失败';
          apis = [];
        }

        // 更新订阅状态
        subscription.lastUpdate = new Date().toISOString();
        subscription.lastError = errorMsg || undefined;

        // 删除旧的来自该订阅的源
        adminConfig.SourceConfig = adminConfig.SourceConfig.filter(
          (s) => s.subscriptionId !== id
        );

        // 添加新的源
        if (apis.length > 0) {
          for (const api of apis) {
            // 检查是否已存在相同key的源（来自其他订阅或手动添加）
            const existingSource = adminConfig.SourceConfig.find(
              (s) => s.key === api.key
            );
            if (!existingSource) {
              adminConfig.SourceConfig.push({
                key: api.key,
                name: api.name,
                api: api.api,
                detail: api.detail,
                from: 'tvbox-subscription',
                disabled: false,
                subscriptionId: id,
                sourceType: api.sourceType || 'applecms', // 保存源类型
                ext: api.ext, // 保存扩展配置
              });
            }
          }
        }

        break;
      }
      case 'enable': {
        const { id } = body as { id?: string };
        if (!id)
          return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

        const subscription = adminConfig.TvboxSubscriptions.find((s) => s.id === id);
        if (!subscription)
          return NextResponse.json({ error: '订阅不存在' }, { status: 404 });

        subscription.enabled = true;

        // 启用来自该订阅的所有源
        adminConfig.SourceConfig.forEach((s) => {
          if (s.subscriptionId === id) {
            s.disabled = false;
          }
        });

        break;
      }
      case 'disable': {
        const { id } = body as { id?: string };
        if (!id)
          return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

        const subscription = adminConfig.TvboxSubscriptions.find((s) => s.id === id);
        if (!subscription)
          return NextResponse.json({ error: '订阅不存在' }, { status: 404 });

        subscription.enabled = false;

        // 禁用来自该订阅的所有源
        adminConfig.SourceConfig.forEach((s) => {
          if (s.subscriptionId === id) {
            s.disabled = true;
          }
        });

        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 持久化到存储
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('TVBOX订阅管理操作失败:', error);
    return NextResponse.json(
      {
        error: 'TVBOX订阅管理操作失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
