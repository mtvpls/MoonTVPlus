import { NextRequest, NextResponse } from 'next/server';

import { generateAIComments, AIComment } from '@/lib/ai-comment-generator';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

interface AICommentsResponse {
  comments: AIComment[];
  total: number;
  movieName: string;
  isAiGenerated: true;
  generatedAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const movieName = searchParams.get('name');
    const movieInfo = searchParams.get('info');
    const count = parseInt(searchParams.get('count') || '10');

    // 参数验证
    if (!movieName) {
      return NextResponse.json(
        { error: '缺少影片名称参数' },
        { status: 400 }
      );
    }

    if (count < 1 || count > 50) {
      return NextResponse.json(
        { error: '评论数量必须在1-50之间' },
        { status: 400 }
      );
    }

    // 读取AI配置
    const config = await getConfig();
    const aiConfig = config.AIConfig;

    // 检查AI功能是否启用
    if (!aiConfig?.Enabled) {
      return NextResponse.json(
        { error: 'AI功能未启用' },
        { status: 403 }
      );
    }

    // 检查AI评论功能是否启用
    if (!aiConfig?.EnableAIComments) {
      return NextResponse.json(
        { error: 'AI评论功能未启用' },
        { status: 403 }
      );
    }

    // 检查必要的配置
    if (!aiConfig.CustomApiKey || !aiConfig.CustomBaseURL || !aiConfig.CustomModel) {
      return NextResponse.json(
        { error: 'AI配置不完整，请在管理面板配置' },
        { status: 500 }
      );
    }

    // 生成AI评论
    const comments = await generateAIComments({
      movieName,
      movieInfo: movieInfo || undefined,
      count,
      aiConfig: {
        CustomApiKey: aiConfig.CustomApiKey,
        CustomBaseURL: aiConfig.CustomBaseURL,
        CustomModel: aiConfig.CustomModel,
        Temperature: aiConfig.Temperature,
        MaxTokens: aiConfig.MaxTokens,
        EnableWebSearch: aiConfig.EnableWebSearch,
        WebSearchProvider: aiConfig.WebSearchProvider,
        TavilyApiKey: aiConfig.TavilyApiKey,
        SerperApiKey: aiConfig.SerperApiKey,
        SerpApiKey: aiConfig.SerpApiKey,
      },
    });

    // 返回结果
    const response: AICommentsResponse = {
      comments,
      total: comments.length,
      movieName,
      isAiGenerated: true,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('AI评论生成失败:', error);

    // 返回友好的错误信息
    const errorMessage = error instanceof Error ? error.message : 'AI评论生成失败';

    return NextResponse.json(
      {
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}
