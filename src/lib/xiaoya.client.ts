/* eslint-disable @typescript-eslint/no-explicit-any */

// Token 内存缓存
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface XiaoyaFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
}

export interface XiaoyaListResponse {
  content: XiaoyaFile[];
  total: number;
}

export class XiaoyaClient {
  private token = '';

  constructor(
    private baseURL: string,
    private username?: string,
    private password?: string,
    private configToken?: string,
  ) {}

  /**
   * 使用账号密码登录获取Token
   */
  static async login(
    baseURL: string,
    username: string,
    password: string,
  ): Promise<string> {
    const response = await fetch(`${baseURL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅登录失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200 || !data.data?.token) {
      throw new Error('小雅登录失败: 未获取到Token');
    }

    return data.data.token;
  }

  /**
   * 获取缓存的 Token 或重新登录
   */
  async getToken(): Promise<string> {
    // 如果配置了 Token，直接使用
    if (this.configToken) {
      return this.configToken;
    }

    // 如果没有配置用户名密码，返回空字符串（guest 模式）
    if (!this.username || !this.password) {
      return '';
    }

    const cacheKey = `${this.baseURL}:${this.username}`;
    const cached = tokenCache.get(cacheKey);

    // 如果有缓存且未过期，直接返回
    if (cached && cached.expiresAt > Date.now()) {
      this.token = cached.token;
      return this.token;
    }

    // 否则重新登录
    console.log('[XiaoyaClient] Token 不存在或已过期，重新登录');
    this.token = await XiaoyaClient.login(
      this.baseURL,
      this.username,
      this.password,
    );

    // 缓存 Token，设置 1 小时过期
    tokenCache.set(cacheKey, {
      token: this.token,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return this.token;
  }

  /**
   * 获取基础 URL
   */
  getBaseURL(): string {
    return this.baseURL;
  }

  /**
   * 列出目录内容
   */
  async listDirectory(
    path: string,
    page = 1,
    perPage = 100,
    refresh = false,
  ): Promise<XiaoyaListResponse> {
    const token = await this.getToken();

    const response = await fetch(`${this.baseURL}/api/fs/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        path,
        page,
        per_page: perPage,
        refresh,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅列表获取失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`小雅列表获取失败: ${data.message}`);
    }

    return {
      content: data.data.content || [],
      total: data.data.total || 0,
    };
  }

  /**
   * 搜索文件
   */
  async search(
    keyword: string,
    page = 1,
    perPage = 100,
  ): Promise<XiaoyaListResponse> {
    const token = await this.getToken();

    const response = await fetch(`${this.baseURL}/api/fs/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        parent: '/',
        keywords: keyword,
        scope: 1, // 递归搜索
        page,
        per_page: perPage,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅搜索失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`小雅搜索失败: ${data.message}`);
    }

    return {
      content: data.data.content || [],
      total: data.data.total || 0,
    };
  }

  /**
   * 获取文件信息
   */
  async getFileInfo(path: string): Promise<XiaoyaFile> {
    const token = await this.getToken();

    const response = await fetch(`${this.baseURL}/api/fs/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        path,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅文件信息获取失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`小雅文件信息获取失败: ${data.message}`);
    }

    return data.data;
  }

  /**
   * 获取文件下载链接
   */
  async getDownloadUrl(path: string): Promise<string> {
    // Alist 的直接下载链接格式
    return `${this.baseURL}/d${path}`;
  }

  /**
   * 获取文件内容（用于读取 NFO 等文本文件）
   */
  async getFileContent(path: string): Promise<string> {
    const downloadUrl = await this.getDownloadUrl(path);

    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`文件读取失败: ${response.status}`);
    }

    return await response.text();
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      await this.getFileInfo(path);
      return true;
    } catch (error) {
      return false;
    }
  }
}
