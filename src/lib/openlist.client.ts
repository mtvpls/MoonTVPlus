/* eslint-disable @typescript-eslint/no-explicit-any */

// Token 内存缓存
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface OpenListFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  sign?: string; // 临时下载签名
  raw_url?: string; // 完整下载链接
  thumb?: string;
  type: number;
  path?: string;
}

export interface OpenListListResponse {
  code: number;
  message: string;
  data: {
    content: OpenListFile[];
    total: number;
    readme: string;
    write: boolean;
  };
}

export interface OpenListGetResponse {
  code: number;
  message: string;
  data: OpenListFile;
}

export class OpenListClient {
  private token = '';

  constructor(
    private baseURL: string,
    private username: string,
    private password: string
  ) {}

  /**
   * 使用账号密码登录获取Token
   */
  static async login(
    baseURL: string,
    username: string,
    password: string
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
      throw new Error(`OpenList 登录失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200 || !data.data?.token) {
      throw new Error('OpenList 登录失败: 未获取到Token');
    }

    return data.data.token;
  }

  /**
   * 获取缓存的 Token 或重新登录
   */
  private async getToken(): Promise<string> {
    const cacheKey = `${this.baseURL}:${this.username}`;
    const cached = tokenCache.get(cacheKey);

    // 如果有缓存且未过期，直接返回
    if (cached && cached.expiresAt > Date.now()) {
      this.token = cached.token;
      return this.token;
    }

    // 否则重新登录
    console.log('[OpenListClient] Token 不存在或已过期，重新登录');
    this.token = await OpenListClient.login(
      this.baseURL,
      this.username,
      this.password
    );

    // 缓存 Token，设置 1 小时过期
    tokenCache.set(cacheKey, {
      token: this.token,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    console.log('[OpenListClient] 登录成功，Token 已缓存');
    return this.token;
  }

  /**
   * 清除 Token 缓存（当 Token 失效时调用）
   */
  private clearTokenCache(): void {
    const cacheKey = `${this.baseURL}:${this.username}`;
    tokenCache.delete(cacheKey);
    console.log('[OpenListClient] Token 缓存已清除');
  }

  /**
   * 执行请求，如果401则清除缓存并重新登录后重试
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retried = false
  ): Promise<Response> {
    // 获取 Token
    const token = await this.getToken();

    // 更新请求头中的 Token
    const requestOptions = {
      ...options,
      headers: {
        ...options.headers,
        Authorization: token,
      },
    };

    const response = await fetch(url, requestOptions);

    // 检查 HTTP status 401
    if (response.status === 401 && !retried) {
      console.log('[OpenListClient] 收到 HTTP 401，清除 Token 缓存并重试');
      this.clearTokenCache();
      return this.fetchWithRetry(url, options, true);
    }

    // 检查响应体中的 code 字段（OpenList 的 Token 过期时 HTTP status 是 200，但 code 是 401）
    if (response.ok && !retried) {
      try {
        // 克隆响应以便读取 JSON
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();

        if (data.code === 401) {
          console.log('[OpenListClient] 响应体 code 为 401，Token 已过期，清除缓存并重试');
          this.clearTokenCache();
          return this.fetchWithRetry(url, options, true);
        }
      } catch (error) {
        // 如果解析 JSON 失败，忽略错误，返回原始响应
        console.warn('[OpenListClient] 解析响应 JSON 失败:', error);
      }
    }
    return response;
  }

  private async getHeaders() {
    const token = await this.getToken();
    return {
      Authorization: token, // 不带 bearer
      'Content-Type': 'application/json'
    };
  }

  // 列出目录
  async listDirectory(
    path: string,
    page = 1,
    perPage = 100,
    refresh = false
  ): Promise<OpenListListResponse> {
    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/list`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify({
        path,
        password: '',
        refresh,
        page,
        per_page: perPage,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenList API 错误: ${response.status}`);
    }

    return response.json();
  }

  // 获取文件信息
  async getFile(path: string): Promise<OpenListGetResponse> {
    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/get`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify({
        path,
        password: '',
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenList API 错误: ${response.status}`);
    }

    return response.json();
  }

  // 上传文件
  async uploadFile(path: string, content: string): Promise<void> {
    const token = await this.getToken();
    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/put`, {
      method: 'PUT',
      headers: {
        Authorization: token,
        'Content-Type': 'text/plain; charset=utf-8',
        'File-Path': encodeURIComponent(path),
        'As-Task': 'false',
      },
      body: content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenList 上传失败: ${response.status} - ${errorText}`);
    }

    // 上传成功后刷新目录缓存
    const dir = path.substring(0, path.lastIndexOf('/')) || '/';
    await this.refreshDirectory(dir);
  }

  // 刷新目录缓存
  async refreshDirectory(path: string): Promise<void> {
    try {
      const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/list`, {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify({
          path,
          password: '',
          refresh: true,
          page: 1,
          per_page: 1,
        }),
      });

      if (!response.ok) {
        console.warn(`刷新目录缓存失败: ${response.status}`);
      }
    } catch (error) {
      console.warn('刷新目录缓存失败:', error);
    }
  }

  // 删除文件
  async deleteFile(path: string): Promise<void> {
    const dir = path.substring(0, path.lastIndexOf('/')) || '/';
    const fileName = path.substring(path.lastIndexOf('/') + 1);

    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/remove`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify({
        names: [fileName],
        dir: dir,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenList 删除失败: ${response.status}`);
    }
  }

  // 获取视频预览流
  async getVideoPreview(path: string): Promise<any> {
    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/other`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify({
        path: path,
        method: 'video_preview',
        password: '',
      }),
    });

    if (!response.ok) {
      throw new Error(`视频预览请求失败: ${response.status}`);
    }

    const data = await response.json();

    if (data.code !== 200) {
      throw new Error(`视频预览失败: ${data.message}`);
    }

    return data;
  }

  // 检查连通性
  async checkConnectivity(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.fetchWithRetry(`${this.baseURL}/api/me`, {
        method: 'GET',
        headers: await this.getHeaders(),
      });

      if (response.status !== 200) {
        return {
          success: false,
          message: `HTTP 状态码错误: ${response.status}`,
        };
      }

      const data = await response.json();

      if (data.code !== 200) {
        return {
          success: false,
          message: `响应码错误: ${data.code}`,
        };
      }

      return {
        success: true,
        message: '连接成功',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '连接失败',
      };
    }
  }
}
