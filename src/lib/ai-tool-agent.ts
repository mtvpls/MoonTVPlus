/* eslint-disable @typescript-eslint/no-explicit-any,no-console,no-constant-condition,@typescript-eslint/no-empty-function */
/**
 * AI问片 新版：工具式（function-calling）调用引擎
 *
 * 让模型通过工具调用自主决定是否查询 联网搜索 / 豆瓣 / TMDB，
 * 服务端执行工具并把结果回喂给模型，直到模型输出最终回答。
 *
 * 支持三种协议：
 * - openai-completions : OpenAI 普通协议  POST {base}/chat/completions
 * - openai-responses   : OpenAI Response 协议 POST {base}/responses
 * - claude             : Claude Messages 协议 POST https://api.anthropic.com/v1/messages
 *
 * 流式模式下向客户端发送的 SSE 事件（与旧版 {text} / [DONE] 兼容）：
 * - data: {"text":"..."}                         文本增量
 * - data: {"type":"tool","name":"...","status":"start"}  工具开始
 * - data: {"type":"tool","name":"...","status":"done"}   工具执行完成
 * - data: [DONE]                                 整个 agent 循环结束（仅一次）
 */

import {
  fetchDoubanData,
  fetchTMDBData,
  fetchWebSearch,
  formatSearchResults,
  VideoContext,
} from '@/lib/ai-orchestrator';
import { db } from '@/lib/db';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';
import {
  getTMDBTrendingContent,
  searchTMDBMulti,
} from '@/lib/tmdb.client';

export type NewProtocol = 'openai-completions' | 'openai-responses' | 'claude';

function buildProtocolUrl(baseURL: string, path: string): string {
  return baseURL.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

export type ToolName =
  | 'get_current_time'
  | 'web_search'
  | 'fetch_page'
  | 'douban_lookup'
  | 'tmdb_lookup'
  | 'get_user_favorites'
  | 'get_user_recent';

export interface AgentToolDef {
  name: ToolName;
  description: string;
  parameters: Record<string, any>;
}

/** 统一的中性工具调用（用于引擎调度） */
interface ToolCall {
  id: string;
  name: string;
  args: any;
}

/** 工具执行结果 */
interface ToolResult {
  name: string;
  ok: boolean;
  text: string;
}

/** 一轮对话的返回：assistant 段落（provider 原生，用于追加进 transcript）+ 本轮工具调用 */
interface RoundResult {
  /** 本轮文本（流式时为已累积文本，非流式时为 message.content） */
  assistantText: string;
  /** provider 原生的 assistant 消息/条目，直接 push 进 transcript */
  assistantSegments: any[];
  /** 本轮请求的工具调用（空 = 模型已结束） */
  toolCalls: ToolCall[];
  /** 本轮请求的输入 token 数（API 返回的真实用量，未返回则缺省） */
  usage?: { promptTokens?: number };
}

interface ProviderAdapter {
  name: NewProtocol;
  buildTools(defs: AgentToolDef[]): any[];
  /** 构造首轮 transcript（含 system 提示；claude 的 system 走顶层字段，不入 transcript） */
  buildInitialTranscript(ctx: {
    systemPrompt: string;
    history: HistoryTurn[];
    message: string;
  }): any[];
  runRound(opts: {
    transcript: any[];
    tools: any[];
    apiKey: string;
    baseURL: string;
    model: string;
    maxTokens: number;
    temperature: number;
    streaming: boolean;
    signal?: AbortSignal;
    /** Claude 走顶层 system / Responses 走 instructions 时使用 */
    systemPromptForRun?: string;
    onText: (delta: string) => void;
    onToolStart: (name: string) => void;
  }): Promise<RoundResult>;
  buildToolResultMessages(toolCalls: ToolCall[], results: ToolResult[]): any[];
}

/** 新版模式可用的数据源凭据（由路由从 AIConfig 组装） */
export interface ToolDataSources {
  webSearch?: {
    provider: 'tavily' | 'serper' | 'serpapi' | 'bing';
    apiKey: string;
  };
  tmdb?: {
    apiKey: string;
    proxy?: string;
    reverseProxy?: string;
  };
  /** 当前登录用户（用于查收藏/最近观看等个性化工具） */
  username?: string;
}

/* ------------------------------------------------------------------ */
/* 历史回合（前端持久化后随下一条消息回喂）                              */
/* ------------------------------------------------------------------ */

/** 前端消息历史中的一条；assistant 消息可携带该回合执行过的工具调用（含参数与返回结果）。 */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{
    name: string;
    key?: string;
    args?: any;
    result?: string;
    ok?: boolean;
  }>;
  /** 较早对话被压缩后写回的摘要（含前缀的完整正文，可多条）；存在时不重建工具详情 */
  compressedSummaries?: string[];
}

/** 为回喂重建工具消息生成全局唯一 id（assistant tool_calls / tool_use 需与结果消息精确对应） */
let replayToolIdSeq = 0;
function nextReplayToolId(): string {
  return `replay_${replayToolIdSeq++}`;
}

/* ------------------------------------------------------------------ */
/* 工具定义                                                            */
/* ------------------------------------------------------------------ */

const TOOL_DEFS: AgentToolDef[] = [
  {
    name: 'get_current_time',
    description:
      '获取当前时间（默认返回北京时间 UTC+8，含日期与时刻）。当问题涉及“今天、最近、最新、即将上映、更新”等时间相关信息，或需要判断某部影片是否已上映/上映多久时调用。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'web_search',
    description:
      '联网搜索最新的影视资讯、上映时间、续集/新季消息、演员近况等实时信息。' +
      '当问题依赖当前日期之后发生的事，或训练数据中不存在的信息时调用。' +
      'Bing RSS 结果主要是摘要和来源链接；使用 Bing 时，不能只依据外层摘要回答，' +
      '应把最相关结果的 link 传给 fetch_page 获取正文后再回答。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词（中文）',
        },
        max_results: {
          type: 'integer',
          description: '返回结果数，默认5',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_page',
    description:
      '抓取指定网页的正文内容（提取主要文本）。当联网搜索只返回摘要、需要阅读完整文章或页面详情时调用。' +
      '仅支持公开可访问的 http/https 页面。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要抓取的网页 URL（http/https）',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'douban_lookup',
    description:
      '查询豆瓣中文影视数据：评分、简介、导演、演员、类型、用户评论。' +
      '支持按豆瓣ID查询详情，或按标题/关键词搜索。始终可用。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '豆瓣 subject ID（优先于 query）' },
        query: { type: 'string', description: '影视标题或关键词搜索' },
        kind: { type: 'string', enum: ['movie', 'tv'], description: '搜索时指定类型' },
        category: { type: 'string', description: '热门榜单分类，如 热门' },
        type: { type: 'string', description: '热门榜单类型，如 全部' },
      },
      required: [],
    },
  },
  {
    name: 'tmdb_lookup',
    description:
      '查询TMDB国际影视元数据。支持三种用法：' +
      '①按 ID 查详情（需 tmdb_id 和 type）；' +
      '②按标题搜索（query，可指定 type=movie/tv 过滤，返回匹配的电影/剧集列表）；' +
      '③获取热榜（trending=true，返回本周全球热门电影与剧集）。' +
      '用于获取简介、评分、关键词、相似推荐，或了解近期热门内容。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'TMDB ID（与 type 一起用于查详情）' },
        type: { type: 'string', enum: ['movie', 'tv'], description: '作品类型' },
        query: { type: 'string', description: '标题搜索关键词（与 id 二选一）' },
        trending: { type: 'boolean', description: 'true 时返回本周全球热门内容（优先于其他参数）' },
      },
      required: [],
    },
  },
  {
    name: 'get_user_favorites',
    description:
      '获取当前用户的收藏列表（最多20条，按收藏时间倒序）。用于了解用户的观影偏好，' +
      '在用户问“给我推荐点我喜欢的”“和我收藏类似的”等问题时调用。需要用户已登录。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_user_recent',
    description:
      '获取当前用户最近观看的记录（最多20条，按观看时间倒序）。用于了解用户最近在看的影视，' +
      '在用户问“最近在追什么”“帮我续上上次没看完的”“推荐类似的剧”等问题时调用。需要用户已登录。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

const TOOL_BY_NAME: Record<ToolName, AgentToolDef> = {
  get_current_time: TOOL_DEFS[0],
  web_search: TOOL_DEFS[1],
  fetch_page: TOOL_DEFS[2],
  douban_lookup: TOOL_DEFS[3],
  tmdb_lookup: TOOL_DEFS[4],
  get_user_favorites: TOOL_DEFS[5],
  get_user_recent: TOOL_DEFS[6],
};

/**
 * 根据当前配置构建可用的工具列表（get_current_time / douban_lookup / 用户工具 始终可用；
 * 无 web search key 时 web_search / fetch_page 不注册；无 tmdb 时 tmdb_lookup 不注册）
 */
export function buildAgentTools(dataSources: ToolDataSources): AgentToolDef[] {
  const tools: AgentToolDef[] = [
    TOOL_BY_NAME.get_current_time,
    TOOL_BY_NAME.get_user_favorites,
    TOOL_BY_NAME.get_user_recent,
  ];
  if (dataSources.webSearch) {
    tools.push(TOOL_BY_NAME.web_search);
    tools.push(TOOL_BY_NAME.fetch_page);
  }
  tools.push(TOOL_BY_NAME.douban_lookup); // douban 始终可用
  if (dataSources.tmdb) {
    tools.push(TOOL_BY_NAME.tmdb_lookup);
  }
  return tools;
}

/**
 * 新版 agent 系统提示词：人设 + 工具使用规则 + 视频上下文。
 * 注意：不含时间等动态内容，保证 system 前缀稳定以命中 prompt 缓存；
 * 时间由模型通过 get_current_time 工具获取。
 */
export function buildAgentSystemPrompt(opts: {
  customSystemPrompt?: string;
  context?: VideoContext;
}): string {
  let p = opts.customSystemPrompt ? `${opts.customSystemPrompt}\n\n` : '';

  p += `你是 MoonTVPlus 的 AI 影视助手，专门帮助用户发现和了解影视内容。

## 可用工具
你可以调用以下工具获取实时或权威数据（仅在需要时调用）：
- get_current_time：获取当前时间（默认北京时间 UTC+8，含日期与时刻）。当问题涉及时间、年份、季节、上映/播出时段、或“最近、最新、去年、前年、上个月、今年”等相对时间表述时，务必先调用它确认当前日期时间。
- web_search：联网搜索最新的影视资讯、上映时间、续集信息、演员近况等实时信息。Bing RSS 返回摘要和来源链接。
- fetch_page：抓取指定网页的正文内容。当 web_search 返回 Bing RSS 结果、只返回摘要，或需要阅读完整文章/页面详情时，必须把相关结果的 link 传入此工具。
- douban_lookup：查询豆瓣中文影视数据（评分、简介、导演、演员、用户评论）。按 ID 查详情，或按标题/关键词搜索。
- tmdb_lookup：查询 TMDB 国际影视元数据。按 ID 查详情、按标题搜索，或获取本周热榜。
- get_user_favorites：获取当前用户的收藏列表（最多20条）。了解用户喜好时调用。
- get_user_recent：获取当前用户最近观看记录（最多20条）。了解用户最近在看什么时调用。

## 使用工具的要求
1. 先判断是否需要工具：涉及时间、评分、简介、最新上映、续集等时，优先调用对应工具获取真实数据。
2. 用户的问题具有时效性时（含“今天、最近、最新、去年、前年、今年、上个月、下个月、几月、哪一年、即将上映、刚上映、更新到第几集”等任何时间/年份/季节相关表述），必须**先调用 get_current_time** 确认当前日期，再据此推算对应年份/时段并搜索。
3. 如果联网搜索返回 Bing RSS 结果，必须从结果中选择最相关的来源链接调用 fetch_page；正文抓取失败时，才可以退回使用搜索摘要，并明确说明信息来源有限。
4. 用户要求“按我的喜好推荐”“推荐我喜欢的/收藏的类似作品”“我最近在看什么/继续上次没看完的”时，先调用 get_user_favorites / get_user_recent 了解用户偏好，再结合其他数据源推荐。
5. 工具调用之间不要输出冗长说明，简短过渡即可。
6. 用中文回复用户。
7. 参考工具返回的数据回答；数据不足时诚实告知用户。
8. 回答格式清晰：使用分段、列表让内容易读。
9. 单次响应中 web_search 最多调用 5 次，fetch_page 最多调用 5 次。优先基于已获取的搜索结果与历史数据回答；已有足够信息时，不要再次联网搜索或抓取网页。执行 web_search 前，请先仔细斟酌搜索词：选择能精准命中目标信息的关键词（考虑片名中英文、上映年份、类型、平台等限定词），避免宽泛或歧义的词，一次到位，减少无效搜索。`;

  if (opts.context?.title) {
    p += `\n\n## 【当前视频上下文】\n用户正在浏览: ${opts.context.title}`;
    if (opts.context.year) p += ` (${opts.context.year})`;
    if (opts.context.currentEpisode) p += `，当前第 ${opts.context.currentEpisode} 集`;
    p += '\n';
  }

  p += '\n\n现在请回答用户的问题。';
  return p;
}

/* ------------------------------------------------------------------ */
/* 工具执行                                                            */
/* ------------------------------------------------------------------ */

/** 精简豆瓣返回结构（对齐旧版 orchestrator 的摘要逻辑） */
function formatDoubanResult(data: any): string {
  if (!data) return '';
  if (data.list) {
    return JSON.stringify(
      data.list.slice(0, 10).map((item: any) => ({
        title: item.title,
        rating: item.rating,
        year: item.year,
        genres: item.genres,
        directors: item.directors,
        actors: item.actors,
      }))
    );
  }
  if (data.items) {
    return JSON.stringify(data.items.slice(0, 5));
  }
  return JSON.stringify({
    title: data.title,
    rating: data.rating,
    year: data.year,
    genres: data.genres,
    directors: data.directors,
    actors: data.actors,
    intro: data.intro,
    reviews: data.reviews?.slice(0, 2),
  });
}

/** 简易 HTML → 纯文本（去除脚本/样式/标签/实体） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 抓取网页正文（带 SSRF 防护）。
 * - 仅允许 http/https，无内网/本地地址（DNS 解析后校验物理 IP）
 * - 拒绝带用户名/密码的 URL
 * - 超时 + 响应体上限，防止拖垮服务
 */
async function fetchPageText(urlStr: string): Promise<string> {
  const parsed = new URL(urlStr);
  if (!/^https?:$/i.test(parsed.protocol)) return '仅支持 http/https 链接。';
  const safe = await validateProxyUrlServerSide(urlStr);
  if (!safe) return '目标地址未通过安全校验（可能指向内网或本地地址），已拦截。';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MoonTVPlusBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return `抓取失败: HTTP ${res.status} ${res.statusText}`;

    const maxBytes = 200_000;
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let collected = '';
    while (collected.length < maxBytes) {
      const { done, value } = await reader!.read();
      if (done) break;
      collected += decoder.decode(value, { stream: true });
    }
    reader?.cancel().catch(() => {});
    return htmlToText(collected).slice(0, 8000);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return '抓取超时。';
    }
    return `抓取失败: ${(error as Error).message}`;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchTool(
  name: string,
  args: any,
  dataSources: ToolDataSources
): Promise<ToolResult> {
  try {
    if (name === 'get_current_time') {
      // 默认返回北京时间 UTC+8 的完整时间（含日期与时刻）
      const now = new Date();
      const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const date = utc8.toISOString().slice(0, 10);
      const time = `${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}:${pad(utc8.getUTCSeconds())}`;
      return { name, ok: true, text: `${date} ${time}（北京时间 UTC+8）` };
    }

    if (name === 'web_search') {
      if (!dataSources.webSearch) {
        return { name, ok: false, text: '联网搜索未启用，无法执行。' };
      }
      const query = String(args?.query || '').trim();
      if (!query) return { name, ok: false, text: '缺少搜索关键词 query。' };
      const raw = await fetchWebSearch(
        query,
        dataSources.webSearch.provider,
        dataSources.webSearch.apiKey
      );
      const formatted = formatSearchResults(raw, dataSources.webSearch.provider);
      return { name, ok: !!formatted, text: formatted || '无搜索结果。' };
    }

    if (name === 'fetch_page') {
      const url = String(args?.url || '').trim();
      if (!url) return { name, ok: false, text: '缺少要抓取的 URL。' };
      const text = await fetchPageText(url);
      return { name, ok: true, text };
    }

    if (name === 'douban_lookup') {
      const raw = await fetchDoubanData({
        id: args?.id,
        query: args?.query,
        kind: args?.kind,
        category: args?.category,
        type: args?.type,
      });
      if (!raw) return { name, ok: false, text: '豆瓣数据获取失败或参数不完整。' };
      return { name, ok: true, text: formatDoubanResult(raw).slice(0, 4000) };
    }

    if (name === 'tmdb_lookup') {
      if (!dataSources.tmdb) return { name, ok: false, text: 'TMDB 未启用。' };
      const { apiKey, proxy, reverseProxy } = dataSources.tmdb;

      // ① 热榜（本周全球热门）
      if (args?.trending) {
        const res = await getTMDBTrendingContent(apiKey, proxy, reverseProxy);
        if (res.code !== 200 || !res.list.length) {
          return { name, ok: false, text: 'TMDB 热榜获取失败。' };
        }
        const text = JSON.stringify(
          res.list.map((item) => ({
            id: item.id,
            title: item.title,
            media_type: item.media_type,
            release_date: item.release_date,
            vote_average: item.vote_average,
            overview: item.overview?.slice(0, 120),
          }))
        );
        return { name, ok: true, text: text.slice(0, 4000) };
      }

      // ② 按标题搜索
      const query = String(args?.query || '').trim();
      if (query) {
        const res = await searchTMDBMulti(apiKey, query, proxy, reverseProxy);
        if (res.code !== 200 || !res.results.length) {
          return { name, ok: false, text: 'TMDB 搜索无结果。' };
        }
        const typeFilter = args?.type;
        const items = res.results.filter(
          (r) => !typeFilter || r.media_type === typeFilter
        );
        const text = JSON.stringify(
          items.slice(0, 8).map((r) => ({
            id: r.id,
            title: r.title || r.name,
            media_type: r.media_type,
            release_date: r.release_date || r.first_air_date || '',
            vote_average: r.vote_average,
            overview: r.overview?.slice(0, 120),
          }))
        );
        return { name, ok: true, text: text || 'TMDB 搜索无结果。' };
      }

      // ③ 按 ID 查详情
      if (!args?.id || !args?.type) {
        return { name, ok: false, text: 'tmdb_lookup 需要提供 query 搜索、trending=true 热榜、或 id+type 查详情之一。' };
      }
      const raw = await fetchTMDBData(
        { id: args.id, type: args.type },
        apiKey,
        proxy,
        reverseProxy
      );
      if (!raw) return { name, ok: false, text: 'TMDB 数据获取失败或参数不完整。' };
      const text = JSON.stringify({
        title: raw.title || raw.name,
        overview: raw.overview,
        vote_average: raw.vote_average,
        genres: raw.genres,
        keywords: raw.keywords,
        similar: raw.similar?.slice(0, 5),
      });
      return { name, ok: true, text: text.slice(0, 4000) };
    }

    if (name === 'get_user_favorites') {
      const username = dataSources.username;
      if (!username) return { name, ok: false, text: '用户未登录，无法获取收藏。' };
      const favorites = await db.getAllFavorites(username);
      const items = Object.values(favorites)
        .sort((a, b) => (b.save_time ?? 0) - (a.save_time ?? 0))
        .slice(0, 20)
        .map((f) => ({
          title: f.title,
          year: f.year,
          source: f.source_name,
          is_completed: !!f.is_completed,
          vod_remarks: f.vod_remarks,
        }));
      if (!items.length) return { name, ok: true, text: '该用户暂无收藏。' };
      return {
        name,
        ok: true,
        text: JSON.stringify({ count: items.length, favorites: items }).slice(0, 4000),
      };
    }

    if (name === 'get_user_recent') {
      const username = dataSources.username;
      if (!username) return { name, ok: false, text: '用户未登录，无法获取最近观看。' };
      const records = await db.getAllPlayRecords(username);
      const items = Object.values(records)
        .sort((a, b) => (b.save_time ?? 0) - (a.save_time ?? 0))
        .slice(0, 20)
        .map((r) => ({
          title: r.title,
          year: r.year,
          source: r.source_name,
          episode: r.index,
          total_episodes: r.total_episodes,
          save_time: r.save_time,
        }));
      if (!items.length) return { name, ok: true, text: '该用户暂无最近观看记录。' };
      return {
        name,
        ok: true,
        text: JSON.stringify({ count: items.length, recent: items }).slice(0, 4000),
      };
    }

    return { name, ok: false, text: `未知工具: ${name}` };
  } catch (error) {
    console.error(`❌ 工具 ${name} 执行失败:`, error);
    return { name, ok: false, text: `工具执行失败: ${(error as Error).message}` };
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI 普通协议（/chat/completions）                                */
/* ------------------------------------------------------------------ */

function parseToolArgs(rawArgs: any, fallbackName: string): any {
  if (rawArgs && typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs !== 'string' || !rawArgs.trim()) return {};

  const source = rawArgs.trim();
  try {
    const parsed = JSON.parse(source);
    if (typeof parsed === 'string') return parseToolArgs(parsed, fallbackName);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // 某些兼容网关会在 arguments 两侧附加引号或其他事件片段，尽量提取完整 JSON 对象。
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(source.slice(start, end + 1));
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        /* fall through */
      }
    }
    console.warn(`⚠️ 工具参数解析失败（${fallbackName}）:`, source.slice(0, 100));
    return {};
  }
}

const openaiCompletionsAdapter: ProviderAdapter = {
  name: 'openai-completions',

  buildTools(defs) {
    return defs.map((d) => ({
      type: 'function',
      function: { name: d.name, description: d.description, parameters: d.parameters },
    }));
  },

  buildInitialTranscript({ systemPrompt, history, message }) {
    const transcript: any[] = [{ role: 'system', content: systemPrompt }];
    for (const h of history) {
      if (h.role === 'user') {
        transcript.push({ role: 'user', content: h.content });
        continue;
      }
      if (h.compressedSummaries?.length) {
        // 压缩摘要：重建为 user 摘要消息（工具详情已在压缩时移除）
        for (const s of h.compressedSummaries) {
          transcript.push({ role: 'user', content: s });
        }
        if (h.content) transcript.push({ role: 'assistant', content: h.content });
      } else if (h.toolCalls?.length) {
        // 重建历史工具回合：assistant(tool_calls) → tool(结果) → assistant(最终回答)，
        // 让模型直接复用此前拿到的数据，避免同一会话重复调用工具。
        const toolCalls = h.toolCalls.map((tc) => ({
          id: nextReplayToolId(),
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args ?? (tc.key ? { query: tc.key } : {})),
          },
        }));
        transcript.push({ role: 'assistant', content: '', tool_calls: toolCalls });
        h.toolCalls.forEach((tc, i) => {
          transcript.push({
            role: 'tool',
            tool_call_id: toolCalls[i].id,
            content: tc.ok === false ? `(工具执行失败) ${tc.result ?? ''}` : (tc.result ?? ''),
          });
        });
        if (h.content) transcript.push({ role: 'assistant', content: h.content });
      } else if (h.content) {
        transcript.push({ role: 'assistant', content: h.content });
      }
    }
    transcript.push({ role: 'user', content: message });
    return transcript;
  },

  async runRound(opts) {
    const body: any = {
      model: opts.model,
      messages: opts.transcript,
      tools: opts.tools,
      tool_choice: 'auto',
      max_tokens: opts.maxTokens,
      stream: opts.streaming,
    };
    // OpenAI 普通协议始终支持 temperature
    body.temperature = opts.temperature;

    const requestUrl = buildProtocolUrl(opts.baseURL, 'chat/completions');
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText} ${errText.slice(0, 200)}`);
    }

    if (!opts.streaming) {
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      const content = msg?.content || '';
      const rawToolCalls: any[] = msg?.tool_calls || [];
      const toolCalls: ToolCall[] = rawToolCalls.map((tc: any) => ({
        id: tc.id || `call_${rawToolCalls.indexOf(tc)}`,
        name: tc.function?.name || 'unknown',
        args: parseToolArgs(tc.function?.arguments, tc.function?.name || 'unknown'),
      }));
      const segments = toolCalls.length
        ? [{ role: 'assistant', content, tool_calls: rawToolCalls }]
        : [{ role: 'assistant', content }];
      return {
        assistantText: content,
        assistantSegments: segments,
        toolCalls,
        usage:
          typeof data.usage?.prompt_tokens === 'number'
            ? { promptTokens: data.usage.prompt_tokens }
            : undefined,
      };
    }

    // 流式解析
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let streamUsage: number | undefined;
    // key: tool index；value: { id, name, rawArgs }
    const toolAcc: Record<number, { id: string; name: string; rawArgs: string }> = {};
    const emittedToolStart = new Set<number>();

    while (true) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (!data) continue;
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          const delta = choice?.delta;

          // 部分网关（含 DeepSeek）会在末块返回 usage，捕获真实 prompt tokens
          if (json.usage && typeof json.usage.prompt_tokens === 'number') {
            streamUsage = json.usage.prompt_tokens;
          }
          if (delta?.reasoning_content) continue; // 跳过 DeepSeek 风格推理内容
          if (delta?.content) {
            content += delta.content;
            opts.onText(delta.content);
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              toolAcc[idx] = toolAcc[idx] || { id: `call_${idx}`, name: '', rawArgs: '' };
              if (tc.id) toolAcc[idx].id = tc.id;
              if (tc.function?.name) toolAcc[idx].name = tc.function.name;
              if (tc.function?.arguments) toolAcc[idx].rawArgs += tc.function.arguments;
              if (!emittedToolStart.has(idx) && toolAcc[idx].name) {
                emittedToolStart.add(idx);
                opts.onToolStart(toolAcc[idx].name);
              }
            }
          }
        } catch (e) {
          console.error('Parse stream chunk error:', e);
        }
      }
    }
    // 清理剩余缓冲
    if (buffer.trim() && buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6).trim();
      if (data && data !== '[DONE]') {
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            opts.onText(delta.content);
          }
        } catch {
          /* ignore */
        }
      }
    }

    const rawToolCalls: any[] = Object.entries(toolAcc)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, tc]) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name || 'unknown', arguments: tc.rawArgs || '{}' },
      }));
    const toolCalls: ToolCall[] = rawToolCalls.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name || 'unknown',
      args: parseToolArgs(tc.function?.arguments, tc.function?.name || 'unknown'),
    }));
    const segments = toolCalls.length
      ? [{ role: 'assistant', content, tool_calls: rawToolCalls }]
      : [{ role: 'assistant', content }];
    return {
      assistantText: content,
      assistantSegments: segments,
      toolCalls,
      usage:
        typeof streamUsage === 'number'
          ? { promptTokens: streamUsage }
          : undefined,
    };
  },

  buildToolResultMessages(toolCalls, results) {
    return toolCalls.map((tc, i) => ({
      role: 'tool',
      tool_call_id: tc.id,
      content: results[i]?.text || '',
    }));
  },
};

/* ------------------------------------------------------------------ */
/* OpenAI Response 协议（/responses）                                  */
/* ------------------------------------------------------------------ */

function parseResponsesOutput(output: any[]): {
  assistantText: string;
  assistantSegments: any[];
  toolCalls: ToolCall[];
} {
  let assistantText = '';
  const assistantSegments: any[] = [];
  const toolCalls: ToolCall[] = [];

  for (const item of output || []) {
    if (item.type === 'message') {
      const text = (item.content || [])
        .filter((c: any) => c.type === 'output_text')
        .map((c: any) => c.text || '')
        .join('');
      assistantText += text;
      assistantSegments.push(item);
    } else if (item.type === 'function_call') {
      const args = parseToolArgs(item.arguments, item.name || 'unknown');
      toolCalls.push({
        id: item.call_id || item.id,
        name: item.name || 'unknown',
        args,
      });
      assistantSegments.push(item);
    }
    // reasoning 等其他条目忽略
  }

  return { assistantText, assistantSegments, toolCalls };
}

const openaiResponsesAdapter: ProviderAdapter = {
  name: 'openai-responses',

  buildTools(defs) {
    return defs.map((d) => ({
      type: 'function',
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    }));
  },

  buildInitialTranscript({ history, message }) {
    // system 走顶层 instructions，不入 input
    const input: any[] = [];
    for (const h of history) {
      if (h.role === 'user') {
        input.push({ role: 'user', content: [{ type: 'input_text', text: h.content }] });
        continue;
      }
      if (h.compressedSummaries?.length) {
        // 压缩摘要：重建为 user 摘要消息（工具详情已在压缩时移除）
        for (const s of h.compressedSummaries) {
          input.push({ role: 'user', content: [{ type: 'input_text', text: s }] });
        }
        if (h.content) {
          input.push({ role: 'assistant', content: [{ type: 'output_text', text: h.content }] });
        }
      } else if (h.toolCalls?.length) {
        const calls = h.toolCalls.map((tc) => ({
          type: 'function_call',
          call_id: nextReplayToolId(),
          name: tc.name,
          arguments: JSON.stringify(tc.args ?? (tc.key ? { query: tc.key } : {})),
        }));
        input.push(...calls);
        h.toolCalls.forEach((tc, i) => {
          input.push({
            type: 'function_call_output',
            call_id: calls[i].call_id,
            output: tc.result ?? '',
          });
        });
        if (h.content) {
          input.push({ role: 'assistant', content: [{ type: 'output_text', text: h.content }] });
        }
      } else if (h.content) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text: h.content }] });
      }
    }
    input.push({ role: 'user', content: [{ type: 'input_text', text: message }] });
    return input;
  },

  async runRound(opts) {
    const body: any = {
      model: opts.model,
      instructions: opts.systemPromptForRun || '',
      input: opts.transcript,
      tools: opts.tools,
      tool_choice: 'auto',
      max_output_tokens: opts.maxTokens,
      temperature: opts.temperature,
      stream: opts.streaming,
    };

    const requestUrl = buildProtocolUrl(opts.baseURL, 'responses');
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI Responses API error: ${res.status} ${res.statusText} ${errText.slice(0, 200)}`);
    }

    if (!opts.streaming) {
      const data = await res.json();
      if (data.status === 'failed') throw new Error('OpenAI Responses API failed');
      return {
        ...parseResponsesOutput(data.output),
        usage:
          typeof data.usage?.input_tokens === 'number'
            ? { promptTokens: data.usage.input_tokens }
            : undefined,
      };
    }

    // 流式解析
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // key: item_id；value: { id, name, rawArgs }
    const toolAcc: Record<string, { id: string; name: string; rawArgs: string }> = {};
    const emittedToolStart = new Set<string>();
    let completedOutput: any[] | null = null;
    let streamUsage: number | undefined;

    while (true) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (!data) continue;
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const type = json.type;

          if (type === 'response.output_text.delta') {
            opts.onText(json.delta || '');
          } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
            const item = json.item;
            if (item?.type === 'function_call') {
              const itemId = item.id || item.call_id || `item_${Object.keys(toolAcc).length}`;
              toolAcc[itemId] = toolAcc[itemId] || { id: item.call_id || item.id, name: '', rawArgs: '' };
              if (item.name) toolAcc[itemId].name = item.name;
              if (item.call_id || item.id) toolAcc[itemId].id = item.call_id || item.id;
              if (typeof item.arguments === 'string' && item.arguments) {
                toolAcc[itemId].rawArgs = item.arguments;
              }
              if (!emittedToolStart.has(itemId) && toolAcc[itemId].name) {
                emittedToolStart.add(itemId);
                opts.onToolStart(toolAcc[itemId].name);
              }
            }
          } else if (type === 'response.function_call_arguments.delta') {
            const itemId = json.item_id || `item_${Object.keys(toolAcc).length}`;
            toolAcc[itemId] = toolAcc[itemId] || { id: itemId, name: '', rawArgs: '' };
            toolAcc[itemId].rawArgs += json.delta || '';
          } else if (type === 'response.function_call_arguments.done') {
            const itemId = json.item_id || '';
            toolAcc[itemId] = toolAcc[itemId] || { id: itemId, name: '', rawArgs: '' };
            if (typeof json.arguments === 'string') toolAcc[itemId].rawArgs = json.arguments;
          } else if (type === 'response.function_call') {
            const itemId = json.item_id || '';
            toolAcc[itemId] = toolAcc[itemId] || { id: itemId, name: '', rawArgs: '' };
            if (json.name) toolAcc[itemId].name = json.name;
            if (json.call_id) toolAcc[itemId].id = json.call_id;
            if (json.arguments) toolAcc[itemId].rawArgs = json.arguments;
            if (!emittedToolStart.has(itemId) && toolAcc[itemId].name) {
              emittedToolStart.add(itemId);
              opts.onToolStart(toolAcc[itemId].name);
            }
          } else if (type === 'response.completed') {
            completedOutput = json.response?.output || null;
            if (typeof json.response?.usage?.input_tokens === 'number') {
              streamUsage = json.response.usage.input_tokens;
            }
          } else if (type === 'response.failed') {
            throw new Error('OpenAI Responses API stream failed');
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes('failed')) throw e;
          console.error('Parse Responses stream chunk error:', e);
        }
      }
    }

    if (completedOutput) {
      // 兼容网关可能在 response.completed 中返回空 arguments 的情况：
      // 用前面 arguments delta 累积的完整参数补回完成事件。
      const mergedOutput = completedOutput.map((item: any) => {
        if (item?.type !== 'function_call') return item;
        const key = item.id || item.call_id;
        const accumulated = key ? toolAcc[key] : undefined;
        if (!accumulated) return item;
        const hasArguments =
          typeof item.arguments === 'string' &&
          item.arguments.trim() &&
          item.arguments.trim() !== '{}';
        return {
          ...item,
          name: item.name || accumulated.name,
          call_id: item.call_id || accumulated.id,
          arguments: hasArguments ? item.arguments : accumulated.rawArgs || item.arguments || '{}',
        };
      });
      return {
        ...parseResponsesOutput(mergedOutput),
        usage:
          typeof streamUsage === 'number'
            ? { promptTokens: streamUsage }
            : undefined,
      };
    }

    // 兜底：用累积的 delta 构造（不理想但可用）
    const rawToolCalls: any[] = Object.entries(toolAcc).map(([, tc]) => ({
      id: tc.id,
      call_id: tc.id,
      name: tc.name || 'unknown',
      arguments: tc.rawArgs || '{}',
      type: 'function_call',
    }));
    const toolCalls: ToolCall[] = rawToolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name || 'unknown',
      args: parseToolArgs(tc.arguments, tc.name || 'unknown'),
    }));
    const assistantSegments = toolCalls.length ? rawToolCalls : [];
    return {
      assistantText: '',
      assistantSegments,
      toolCalls,
      usage:
        typeof streamUsage === 'number'
          ? { promptTokens: streamUsage }
          : undefined,
    };
  },

  buildToolResultMessages(toolCalls, results) {
    return toolCalls.map((tc, i) => ({
      type: 'function_call_output',
      call_id: tc.id,
      output: results[i]?.text || '',
    }));
  },
};

/* ------------------------------------------------------------------ */
/* Claude Messages 协议（/v1/messages）                                */
/* ------------------------------------------------------------------ */

/** 现代 Claude 模型不接受 temperature/top_p，仅白名单旧模型发送 */
function supportsSamplingParams(model: string): boolean {
  const legacyModels = [
    'claude-3-opus-20240229',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-haiku-20240307',
    'claude-2.1',
    'claude-2.0',
  ];
  return legacyModels.includes(model);
}

const claudeAdapter: ProviderAdapter = {
  name: 'claude',

  buildTools(defs) {
    return defs.map((d, i) => ({
      name: d.name,
      description: d.description,
      input_schema: { ...d.parameters, additionalProperties: false },
      // 在最后一个工具上打缓存断点：配合 system 断点，让 system+tools 前缀
      // 在 agent 多轮循环中命中 Anthropic prompt caching。
      ...(i === defs.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
  },

  buildInitialTranscript({ history, message }) {
    const transcript: any[] = [];
    for (const h of history) {
      if (h.role === 'user') {
        transcript.push({ role: 'user', content: h.content });
        continue;
      }
      if (h.compressedSummaries?.length) {
        // 压缩摘要：重建为 user 摘要消息（工具详情已在压缩时移除）
        for (const s of h.compressedSummaries) {
          transcript.push({ role: 'user', content: s });
        }
        if (h.content) transcript.push({ role: 'assistant', content: h.content });
      } else if (h.toolCalls?.length) {
        // 重建历史工具回合：assistant(tool_use) → user(tool_result) → assistant(最终回答)，
        // Claude 要求角色严格交替，因此把最终回答单独作为一条 assistant 消息。
        const toolUses = h.toolCalls.map((tc) => ({
          type: 'tool_use',
          id: nextReplayToolId(),
          name: tc.name,
          input: tc.args ?? {},
        }));
        transcript.push({ role: 'assistant', content: toolUses });
        transcript.push({
          role: 'user',
          content: h.toolCalls.map((tc, i) => ({
            type: 'tool_result',
            tool_use_id: toolUses[i].id,
            content: tc.result ?? '',
            ...(tc.ok === false ? { is_error: true } : {}),
          })),
        });
        if (h.content) transcript.push({ role: 'assistant', content: h.content });
      } else if (h.content) {
        transcript.push({ role: 'assistant', content: h.content });
      }
    }
    transcript.push({ role: 'user', content: message });
    return transcript;
  },

  async runRound(opts) {
    const body: any = {
      model: opts.model,
      // Anthropic 要求 system 为数组才能挂 cache_control 断点。
      // 在 system 末尾断点：system+tools 前缀跨轮命中 prompt cache。
      system: [
        {
          type: 'text',
          text: opts.systemPromptForRun || '',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: opts.transcript,
      tools: opts.tools,
      max_tokens: opts.maxTokens,
      stream: opts.streaming,
    };
    if (supportsSamplingParams(opts.model)) {
      body.temperature = opts.temperature;
    }

    const requestUrl = buildProtocolUrl(opts.baseURL, 'messages');
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Claude API error: ${res.status} ${res.statusText} ${errText.slice(0, 200)}`);
    }

    if (!opts.streaming) {
      const data = await res.json();
      return {
        ...parseClaudeContent(data.content, data.stop_reason),
        usage:
          typeof data.usage?.input_tokens === 'number'
            ? { promptTokens: data.usage.input_tokens }
            : undefined,
      };
    }

    // 流式解析
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    // key: block index；value: tool_use 块
    const toolBlocks: Record<number, { id: string; name: string; rawInput: string }> = {};
    const emittedToolStart = new Set<number>();
    let streamUsage: number | undefined;

    while (true) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_start') {
            const block = json.content_block;
            if (block?.type === 'tool_use') {
              toolBlocks[json.index] = {
                id: block.id,
                name: block.name,
                rawInput:
                  block.input && typeof block.input === 'object' && Object.keys(block.input).length > 0
                    ? JSON.stringify(block.input)
                    : '',
              };
              if (!emittedToolStart.has(json.index)) {
                emittedToolStart.add(json.index);
                opts.onToolStart(block.name);
              }
            }
          } else if (json.type === 'message_delta') {
            if (typeof json.usage?.input_tokens === 'number') {
              streamUsage = json.usage.input_tokens;
            }
          } else if (json.type === 'content_block_delta') {
            const delta = json.delta;
            if (delta?.type === 'text_delta') {
              text += delta.text;
              opts.onText(delta.text);
            } else if (delta?.type === 'input_json_delta') {
              const block = toolBlocks[json.index];
              if (block) block.rawInput += delta.partial_json || '';
            }
            // thinking_delta 等跳过
          }
        } catch (e) {
          console.error('Parse Claude stream chunk error:', e);
        }
      }
    }
    if (buffer.trim() && buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6).trim();
      if (data) {
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta') {
            const delta = json.delta;
            if (delta?.type === 'text_delta') {
              text += delta.text;
              opts.onText(delta.text);
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    return {
      ...buildClaudeRoundResult(text, toolBlocks),
      usage:
        typeof streamUsage === 'number'
          ? { promptTokens: streamUsage }
          : undefined,
    };
  },

  buildToolResultMessages(toolCalls, results) {
    return [
      {
        role: 'user',
        content: toolCalls.map((tc, i) => ({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: results[i]?.text || '',
          ...(results[i] && !results[i].ok ? { is_error: true } : {}),
        })),
      },
    ];
  },
};

function parseClaudeContent(content: any[], _stopReason?: string): RoundResult {
  let text = '';
  const blocks: any[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content || []) {
    if (block.type === 'text') {
      text += block.text;
      blocks.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input || {} });
      toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
    }
  }

  return {
    assistantText: text,
    assistantSegments: [{ role: 'assistant', content: blocks }],
    toolCalls,
  };
}

function buildClaudeRoundResult(text: string, toolBlocks: Record<number, { id: string; name: string; rawInput: string }>): RoundResult {
  const blocks: any[] = [];
  const toolCalls: ToolCall[] = [];

  if (text) blocks.push({ type: 'text', text });
  for (const [, block] of Object.entries(toolBlocks).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const input = parseToolArgs(block.rawInput, block.name);
    blocks.push({ type: 'tool_use', id: block.id, name: block.name, input });
    toolCalls.push({ id: block.id, name: block.name, args: input });
  }

  return {
    assistantText: text,
    assistantSegments: blocks.length ? [{ role: 'assistant', content: blocks }] : [],
    toolCalls,
  };
}

/* ------------------------------------------------------------------ */
/* 上下文压缩（LLM 摘要化 + 丢弃所有工具消息）                          */
/* ------------------------------------------------------------------ */

/** 约 4 字符 ≈ 1 token 的粗略估算（项目无 tokenizer 依赖） */
function estimateTokens(value: any): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

/** 摘要专用系统指令 */
const SUMMARY_SYSTEM_PROMPT =
  '你是一个对话压缩工具。用户会给你一段 AI 助手使用工具（联网搜索、豆瓣、TMDB、网页抓取、查收藏等）与用户多轮对话的原始记录。' +
  '请把它压缩成简洁的中文摘要，保留：用户的核心诉求、助手查到的关键事实（片名、评分、上映时间、来源链接、关键结论等）。' +
  '工具调用的详细原始返回可以省略，但关键数字与结论必须保留。直接输出摘要正文，不要客套，不超过300字。';

/** 判断某个 transcript 元素是否属于"工具消息"（压缩时整体移除） */
function isToolElement(el: any, protocol: NewProtocol): boolean {
  if (!el || typeof el !== 'object') return false;
  if (protocol === 'openai-responses') {
    return el.type === 'function_call' || el.type === 'function_call_output';
  }
  if (protocol === 'claude') {
    const content: any[] = Array.isArray(el.content) ? el.content : [];
    if (el.role === 'assistant' && content.some((b) => b?.type === 'tool_use')) return true;
    if (el.role === 'user' && content.some((b) => b?.type === 'tool_result')) return true;
    return false;
  }
  // openai-completions
  if (el.role === 'tool') return true;
  if (el.role === 'assistant' && Array.isArray(el.tool_calls) && el.tool_calls.length) return true;
  return false;
}

/** 把一个工具元素转成可读文本（供摘要 LLM 阅读） */
function toolElementToText(el: any, protocol: NewProtocol): string {
  const lines: string[] = [];
  if (protocol === 'openai-responses') {
    if (el.type === 'function_call') {
      lines.push(`助手调用工具: ${el.name || ''}(${el.arguments || '{}'})`);
    } else if (el.type === 'function_call_output') {
      lines.push(`工具结果: ${String(el.output ?? '').slice(0, 4000)}`);
    }
    return lines.join('\n');
  }
  if (protocol === 'claude') {
    const content: any[] = Array.isArray(el.content) ? el.content : [];
    if (el.role === 'assistant') {
      const tools = content.filter((b) => b?.type === 'tool_use');
      const text = content
        .filter((b) => b?.type === 'text')
        .map((b) => b.text)
        .join('');
      if (tools.length) {
        lines.push(
          `助手调用工具: ${tools
            .map((b) => `${b.name}(${JSON.stringify(b.input ?? {})})`)
            .join('; ')}`
        );
      }
      if (text) lines.push(`助手: ${text}`);
    } else if (el.role === 'user') {
      const results = content
        .filter((b) => b?.type === 'tool_result')
        .map((b) => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')))
        .join('\n');
      if (results) lines.push(`工具结果: ${results.slice(0, 4000)}`);
    }
    return lines.join('\n');
  }
  // openai-completions
  if (el.role === 'tool') {
    return `工具结果: ${String(el.content ?? '').slice(0, 4000)}`;
  }
  if (el.role === 'assistant' && Array.isArray(el.tool_calls)) {
    const calls = el.tool_calls
      .map((tc: any) => `${tc.function?.name || ''}(${tc.function?.arguments || '{}'})`)
      .join('; ');
    lines.push(`助手调用工具: ${calls}`);
    if (el.content) lines.push(`助手: ${el.content}`);
  }
  return lines.join('\n');
}

/** 构造摘要消息（写入 transcript，格式随协议） */
function buildSummaryMessage(protocol: NewProtocol, summary: string): any {
  const content = `【以下为较早对话的工具调用摘要】\n${summary}`;
  if (protocol === 'openai-responses') {
    return { role: 'user', content: [{ type: 'input_text', text: content }] };
  }
  return { role: 'user', content };
}

/** 调用同 provider 做一次非流式摘要 */
async function summarizeWithProvider(
  providerOpts: {
    protocol: NewProtocol;
    apiKey: string;
    baseURL: string;
    model: string;
    signal?: AbortSignal;
  },
  rawText: string
): Promise<string> {
  const summaryMaxTokens = 1024;
  if (providerOpts.protocol === 'openai-responses') {
    const res = await fetch(buildProtocolUrl(providerOpts.baseURL, 'responses'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerOpts.apiKey}`,
      },
      body: JSON.stringify({
        model: providerOpts.model,
        instructions: SUMMARY_SYSTEM_PROMPT,
        input: [{ role: 'user', content: [{ type: 'input_text', text: rawText }] }],
        max_output_tokens: summaryMaxTokens,
        temperature: 0.3,
        stream: false,
      }),
      signal: providerOpts.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Summary Responses error: ${res.status} ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return parseResponsesOutput(data.output || []).assistantText;
  }
  if (providerOpts.protocol === 'claude') {
    const res = await fetch(buildProtocolUrl(providerOpts.baseURL, 'messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': providerOpts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: providerOpts.model,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawText }],
        max_tokens: summaryMaxTokens,
        stream: false,
      }),
      signal: providerOpts.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Summary Claude error: ${res.status} ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return parseClaudeContent(data.content || []).assistantText;
  }
  // openai-completions
  const res = await fetch(buildProtocolUrl(providerOpts.baseURL, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerOpts.apiKey}`,
    },
    body: JSON.stringify({
      model: providerOpts.model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: rawText },
      ],
      max_tokens: summaryMaxTokens,
      temperature: 0.3,
      stream: false,
    }),
    signal: providerOpts.signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Summary OpenAI error: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 上下文超限时压缩：把 transcript 中所有工具消息序列化后交给 LLM 摘要，
 * 摘要写回为一条 user 消息，然后丢弃所有工具消息（AI 需要时可重新调工具）。
 * 摘要失败时降级为直接丢弃工具消息（仅保留占位），保证主请求不失败。
 * summarize=false 时跳过 LLM 直接丢弃（循环内已压过一次、又再次超限的兜底）。
 */
async function compressTranscript(
  transcript: any[],
  protocol: NewProtocol,
  providerOpts: {
    protocol: NewProtocol;
    apiKey: string;
    baseURL: string;
    model: string;
    signal?: AbortSignal;
  },
  ctx: { transcriptTokens: number; compressed: boolean },
  summarize = true
): Promise<{ summary: string; fallback: boolean }> {
  const toolElements = transcript.filter((el) => isToolElement(el, protocol));
  if (toolElements.length === 0) return { summary: '', fallback: false };
  const kept = transcript.filter((el) => !isToolElement(el, protocol));

  let summary = '';
  if (summarize) {
    const rawText = toolElements.map((el) => toolElementToText(el, protocol)).join('\n');
    try {
      summary = await summarizeWithProvider(providerOpts, rawText);
    } catch (e) {
      console.error('❌ 上下文摘要失败，降级为直接丢弃工具消息:', e);
    }
  }
  summary = (summary || '').trim();

  const fallback = !summary;
  const summaryMsg = buildSummaryMessage(protocol, summary || '（较早对话中的工具调用详情已省略；如需可重新调用工具获取。）');
  // 摘要插入到末尾（当前 user 消息）之前
  const insertAt = Math.max(0, kept.length - 1);
  kept.splice(insertAt, 0, summaryMsg);

  transcript.length = 0;
  transcript.push(...kept);
  ctx.transcriptTokens = estimateTokens(transcript);
  return { summary, fallback };
}

/* ------------------------------------------------------------------ */
/* 适配器选择 + 引擎主循环                                             */
/* ------------------------------------------------------------------ */

function getAdapter(protocol: NewProtocol): ProviderAdapter {
  switch (protocol) {
    case 'openai-responses':
      return openaiResponsesAdapter;
    case 'claude':
      return claudeAdapter;
    case 'openai-completions':
    default:
      return openaiCompletionsAdapter;
  }
}

export interface RunToolAgentOptions {
  protocol: NewProtocol;
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
  temperature: number;
  streaming: boolean;
  systemPrompt: string;
  history: HistoryTurn[];
  message: string;
  tools: AgentToolDef[];
  dataSources: ToolDataSources;
  signal?: AbortSignal;
  /** 上下文窗口 token 上限，默认 131072（128k） */
  maxContext?: number;
  /** 上下文压缩触发阈值百分比（0-100），默认 90；0=关闭 */
  compressThreshold?: number;
}

export type RunToolAgentResult =
  | { kind: 'stream'; stream: ReadableStream<Uint8Array> }
  | { kind: 'json'; content: string; compressedSummary?: string };

/**
 * 运行工具式 agent 循环。
 * - 每轮调用 provider；流式时实时转发文本与工具进度事件。
 * - 收到工具调用则并发执行（dispatchTool）并把结果回喂，继续下一轮。
 * - 直到模型返回无工具调用的终轮（end_turn/stop）为止。不设调用次数上限。
 * - streaming=false 时同样跑完整循环，累积文本返回 { content }。
 */
export async function runToolAgent(opts: RunToolAgentOptions): Promise<RunToolAgentResult> {
  const adapter = getAdapter(opts.protocol);
  const transcript = adapter.buildInitialTranscript({
    systemPrompt: opts.systemPrompt,
    history: opts.history,
    message: opts.message,
  });

  // Claude / Responses 的 system 走顶层字段，传给 runRound 使用
  const runOptsBase = {
    ...opts,
    systemPromptForRun: opts.systemPrompt,
  } as any;

  // 上下文预算：system + tools 是常量计入窗口。
  // 以 API 返回的真实 prompt tokens 为基准（上一轮），本轮新 push 用增量估算叠加；
  // API 未返回 usage（部分网关）时退化为整体估算。
  const maxContext = opts.maxContext ?? 131072;
  const compressThreshold = opts.compressThreshold ?? 90;
  const budgetEnabled = compressThreshold > 0 && compressThreshold <= 100 && maxContext > 0;
  const baseTokens = budgetEnabled
    ? estimateTokens(opts.systemPrompt) + estimateTokens(adapter.buildTools(opts.tools))
    : 0;
  const budgetTokens = budgetEnabled
    ? Math.floor((maxContext * compressThreshold) / 100) - baseTokens
    : Number.POSITIVE_INFINITY;
  const ctx = {
    transcriptTokens: estimateTokens(transcript),
    compressed: false,
  };
  const providerOpts = {
    protocol: opts.protocol,
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    model: opts.model,
    signal: opts.signal,
  };
  // 本次 agent 循环最后一次成功压缩的摘要（流式转 SSE、非流式随 JSON 返回）
  let lastCompression: string | null = null;
  const enforce = async () => {
    if (!budgetEnabled) return;
    if (ctx.transcriptTokens <= budgetTokens) return;
    // 首次超限调 LLM 摘要；同一次循环内若再次超限，纯丢弃兜底（避免反复调用摘要）
    const result = await compressTranscript(transcript, adapter.name, providerOpts, ctx, !ctx.compressed);
    ctx.compressed = true;
    // 摘要成功（未降级）时记录，流式转 SSE、非流式随 JSON 返回给前端持久化
    if (result.summary && !result.fallback) {
      lastCompression = result.summary;
    }
  };
  // 拿到 API 返回的真实 prompt tokens 时，校准计数基准
  const syncUsage = (round: RoundResult) => {
    if (typeof round.usage?.promptTokens === 'number') {
      const delta = estimateTokens(transcript) - round.usage.promptTokens;
      ctx.transcriptTokens = round.usage.promptTokens + Math.max(0, delta);
    }
  };

  if (!opts.streaming) {
    let allText = '';
    while (true) {
      await enforce();
      const round = await adapter.runRound({
        ...runOptsBase,
        transcript,
        tools: adapter.buildTools(opts.tools),
        onText: () => {},
        onToolStart: () => {},
      });
      transcript.push(...round.assistantSegments);
      ctx.transcriptTokens += estimateTokens(round.assistantSegments);
      allText += round.assistantText;
      if (round.toolCalls.length === 0) break;
      const results = await Promise.all(
        round.toolCalls.map((tc) => dispatchTool(tc.name, tc.args, opts.dataSources))
      );
      const resultMsgs = adapter.buildToolResultMessages(round.toolCalls, results);
      transcript.push(...resultMsgs);
      ctx.transcriptTokens += estimateTokens(resultMsgs);
      // 本轮请求已返回真实用量：校准基准（下一轮 enforce 用更准的值判断）
      syncUsage(round);
    }
    return {
      kind: 'json',
      content: allText,
      ...(lastCompression ? { compressedSummary: lastCompression } : {}),
    };
  }

  // 流式：包装成 SSE
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (payload: string) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      try {
        while (true) {
          await enforce();
          const round = await adapter.runRound({
            ...runOptsBase,
            transcript,
            tools: adapter.buildTools(opts.tools),
            signal: opts.signal,
            onText: (delta) => send(JSON.stringify({ text: delta })),
            // 工具 start 事件在整轮解析完成后统一发送（此时才拿到完整参数），
            // 因此流式过程中 onToolStart 仅作占位，不单独发事件。
            onToolStart: () => {},
          });
          transcript.push(...round.assistantSegments);
          ctx.transcriptTokens += estimateTokens(round.assistantSegments);
          if (round.toolCalls.length === 0) break;

          // 整轮解析完成后：先逐个发 start（携带关键参数），再并发执行工具，执行完逐个发 done
          for (const tc of round.toolCalls) {
            send(
              JSON.stringify({
                type: 'tool',
                name: tc.name,
                status: 'start',
                args: tc.args,
              })
            );
          }
          const results = await Promise.all(
            round.toolCalls.map(async (tc) => {
              const result = await dispatchTool(tc.name, tc.args, opts.dataSources);
              send(
                JSON.stringify({
                  type: 'tool',
                  name: tc.name,
                  status: 'done',
                  // 携带执行结果，供前端在响应结束后将工具调用固化进消息历史
                  result: result.text,
                  ok: result.ok,
                })
              );
              return result;
            })
          );
          const resultMsgs = adapter.buildToolResultMessages(round.toolCalls, results);
          transcript.push(...resultMsgs);
          ctx.transcriptTokens += estimateTokens(resultMsgs);
          syncUsage(round);
        }
        // 压缩发生在本轮循环内：把摘要随 SSE 发给前端，前端持久化后下次请求不再膨胀
        if (lastCompression) {
          send(JSON.stringify({ type: 'context_compressed', summary: lastCompression }));
        }
        send('[DONE]');
      } catch (error) {
        console.error('❌ AI agent 流式错误:', error);
        if (!closed) {
          const msg =
            error instanceof DOMException && error.name === 'AbortError'
              ? '请求已取消'
              : `AI agent 请求失败: ${(error as Error).message}`;
          send(JSON.stringify({ error: msg }));
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return { kind: 'stream', stream };
}
