/* eslint-disable @typescript-eslint/no-explicit-any */

import { SourceAdapterFactory, SourceConfig } from './adapters/source-adapter';
import { SearchResult } from './types';

/**
 * 源管理器
 * 统一管理所有视频源的搜索、详情获取等操作
 * 使用适配器模式支持多种源类型
 */
export class SourceManager {
  /**
   * 从单个源搜索视频
   */
  static async searchFromSource(
    sourceConfig: SourceConfig,
    query: string
  ): Promise<SearchResult[]> {
    try {
      const adapter = await SourceAdapterFactory.getAdapter(sourceConfig);
      return await adapter.search(query);
    } catch (error) {
      console.error(`源 ${sourceConfig.name} 搜索失败:`, error);
      return [];
    }
  }

  /**
   * 从多个源并行搜索
   */
  static async searchFromMultipleSources(
    sources: SourceConfig[],
    query: string
  ): Promise<SearchResult[]> {
    const promises = sources.map(source =>
      this.searchFromSource(source, query)
    );

    const results = await Promise.all(promises);

    // 合并所有结果
    return results.flat();
  }

  /**
   * 获取视频详情
   */
  static async getDetail(
    sourceConfig: SourceConfig,
    id: string
  ): Promise<SearchResult> {
    const adapter = await SourceAdapterFactory.getAdapter(sourceConfig);
    return await adapter.getDetail(id);
  }

  /**
   * 获取播放地址
   */
  static async getPlayUrl(
    sourceConfig: SourceConfig,
    id: string,
    episodeIndex: number
  ): Promise<string> {
    const adapter = await SourceAdapterFactory.getAdapter(sourceConfig);
    return await adapter.getPlayUrl(id, episodeIndex);
  }

  /**
   * 检查源是否需要认证
   */
  static needsAuth(sourceConfig: SourceConfig): boolean {
    return sourceConfig.sourceType === 'quark' || sourceConfig.sourceType === 'ali';
  }

  /**
   * 检查源是否已认证
   */
  static async isAuthenticated(sourceConfig: SourceConfig): Promise<boolean> {
    if (!this.needsAuth(sourceConfig)) {
      return true;
    }

    try {
      const adapter = await SourceAdapterFactory.getAdapter(sourceConfig);
      return await adapter.isAuthenticated();
    } catch (error) {
      return false;
    }
  }

  /**
   * 清除适配器缓存
   */
  static clearCache(key?: string) {
    SourceAdapterFactory.clearCache(key);
  }
}
