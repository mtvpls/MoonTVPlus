'use client';

import { useEffect } from 'react';

import { clearAuthCookie, getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { TOKEN_CONFIG } from '@/lib/refresh-token';

/**
 * Token 自动刷新管理器
 *
 * 功能：
 * 1. 拦截所有 fetch 请求
 * 2. 检测到 401 错误时自动刷新 Token 并重试
 * 3. 在请求前检查 Token 是否即将过期，主动刷新
 *
 * 策略：
 * - 响应拦截：401 错误 → 刷新 Token → 重试请求
 * - 请求拦截：剩余时间 < 10 分钟 → 主动刷新
 */
export function TokenRefreshManager() {
  useEffect(() => {
    // localStorage 模式不需要刷新
    const storageType =
      (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return;
    }

    // 刷新状态管理
    let isRefreshing = false;
    let refreshPromise: Promise<boolean> | null = null;

    // Token 刷新函数
    const refreshToken = async (): Promise<boolean> => {
      // 如果正在刷新，返回现有的 Promise
      if (isRefreshing && refreshPromise) {
        return refreshPromise;
      }

      isRefreshing = true;
      refreshPromise = (async () => {
        try {
          // 使用原始 fetch 避免递归
          const response = await window.fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });

          if (response.ok) {
            console.log('[Token] Refreshed successfully');
            return true;
          } else {
            console.error('[Token] Refresh failed:', response.status);

            // 刷新失败，先登出再跳转登录
            if (response.status === 401 || response.status === 403) {
              // 如果在登录页面，跳过登出和跳转逻辑
              if (window.location.pathname === '/login') {
                console.log(
                  '[Token] On login page, skipping logout and redirect',
                );
                return false;
              }

              try {
                await window.fetch('/api/logout', {
                  method: 'POST',
                  credentials: 'include',
                });
              } catch (error) {
                console.error('[Token] Logout error:', error);
                // 登出失败时清除前端cookie
                clearAuthCookie();
              }
              window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            }
            return false;
          }
        } catch (error) {
          console.error('[Token] Refresh error:', error);
          return false;
        } finally {
          isRefreshing = false;
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    };

    // 检查 Token 是否需要刷新
    const shouldRefreshToken = (): boolean => {
      const authInfo = getAuthInfoFromBrowserCookie();
      if (!authInfo || !authInfo.timestamp || !authInfo.refreshExpires) {
        return false;
      }

      const now = Date.now();

      // Refresh Token 已过期
      if (now >= authInfo.refreshExpires) {
        console.log('[Token] Refresh token expired, redirecting to login');
        // 先登出再跳转登录
        window
          .fetch('/api/logout', {
            method: 'POST',
            credentials: 'include',
          })
          .catch((error) => {
            console.error('[Token] Logout error:', error);
            // 登出失败时清除前端cookie
            clearAuthCookie();
          })
          .finally(() => {
            window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          });
        return false;
      }

      // 计算 Access Token 剩余时间
      const ACCESS_TOKEN_AGE = TOKEN_CONFIG.ACCESS_TOKEN_AGE;
      const age = now - authInfo.timestamp;
      const remaining = ACCESS_TOKEN_AGE - age;

      // 剩余时间 < 刷新阈值时需要刷新（包括已过期的情况）
      const REFRESH_THRESHOLD = TOKEN_CONFIG.RENEWAL_THRESHOLD;
      return remaining < REFRESH_THRESHOLD;
    };

    // 保存原始 fetch
    const originalFetch = window.fetch;

    // 拦截 fetch
    window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      // 跳过不需要 Token 刷新的 API
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      // 跳过：刷新 API、登录、登出、注册等认证相关接口
      if (
        url.includes('/api/auth/refresh') ||
        url.includes('/api/login') ||
        url.includes('/api/logout') ||
        url.includes('/api/register') ||
        url.includes('/api/auth/oidc')
      ) {
        return originalFetch(input, init);
      }

      // 请求前检查：Token 即将过期时主动刷新
      if (shouldRefreshToken()) {
        console.log('[Token] Expiring soon, refreshing proactively...');
        await refreshToken();
      }

      // 发送请求
      let response = await originalFetch(input, init);

      // 响应拦截：401 错误时刷新 Token 并重试（仅重试一次）
      if (response.status === 401) {
        // 如果在登录页面，跳过刷新逻辑
        if (window.location.pathname === '/login') {
          console.log('[Token] On login page, skipping refresh logic');
          return response;
        }

        // 克隆响应以便读取响应体
        const clonedResponse = response.clone();

        try {
          const responseText = await clonedResponse.text();

          // 只有当响应体包含 "Unauthorized" 或 "Refresh token expired" 或 "Access token expired" 时才刷新
          if (
            responseText.includes('Unauthorized') ||
            responseText.includes('Refresh token expired') ||
            responseText.includes('Access token expired')
          ) {
            console.log(
              '[Token] Received 401 with auth error, attempting refresh and retry...',
            );

            const refreshed = await refreshToken();

            if (refreshed) {
              // 刷新成功，重试原请求（仅此一次）
              response = await originalFetch(input, init);

              // 如果重试后仍然是 401，说明有问题，先登出再跳转登录
              if (response.status === 401) {
                console.error(
                  '[Token] Still 401 after refresh, redirecting to login',
                );

                // 如果在登录页面，跳过登出和跳转逻辑
                if (window.location.pathname === '/login') {
                  console.log(
                    '[Token] On login page, skipping logout and redirect',
                  );
                  return response;
                }

                try {
                  await originalFetch('/api/logout', {
                    method: 'POST',
                    credentials: 'include',
                  });
                } catch (error) {
                  console.error('[Token] Logout error:', error);
                  // 登出失败时清除前端cookie
                  clearAuthCookie();
                }
                window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
              }
            }
          } else {
            console.log(
              '[Token] Received 401 but not an auth error, skipping refresh',
            );
          }
        } catch (error) {
          console.error('[Token] Failed to read response body:', error);
        }
      }

      return response;
    };

    // 清理：恢复原始 fetch
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // 这是一个纯逻辑组件，不渲染任何内容
  return null;
}
