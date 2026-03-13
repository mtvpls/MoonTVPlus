/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getProgress } from '@/lib/data-migration-progress';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // 验证身份和权限
  const authInfo = getAuthInfoFromCookie(req);
  if (!authInfo || !authInfo.username) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (authInfo.username !== process.env.USERNAME) {
    return new Response('Forbidden', { status: 403 });
  }

  const username = authInfo.username; // 存储到局部变量以便 TypeScript 类型推断

  const { searchParams } = new URL(req.url);
  const operation = searchParams.get('operation'); // 'export' or 'import'

  if (!operation) {
    return new Response('Missing operation parameter', { status: 400 });
  }

  // 创建 SSE 响应
  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | null = null;
  let timeout: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const sendProgress = () => {
        try {
          const progress = getProgress(
            username,
            operation as 'export' | 'import',
          );
          if (progress) {
            const data = JSON.stringify(progress);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (error) {
          // 如果控制器已关闭，清理定时器
          if (interval) clearInterval(interval);
          if (timeout) clearTimeout(timeout);
        }
      };

      // 立即发送一次
      sendProgress();

      // 每秒发送一次进度更新
      interval = setInterval(sendProgress, 1000);

      // 30秒后自动关闭连接
      timeout = setTimeout(() => {
        if (interval) clearInterval(interval);
        try {
          controller.close();
        } catch (error) {
          // 控制器可能已经关闭
        }
      }, 30000);
    },
    cancel() {
      // 当客户端断开连接时清理
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
