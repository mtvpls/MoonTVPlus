/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getStorage } from '@/lib/db';

/**
 * 访问统计 API
 * 
 * GET: 获取当日访问统计（PV/UV）
 * POST: 记录一次访问
 */

// 获取客户端唯一标识
function getVisitorId(request: NextRequest): string {
  // 优先使用 X-Forwarded-For（反向代理场景）
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  // 其次使用 X-Real-IP
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  // 最后使用连接 IP
  return 'unknown';
}

// 获取今日日期字符串 (YYYY-MM-DD)
function getTodayDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// GET: 获取访问统计
export async function GET() {
  try {
    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: 'Storage not available' }, { status: 500 });
    }

    const today = getTodayDate();
    const db = (storage as any).db;

    // 查询今日统计
    const result = await db.query(
      'SELECT pv, uv FROM visit_stats WHERE date = ?',
      [today]
    );

    if (result.results && result.results.length > 0) {
      return NextResponse.json({
        success: true,
        data: {
          date: today,
          pv: result.results[0].pv || 0,
          uv: result.results[0].uv || 0,
        },
      });
    }

    // 今日还没有数据
    return NextResponse.json({
      success: true,
      data: {
        date: today,
        pv: 0,
        uv: 0,
      },
    });
  } catch (error) {
    console.error('获取访问统计失败:', error);
    return NextResponse.json(
      { error: 'Failed to get visit stats' },
      { status: 500 }
    );
  }
}

// POST: 记录访问
export async function POST(request: NextRequest) {
  try {
    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: 'Storage not available' }, { status: 500 });
    }

    const today = getTodayDate();
    const visitorId = getVisitorId(request);
    const now = Date.now();
    const db = (storage as any).db;

    // 确保今日统计记录存在
    await db.query(
      `INSERT OR IGNORE INTO visit_stats (date, pv, uv, updated_at) VALUES (?, 0, 0, ?)`,
      [today, now]
    );

    // 检查该访客今日是否已访问
    const existingVisit = await db.query(
      'SELECT id FROM visit_records WHERE visitor_id = ? AND date = ?',
      [visitorId, today]
    );

    const isNewVisitor = !existingVisit.results || existingVisit.results.length === 0;

    // 记录访问
    if (isNewVisitor) {
      // 新访客：插入访问记录 + 增加 PV 和 UV
      await db.query(
        'INSERT OR IGNORE INTO visit_records (visitor_id, date, first_visit) VALUES (?, ?, ?)',
        [visitorId, today, now]
      );

      await db.query(
        'UPDATE visit_stats SET pv = pv + 1, uv = uv + 1, updated_at = ? WHERE date = ?',
        [now, today]
      );
    } else {
      // 老访客：只增加 PV
      await db.query(
        'UPDATE visit_stats SET pv = pv + 1, updated_at = ? WHERE date = ?',
        [now, today]
      );
    }

    // 返回最新统计
    const stats = await db.query(
      'SELECT pv, uv FROM visit_stats WHERE date = ?',
      [today]
    );

    return NextResponse.json({
      success: true,
      data: {
        date: today,
        pv: stats.results?.[0]?.pv || 0,
        uv: stats.results?.[0]?.uv || 0,
        isNewVisitor,
      },
    });
  } catch (error) {
    console.error('记录访问失败:', error);
    return NextResponse.json(
      { error: 'Failed to record visit' },
      { status: 500 }
    );
  }
}
