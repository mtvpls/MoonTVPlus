import { NextResponse } from 'next/server';

import { fetchBangumiFromServer } from '@/lib/bangumi.server';
import {
  buildSchedule,
  CalendarItem,
  currentSeason,
  fetchLiveChart,
  indexCards,
  parseLiveChart,
} from '@/lib/bangumi-schedule.server';
import { getConfig } from '@/lib/config';
import {
  getBangumiScheduleDatabaseCache,
  getBangumiScheduleMemoryCache,
  setBangumiScheduleDatabaseCache,
  setBangumiScheduleMemoryCache,
} from '@/lib/bangumi-schedule-cache.server';

export const dynamic = 'force-dynamic';

interface RawCalendarItem {
  id?: number;
  name?: string;
  name_cn?: string;
  weekday?: { id?: number };
  air_date?: string;
  rating?: { score?: number } | null;
  images?: {
    large?: string;
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
  } | null;
}

/** 响应中下发的条目形状（前端渲染用，rating 归一为字符串） */
interface ScheduleItem {
  id: string;
  name: string;
  name_cn: string;
  /** BGM 星期约定：0=周一 .. 6=周日。未知放送时间的条目也带星期 */
  weekday: number;
  time?: string;
  rating?: string;
  air_date?: string;
  images?: RawCalendarItem['images'];
}

function toCalendarItem(it: RawCalendarItem): CalendarItem {
  return {
    id: it.id ?? 0,
    name: it.name || '',
    name_cn: it.name_cn || '',
    weekday: it.weekday?.id ?? 0,
    air_date: it.air_date || '',
    rating: it.rating?.score ?? null,
    images: it.images ?? null,
  };
}

/** 把 BGM 日历（按星期分组）展平为条目列表，并带上所属星期 */
interface RawCalendarWeek {
  weekday?: { id?: number };
  items?: RawCalendarItem[];
}

function toFlatCalendarItems(calendar: RawCalendarWeek[]): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const wk of calendar) {
    const weekday = wk.weekday?.id ?? 0;
    for (const it of wk.items ?? []) {
      out.push(toCalendarItem({ ...it, weekday: { id: weekday } }));
    }
  }
  return out;
}

function toScheduleItem(it: CalendarItem): ScheduleItem {
  return {
    id: String(it.id),
    name: it.name,
    name_cn: it.name_cn,
    // 统一归一为 0=周一 .. 6=周日（与 tsToBeijing/days 数组下标一致）。
    // 未知条目的 weekday 来自 BGM 日历（1=周一..7=周日），需转换。
    weekday: it.weekday > 0 ? it.weekday - 1 : it.weekday,
    rating: it.rating != null && Number.isFinite(it.rating) ? it.rating.toFixed(1) : undefined,
    air_date: it.air_date || undefined,
    images: it.images ?? undefined,
  };
}

export async function GET() {
  try {
    const config = await getConfig();
    const { season, year } = currentSeason();

    const memoryCached = getBangumiScheduleMemoryCache<ScheduleResponse>(season, year);
    if (memoryCached) {
      return NextResponse.json(memoryCached, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    const databaseCached = await getBangumiScheduleDatabaseCache<ScheduleResponse>(
      season,
      year
    );
    if (databaseCached) {
      return NextResponse.json(databaseCached, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    const [calendarRes, html] = await Promise.all([
      fetchBangumiFromServer('/calendar', {
        baseUrl: config.SiteConfig.BangumiApiBaseUrl,
        proxy: config.SiteConfig.BangumiProxy,
      }),
      fetchLiveChart(season, year, config.SiteConfig.LiveChartProxy),
    ]);

    if (!calendarRes.ok) {
      return NextResponse.json(
        { error: `Bangumi calendar 请求失败: ${calendarRes.status}` },
        { status: calendarRes.status || 502 }
      );
    }

    const calendar: RawCalendarItem[] = (await calendarRes.json()) as RawCalendarItem[];
    const cards = parseLiveChart(html);
    const idx = indexCards(cards);

    const flat = toFlatCalendarItems(calendar as RawCalendarWeek[]);
    const schedule = buildSchedule(flat, idx);

    const response: ScheduleResponse = {
      generatedAt: schedule.generatedAt,
      season: schedule.season,
      year: schedule.year,
      days: schedule.days.map((d, wd) => ({
        en: d.en,
        cn: d.cn,
        slots: d.slots.map((s) => ({
          time: s.time,
          items: s.items.map(toScheduleItem),
        })),
        // 该日未知放送时间（BGM 有星期但匹配不到精确时刻）。
        // schedule.unknown 条目携带 BGM 星期（1=周一..7=周日），wd 为 0=周一..6=周日
        unknown: schedule.unknown
          .filter((u) => u.weekday === wd + 1)
          .map(toScheduleItem),
      })),
      unknown: schedule.unknown.map(toScheduleItem),
    };

    setBangumiScheduleMemoryCache(season, year, response);
    await setBangumiScheduleDatabaseCache(season, year, response);

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (error) {
    console.error('获取 Bangumi 时刻表失败:', error);
    return NextResponse.json(
      { error: '获取 Bangumi 时刻表失败' },
      { status: 500 }
    );
  }
}


interface ScheduleResponse {
  generatedAt: number;
  season: string;
  year: number;
  days: Array<{
    en: string;
    cn: string;
    slots: Array<{ time: string; items: ScheduleItem[] }>;
    unknown: ScheduleItem[];
  }>;
  unknown: ScheduleItem[];
}
