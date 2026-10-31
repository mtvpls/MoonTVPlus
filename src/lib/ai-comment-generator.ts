import { callParallelSearch, createSearchContext } from '@/lib/parallel-search';
import { getWebSearchProvider } from '@/lib/web-search-config';
// AI评论生成核心逻辑

import {
  buildAgentTools,
  runToolAgent,
  ToolDataSources,
} from '@/lib/ai-tool-agent';
import { normalizeApiBaseUrl } from '@/lib/url';
import { parseStringPromise } from 'xml2js';

export interface AIComment {
  id: string;
  userName: string;
  userAvatar: string;
  rating: number | null;
  content: string;
  time: string;
  votes: number;
  isAiGenerated: true;
}

// 新版 AI 调用协议（与 AIConfig.NewProtocol 保持一致）
export type AICommentProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'claude';

interface GenerateCommentsParams {
  movieName: string;
  movieInfo?: string;
  count?: number;
  // 解析后的调用凭据（兼容新版 AI 方式：由路由根据 AIConfig 解析后传入）
  protocol: AICommentProtocol;
  apiKey: string;
  baseURL: string;
  model: string;
  // 工具式调用：开启后交由模型自主调用联网/豆瓣/TMDB 工具收集素材
  useToolMode?: boolean;
  toolDataSources?: ToolDataSources;
  aiConfig: {
    Temperature?: number;
    MaxTokens?: number;
    MaxContext?: number;
    CompressThreshold?: number;
    EnableWebSearch?: boolean;
    WebSearchProvider?: 'parallel' | 'tavily' | 'serper' | 'serpapi' | 'bing';
    TavilyApiKey?: string;
    SerperApiKey?: string;
    SerpApiKey?: string;
  };
}

// Claude Messages API 根地址需以 /v1 结尾
function normalizeClaudeBaseURL(baseURL: string): string {
  const normalized = normalizeApiBaseUrl(baseURL || 'https://api.anthropic.com');
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

// 现代 Claude 模型不接受 temperature，仅白名单旧模型发送
function claudeSupportsSamplingParams(model: string): boolean {
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

// 工具式调用的系统提示词：允许模型先用工具查证，最终仅输出 JSON 数组
const COMMENT_TOOL_SYSTEM_PROMPT = `你是一个专业的影评生成助手，擅长生成真实自然的观众评论。

你可以调用可用工具（联网搜索、豆瓣、TMDB 等）了解影片的真实口碑、剧情、演员表现和观众评价，再据此生成评论。仅在有助于提升评论真实性时才调用工具，不要过度调用。

重要：完成资料收集后，最终回复必须**只输出**用户要求的 JSON 数组本身，不要输出任何解释、前后缀或代码块标记。`;

// 按协议调用 AI，返回文本内容（评论生成为单轮、无工具调用）
async function callAIForComments(params: {
  protocol: AICommentProtocol;
  apiKey: string;
  baseURL: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const {
    protocol,
    apiKey,
    baseURL,
    model,
    systemPrompt,
    userPrompt,
    temperature,
    maxTokens,
  } = params;

  // Claude Messages 协议
  if (protocol === 'claude') {
    // Claude API 要求必填 max_tokens；未设置时用一个保守上限兜底
    const body: any = {
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: maxTokens ?? 4096,
    };
    if (claudeSupportsSamplingParams(model) && temperature !== undefined) {
      body.temperature = temperature;
    }

    const response = await fetch(`${normalizeClaudeBaseURL(baseURL)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`AI API调用失败: ${response.status}`);
    }

    const data = await response.json();
    return (data.content || [])
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || '')
      .join('');
  }

  // OpenAI Responses 协议（/responses）
  if (protocol === 'openai-responses') {
    const responsesBody: any = {
      model,
      instructions: systemPrompt,
      input: [
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
      ],
    };
    if (maxTokens !== undefined) responsesBody.max_output_tokens = maxTokens;
    if (temperature !== undefined) responsesBody.temperature = temperature;

    const response = await fetch(`${normalizeApiBaseUrl(baseURL)}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(responsesBody),
    });

    if (!response.ok) {
      throw new Error(`AI API调用失败: ${response.status}`);
    }

    const data = await response.json();
    // 优先使用便捷字段，否则从 output 数组中提取 output_text
    if (typeof data.output_text === 'string' && data.output_text) {
      return data.output_text;
    }
    return (data.output || [])
      .filter((item: any) => item.type === 'message')
      .flatMap((item: any) => item.content || [])
      .filter((c: any) => c.type === 'output_text')
      .map((c: any) => c.text || '')
      .join('');
  }

  // OpenAI Chat Completions 协议（默认，兼容旧版自定义 API）
  const completionsBody: any = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (temperature !== undefined) completionsBody.temperature = temperature;
  if (maxTokens !== undefined) completionsBody.max_tokens = maxTokens;

  const response = await fetch(
    `${normalizeApiBaseUrl(baseURL)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(completionsBody),
    }
  );

  if (!response.ok) {
    throw new Error(`AI API调用失败: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

interface CommentData {
  content: string;
  rating: number | null;
  sentiment: 'positive' | 'neutral' | 'negative';
}

// 生成评论的Prompt
function buildCommentPrompt(
  movieName: string,
  movieInfo?: string,
  searchResults?: string,
  count: number = 10
): string {
  return `你是一个影评生成助手。请生成真实自然的观众评论。

影片：${movieName}
${movieInfo ? `简介：${movieInfo}` : ''}
${searchResults ? `\n网络评价参考：\n${searchResults}` : ''}

任务要求：
1. 生成${count}条观众评论
2. 每条评论50-200字，口语化、自然
3. 观点多样化：有好评、中评、差评，比例大约6:3:1
4. 可以包含：
   - 个人观影感受和情感共鸣
   - 对演员演技的评价
   - 对剧情、节奏、画面的看法
   - 与其他作品的对比
   - 推荐或不推荐的理由
5. 避免：
   - 过于专业的影评术语
   - 千篇一律的表达
   - 明显的AI痕迹
   - 重复的内容

请直接输出JSON数组格式，不要有其他文字：
[
  {
    "content": "评论内容",
    "rating": 4,
    "sentiment": "positive"
  }
]

注意：rating为1-5的整数或null（表示未评分），sentiment为positive/neutral/negative之一。`;
}

// 联网搜索影片资料
async function searchMovieInfo(
  movieName: string,
  aiConfig: GenerateCommentsParams['aiConfig']
): Promise<string> {
  if (!aiConfig.EnableWebSearch) {
    return '';
  }

  try {
    const provider = getWebSearchProvider(aiConfig);
    let searchResults = '';

    if (provider === 'parallel') {
      return (await callParallelSearch('web_search', { objective: movieName + ' 影评 评价', search_queries: [movieName + ' 影评 评价'] }, createSearchContext())).slice(0, 1000);
    }
    if (provider === 'tavily' && aiConfig.TavilyApiKey) {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: aiConfig.TavilyApiKey,
          query: `${movieName} 影评 评价`,
          max_results: 5,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        searchResults = data.results
          ?.map((r: any) => r.content)
          .join('\n')
          .slice(0, 1000);
      }
    } else if (provider === 'serper' && aiConfig.SerperApiKey) {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': aiConfig.SerperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: `${movieName} 影评 评价`,
          num: 5,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        searchResults = data.organic
          ?.map((r: any) => r.snippet)
          .join('\n')
          .slice(0, 1000);
      }
    } else if (provider === 'serpapi' && aiConfig.SerpApiKey) {
      const response = await fetch(
        `https://serpapi.com/search?q=${encodeURIComponent(movieName + ' 影评 评价')}&api_key=${aiConfig.SerpApiKey}&num=5`
      );

      if (response.ok) {
        const data = await response.json();
        searchResults = data.organic_results
          ?.map((r: any) => r.snippet)
          .join('\n')
          .slice(0, 1000);
      }
    } else if (provider === 'bing') {
      const response = await fetch(
        `https://www.bing.com/search?format=rss&q=${encodeURIComponent(movieName + ' 影评 评价')}`,
        {
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'Mozilla/5.0 (compatible; MoonTVPlusBot/1.0)',
          },
        }
      );
      if (response.ok) {
        const parsed = await parseStringPromise(await response.text(), { trim: true });
        const items = parsed?.rss?.channel?.[0]?.item || [];
        searchResults = items
          .slice(0, 5)
          .map((item: any) => item.description?.[0] || '')
          .join('\n')
          .slice(0, 1000);
      }
    }

    return searchResults;
  } catch (error) {
    console.error('搜索影片资料失败:', error);
    return '';
  }
}

// 调用AI生成评论
export async function generateAIComments(
  params: GenerateCommentsParams
): Promise<AIComment[]> {
  const { movieName, movieInfo, count = 10, aiConfig } = params;

  try {
    let content: string;

    if (params.useToolMode) {
      // 工具式调用：不预抓取，由模型自主决定是否调用工具收集素材。
      // 跑完整 agent 循环（非流式），累积文本后再抽取 JSON。
      const prompt = buildCommentPrompt(movieName, movieInfo, undefined, count);
      const dataSources: ToolDataSources = params.toolDataSources || {};
      const result = await runToolAgent({
        protocol: params.protocol,
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        model: params.model,
        maxTokens: aiConfig.MaxTokens,
        temperature: aiConfig.Temperature,
        maxContext: aiConfig.MaxContext ?? 131072,
        compressThreshold: aiConfig.CompressThreshold ?? 90,
        streaming: false,
        systemPrompt: COMMENT_TOOL_SYSTEM_PROMPT,
        history: [],
        message: prompt,
        tools: buildAgentTools(dataSources),
        dataSources,
      });
      content = result.kind === 'json' ? result.content : '';
    } else {
      // 单轮直调：先按需预抓取网络评价，再一次性生成
      const searchResults = await searchMovieInfo(movieName, aiConfig);
      const prompt = buildCommentPrompt(movieName, movieInfo, searchResults, count);
      content = await callAIForComments({
        protocol: params.protocol,
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        model: params.model,
        systemPrompt:
          '你是一个专业的影评生成助手，擅长生成真实自然的观众评论。',
        userPrompt: prompt,
        temperature: aiConfig.Temperature,
        maxTokens: aiConfig.MaxTokens,
      });
    }

    if (!content) {
      throw new Error('AI返回内容为空');
    }

    // 4. 解析AI返回的JSON
    let commentsData: CommentData[];
    try {
      // 尝试提取JSON（可能被markdown代码块包裹）
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        commentsData = JSON.parse(jsonMatch[0]);
      } else {
        commentsData = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('解析AI返回的JSON失败:', content);
      throw new Error('AI返回格式错误');
    }

    // 5. 转换为AIComment格式
    const aiComments: AIComment[] = commentsData.map((comment, index) => {
      const timestamp = Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000; // 随机过去30天内
      const date = new Date(timestamp);

      return {
        id: `ai-${Date.now()}-${index}`,
        userName: generateUserName(index),
        userAvatar: generateAvatar(index),
        rating: comment.rating,
        content: comment.content,
        time: formatTime(date),
        votes: generateVotes(comment.sentiment),
        isAiGenerated: true,
      };
    });

    return aiComments;
  } catch (error) {
    console.error('AI评论生成失败:', error);
    throw error;
  }
}

// 生成虚拟用户名
function generateUserName(index: number): string {
  const prefixes = [
    '影迷',
    '观众',
    '电影爱好者',
    '剧迷',
    '路人',
    '网友',
    '看客',
  ];
  const prefix = prefixes[index % prefixes.length];
  return `${prefix}${Math.floor(Math.random() * 9000) + 1000}`;
}

// 生成头像URL（使用DiceBear API）
function generateAvatar(seed: number): string {
  const styles = ['avataaars', 'bottts', 'personas', 'micah'];
  const style = styles[seed % styles.length];
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`;
}

// 格式化时间
function formatTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 根据情感生成点赞数
function generateVotes(sentiment: string): number {
  if (sentiment === 'positive') {
    return Math.floor(Math.random() * 100) + 20; // 20-120
  } else if (sentiment === 'neutral') {
    return Math.floor(Math.random() * 50) + 5; // 5-55
  } else {
    return Math.floor(Math.random() * 30); // 0-30
  }
}
