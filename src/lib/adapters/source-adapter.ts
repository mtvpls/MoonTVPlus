/* eslint-disable @typescript-eslint/no-explicit-any */

import { SearchResult } from '../types';

/**
 * 源适配器接口
 * 定义所有视频源必须实现的标准接口
 */
export interface SourceAdapter {
  /**
   * 适配器类型
   */
  readonly type: 'applecms' | 'quark' | 'ali';

  /**
   * 适配器名称
   */
  readonly name: string;

  /**
   * 初始化适配器
   * @param config 源配置信息
   */
  init(config: SourceConfig): Promise<void>;

  /**
   * 搜索视频
   * @param query 搜索关键词
   * @returns 搜索结果列表
   */
  search(query: string): Promise<SearchResult[]>;

  /**
   * 获取视频详情
   * @param id 视频ID
   * @returns 视频详情
   */
  getDetail(id: string): Promise<SearchResult>;

  /**
   * 获取播放地址
   * @param id 视频ID
   * @param episodeIndex 集数索引
   * @returns 播放地址
   */
  getPlayUrl(id: string, episodeIndex: number): Promise<string>;

  /**
   * 检查适配器是否已认证（对于需要认证的源）
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * 刷新认证令牌（对于需要认证的源）
   */
  refreshAuth?(): Promise<void>;
}

/**
 * 源配置接口
 */
export interface SourceConfig {
  key: string;
  name: string;
  api: string;
  sourceType: 'applecms' | 'quark' | 'ali';
  detail?: string;

  // 认证信息（用于网盘源）
  auth?: {
    token?: string;
    cookie?: string;
    refreshToken?: string;
    userId?: string;
  };

  // 扩展配置
  ext?: string | Record<string, any>;
}

/**
 * 适配器工厂
 * 根据源类型创建对应的适配器实例
 */
export class SourceAdapterFactory {
  private static adapters: Map<string, SourceAdapter> = new Map();

  /**
   * 创建或获取适配器实例
   */
  static async getAdapter(config: SourceConfig): Promise<SourceAdapter> {
    const cacheKey = `${config.sourceType}_${config.key}`;

    if (this.adapters.has(cacheKey)) {
      return this.adapters.get(cacheKey)!;
    }

    let adapter: SourceAdapter;

    switch (config.sourceType) {
      case 'applecms':
        const { AppleCmsAdapter } = await import('./applecms-adapter');
        adapter = new AppleCmsAdapter();
        break;

      case 'quark':
        const { QuarkDriveAdapter } = await import('./quark-adapter');
        adapter = new QuarkDriveAdapter();
        break;

      case 'ali':
        throw new Error('阿里云盘适配器暂未实现');

      default:
        throw new Error(`不支持的源类型: ${config.sourceType}`);
    }

    await adapter.init(config);
    this.adapters.set(cacheKey, adapter);

    return adapter;
  }

  /**
   * 清除适配器缓存
   */
  static clearCache(key?: string) {
    if (key) {
      this.adapters.delete(key);
    } else {
      this.adapters.clear();
    }
  }
}
