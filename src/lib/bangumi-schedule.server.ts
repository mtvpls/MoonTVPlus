/* eslint-disable @typescript-eslint/no-explicit-any */

import * as cheerio from 'cheerio/slim';
import { safeFetch } from './safe-http';
import { isCloudflareEnvironment } from '@/lib/bangumi.server';

/**
 * Bangumi 番剧每日放送时刻表 —— 服务端实现。
 * 移植自参考实现 /data/projects/test/deliverable（livechart.py + bgm.py）：
 *   1) 由当前日期推算当季，抓取 LiveChart 全量页（https://www.livechart.me/{season}-{year}/all）
 *   2) 解析出每部番的每周固定更新时间（UTC 秒）
 *   3) 将 BGM 日历条目按名称匹配到 LiveChart 卡片，得到精确放送时刻
 * 时间一律换算为北京时间（UTC+8）。
 */

const SEASONS = ['winter', 'spring', 'summer', 'fall'] as const;
type Season = (typeof SEASONS)[number];

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const LIVE_CHART_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

export interface LiveChartCard {
  anime_id?: string;
  native: string;
  english: string;
  romaji: string;
  /** 每周固定更新时刻（UTC 秒），匹配的核心字段 */
  next_ts: number | null;
  date_txt: string;
}

export interface CalendarItem {
  id: number;
  name: string;
  name_cn: string;
  weekday: number;
  air_date: string;
  rating?: number | null;
  images?: {
    large?: string;
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
  } | null;
}

/** 由当前日期推算当季。月份 → 季度：1-3=冬, 4-6=春, 7-9=夏, 10-12=秋 */
export function currentSeason(now: Date = new Date()): {
  season: Season;
  year: number;
} {
  const m = now.getMonth() + 1; // 1..12
  const season: Season =
    m <= 3 ? 'winter' : m <= 6 ? 'spring' : m <= 9 ? 'summer' : 'fall';
  return { season, year: now.getFullYear() };
}

function seasonUrl(season: Season, year: number): string {
  return `https://www.livechart.me/${season}-${year}/all`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 抓取 LiveChart 当季全量页 HTML。
 * 带重试（3 次、线性退避）。
 * - Node 运行时：用 node-fetch，可带代理（HttpsProxyAgent）；
 * - Cloudflare 运行时：node-fetch / https-proxy-agent 不可用，回退原生 fetch。
 */
export async function fetchLiveChart(
  season: Season,
  year: number,
  proxy?: string
): Promise<string> {
  const url = seasonUrl(season, year);
  const attempts = 3;
  let lastError: unknown;

  const useNativeFetch = isCloudflareEnvironment();

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (useNativeFetch) {
        const res = await fetch(url, {
          headers: {
            'User-Agent': LIVE_CHART_UA,
          },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          throw new Error(`LiveChart 请求失败: ${res.status}`);
        }
        return await res.text();
      }

      const fetchOptions: any = {
        headers: {
          'User-Agent': LIVE_CHART_UA,
        },
        signal: AbortSignal.timeout(proxy ? 30000 : 15000),
      };
      const res = await safeFetch(url, fetchOptions, proxy);
      if (!res.ok) {
        throw new Error(`LiveChart 请求失败: ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await sleep(600 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

/**
 * 解析 LiveChart HTML，返回卡片列表。
 * 与参考实现 parse() 对齐：取 article.anime 的 data-* 属性与 .episode-countdown time[data-timestamp]。
 */
export function parseLiveChart(html: string): LiveChartCard[] {
  const $ = cheerio.load(html);
  const cards: LiveChartCard[] = [];
  $('article.anime').each((_i, el) => {
    const card = $(el);
    const d: LiveChartCard = {
      anime_id: card.attr('data-anime-id'),
      native: (card.attr('data-native') || '').trim(),
      english: (card.attr('data-english') || '').trim(),
      romaji: (card.attr('data-romaji') || '').trim(),
      next_ts: null,
      date_txt: '',
    };
    const cnt = card.find('.episode-countdown').first();
    if (cnt.length) {
      const tm = cnt.find('time').first();
      const ts = tm.attr('data-timestamp');
      if (ts) {
        const n = Number(ts);
        if (Number.isFinite(n)) d.next_ts = n;
      }
    }
    const de = card.find('.anime-date').first();
    d.date_txt = de.text().replace(/\s+/g, ' ').trim();
    cards.push(d);
  });
  return cards;
}

/** 归一化用于匹配：半角化、去空格、去时序词、去引号标点 */
function normalize(s: string): string {
  let out = (s || '').normalize('NFKC');
  out = out.replace(/\s+/g, '');
  out = out
    .toLowerCase()
    .replace(
      /2nd|second|Ⅱ|ＩＩ|2|第二|二|第2|2期|第2期|二期/g,
      ''
    );
  out = out.replace(/[「」『』【】《》〈〉"'“”‘’()（）\-—]/g, '');
  return out;
}

export interface IndexedCards {
  byName: Map<string, LiveChartCard>;
  keys: string[];
}

/** 预建名称索引（native/english/romaji 各自归一化），供 matchTime 复用 */
export function indexCards(cards: LiveChartCard[]): IndexedCards {
  const byName = new Map<string, LiveChartCard>();
  for (const c of cards) {
    for (const nm of [c.native, c.english, c.romaji]) {
      const k = normalize(nm);
      if (k && !byName.has(k)) byName.set(k, c);
    }
  }
  return { byName, keys: Array.from(byName.keys()) };
}

/**
 * 把一个 BGM 条目匹配到 LiveChart 卡片，返回其 next_ts（UTC 秒）或 null。
 * 匹配顺序：完全相等 → 最长公共子串（双方长度 ≥6）。
 */
export function matchTime(
  bgmItem: Pick<CalendarItem, 'name' | 'name_cn'>,
  idx: IndexedCards
): number | null {
  const bn = normalize(bgmItem.name) || normalize(bgmItem.name_cn);
  if (!bn) return null;

  const hit = idx.byName.get(bn);
  if (hit) return hit.next_ts;

  let best: number | null = null;
  let bestLen = 0;
  for (const k of idx.keys) {
    if (bn.length >= 6 && k.length >= 6) {
      const card = idx.byName.get(k);
      if (card) {
        if (bn.includes(k) && k.length > bestLen) {
          best = card.next_ts;
          bestLen = k.length;
        } else if (k.includes(bn) && bn.length > bestLen) {
          best = card.next_ts;
          bestLen = bn.length;
        }
      }
    }
  }
  return best;
}

/** UTC 秒 → 北京时间 { time: 'HH:MM', weekday: 0=周一..6=周日 } */
export function tsToBeijing(ts: number): { time: string; weekday: number } {
  const d = new Date(ts * 1000 + BEIJING_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  // 北京时区（固定 UTC+8）的星期几：JS getUTCDay 0=周日 → 转 0=周一
  const weekday = (d.getUTCDay() + 6) % 7;
  return { time: `${hh}:${mm}`, weekday };
}

/** 只保留有海报的条目（与网格视图保持一致，VideoCard 需要 poster） */
export function hasPoster(item: CalendarItem): boolean {
  return Boolean(item.images && (item.images.large || item.images.common));
}

const WEEKDAYS = [
  { en: 'Mon', cn: '周一' },
  { en: 'Tue', cn: '周二' },
  { en: 'Wed', cn: '周三' },
  { en: 'Thu', cn: '周四' },
  { en: 'Fri', cn: '周五' },
  { en: 'Sat', cn: '周六' },
  { en: 'Sun', cn: '周日' },
];

export interface ScheduleSlot {
  time: string;
  items: CalendarItem[];
}

export interface ScheduleDay {
  en: string;
  cn: string;
  slots: ScheduleSlot[];
}

export interface ScheduleData {
  generatedAt: number;
  season: string;
  year: number;
  days: ScheduleDay[];
  unknown: CalendarItem[];
}

/**
 * 把 BGM 日历条目（扁平、含 weekday）按匹配到的北京时间分组为时刻表。
 * 命中精确时间的条目按「星期 → 时间」分组；匹配不到的归入 unknown（放最底部）。
 */
export function buildSchedule(
  calendarItems: CalendarItem[],
  idx: IndexedCards
): ScheduleData {
  const known: Array<Map<string, CalendarItem[]>> = Array.from(
    { length: 7 },
    () => new Map()
  );
  const unknown: CalendarItem[] = [];

  for (const item of calendarItems) {
    if (!hasPoster(item)) continue;

    const ts = matchTime(item, idx);
    if (ts) {
      const { time, weekday } = tsToBeijing(ts);
      const slot = known[weekday].get(time);
      if (slot) slot.push(item);
      else known[weekday].set(time, [item]);
    } else {
      unknown.push(item);
    }
  }

  // 未知条目按 BGM 星期排序，同星期内按中文名排序，展示更稳定
  unknown.sort((a, b) => {
    const wdDiff = (a.weekday || 0) - (b.weekday || 0);
    if (wdDiff !== 0) return wdDiff;
    return a.name_cn.localeCompare(b.name_cn, 'zh-Hans-CN');
  });

  const days: ScheduleDay[] = WEEKDAYS.map((d, wd) => ({
    ...d,
    slots: Array.from(known[wd].entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, items]) => ({ time, items })),
  }));

  const { season, year } = currentSeason();
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    season,
    year,
    days,
    unknown,
  };
}
