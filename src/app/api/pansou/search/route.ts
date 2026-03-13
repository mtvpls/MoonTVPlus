/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { PansouLink, searchPansou } from '@/lib/pansou.client';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { keyword } = body;

    if (!keyword) {
      return NextResponse.json({ error: '关键词不能为空' }, { status: 400 });
    }

    // 从系统配置中获取 Pansou 配置
    const config = await getConfig();
    const apiUrl = config.SiteConfig.PansouApiUrl;
    const username = config.SiteConfig.PansouUsername;
    const password = config.SiteConfig.PansouPassword;

    console.log('Pansou 搜索请求:', {
      keyword,
      apiUrl: apiUrl ? '已配置' : '未配置',
      hasAuth: !!(username && password),
    });

    if (!apiUrl) {
      return NextResponse.json(
        { error: '未配置 Pansou API 地址，请在管理面板配置' },
        { status: 400 },
      );
    }

    // 调用 Pansou 搜索
    const results = await searchPansou(apiUrl, keyword, {
      username,
      password,
    });

    const rawBlocklist = config.SiteConfig.PansouKeywordBlocklist || '';
    const normalizedBlocklist = rawBlocklist.replace(/，/g, ',');
    const blockedKeywords = normalizedBlocklist
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    let filteredResults = results;

    if (blockedKeywords.length > 0 && results.merged_by_type) {
      const mergedByType: Record<string, PansouLink[]> = {};
      let total = 0;

      const shouldBlock = (link: PansouLink) => {
        const content =
          `${link.note || ''} ${link.url || ''} ${link.source || ''}`.toLowerCase();
        return blockedKeywords.some((item) =>
          content.includes(item.toLowerCase()),
        );
      };

      Object.entries(results.merged_by_type).forEach(([type, links]) => {
        const filteredLinks = links.filter((link) => !shouldBlock(link));
        if (filteredLinks.length > 0) {
          mergedByType[type] = filteredLinks;
          total += filteredLinks.length;
        }
      });

      filteredResults = {
        ...results,
        merged_by_type: mergedByType,
        total,
      };
    }

    console.log('Pansou 搜索结果:', {
      total: filteredResults.total,
      hasData: !!filteredResults.merged_by_type,
      types: filteredResults.merged_by_type
        ? Object.keys(filteredResults.merged_by_type)
        : [],
    });

    return NextResponse.json(filteredResults);
  } catch (error: any) {
    console.error('Pansou 搜索失败:', error);
    return NextResponse.json(
      { error: error.message || '搜索失败' },
      { status: 500 },
    );
  }
}
