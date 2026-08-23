/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { normalizeApiBaseUrl } from '@/lib/url';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      Enabled,
      Provider,
      OpenAIApiKey,
      OpenAIBaseURL,
      OpenAIModel,
      ClaudeApiKey,
      ClaudeBaseURL,
      ClaudeModel,
      CustomApiKey,
      CustomBaseURL,
      CustomModel,
      EnableDecisionModel,
      DecisionProvider,
      DecisionOpenAIApiKey,
      DecisionOpenAIBaseURL,
      DecisionOpenAIModel,
      DecisionClaudeApiKey,
      DecisionClaudeModel,
      DecisionCustomApiKey,
      DecisionCustomBaseURL,
      DecisionCustomModel,
      EnableWebSearch,
      WebSearchProvider,
      TavilyApiKey,
      SerperApiKey,
      SerpApiKey,
      EnableNewMode,
      NewProtocol,
      MaxContext,
      CompressThreshold,
      EnableHomepageEntry,
      EnableVideoCardEntry,
      EnablePlayPageEntry,
      EnableAIComments,
      Temperature,
      MaxTokens,
      SystemPrompt,
      EnableStreaming,
      DefaultMessageNoVideo,
      DefaultMessageWithVideo,
    } = body as {
      Enabled: boolean;
      Provider: 'openai' | 'claude' | 'custom';
      OpenAIApiKey?: string;
      OpenAIBaseURL?: string;
      OpenAIModel?: string;
      ClaudeApiKey?: string;
      ClaudeBaseURL?: string;
      ClaudeModel?: string;
      CustomApiKey?: string;
      CustomBaseURL?: string;
      CustomModel?: string;
      EnableDecisionModel: boolean;
      DecisionProvider?: 'openai' | 'claude' | 'custom';
      DecisionOpenAIApiKey?: string;
      DecisionOpenAIBaseURL?: string;
      DecisionOpenAIModel?: string;
      DecisionClaudeApiKey?: string;
      DecisionClaudeModel?: string;
      DecisionCustomApiKey?: string;
      DecisionCustomBaseURL?: string;
      DecisionCustomModel?: string;
      EnableWebSearch: boolean;
      WebSearchProvider?: 'tavily' | 'serper' | 'serpapi' | 'bing';
      TavilyApiKey?: string;
      SerperApiKey?: string;
      SerpApiKey?: string;
      EnableNewMode?: boolean;
      NewProtocol?: 'openai-completions' | 'openai-responses' | 'claude';
      MaxContext?: number;
      CompressThreshold?: number;
      EnableHomepageEntry: boolean;
      EnableVideoCardEntry: boolean;
      EnablePlayPageEntry: boolean;
      EnableAIComments: boolean;
      Temperature?: number;
      MaxTokens?: number;
      SystemPrompt?: string;
      EnableStreaming?: boolean;
      DefaultMessageNoVideo?: string;
      DefaultMessageWithVideo?: string;
    };

    // 参数校验
    if (
      typeof Enabled !== 'boolean' ||
      (Provider !== undefined && !['openai', 'claude', 'custom'].includes(Provider)) ||
      (OpenAIApiKey !== undefined && typeof OpenAIApiKey !== 'string') ||
      (OpenAIBaseURL !== undefined && typeof OpenAIBaseURL !== 'string') ||
      (OpenAIModel !== undefined && typeof OpenAIModel !== 'string') ||
      (ClaudeApiKey !== undefined && typeof ClaudeApiKey !== 'string') ||
      (ClaudeBaseURL !== undefined && typeof ClaudeBaseURL !== 'string') ||
      (ClaudeModel !== undefined && typeof ClaudeModel !== 'string') ||
      (CustomApiKey !== undefined && typeof CustomApiKey !== 'string') ||
      (CustomBaseURL !== undefined && typeof CustomBaseURL !== 'string') ||
      (CustomModel !== undefined && typeof CustomModel !== 'string') ||
      typeof EnableDecisionModel !== 'boolean' ||
      (DecisionProvider !== undefined && !['openai', 'claude', 'custom'].includes(DecisionProvider)) ||
      (DecisionOpenAIApiKey !== undefined && typeof DecisionOpenAIApiKey !== 'string') ||
      (DecisionOpenAIBaseURL !== undefined && typeof DecisionOpenAIBaseURL !== 'string') ||
      (DecisionOpenAIModel !== undefined && typeof DecisionOpenAIModel !== 'string') ||
      (DecisionClaudeApiKey !== undefined && typeof DecisionClaudeApiKey !== 'string') ||
      (DecisionClaudeModel !== undefined && typeof DecisionClaudeModel !== 'string') ||
      (DecisionCustomApiKey !== undefined && typeof DecisionCustomApiKey !== 'string') ||
      (DecisionCustomBaseURL !== undefined && typeof DecisionCustomBaseURL !== 'string') ||
      (DecisionCustomModel !== undefined && typeof DecisionCustomModel !== 'string') ||
      typeof EnableWebSearch !== 'boolean' ||
      (WebSearchProvider !== undefined && !['tavily', 'serper', 'serpapi', 'bing'].includes(WebSearchProvider)) ||
      (TavilyApiKey !== undefined && typeof TavilyApiKey !== 'string') ||
      (SerperApiKey !== undefined && typeof SerperApiKey !== 'string') ||
      (SerpApiKey !== undefined && typeof SerpApiKey !== 'string') ||
      (EnableNewMode !== undefined && typeof EnableNewMode !== 'boolean') ||
      (NewProtocol !== undefined &&
        !['openai-completions', 'openai-responses', 'claude'].includes(NewProtocol)) ||
      (MaxContext !== undefined && (typeof MaxContext !== 'number' || MaxContext <= 0)) ||
      (CompressThreshold !== undefined &&
        (typeof CompressThreshold !== 'number' ||
          CompressThreshold < 0 ||
          CompressThreshold > 100)) ||
      typeof EnableHomepageEntry !== 'boolean' ||
      typeof EnableVideoCardEntry !== 'boolean' ||
      typeof EnablePlayPageEntry !== 'boolean' ||
      typeof EnableAIComments !== 'boolean' ||
      (Temperature !== undefined && typeof Temperature !== 'number') ||
      (MaxTokens !== undefined && typeof MaxTokens !== 'number') ||
      (SystemPrompt !== undefined && typeof SystemPrompt !== 'string') ||
      (EnableStreaming !== undefined && typeof EnableStreaming !== 'boolean')
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const adminConfig = await getConfig();

    // 权限校验 - 使用v2用户系统
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 更新缓存中的AI配置
    adminConfig.AIConfig = {
      Enabled,
      Provider,
      OpenAIApiKey,
      OpenAIBaseURL: normalizeApiBaseUrl(OpenAIBaseURL),
      OpenAIModel,
      ClaudeApiKey,
      ClaudeBaseURL: normalizeApiBaseUrl(ClaudeBaseURL),
      ClaudeModel,
      CustomApiKey,
      CustomBaseURL: normalizeApiBaseUrl(CustomBaseURL),
      CustomModel,
      EnableDecisionModel,
      DecisionProvider,
      DecisionOpenAIApiKey,
      DecisionOpenAIBaseURL: normalizeApiBaseUrl(DecisionOpenAIBaseURL),
      DecisionOpenAIModel,
      DecisionClaudeApiKey,
      DecisionClaudeModel,
      DecisionCustomApiKey,
      DecisionCustomBaseURL: normalizeApiBaseUrl(DecisionCustomBaseURL),
      DecisionCustomModel,
      EnableWebSearch,
      WebSearchProvider,
      TavilyApiKey,
      SerperApiKey,
      SerpApiKey,
      EnableNewMode,
      NewProtocol,
      MaxContext,
      CompressThreshold,
      EnableHomepageEntry,
      EnableVideoCardEntry,
      EnablePlayPageEntry,
      EnableAIComments,
      Temperature,
      MaxTokens,
      SystemPrompt,
      EnableStreaming,
      DefaultMessageNoVideo,
      DefaultMessageWithVideo,
    };

    // 写入数据库
    await db.saveAdminConfig(adminConfig);
    // 刷新内存缓存，确保后续 getConfig() 立即读到最新配置（与其他 admin 路由一致）
    const { setCachedConfig } = await import('@/lib/config');
    await setCachedConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 不缓存结果
        },
      }
    );
  } catch (error) {
    console.error('更新AI配置失败:', error);
    return NextResponse.json(
      {
        error: '更新AI配置失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
