import { NextRequest, NextResponse } from 'next/server';

import {
  AIComment,
  AICommentProtocol,
  generateAIComments,
} from '@/lib/ai-comment-generator';
import { ToolDataSources } from '@/lib/ai-tool-agent';
import { getConfig } from '@/lib/config';
import { resolveWebSearch } from '@/lib/web-search-config';

export const runtime = 'nodejs';

// 根据 AIConfig 解析出评论生成实际使用的协议与凭据，
// 与首页 AI 助手（/api/ai/chat）保持一致，兼容新版 AI 方式。
function resolveAICredentials(aiConfig: any): {
  protocol: AICommentProtocol;
  apiKey: string;
  baseURL: string;
  model: string;
} {
  // 新版（工具式调用）：由管理员开启，凭据存于 OpenAI/Claude 字段
  if (aiConfig.EnableNewMode) {
    const protocol: AICommentProtocol =
      aiConfig.NewProtocol === 'openai-responses' ||
      aiConfig.NewProtocol === 'claude'
        ? aiConfig.NewProtocol
        : 'openai-completions';

    if (protocol === 'claude') {
      return {
        protocol,
        apiKey: aiConfig.ClaudeApiKey || '',
        baseURL: aiConfig.ClaudeBaseURL || 'https://api.anthropic.com',
        model: aiConfig.ClaudeModel || '',
      };
    }

    return {
      protocol,
      apiKey: aiConfig.OpenAIApiKey || aiConfig.CustomApiKey || '',
      baseURL: aiConfig.OpenAIBaseURL || aiConfig.CustomBaseURL || '',
      model: aiConfig.OpenAIModel || aiConfig.CustomModel || '',
    };
  }

  // 旧版：使用自定义（OpenAI 兼容）字段
  return {
    protocol: 'openai-completions',
    apiKey: aiConfig.CustomApiKey || '',
    baseURL: aiConfig.CustomBaseURL || '',
    model: aiConfig.CustomModel || '',
  };
}

interface AICommentsResponse {
  comments: AIComment[];
  total: number;
  movieName: string;
  isAiGenerated: true;
  generatedAt: string;
}

export async function GET(request: NextRequest) {
  // 流式返回一个普通 JSON：生成期间持续发送空白字符作为心跳，避免长耗时
  // 的阻塞请求被网关（Cloudflare/nginx）按读超时断开导致响应体为空。
  // JSON 解析会忽略前导空白，因此整体仍是合法 JSON——结果或错误对象在最后
  // 一次性写出，前端照常 response.json() 即可。
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 控制器已关闭（客户端断开等），忽略
        }
      };
      // 最终结果/错误：整个响应体只写出这一个 JSON 值
      const send = (obj: unknown) => enqueue(JSON.stringify(obj));
      // 心跳：仅写出空白字符（JSON 前导空白会被解析器忽略）
      const ping = () => enqueue(' ');

      try {
        // 立即刷出一个空白，尽快拿到首字节、建立连接
        enqueue(' ');

        const searchParams = request.nextUrl.searchParams;
        const movieName = searchParams.get('name');
        const movieInfo = searchParams.get('info');
        const count = parseInt(searchParams.get('count') || '10');

        // 参数验证
        if (!movieName) {
          send({ error: '缺少影片名称参数' });
          return;
        }
        if (count < 1 || count > 50) {
          send({ error: '评论数量必须在1-50之间' });
          return;
        }

        // 读取AI配置
        const config = await getConfig();
        const aiConfig = config.AIConfig;

        if (!aiConfig?.Enabled) {
          send({ error: 'AI功能未启用' });
          return;
        }
        if (!aiConfig?.EnableAIComments) {
          send({ error: 'AI评论功能未启用' });
          return;
        }

        // 解析实际使用的协议与凭据（兼容新版 AI 方式）
        const credentials = resolveAICredentials(aiConfig);
        if (!credentials.apiKey || !credentials.baseURL || !credentials.model) {
          send({ error: 'AI配置不完整，请在管理面板配置' });
          return;
        }

        // 是否走工具式调用（由管理员在面板开启）
        const useToolMode = !!aiConfig.EnableAICommentsToolMode;

        // 工具式调用所需的数据源（联网搜索 + TMDB），与 /api/ai/chat 保持一致
        let toolDataSources: ToolDataSources | undefined;
        if (useToolMode) {
          const usableWebSearch = resolveWebSearch(aiConfig);

          toolDataSources = {
            webSearch: usableWebSearch,
            tmdb: config.SiteConfig?.TMDBApiKey
              ? {
                  apiKey: config.SiteConfig.TMDBApiKey,
                  proxy: config.SiteConfig.TMDBProxy,
                  reverseProxy: config.SiteConfig.TMDBReverseProxy,
                }
              : undefined,
          };
        }

        // 生成期间定期心跳，保持连接不被网关断开
        heartbeat = setInterval(ping, 15000);

        // 生成AI评论
        const comments = await generateAIComments({
          movieName,
          movieInfo: movieInfo || undefined,
          count,
          protocol: credentials.protocol,
          apiKey: credentials.apiKey,
          baseURL: credentials.baseURL,
          model: credentials.model,
          useToolMode,
          toolDataSources,
          aiConfig: {
            Temperature: aiConfig.Temperature,
            MaxTokens: aiConfig.MaxTokens,
            MaxContext: aiConfig.MaxContext,
            CompressThreshold: aiConfig.CompressThreshold,
            EnableWebSearch: aiConfig.EnableWebSearch,
            WebSearchProvider: aiConfig.WebSearchProvider,
            TavilyApiKey: aiConfig.TavilyApiKey,
            SerperApiKey: aiConfig.SerperApiKey,
            SerpApiKey: aiConfig.SerpApiKey,
          },
        });

        const payload: AICommentsResponse = {
          comments,
          total: comments.length,
          movieName,
          isAiGenerated: true,
          generatedAt: new Date().toISOString(),
        };
        send(payload);
      } catch (error) {
        console.error('AI评论生成失败:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'AI评论生成失败';
        send({ error: errorMessage });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // 已关闭，忽略
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // 关闭 nginx 缓冲，确保心跳空白即时刷出
      'X-Accel-Buffering': 'no',
    },
  });
}
