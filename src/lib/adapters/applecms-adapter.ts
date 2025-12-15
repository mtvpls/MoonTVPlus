/* eslint-disable @typescript-eslint/no-explicit-any */

import { SourceAdapter, SourceConfig } from './source-adapter';
import { SearchResult } from '../types';
import { cleanHtmlTags } from '../utils';

/**
 * 苹果 CMS API 配置
 */
const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

/**
 * 苹果 CMS API 返回的视频项
 */
interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

/**
 * M3U8 链接匹配正则
 */
const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

/**
 * 苹果 CMS 适配器
 * 支持标准的苹果 CMS V10 API 格式
 */
export class AppleCmsAdapter implements SourceAdapter {
  readonly type = 'applecms' as const;
  readonly name = '苹果CMS';

  private config!: SourceConfig;

  async init(config: SourceConfig): Promise<void> {
    this.config = config;
  }

  async isAuthenticated(): Promise<boolean> {
    // 苹果CMS不需要认证
    return true;
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const apiBaseUrl = this.config.api;
      const apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);

      // 获取第一页数据
      const firstPageResult = await this.searchWithCache(query, 1, apiUrl);
      const results = firstPageResult.results;

      // 这里简化处理，只获取第一页
      // 完整实现可以参考原 downstream.ts 的多页逻辑

      return results;
    } catch (error) {
      console.error('苹果CMS搜索失败:', error);
      return [];
    }
  }

  async getDetail(id: string): Promise<SearchResult> {
    if (this.config.detail) {
      return this.handleSpecialSourceDetail(id);
    }

    const detailUrl = `${this.config.api}${API_CONFIG.detail.path}${id}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`详情请求失败: ${response.status}`);
    }

    const data = await response.json();

    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      throw new Error('获取到的详情内容无效');
    }

    const videoDetail = data.list[0];
    let episodes: string[] = [];
    let titles: string[] = [];

    // 处理播放源拆分
    if (videoDetail.vod_play_url) {
      const vod_play_url_array = videoDetail.vod_play_url.split('$$$');
      vod_play_url_array.forEach((url: string) => {
        const matchEpisodes: string[] = [];
        const matchTitles: string[] = [];
        const title_url_array = url.split('#');
        title_url_array.forEach((title_url: string) => {
          const episode_title_url = title_url.split('$');
          if (
            episode_title_url.length === 2 &&
            episode_title_url[1].endsWith('.m3u8')
          ) {
            matchTitles.push(episode_title_url[0]);
            matchEpisodes.push(episode_title_url[1]);
          }
        });
        if (matchEpisodes.length > episodes.length) {
          episodes = matchEpisodes;
          titles = matchTitles;
        }
      });
    }

    // 如果播放源为空，尝试从内容中解析 m3u8
    if (episodes.length === 0 && videoDetail.vod_content) {
      const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
      episodes = matches.map((link: string) => link.replace(/^\$/, ''));
    }

    return {
      id: id.toString(),
      title: videoDetail.vod_name,
      poster: videoDetail.vod_pic,
      episodes,
      episodes_titles: titles,
      source: this.config.key,
      source_name: this.config.name,
      class: videoDetail.vod_class,
      year: videoDetail.vod_year
        ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
        : 'unknown',
      desc: cleanHtmlTags(videoDetail.vod_content),
      type_name: videoDetail.type_name,
      douban_id: videoDetail.vod_douban_id,
    };
  }

  async getPlayUrl(id: string, episodeIndex: number): Promise<string> {
    // 对于苹果CMS，播放地址直接存储在 episodes 数组中
    const detail = await this.getDetail(id);
    if (episodeIndex < 0 || episodeIndex >= detail.episodes.length) {
      throw new Error('集数索引越界');
    }
    return detail.episodes[episodeIndex];
  }

  /**
   * 带缓存的搜索
   */
  private async searchWithCache(
    query: string,
    page: number,
    url: string,
    timeoutMs = 8000
  ): Promise<{ results: SearchResult[]; pageCount?: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: API_CONFIG.search.headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { results: [] };
      }

      const data = await response.json();
      if (
        !data ||
        !data.list ||
        !Array.isArray(data.list) ||
        data.list.length === 0
      ) {
        return { results: [] };
      }

      // 处理结果数据
      const allResults = data.list.map((item: ApiSearchItem) => {
        let episodes: string[] = [];
        let titles: string[] = [];

        // 使用正则表达式从 vod_play_url 提取 m3u8 链接
        if (item.vod_play_url) {
          const vod_play_url_array = item.vod_play_url.split('$$$');
          vod_play_url_array.forEach((url: string) => {
            const matchEpisodes: string[] = [];
            const matchTitles: string[] = [];
            const title_url_array = url.split('#');
            title_url_array.forEach((title_url: string) => {
              const episode_title_url = title_url.split('$');
              if (
                episode_title_url.length === 2 &&
                episode_title_url[1].endsWith('.m3u8')
              ) {
                matchTitles.push(episode_title_url[0]);
                matchEpisodes.push(episode_title_url[1]);
              }
            });
            if (matchEpisodes.length > episodes.length) {
              episodes = matchEpisodes;
              titles = matchTitles;
            }
          });
        }

        return {
          id: item.vod_id.toString(),
          title: item.vod_name.trim().replace(/\s+/g, ' '),
          poster: item.vod_pic,
          episodes,
          episodes_titles: titles,
          source: this.config.key,
          source_name: this.config.name,
          class: item.vod_class,
          year: item.vod_year
            ? item.vod_year.match(/\d{4}/)?.[0] || ''
            : 'unknown',
          desc: cleanHtmlTags(item.vod_content || ''),
          type_name: item.type_name,
          douban_id: item.vod_douban_id,
        };
      });

      // 过滤掉集数为 0 的结果
      const results = allResults.filter(
        (result: SearchResult) => result.episodes.length > 0
      );

      const pageCount = page === 1 ? data.pagecount || 1 : undefined;
      return { results, pageCount };
    } catch (error: any) {
      clearTimeout(timeoutId);
      return { results: [] };
    }
  }

  /**
   * 处理特殊源的详情（需要网页爬取）
   */
  private async handleSpecialSourceDetail(id: string): Promise<SearchResult> {
    const detailUrl = `${this.config.detail}/index.php/vod/detail/id/${id}.html`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`详情页请求失败: ${response.status}`);
    }

    const html = await response.text();
    let matches: string[] = [];

    if (this.config.key === 'ffzy') {
      const ffzyPattern =
        /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
      matches = html.match(ffzyPattern) || [];
    }

    if (matches.length === 0) {
      const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
      matches = html.match(generalPattern) || [];
    }

    // 去重并清理链接前缀
    matches = Array.from(new Set(matches)).map((link: string) => {
      link = link.substring(1); // 去掉开头的 $
      const parenIndex = link.indexOf('(');
      return parenIndex > 0 ? link.substring(0, parenIndex) : link;
    });

    // 根据 matches 数量生成剧集标题
    const episodes_titles = Array.from({ length: matches.length }, (_, i) =>
      (i + 1).toString()
    );

    // 提取标题
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const titleText = titleMatch ? titleMatch[1].trim() : '';

    // 提取描述
    const descMatch = html.match(
      /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/
    );
    const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

    // 提取封面
    const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
    const coverUrl = coverMatch ? coverMatch[0].trim() : '';

    // 提取年份
    const yearMatch = html.match(/>(\d{4})</);
    const yearText = yearMatch ? yearMatch[1] : 'unknown';

    return {
      id,
      title: titleText,
      poster: coverUrl,
      episodes: matches,
      episodes_titles,
      source: this.config.key,
      source_name: this.config.name,
      class: '',
      year: yearText,
      desc: descText,
      type_name: '',
      douban_id: 0,
    };
  }
}
