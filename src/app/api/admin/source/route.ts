/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 支持的操作类型
type Action =
  | 'add'
  | 'disable'
  | 'enable'
  | 'delete'
  | 'sort'
  | 'batch_disable'
  | 'batch_enable'
  | 'batch_delete'
  | 'toggle_proxy_mode'
  | 'update_weight'
  | 'batch_update_weights';

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
    const ACTIONS: Action[] = [
      'add',
      'disable',
      'enable',
      'delete',
      'sort',
      'batch_disable',
      'batch_enable',
      'batch_delete',
      'toggle_proxy_mode',
      'update_weight',
      'batch_update_weights',
    ];
    if (!username || !action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // 获取配置与存储
    const adminConfig = await getConfig();

    // 权限与身份校验
    if (username !== process.env.USERNAME) {
      // 从V2存储中获取用户信息
      const userInfoV2 = await db.getUserInfoV2(username);
      if (!userInfoV2 || userInfoV2.role !== 'admin' || userInfoV2.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    switch (action) {
      case 'add': {
        const { key, name, api, detail } = body as {
          key?: string;
          name?: string;
          api?: string;
          detail?: string;
        };
        if (!key || !name || !api) {
          return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
        }
        // 禁止添加保留关键字
        if (key === 'openlist' || key === 'xiaoya') {
          return NextResponse.json(
            { error: `${key} 是保留关键字，不能作为视频源 key` },
            { status: 400 }
          );
        }
        if (key.startsWith('emby')) {
          return NextResponse.json(
            { error: 'emby 开头的 key 是保留关键字，不能作为视频源 key' },
            { status: 400 }
          );
        }
        if (adminConfig.SourceConfig.some((s) => s.key === key)) {
          return NextResponse.json({ error: '该源已存在' }, { status: 400 });
        }
        adminConfig.SourceConfig.push({
          key,
          name,
          api,
          detail,
          from: 'custom',
          disabled: false,
        });
        break;
      }
      case 'disable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.disabled = true;
        break;
      }
      case 'enable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.disabled = false;
        break;
      }
      case 'delete': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        const idx = adminConfig.SourceConfig.findIndex((s) => s.key === key);
        if (idx === -1)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        const entry = adminConfig.SourceConfig[idx];
        if (entry.from === 'config') {
          return NextResponse.json({ error: '该源不可删除' }, { status: 400 });
        }
        adminConfig.SourceConfig.splice(idx, 1);

        // 检查并清理用户组和用户的权限数组
        // 清理用户组权限
        if (adminConfig.UserConfig.Tags) {
          adminConfig.UserConfig.Tags.forEach((tag) => {
            if (tag.enabledApis) {
              tag.enabledApis = tag.enabledApis.filter((api) => api !== key);
            }
          });
        }

        // 清理用户权限
        adminConfig.UserConfig.Users.forEach((user) => {
          if (user.enabledApis) {
            user.enabledApis = user.enabledApis.filter((api) => api !== key);
          }
        });
        break;
      }
      case 'batch_disable': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 参数或为空' },
            { status: 400 }
          );
        }
        keys.forEach((key) => {
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (entry) {
            entry.disabled = true;
          }
        });
        break;
      }
      case 'batch_enable': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 参数或为空' },
            { status: 400 }
          );
        }
        keys.forEach((key) => {
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (entry) {
            entry.disabled = false;
          }
        });
        break;
      }
      case 'batch_delete': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 参数或为空' },
            { status: 400 }
          );
        }
        // 过滤掉 from=config 的源，记录跳过的数量
        const keysToDelete: string[] = [];
        const skippedKeys: string[] = [];

        keys.forEach((key) => {
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (entry && entry.from === 'config') {
            skippedKeys.push(key);
          } else if (entry) {
            keysToDelete.push(key);
          }
        });

        // 批量删除
        keysToDelete.forEach((key) => {
          const idx = adminConfig.SourceConfig.findIndex((s) => s.key === key);
          if (idx !== -1) {
            adminConfig.SourceConfig.splice(idx, 1);
          }
        });

        // 检查并清理用户组和用户的权限数组
        if (keysToDelete.length > 0) {
          // 清理用户组权限
          if (adminConfig.UserConfig.Tags) {
            adminConfig.UserConfig.Tags.forEach((tag) => {
              if (tag.enabledApis) {
                tag.enabledApis = tag.enabledApis.filter(
                  (api) => !keysToDelete.includes(api)
                );
              }
            });
          }

          // 清理用户权限
          adminConfig.UserConfig.Users.forEach((user) => {
            if (user.enabledApis) {
              user.enabledApis = user.enabledApis.filter(
                (api) => !keysToDelete.includes(api)
              );
            }
          });
        }

        // 保存批量删除的统计信息，稍后返回
        (body as any)._batchDeleteResult = {
          deleted: keysToDelete.length,
          skipped: skippedKeys.length,
        };
        break;
      }
      case 'sort': {
        const { order } = body as { order?: string[] };
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序列表格式错误' },
            { status: 400 }
          );
        }
        const map = new Map(adminConfig.SourceConfig.map((s) => [s.key, s]));
        const newList: typeof adminConfig.SourceConfig = [];
        order.forEach((k) => {
          const item = map.get(k);
          if (item) {
            newList.push(item);
            map.delete(k);
          }
        });
        // 未在 order 中的保持原顺序
        adminConfig.SourceConfig.forEach((item) => {
          if (map.has(item.key)) newList.push(item);
        });
        adminConfig.SourceConfig = newList;
        break;
      }
      case 'toggle_proxy_mode': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.proxyMode = !entry.proxyMode;
        break;
      }
      case 'batch_update_weights': {
        const { weights, order } = body as {
          weights?: Array<{ key?: string; weight?: number }>;
          order?: string[];
        };
        if (!Array.isArray(weights) || weights.length === 0) {
          return NextResponse.json(
            { error: '缺少 weights 参数或为空' },
            { status: 400 }
          );
        }

        for (const item of weights) {
          if (!item?.key) {
            return NextResponse.json(
              { error: 'weights 中存在无效 key' },
              { status: 400 }
            );
          }
          if (
            typeof item.weight !== 'number' ||
            item.weight < 0 ||
            item.weight > 100
          ) {
            return NextResponse.json(
              { error: '权重必须是 0-100 之间的数字' },
              { status: 400 }
            );
          }
          const entry = adminConfig.SourceConfig.find(
            (source) => source.key === item.key
          );
          if (!entry) {
            return NextResponse.json(
              { error: `源不存在: ${item.key}` },
              { status: 404 }
            );
          }
          entry.weight = item.weight;
        }

        if (Array.isArray(order)) {
          const map = new Map(
            adminConfig.SourceConfig.map((source) => [source.key, source])
          );
          const newList: typeof adminConfig.SourceConfig = [];
          order.forEach((key) => {
            const item = map.get(key);
            if (item) {
              newList.push(item);
              map.delete(key);
            }
          });
          adminConfig.SourceConfig.forEach((item) => {
            if (map.has(item.key)) newList.push(item);
          });
          adminConfig.SourceConfig = newList;
        }
        break;
      }
      case 'update_weight': {
        const { key, weight } = body as { key?: string; weight?: number };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        if (weight === undefined || weight === null)
          return NextResponse.json(
            { error: '缺少 weight 参数' },
            { status: 400 }
          );
        if (typeof weight !== 'number' || weight < 0 || weight > 100)
          return NextResponse.json(
            { error: '权重必须是 0-100 之间的数字' },
            { status: 400 }
          );
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.weight = weight;
        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 持久化到存储
    await db.saveAdminConfig(adminConfig);

    // 清除短剧视频源缓存（因为视频源发生了变动）
    try {
      await db.deleteGlobalValue('duanju');
      console.log('已清除短剧视频源缓存');
    } catch (error) {
      console.error('清除短剧视频源缓存失败:', error);
      // 不影响主流程，继续执行
    }

    // 构建响应数据
    const responseData: Record<string, any> = { ok: true };

    // 如果是批量删除操作，包含统计信息
    if (action === 'batch_delete' && (body as any)._batchDeleteResult) {
      responseData.deleted = (body as any)._batchDeleteResult.deleted;
      responseData.skipped = (body as any)._batchDeleteResult.skipped;
    }

    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('视频源管理操作失败:', error);
    return NextResponse.json(
      {
        error: '视频源管理操作失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
