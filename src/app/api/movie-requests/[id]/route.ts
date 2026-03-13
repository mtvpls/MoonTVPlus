import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';

export const runtime = 'nodejs';

// GET: 获取单个求片详情
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = getStorage();
    const movieRequest = await storage.getMovieRequest(params.id);

    if (!movieRequest) {
      return NextResponse.json({ error: '求片不存在' }, { status: 404 });
    }

    return NextResponse.json({ request: movieRequest });
  } catch (error) {
    console.error('获取求片详情失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

// PATCH: 更新求片状态（标记已上架）
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = getStorage();

    // 检查权限：只有管理员和站长可以操作
    if (storage.getUserInfoV2) {
      const userInfo = await storage.getUserInfoV2(authInfo.username);
      if (userInfo?.role !== 'admin' && userInfo?.role !== 'owner') {
        return NextResponse.json({ error: '无权限操作' }, { status: 403 });
      }
    } else {
      // 如果不支持 getUserInfoV2，只允许站长操作
      if (authInfo.username !== process.env.USERNAME) {
        return NextResponse.json({ error: '无权限操作' }, { status: 403 });
      }
    }

    const body = await request.json();
    const { status, fulfilledSource, fulfilledId } = body;

    const movieRequest = await storage.getMovieRequest(params.id);
    if (!movieRequest) {
      return NextResponse.json({ error: '求片不存在' }, { status: 404 });
    }

    // 更新状态
    const updates: any = {
      status,
      updatedAt: Date.now(),
    };

    if (status === 'fulfilled') {
      updates.fulfilledAt = Date.now();
      updates.fulfilledSource = fulfilledSource;
      updates.fulfilledId = fulfilledId;

      // 给所有求片用户发送通知
      for (const username of movieRequest.requestedBy) {
        await storage.addNotification(username, {
          id: `req_fulfilled_${params.id}_${Date.now()}`,
          type: 'request_fulfilled',
          title: '求片已上架',
          message: `您求的《${movieRequest.title}》已上架`,
          timestamp: Date.now(),
          read: false,
          metadata: {
            requestId: params.id,
            source: fulfilledSource,
            id: fulfilledId,
          },
        });
      }
    }

    await storage.updateMovieRequest(params.id, updates);

    return NextResponse.json({
      message: '更新成功',
      request: { ...movieRequest, ...updates },
    });
  } catch (error) {
    console.error('更新求片失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

// DELETE: 删除求片
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = getStorage();

    // 检查权限：只有管理员和站长可以删除
    if (storage.getUserInfoV2) {
      const userInfo = await storage.getUserInfoV2(authInfo.username);
      if (userInfo?.role !== 'admin' && userInfo?.role !== 'owner') {
        return NextResponse.json({ error: '无权限操作' }, { status: 403 });
      }
    } else {
      // 如果不支持 getUserInfoV2，只允许站长操作
      if (authInfo.username !== process.env.USERNAME) {
        return NextResponse.json({ error: '无权限操作' }, { status: 403 });
      }
    }

    const movieRequest = await storage.getMovieRequest(params.id);
    if (!movieRequest) {
      return NextResponse.json({ error: '求片不存在' }, { status: 404 });
    }

    // 删除求片
    await storage.deleteMovieRequest(params.id);

    // 从所有用户的求片列表中移除
    for (const username of movieRequest.requestedBy) {
      await storage.removeUserMovieRequest(username, params.id);
    }

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除求片失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
