/**
 * 服务器端离线下载器
 * 用于在服务器端下载 M3U8 视频到本地文件系统
 */

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { URL } from 'url';
import * as zlib from 'zlib';

export interface OfflineDownloadTask {
  id: string;
  source: string;
  videoId: string;
  episodeIndex: number;
  title: string;
  m3u8Url: string;
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'paused';
  progress: number;
  totalSegments: number;
  downloadedSegments: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  downloadDir: string;
  // 视频元数据
  metadata?: {
    videoTitle?: string; // 视频总标题（如：某某动漫）
    cover?: string; // 封面图片URL
    description?: string; // 视频描述
    year?: string; // 年份
    rating?: number; // 评分
    totalEpisodes?: number; // 总集数
  };
}

interface SegmentInfo {
  url: string;
  filename: string;
  duration: number;
}

interface KeyInfo {
  method: string;
  uri: string;
  iv?: string;
}

export class OfflineDownloader {
  private baseDir: string;
  private maxRetries = 3;
  private retryDelay = 1000; // ms
  private concurrency = 6;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.ensureDir(this.baseDir);
  }

  /**
   * 创建下载任务
   */
  async createTask(
    source: string,
    videoId: string,
    episodeIndex: number,
    title: string,
    m3u8Url: string,
    metadata?: {
      videoTitle?: string;
      cover?: string;
      description?: string;
      year?: string;
      rating?: number;
      totalEpisodes?: number;
    },
  ): Promise<OfflineDownloadTask> {
    const taskId = `${source}_${videoId}_${episodeIndex}_${Date.now()}`;
    const downloadDir = path.join(
      this.baseDir,
      source,
      videoId,
      `ep${episodeIndex + 1}`,
    );

    const task: OfflineDownloadTask = {
      id: taskId,
      source,
      videoId,
      episodeIndex,
      title,
      m3u8Url,
      status: 'pending',
      progress: 0,
      totalSegments: 0,
      downloadedSegments: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      downloadDir,
      metadata,
    };

    return task;
  }

  /**
   * 开始下载任务
   */
  async startDownload(
    task: OfflineDownloadTask,
    onProgress?: (task: OfflineDownloadTask) => void,
  ): Promise<void> {
    try {
      task.status = 'downloading';
      task.updatedAt = new Date();
      onProgress?.(task);

      // 确保下载目录存在
      this.ensureDir(task.downloadDir);

      // 检查是否已经下载过（避免重复下载）
      const playlistPath = path.join(task.downloadDir, 'playlist.m3u8');
      if (fs.existsSync(playlistPath)) {
        // 检查所有文件是否完整
        const isComplete = await this.verifyDownload(task.downloadDir);
        if (isComplete) {
          task.status = 'completed';
          task.progress = 100;
          task.updatedAt = new Date();
          onProgress?.(task);
          return;
        }
      }

      // 下载 M3U8 文件
      let m3u8Content = await this.fetchContent(task.m3u8Url);
      let finalM3u8Url = task.m3u8Url;

      // 检查是否为主播放列表（包含多个分辨率）
      if (this.isMasterPlaylist(m3u8Content)) {
        console.log('检测到主播放列表，正在选择最高分辨率...');

        // 解析主播放列表，获取最高分辨率的子播放列表URL
        const bestVariantUrl = this.selectBestVariant(
          m3u8Content,
          task.m3u8Url,
        );

        if (bestVariantUrl) {
          console.log('已选择最高分辨率流:', bestVariantUrl);
          finalM3u8Url = bestVariantUrl;

          // 下载子播放列表
          m3u8Content = await this.fetchContent(bestVariantUrl);
        } else {
          console.warn('无法找到子播放列表，使用原始URL');
        }
      }

      // 解析 M3U8 文件
      const { segments, keyInfo } = this.parseM3U8(m3u8Content, finalM3u8Url);

      task.totalSegments = segments.length;
      onProgress?.(task);

      // 下载解密 Key（如果有）
      if (keyInfo && keyInfo.uri) {
        await this.downloadKey(keyInfo, task.downloadDir);
      }

      // 下载所有片段
      await this.downloadSegments(segments, task, onProgress);

      // 生成本地播放列表，保持原始格式
      this.generateLocalPlaylist(
        m3u8Content,
        segments,
        keyInfo,
        task.downloadDir,
      );

      task.status = 'completed';
      task.progress = 100;
      task.updatedAt = new Date();
      onProgress?.(task);
    } catch (error) {
      task.status = 'error';
      task.errorMessage =
        error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date();
      onProgress?.(task);
      throw error;
    }
  }

  /**
   * 检查是否为主播放列表（Master Playlist）
   */
  private isMasterPlaylist(content: string): boolean {
    return content.includes('#EXT-X-STREAM-INF:');
  }

  /**
   * 从主播放列表中选择最高分辨率的变体
   */
  private selectBestVariant(content: string, baseUrl: string): string | null {
    const lines = content.split('\n').map((line) => line.trim());

    interface Variant {
      url: string;
      bandwidth: number;
      resolution?: { width: number; height: number };
    }

    const variants: Variant[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // 提取带宽信息
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;

        // 提取分辨率信息
        const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
        const resolution = resolutionMatch
          ? {
              width: parseInt(resolutionMatch[1], 10),
              height: parseInt(resolutionMatch[2], 10),
            }
          : undefined;

        // 下一行应该是子播放列表的URL
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (nextLine && !nextLine.startsWith('#')) {
            const variantUrl = this.resolveUrl(nextLine, baseUrl);
            variants.push({ url: variantUrl, bandwidth, resolution });
          }
        }
      }
    }

    if (variants.length === 0) {
      return null;
    }

    // 优先按分辨率排序（宽度 * 高度），如果没有分辨率信息则按带宽排序
    variants.sort((a, b) => {
      // 如果两者都有分辨率信息，按分辨率排序
      if (a.resolution && b.resolution) {
        const aPixels = a.resolution.width * a.resolution.height;
        const bPixels = b.resolution.width * b.resolution.height;
        if (aPixels !== bPixels) {
          return bPixels - aPixels; // 降序
        }
      }

      // 如果只有一个有分辨率信息，优先选择有分辨率的
      if (a.resolution && !b.resolution) return -1;
      if (!a.resolution && b.resolution) return 1;

      // 都没有分辨率信息，或分辨率相同，则按带宽排序
      return b.bandwidth - a.bandwidth; // 降序
    });

    console.log(
      '可用的流变体:',
      variants.map((v) => ({
        url: v.url,
        bandwidth: v.bandwidth,
        resolution: v.resolution
          ? `${v.resolution.width}x${v.resolution.height}`
          : '未知',
      })),
    );

    return variants[0].url;
  }

  /**
   * 解析 M3U8 文件
   */
  private parseM3U8(
    content: string,
    baseUrl: string,
  ): { segments: SegmentInfo[]; keyInfo: KeyInfo | null } {
    const lines = content.split('\n').map((line) => line.trim());
    const segments: SegmentInfo[] = [];
    let keyInfo: KeyInfo | null = null;
    let currentDuration = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 解析时长
      if (line.startsWith('#EXTINF:')) {
        const match = line.match(/#EXTINF:([\d.]+)/);
        if (match) {
          currentDuration = parseFloat(match[1]);
        }
      }
      // 解析加密信息
      else if (line.startsWith('#EXT-X-KEY:')) {
        const methodMatch = line.match(/METHOD=([^,]+)/);
        const uriMatch = line.match(/URI="([^"]+)"/);
        const ivMatch = line.match(/IV=([^,\s]+)/);

        if (methodMatch && methodMatch[1] !== 'NONE') {
          keyInfo = {
            method: methodMatch[1],
            uri: uriMatch ? this.resolveUrl(uriMatch[1], baseUrl) : '',
            iv: ivMatch ? ivMatch[1] : undefined,
          };
        }
      }
      // 解析片段 URL
      else if (line && !line.startsWith('#')) {
        const segmentUrl = this.resolveUrl(line, baseUrl);
        const filename = `segment_${segments.length.toString().padStart(5, '0')}.ts`;

        segments.push({
          url: segmentUrl,
          filename,
          duration: currentDuration,
        });

        currentDuration = 0;
      }
    }

    return { segments, keyInfo };
  }

  /**
   * 下载所有片段（带重试和并发控制）
   */
  private async downloadSegments(
    segments: SegmentInfo[],
    task: OfflineDownloadTask,
    onProgress?: (task: OfflineDownloadTask) => void,
  ): Promise<void> {
    const queue = [...segments];
    const downloading: Promise<void>[] = [];
    let downloadedCount = 0;

    const downloadNext = async (): Promise<void> => {
      if (queue.length === 0) return;

      const segment = queue.shift()!;
      const segmentPath = path.join(task.downloadDir, segment.filename);

      // 如果文件已存在且大小 > 0，跳过下载
      if (fs.existsSync(segmentPath) && fs.statSync(segmentPath).size > 0) {
        downloadedCount++;
        task.downloadedSegments = downloadedCount;
        task.progress = Math.round(
          (downloadedCount / task.totalSegments) * 100,
        );
        task.updatedAt = new Date();
        onProgress?.(task);
        return downloadNext();
      }

      // 下载片段（带重试）
      await this.downloadWithRetry(segment.url, segmentPath);

      downloadedCount++;
      task.downloadedSegments = downloadedCount;
      task.progress = Math.round((downloadedCount / task.totalSegments) * 100);
      task.updatedAt = new Date();
      onProgress?.(task);

      return downloadNext();
    };

    // 并发下载
    for (let i = 0; i < Math.min(this.concurrency, segments.length); i++) {
      downloading.push(downloadNext());
    }

    await Promise.all(downloading);
  }

  /**
   * 下载解密 Key
   */
  private async downloadKey(
    keyInfo: KeyInfo,
    downloadDir: string,
  ): Promise<void> {
    if (!keyInfo.uri) return;

    const keyPath = path.join(downloadDir, 'key.key');

    // 如果 key 已存在，跳过下载
    if (fs.existsSync(keyPath) && fs.statSync(keyPath).size > 0) {
      return;
    }

    await this.downloadWithRetry(keyInfo.uri, keyPath);
  }

  /**
   * 下载文件（带重试）
   */
  private async downloadWithRetry(
    url: string,
    savePath: string,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await this.downloadFile(url, savePath);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(
          `下载失败 (尝试 ${attempt + 1}/${this.maxRetries}): ${url}`,
          error,
        );

        if (attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelay * (attempt + 1));
        }
      }
    }

    throw new Error(
      `下载失败（已重试 ${this.maxRetries} 次）: ${url}\n${lastError?.message}`,
    );
  }

  /**
   * 获取标准浏览器请求头
   */
  private getHeaders(url: string): Record<string, string> {
    const urlObj = new URL(url);
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      Origin: `${urlObj.protocol}//${urlObj.host}`,
      Referer: `${urlObj.protocol}//${urlObj.host}/`,
      Connection: 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    };
  }

  /**
   * 下载单个文件
   */
  private async downloadFile(url: string, savePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const options = {
        headers: this.getHeaders(url),
      };

      const request = client.get(url, options, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // 处理重定向
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.downloadFile(redirectUrl, savePath)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        // 检查内容编码，处理压缩
        const encoding = response.headers['content-encoding'];
        let stream: NodeJS.ReadableStream = response;

        if (encoding === 'gzip') {
          stream = response.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = response.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
          stream = response.pipe(zlib.createBrotliDecompress());
        }

        const fileStream = fs.createWriteStream(savePath);
        stream.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(savePath, () => {
            // Ignore unlink errors
          });
          reject(err);
        });

        stream.on('error', (err) => {
          fs.unlink(savePath, () => {
            // Ignore unlink errors
          });
          reject(err);
        });
      });

      request.on('error', (err) => {
        reject(err);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * 获取内容（用于 M3U8 文件）
   */
  private async fetchContent(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const options = {
        headers: this.getHeaders(url),
      };

      const request = client.get(url, options, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.fetchContent(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        // 检查内容编码，处理压缩
        const encoding = response.headers['content-encoding'];
        let stream: NodeJS.ReadableStream = response;

        if (encoding === 'gzip') {
          stream = response.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = response.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
          stream = response.pipe(zlib.createBrotliDecompress());
        }

        let data = '';
        stream.on('data', (chunk) => {
          data += chunk.toString('utf-8');
        });

        stream.on('end', () => {
          resolve(data);
        });

        stream.on('error', (err) => {
          reject(err);
        });
      });

      request.on('error', reject);
      request.setTimeout(10000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * 生成本地播放列表（保持原始格式，只替换片段URL）
   */
  private generateLocalPlaylist(
    originalM3u8Content: string,
    segments: SegmentInfo[],
    keyInfo: KeyInfo | null,
    downloadDir: string,
  ): void {
    const lines = originalM3u8Content.split('\n');
    const modifiedLines: string[] = [];
    let segmentIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 替换 Key URI
      if (trimmedLine.startsWith('#EXT-X-KEY:')) {
        if (keyInfo && keyInfo.method !== 'NONE') {
          // 替换 URI 为本地 key.key
          const modifiedLine = line.replace(/URI="[^"]+"/g, 'URI="key.key"');
          modifiedLines.push(modifiedLine);
        } else {
          modifiedLines.push(line);
        }
      }
      // 替换视频片段 URL
      else if (trimmedLine && !trimmedLine.startsWith('#')) {
        // 这是一个视频片段，替换为本地文件名
        if (segmentIndex < segments.length) {
          const indent = line.match(/^\s*/)?.[0] || '';
          modifiedLines.push(indent + segments[segmentIndex].filename);
          segmentIndex++;
        } else {
          // 如果超出了片段数量，保留原始行（不应该发生）
          modifiedLines.push(line);
        }
      }
      // 保持其他所有行不变
      else {
        modifiedLines.push(line);
      }
    }

    const playlistPath = path.join(downloadDir, 'playlist.m3u8');
    fs.writeFileSync(playlistPath, modifiedLines.join('\n'), 'utf-8');
  }

  /**
   * 验证下载是否完整
   */
  private async verifyDownload(downloadDir: string): Promise<boolean> {
    try {
      const playlistPath = path.join(downloadDir, 'playlist.m3u8');
      if (!fs.existsSync(playlistPath)) {
        return false;
      }

      const content = fs.readFileSync(playlistPath, 'utf-8');
      const lines = content.split('\n').map((line) => line.trim());

      // 检查所有 ts 文件是否存在
      for (const line of lines) {
        if (line && !line.startsWith('#')) {
          const segmentPath = path.join(downloadDir, line);
          if (
            !fs.existsSync(segmentPath) ||
            fs.statSync(segmentPath).size === 0
          ) {
            return false;
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 解析相对 URL
   */
  private resolveUrl(targetUrl: string, baseUrl: string): string {
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      return targetUrl;
    }

    try {
      const base = new URL(baseUrl);
      if (targetUrl.startsWith('/')) {
        return `${base.protocol}//${base.host}${targetUrl}`;
      } else {
        const basePath = base.pathname.substring(
          0,
          base.pathname.lastIndexOf('/') + 1,
        );
        return `${base.protocol}//${base.host}${basePath}${targetUrl}`;
      }
    } catch {
      return targetUrl;
    }
  }

  /**
   * 确保目录存在
   */
  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 删除下载任务的所有文件
   */
  async deleteTask(task: OfflineDownloadTask): Promise<void> {
    if (fs.existsSync(task.downloadDir)) {
      fs.rmSync(task.downloadDir, { recursive: true, force: true });
    }
  }

  /**
   * 检查视频是否已下载
   */
  checkDownloaded(
    source: string,
    videoId: string,
    episodeIndex: number,
  ): boolean {
    const downloadDir = path.join(
      this.baseDir,
      source,
      videoId,
      `ep${episodeIndex + 1}`,
    );
    const playlistPath = path.join(downloadDir, 'playlist.m3u8');
    return fs.existsSync(playlistPath);
  }

  /**
   * 获取本地播放列表路径
   */
  getLocalPlaylistPath(
    source: string,
    videoId: string,
    episodeIndex: number,
  ): string | null {
    const downloadDir = path.join(
      this.baseDir,
      source,
      videoId,
      `ep${episodeIndex + 1}`,
    );
    const playlistPath = path.join(downloadDir, 'playlist.m3u8');
    return fs.existsSync(playlistPath) ? playlistPath : null;
  }
}
