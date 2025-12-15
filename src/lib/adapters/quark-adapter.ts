/* eslint-disable @typescript-eslint/no-explicit-any */

import { SourceAdapter, SourceConfig } from './source-adapter';
import { SearchResult } from '../types';

/**
 * 夸克网盘 API 配置
 */
const QUARK_API = {
  BASE_URL: 'https://drive-pc.quark.cn',
  // 文件搜索
  SEARCH: '/1/clouddrive/file/sort',
  // 获取文件列表
  LIST: '/1/clouddrive/file/sort',
  // 获取下载链接
  DOWNLOAD: '/1/clouddrive/file/download',
  // 获取分享详情
  SHARE_DETAIL: '/1/clouddrive/share/sharepage/detail',
  // 保存分享到网盘
  SHARE_SAVE: '/1/clouddrive/share/sharepage/save',
};

/**
 * 夸克网盘文件信息
 */
interface QuarkFile {
  fid: string;
  file_name: string;
  size: number;
  file_type: number; // 0=文件夹, 1=文件
  format_type: string; // video, audio, image 等
  created_at: number;
  updated_at: number;
  dir: boolean;
}

/**
 * 夸克网盘适配器
 * 支持通过夸克网盘分享链接或直接搜索网盘内容播放视频
 */
export class QuarkDriveAdapter implements SourceAdapter {
  readonly type = 'quark' as const;
  readonly name = '夸克网盘';

  private config!: SourceConfig;
  private cookie: string = '';
  private shareLinks: string[] = [];

  async init(config: SourceConfig): Promise<void> {
    this.config = config;

    // 解析配置
    if (config.auth?.cookie) {
      this.cookie = config.auth.cookie;
    }

    // 解析 ext 配置（可能包含分享链接）
    if (config.ext) {
      try {
        const extConfig = typeof config.ext === 'string'
          ? JSON.parse(config.ext)
          : config.ext;

        if (extConfig.cookie) {
          this.cookie = extConfig.cookie;
        }

        if (extConfig.shares && Array.isArray(extConfig.shares)) {
          this.shareLinks = extConfig.shares;
        }
      } catch (error) {
        console.error('解析夸克配置失败:', error);
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.cookie) {
      return false;
    }

    try {
      // 尝试获取文件列表来验证 cookie 是否有效
      const response = await this.fetchQuarkAPI(QUARK_API.LIST, {
        pdir_fid: '0',
        _page: 1,
        _size: 1,
      });

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // 方式1: 搜索分享链接中的内容
    if (this.shareLinks.length > 0) {
      for (const shareLink of this.shareLinks) {
        try {
          const shareResults = await this.searchInShare(shareLink, query);
          results.push(...shareResults);
        } catch (error) {
          console.error(`搜索分享链接失败: ${shareLink}`, error);
        }
      }
    }

    // 方式2: 如果已登录，搜索自己网盘中的内容
    if (await this.isAuthenticated()) {
      try {
        const myDriveResults = await this.searchInMyDrive(query);
        results.push(...myDriveResults);
      } catch (error) {
        console.error('搜索个人网盘失败:', error);
      }
    }

    return results;
  }

  /**
   * 在分享链接中搜索
   */
  private async searchInShare(shareLink: string, query: string): Promise<SearchResult[]> {
    // 从分享链接中提取 share_id
    const shareId = this.extractShareId(shareLink);
    if (!shareId) {
      throw new Error('无效的分享链接');
    }

    // 获取分享详情
    const shareDetail = await this.fetchQuarkAPI(QUARK_API.SHARE_DETAIL, {
      pwd_id: shareId,
      passcode: '', // 如果有密码，需要从配置中读取
    });

    if (!shareDetail.data || !shareDetail.data.list) {
      return [];
    }

    const files = shareDetail.data.list as QuarkFile[];

    // 过滤出包含关键词的视频文件/文件夹
    const matchedFiles = files.filter(file =>
      file.file_name.toLowerCase().includes(query.toLowerCase()) &&
      (file.format_type === 'video' || file.dir)
    );

    // 转换为 SearchResult 格式
    return matchedFiles.map(file => this.convertToSearchResult(file, shareId));
  }

  /**
   * 在个人网盘中搜索
   */
  private async searchInMyDrive(query: string): Promise<SearchResult[]> {
    const response = await this.fetchQuarkAPI(QUARK_API.SEARCH, {
      pdir_fid: '0',
      keyword: query,
      _page: 1,
      _size: 50,
    });

    if (!response.data || !response.data.list) {
      return [];
    }

    const files = response.data.list as QuarkFile[];

    // 过滤出视频文件
    const videoFiles = files.filter(file =>
      file.format_type === 'video' || file.dir
    );

    return videoFiles.map(file => this.convertToSearchResult(file));
  }

  async getDetail(id: string): Promise<SearchResult> {
    // ID 格式: fid 或 shareId:fid
    const [shareId, fid] = id.includes(':') ? id.split(':') : [null, id];

    if (shareId) {
      // 从分享链接获取详情
      return this.getShareDetail(shareId, fid);
    } else {
      // 从个人网盘获取详情
      return this.getMyDriveDetail(fid);
    }
  }

  private async getShareDetail(shareId: string, fid: string): Promise<SearchResult> {
    const response = await this.fetchQuarkAPI(QUARK_API.SHARE_DETAIL, {
      pwd_id: shareId,
      passcode: '',
    });

    const file = response.data.list.find((f: QuarkFile) => f.fid === fid);
    if (!file) {
      throw new Error('文件不存在');
    }

    // 如果是文件夹，获取文件夹内的视频文件列表
    if (file.dir) {
      const listResponse = await this.fetchQuarkAPI(QUARK_API.SHARE_DETAIL, {
        pwd_id: shareId,
        pdir_fid: fid,
        _page: 1,
        _size: 100,
      });

      const videoFiles = listResponse.data.list.filter(
        (f: QuarkFile) => f.format_type === 'video'
      );

      return this.convertToSearchResult(file, shareId, videoFiles);
    }

    return this.convertToSearchResult(file, shareId);
  }

  private async getMyDriveDetail(fid: string): Promise<SearchResult> {
    const response = await this.fetchQuarkAPI(QUARK_API.LIST, {
      pdir_fid: fid,
      _page: 1,
      _size: 100,
    });

    if (!response.data) {
      throw new Error('获取文件详情失败');
    }

    const files = response.data.list as QuarkFile[];
    const videoFiles = files.filter(f => f.format_type === 'video');

    // 构造详情
    return {
      id: fid,
      title: response.data.metadata?.title || '视频',
      poster: '',
      episodes: videoFiles.map(f => `quark:${f.fid}`),
      episodes_titles: videoFiles.map(f => f.file_name),
      source: this.config.key,
      source_name: this.config.name,
      class: '',
      year: '',
      desc: '',
    };
  }

  async getPlayUrl(id: string, episodeIndex: number): Promise<string> {
    // 从 episodes[episodeIndex] 中提取 fid
    const episodeId = id; // 实际上 episodes 数组中存储的就是 fid

    // 提取真实的 fid
    const fid = episodeId.replace('quark:', '');

    // 调用下载接口获取播放地址
    const response = await this.fetchQuarkAPI(QUARK_API.DOWNLOAD, {
      fids: fid,
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('获取播放地址失败');
    }

    return response.data[0].download_url;
  }

  /**
   * 调用夸克 API
   */
  private async fetchQuarkAPI(endpoint: string, params: Record<string, any>): Promise<any> {
    const url = new URL(QUARK_API.BASE_URL + endpoint);

    // 添加通用参数
    const allParams = {
      pr: 'ucpro',
      fr: 'pc',
      ...params,
    };

    Object.entries(allParams).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    };

    // 如果有 cookie，添加到请求头
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`夸克 API 请求失败: ${response.status}`);
    }

    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`夸克 API 错误: ${data.message || '未知错误'}`);
    }

    return data;
  }

  /**
   * 从分享链接提取 share_id
   */
  private extractShareId(shareLink: string): string | null {
    const match = shareLink.match(/\/s\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * 转换为 SearchResult 格式
   */
  private convertToSearchResult(
    file: QuarkFile,
    shareId?: string,
    episodes?: QuarkFile[]
  ): SearchResult {
    const id = shareId ? `${shareId}:${file.fid}` : file.fid;

    return {
      id,
      title: file.file_name.replace(/\.\w+$/, ''), // 去除扩展名
      poster: '',
      episodes: episodes
        ? episodes.map(e => `quark:${e.fid}`)
        : file.dir
          ? []
          : [`quark:${file.fid}`],
      episodes_titles: episodes
        ? episodes.map(e => e.file_name)
        : file.dir
          ? []
          : [file.file_name],
      source: this.config.key,
      source_name: this.config.name,
      class: file.format_type || 'video',
      year: new Date(file.created_at * 1000).getFullYear().toString(),
      desc: `文件大小: ${this.formatSize(file.size)}`,
    };
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
}
