/* eslint-disable @typescript-eslint/no-explicit-any,no-console,@typescript-eslint/no-non-null-assertion */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { sanitizeFeaturePermissions } from '@/lib/feature-permissions';

export const runtime = 'nodejs';

// 支持的操作类型
const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'changePassword',
  'deleteUser',
  'updateUserApis',
  'userGroup',
  'updateUserGroups',
  'batchUpdateUserGroups',
] as const;

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
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      targetUsername, // 目标用户名
      targetPassword, // 目标用户密码（仅在添加用户时需要）
      action,
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      action?: (typeof ACTIONS)[number];
    };

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // 用户组操作和批量操作不需要targetUsername
    if (!targetUsername && !['userGroup', 'batchUpdateUserGroups'].includes(action)) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    if (
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      action !== 'updateUserApis' &&
      action !== 'userGroup' &&
      action !== 'updateUserGroups' &&
      action !== 'batchUpdateUserGroups' &&
      username === targetUsername
    ) {
      return NextResponse.json(
        { error: '无法对自己进行此操作' },
        { status: 400 }
      );
    }

    // 获取配置与存储
    const adminConfig = await getConfig();

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      // 优先从新版本获取用户信息
      const operatorInfo = await db.getUserInfoV2(username);
      if (operatorInfo) {
        if (operatorInfo.role !== 'admin' || operatorInfo.banned) {
          return NextResponse.json({ error: '权限不足' }, { status: 401 });
        }
        operatorRole = 'admin';
      } else {
        // 回退到配置中查找
        const userEntry = adminConfig.UserConfig.Users.find(
          (u) => u.username === username
        );
        if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
          return NextResponse.json({ error: '权限不足' }, { status: 401 });
        }
        operatorRole = 'admin';
      }
    }

    // 查找目标用户条目（用户组操作和批量操作不需要）
    let targetEntry: any = null;
    let isTargetAdmin = false;
    let targetUserV2: any = null;

    if (!['userGroup', 'batchUpdateUserGroups'].includes(action) && targetUsername) {
      // 先从配置中查找
      targetEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === targetUsername
      );

      // 如果配置中没有，从新版本存储中查找
      if (!targetEntry) {
        targetUserV2 = await db.getUserInfoV2(targetUsername);
        if (targetUserV2) {
          // 构造一个兼容的targetEntry对象
          targetEntry = {
            username: targetUsername,
            role: targetUserV2.role,
            banned: targetUserV2.banned,
            tags: targetUserV2.tags,
          };
        }
      }

      if (
        targetEntry &&
        targetEntry.role === 'owner' &&
        !['changePassword', 'updateUserApis', 'updateUserGroups'].includes(action)
      ) {
        return NextResponse.json({ error: '无法操作站长' }, { status: 400 });
      }

      // 权限校验逻辑
      isTargetAdmin = targetEntry?.role === 'admin';
    }

    switch (action) {
      case 'add': {
        if (targetEntry) {
          return NextResponse.json({ error: '用户已存在' }, { status: 400 });
        }
        // 检查新版本中是否已存在
        const existsV2 = await db.checkUserExistV2(targetUsername!);
        if (existsV2) {
          return NextResponse.json({ error: '用户已存在' }, { status: 400 });
        }
        if (!targetPassword) {
          return NextResponse.json(
            { error: '缺少目标用户密码' },
            { status: 400 }
          );
        }

        // 获取用户组信息
        const { userGroup } = body as { userGroup?: string };
        const tags = userGroup && userGroup.trim() ? [userGroup] : undefined;

        // 使用新版本创建用户
        await db.createUserV2(targetUsername!, targetPassword, 'user', tags);

        // 不再更新配置，因为用户已经存储在新版本中
        // 构造一个虚拟的targetEntry用于后续逻辑
        targetEntry = {
          username: targetUsername!,
          role: 'user',
          tags,
        };
        break;
      }
      case 'ban': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 }
          );
        }
        if (isTargetAdmin) {
          // 目标是管理员
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可封禁管理员' },
              { status: 401 }
            );
          }
        }

        // 只更新V2存储
        await db.updateUserInfoV2(targetUsername!, { banned: true });
        break;
      }
      case 'unban': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 }
          );
        }
        if (isTargetAdmin) {
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可操作管理员' },
              { status: 401 }
            );
          }
        }

        // 只更新V2存储
        await db.updateUserInfoV2(targetUsername!, { banned: false });
        break;
      }
      case 'setAdmin': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 }
          );
        }
        if (targetEntry.role === 'admin') {
          return NextResponse.json(
            { error: '该用户已是管理员' },
            { status: 400 }
          );
        }
        if (operatorRole !== 'owner') {
          return NextResponse.json(
            { error: '仅站长可设置管理员' },
            { status: 401 }
          );
        }

        // 只更新V2存储
        await db.updateUserInfoV2(targetUsername!, { role: 'admin' });
        break;
      }
      case 'cancelAdmin': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 }
          );
        }
        if (targetEntry.role !== 'admin') {
          return NextResponse.json(
            { error: '目标用户不是管理员' },
            { status: 400 }
          );
        }
        if (operatorRole !== 'owner') {
          return NextResponse.json(
            { error: '仅站长可取消管理员' },
            { status: 401 }
          );
        }

        // 只更新V2存储
        await db.updateUserInfoV2(targetUsername!, { role: 'user' });
        break;
      }
      case 'changePassword': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 }
          );
        }
        if (!targetPassword) {
          return NextResponse.json({ error: '缺少新密码' }, { status: 400 });
        }

        // 权限检查：不允许修改站长密码
        if (targetEntry.role === 'owner') {
          return NextResponse.json(
            { error: '无法修改站长密码' },
            { status: 401 }
          );
        }

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json(
            { error: '仅站长可修改其他管理员密码' },
            { status: 401 }
          );
        }

        // 使用新版本修改密码（SHA256加密）
        await db.changePasswordV2(targetUsername!, targetPassword);
        break;
      }
      case 'deleteUser': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 }
          );
        }

        // 权限检查：站长可删除所有用户（除了自己），管理员可删除普通用户
        if (username === targetUsername) {
          return NextResponse.json(
            { error: '不能删除自己' },
            { status: 400 }
          );
        }

        if (isTargetAdmin && operatorRole !== 'owner') {
          return NextResponse.json(
            { error: '仅站长可删除管理员' },
            { status: 401 }
          );
        }

        // 只删除V2存储中的用户
        await db.deleteUserV2(targetUsername!);

        break;
      }
      case 'updateUserApis': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 }
          );
        }

        const { enabledApis } = body as { enabledApis?: string[] };

        // 权限检查：站长可配置所有人的采集源，管理员可配置普通用户和自己的采集源
        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json(
            { error: '仅站长可配置其他管理员的采集源' },
            { status: 401 }
          );
        }

        // 更新V2存储中的采集源权限
        await db.updateUserInfoV2(targetUsername!, {
          enabledApis: enabledApis && enabledApis.length > 0 ? enabledApis : []
        });

        break;
      }
      case 'userGroup': {
        // 用户组管理操作
        const { groupAction, groupName, enabledApis, permissions } = body as {
          groupAction: 'add' | 'edit' | 'delete';
          groupName: string;
          enabledApis?: string[];
          permissions?: string[];
        };
        const normalizedPermissions = sanitizeFeaturePermissions(permissions);

        if (!adminConfig.UserConfig.Tags) {
          adminConfig.UserConfig.Tags = [];
        }

        switch (groupAction) {
          case 'add': {
            // 检查用户组是否已存在
            if (adminConfig.UserConfig.Tags.find(t => t.name === groupName)) {
              return NextResponse.json({ error: '用户组已存在' }, { status: 400 });
            }
            adminConfig.UserConfig.Tags.push({
              name: groupName,
              enabledApis: enabledApis || [],
              permissions: normalizedPermissions,
            });
            break;
          }
          case 'edit': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(t => t.name === groupName);
            if (groupIndex === -1) {
              return NextResponse.json({ error: '用户组不存在' }, { status: 404 });
            }
            adminConfig.UserConfig.Tags[groupIndex].enabledApis = enabledApis || [];
            adminConfig.UserConfig.Tags[groupIndex].permissions = normalizedPermissions;
            break;
          }
          case 'delete': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(t => t.name === groupName);
            if (groupIndex === -1) {
              return NextResponse.json({ error: '用户组不存在' }, { status: 404 });
            }

            // 查找使用该用户组的所有用户（从V2存储中查找）
            const affectedUsers = await db.getUsersByTag(groupName);

            // 从用户的tags中移除该用户组
            for (const username of affectedUsers) {
              const userInfo = await db.getUserInfoV2(username);
              if (userInfo && userInfo.tags) {
                const newTags = userInfo.tags.filter(tag => tag !== groupName);
                await db.updateUserInfoV2(username, { tags: newTags });
              }
            }

            // 删除用户组
            adminConfig.UserConfig.Tags.splice(groupIndex, 1);

            // 记录删除操作的影响
            console.log(`删除用户组 "${groupName}"，影响用户: ${affectedUsers.length > 0 ? affectedUsers.join(', ') : '无'}`);

            break;
          }
          default:
            return NextResponse.json({ error: '未知的用户组操作' }, { status: 400 });
        }
        break;
      }
      case 'updateUserGroups': {
        if (!targetEntry) {
          return NextResponse.json({ error: '目标用户不存在' }, { status: 404 });
        }

        const { userGroups } = body as { userGroups: string[] };

        // 权限检查：站长可配置所有人的用户组，管理员可配置普通用户和自己的用户组
        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json({ error: '仅站长可配置其他管理员的用户组' }, { status: 400 });
        }

        // 更新用户的用户组
        if (userGroups && userGroups.length > 0) {
          // 只更新V2存储
          await db.updateUserInfoV2(targetUsername!, { tags: userGroups });
        } else {
          // 如果为空数组或未提供，则删除该字段，表示无用户组
          await db.updateUserInfoV2(targetUsername!, { tags: [] });
        }

        break;
      }
      case 'batchUpdateUserGroups': {
        const { usernames, userGroups } = body as { usernames: string[]; userGroups: string[] };

        if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
          return NextResponse.json({ error: '缺少用户名列表' }, { status: 400 });
        }

        // 权限检查：站长可批量配置所有人的用户组，管理员只能批量配置普通用户
        if (operatorRole !== 'owner') {
          for (const targetUsername of usernames) {
            // 从V2存储中查找用户
            const userV2 = await db.getUserInfoV2(targetUsername);
            if (userV2 && userV2.role === 'admin' && targetUsername !== username) {
              return NextResponse.json({ error: `管理员无法操作其他管理员 ${targetUsername}` }, { status: 400 });
            }
          }
        }

        // 批量更新用户组
        for (const targetUsername of usernames) {
          // 只更新V2存储
          if (userGroups && userGroups.length > 0) {
            await db.updateUserInfoV2(targetUsername, { tags: userGroups });
          } else {
            await db.updateUserInfoV2(targetUsername, { tags: [] });
          }
        }

        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 将更新后的配置写入数据库
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理员配置不缓存
        },
      }
    );
  } catch (error) {
    console.error('用户管理操作失败:', error);
    return NextResponse.json(
      {
        error: '用户管理操作失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
