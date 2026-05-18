import { NextRequest, NextResponse } from 'next/server';

import { cancelNetdiskCheckTask } from '@/lib/netdisk-check-task';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(
      request,
      'netdisk_search',
      '无权限使用网盘有效性检测'
    );
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const taskId = String(body?.taskId || '');
    if (!taskId) {
      return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    }
    const task = cancelNetdiskCheckTask(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取消检测任务失败' },
      { status: 500 }
    );
  }
}
