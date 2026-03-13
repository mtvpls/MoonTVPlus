/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { orchestrateDataSources, VideoContext } from '@/lib/ai-orchestrator';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  message: string;
  context?: VideoContext;
  history?: ChatMessage[];
}

/**
 * OpenAI兼容的流式聊天请求
 */
async function streamOpenAIChat(
  messages: ChatMessage[],
  config: {
    apiKey: string;
    baseURL: string;
    model: string;
    temperature: number;
    maxTokens: number;
  },
  enableStreaming = true,
): Promise<ReadableStream | Response> {
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: enableStreaming,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI API error: ${response.status} ${response.statusText}`,
    );
  }

  return enableStreaming ? response.body! : response;
}

/**
 * 转换流为SSE格式
 */
function transformToSSE(
  stream: ReadableStream,
  provider: 'openai' | 'claude' | 'custom',
): ReadableStream {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      let buffer = ''; // 缓冲区，用于保存不完整的行
      let contentBuffer = ''; // 累积的内容，用于处理跨chunk的thinking标签
      let inThinkingBlock = false; // 是否在thinking块内

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // 将新chunk与缓冲区拼接
          const text = buffer + chunk;
          // 按换行符分割，最后一个元素可能是不完整的行
          const parts = text.split('\n');
          // 保存最后一个不完整的行到缓冲区
          buffer = parts.pop() || '';

          // 处理完整的行
          const lines = parts.filter((line) => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();

              // 跳过空数据
              if (!data) {
                continue;
              }

              if (data === '[DONE]') {
                controller.enqueue(
                  new TextEncoder().encode('data: [DONE]\n\n'),
                );
                continue;
              }

              try {
                const json = JSON.parse(data);

                // 提取文本内容
                let text = '';
                if (provider === 'claude') {
                  // Claude格式
                  if (json.type === 'content_block_delta') {
                    text = json.delta?.text || '';
                  }
                } else {
                  // OpenAI格式
                  text = json.choices?.[0]?.delta?.content || '';
                }

                if (text) {
                  // 累积内容并处理thinking标签
                  contentBuffer += text;

                  // 检查是否进入thinking块
                  if (contentBuffer.includes('<think>')) {
                    inThinkingBlock = true;
                  }

                  // 检查是否退出thinking块
                  if (inThinkingBlock && contentBuffer.includes('</think>')) {
                    // 移除thinking块内容
                    contentBuffer = contentBuffer.replace(
                      /<think>[\s\S]*?<\/think>/g,
                      '',
                    );
                    inThinkingBlock = false;
                  }

                  // 只有在不在thinking块内时才输出内容
                  if (!inThinkingBlock) {
                    // 输出非thinking部分的内容
                    const outputText = contentBuffer;
                    if (outputText) {
                      controller.enqueue(
                        new TextEncoder().encode(
                          `data: ${JSON.stringify({ text: outputText })}\n\n`,
                        ),
                      );
                      contentBuffer = ''; // 清空已输出的内容
                    }
                  }
                }
              } catch (e) {
                // 只在非空数据解析失败时打印错误
                if (data.length > 0) {
                  console.error(
                    'Parse stream chunk error:',
                    e,
                    'Data:',
                    data.substring(0, 100),
                  );
                }
              }
            }
          }
        }

        // 处理缓冲区中剩余的数据
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data && data !== '[DONE]') {
              try {
                const json = JSON.parse(data);
                let text = '';
                if (provider === 'claude') {
                  if (json.type === 'content_block_delta') {
                    text = json.delta?.text || '';
                  }
                } else {
                  text = json.choices?.[0]?.delta?.content || '';
                }
                if (text) {
                  contentBuffer += text;
                  // 最后清理一次thinking标签
                  contentBuffer = contentBuffer.replace(
                    /<think>[\s\S]*?<\/think>/g,
                    '',
                  );
                  if (contentBuffer) {
                    controller.enqueue(
                      new TextEncoder().encode(
                        `data: ${JSON.stringify({ text: contentBuffer })}\n\n`,
                      ),
                    );
                  }
                }
              } catch (e) {
                console.error('Parse final buffer error:', e);
              }
            }
          }
        }
      } catch (error) {
        console.error('Stream error:', error);
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    // 1. 验证用户登录
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. 获取AI配置
    const adminConfig = await getConfig();
    const aiConfig = adminConfig.AIConfig;

    if (!aiConfig || !aiConfig.Enabled) {
      return NextResponse.json({ error: 'AI功能未启用' }, { status: 400 });
    }

    // 3. 权限检查：如果不允许普通用户使用，检查用户角色
    if (!aiConfig.AllowRegularUsers) {
      const username = authInfo.username;
      // 站长始终有权限
      if (username !== process.env.USERNAME) {
        // 检查是否为管理员
        const userInfo = await db.getUserInfoV2(username);
        if (
          !userInfo ||
          (userInfo.role !== 'admin' && userInfo.role !== 'owner') ||
          userInfo.banned
        ) {
          return NextResponse.json(
            { error: '该功能仅限站长和管理员使用' },
            { status: 403 },
          );
        }
      }
    }

    // 4. 解析请求参数
    const body = (await request.json()) as ChatRequest;
    const { message, context, history = [] } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 });
    }

    console.log('📨 收到AI聊天请求:', {
      message: message.slice(0, 50),
      context,
      historyLength: history.length,
    });

    // 4. 使用orchestrator协调数据源
    const orchestrationResult = await orchestrateDataSources(message, context, {
      enableWebSearch: aiConfig.EnableWebSearch,
      webSearchProvider: aiConfig.WebSearchProvider,
      tavilyApiKey: aiConfig.TavilyApiKey,
      serperApiKey: aiConfig.SerperApiKey,
      serpApiKey: aiConfig.SerpApiKey,
      // TMDB 配置
      tmdbApiKey: adminConfig.SiteConfig.TMDBApiKey,
      tmdbProxy: adminConfig.SiteConfig.TMDBProxy,
      tmdbReverseProxy: adminConfig.SiteConfig.TMDBReverseProxy,
      // 决策模型配置（固定使用自定义provider，复用主模型的API配置）
      enableDecisionModel: aiConfig.EnableDecisionModel,
      decisionProvider: 'custom',
      decisionApiKey: aiConfig.CustomApiKey,
      decisionBaseURL: aiConfig.CustomBaseURL,
      decisionModel: aiConfig.DecisionCustomModel,
    });

    console.log(
      '🎯 数据协调完成, systemPrompt长度:',
      orchestrationResult.systemPrompt.length,
    );

    // 5. 构建消息列表
    const systemPrompt = aiConfig.SystemPrompt
      ? `${aiConfig.SystemPrompt}\n\n${orchestrationResult.systemPrompt}`
      : orchestrationResult.systemPrompt;

    const messages: ChatMessage[] = [
      { role: 'user', content: systemPrompt },
      { role: 'assistant', content: '明白了，我会按照要求回答用户的问题。' },
      ...history,
      { role: 'user', content: message },
    ];

    // 6. 调用自定义API
    const temperature = aiConfig.Temperature ?? 0.7;
    const maxTokens = aiConfig.MaxTokens ?? 1000;
    const enableStreaming = aiConfig.EnableStreaming !== false; // 默认启用流式响应

    if (!aiConfig.CustomApiKey || !aiConfig.CustomBaseURL) {
      return NextResponse.json(
        { error: '自定义API配置不完整' },
        { status: 400 },
      );
    }

    const result = await streamOpenAIChat(
      messages,
      {
        apiKey: aiConfig.CustomApiKey,
        baseURL: aiConfig.CustomBaseURL,
        model: aiConfig.CustomModel || 'gpt-3.5-turbo',
        temperature,
        maxTokens,
      },
      enableStreaming,
    );

    // 7. 根据是否启用流式响应返回不同格式
    if (enableStreaming) {
      // 流式响应：转换为SSE格式并返回
      const sseStream = transformToSSE(result as ReadableStream, 'openai');

      return new NextResponse(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } else {
      // 非流式响应：等待完整响应后返回JSON
      const response = result as Response;
      const data = await response.json();
      let content = data.choices?.[0]?.message?.content || '';

      // 移除thinking标签内容
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '');

      return NextResponse.json({ content });
    }
  } catch (error) {
    console.error('❌ AI聊天API错误:', error);
    return NextResponse.json(
      {
        error: 'AI聊天请求失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
