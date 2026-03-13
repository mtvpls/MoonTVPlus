import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from './auth';

/**
 * 获取用于代理的 token
 * 优先级：全局 token > 用户 token（从 cookie 获取）> null
 */
export async function getProxyToken(
  request?: NextRequest,
): Promise<string | null> {
  // 1. 尝试获取全局 token
  const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
  if (globalToken) {
    return globalToken;
  }

  // 2. 如果提供了 request，尝试从用户登录信息获取用户的 tvbox token
  if (request) {
    const authInfo = getAuthInfoFromCookie(request);
    if (authInfo && authInfo.username) {
      try {
        const { db } = await import('./db');
        // 通过用户名获取用户的 tvbox token
        const userToken = await db.getTvboxSubscribeToken(authInfo.username);
        if (userToken) {
          return userToken;
        }
      } catch (error) {
        // 忽略错误，继续
      }
    }
  }

  // 3. 没有可用的 token
  return null;
}
