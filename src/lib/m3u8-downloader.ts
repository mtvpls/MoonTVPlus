/**
 * M3U8 下载器核心逻辑
 * 基于 M3U8Download 项目改造为 TypeScript 版本
 */

// @ts-ignore - mux.js 没有类型定义
import * as muxjs from 'mux.js';

import { AESDecryptor } from './aes-decryptor';

export interface M3U8DownloadTask {
  id: string;
  url: string;
  title: string;
  type: 'TS' | 'MP4';
  status: 'ready' | 'downloading' | 'pause' | 'done' | 'error';
  finishList: Array<{
    title: string;
    status: '' | 'is-downloading' | 'is-success' | 'is-error';
    retryCount?: number; // 重试次数
  }>;
  tsUrlList: string[];
  requests: XMLHttpRequest[];
  mediaFileList: ArrayBuffer[];
  downloadIndex: number;
  downloading: boolean;
  durationSecond: number;
  beginTime: Date;
  errorNum: number;
  finishNum: number;
  retryNum: number;
  retryCountdown: number;
  rangeDownload: {
    isShowRange: boolean;
    startSegment: number;
    endSegment: number;
    targetSegment: number;
  };
  aesConf: {
    method: string;
    uri: string;
    iv: Uint8Array | null;
    key: ArrayBuffer | null;
    decryption: AESDecryptor | null;
  };
  //禁止SzeMeng76抄袭狗抄袭
  // File System API 相关字段
  downloadMode?: 'browser' | 'filesystem';
  filesystemDirHandle?: FileSystemDirectoryHandle;
  m3u8Content?: string; // 原始 M3U8 内容，用于生成本地播放列表
  // 视频标识信息（用于区分不同视频）
  source?: string;
  videoId?: string;
  episodeIndex?: number;
  createdAt?: number; // 创建时间戳
}

export interface M3U8DownloaderOptions {
  onProgress?: (task: M3U8DownloadTask) => void;
  onComplete?: (task: M3U8DownloadTask) => void;
  onError?: (task: M3U8DownloadTask, error: string) => void;
}

export class M3U8Downloader {
  private tasks: Map<string, M3U8DownloadTask> = new Map();
  private currentTask: M3U8DownloadTask | null = null;
  private options: M3U8DownloaderOptions;

  constructor(options: M3U8DownloaderOptions = {}) {
    this.options = options;
  }

  /**
   * 创建下载任务
   */
  async createTask(
    url: string,
    title: string,
    type: 'TS' | 'MP4' = 'TS',
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    },
  ): Promise<string> {
    const taskId = 't_' + Date.now() + Math.random().toString(36).substr(2, 9);

    try {
      // 获取 m3u8 文件内容
      const m3u8Content = await this.fetchM3U8(url);

      if (!m3u8Content.startsWith('#EXTM3U')) {
        throw new Error('无效的 m3u8 链接');
      }

      // 检查是否是主播放列表
      if (this.isMasterPlaylist(m3u8Content)) {
        const streams = this.parseStreamInfo(m3u8Content, url);
        if (streams.length > 0) {
          // 自动选择最高清晰度
          url = streams[0].url;
          const subM3u8Content = await this.fetchM3U8(url);
          return this.processM3U8Content(
            taskId,
            url,
            title,
            type,
            subM3u8Content,
            metadata,
          );
        }
      }

      return this.processM3U8Content(
        taskId,
        url,
        title,
        type,
        m3u8Content,
        metadata,
      );
    } catch (error) {
      throw new Error(`创建任务失败: ${error}`);
    }
  }

  /**
   * 处理 M3U8 内容
   */
  private processM3U8Content(
    taskId: string,
    url: string,
    title: string,
    type: 'TS' | 'MP4',
    m3u8Content: string,
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    },
  ): string {
    const task: M3U8DownloadTask = {
      id: taskId,
      url,
      title,
      type,
      status: 'ready',
      finishList: [],
      tsUrlList: [],
      requests: [],
      mediaFileList: [],
      downloadIndex: 0, // 初始化为 0，在 startTask 时会设置为正确的值
      downloading: false,
      durationSecond: 0,
      beginTime: new Date(),
      errorNum: 0,
      finishNum: 0,
      retryNum: 3,
      retryCountdown: 0,
      rangeDownload: {
        isShowRange: false,
        startSegment: 0, // 改为从 0 开始
        endSegment: 0,
        targetSegment: 0,
      },
      aesConf: {
        method: '',
        uri: '',
        iv: null,
        key: null,
        decryption: null,
      },
      m3u8Content, // 保存原始 M3U8 内容
      source: metadata?.source,
      videoId: metadata?.videoId,
      episodeIndex: metadata?.episodeIndex,
      createdAt: Date.now(),
    };

    // 解析 TS 片段
    const lines = m3u8Content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        const duration = parseFloat(line.split('#EXTINF:')[1]);
        task.durationSecond += duration;
      } else if (line.startsWith('#EXT-X-KEY')) {
        const keyMatch = line.match(
          /METHOD=([^,]+)(?:,URI="([^"]+)")?(?:,IV=([^,]+))?/,
        );
        if (keyMatch) {
          task.aesConf.method = keyMatch[1];
          task.aesConf.uri = keyMatch[2] ? this.applyURL(keyMatch[2], url) : '';
          task.aesConf.iv = keyMatch[3] ? this.parseIV(keyMatch[3]) : null;
        }
      } else if (line && !line.startsWith('#')) {
        task.tsUrlList.push(this.applyURL(line, url));
        task.finishList.push({ title: line, status: '' });
      }
    }

    task.rangeDownload.endSegment = task.tsUrlList.length;
    task.rangeDownload.targetSegment = task.tsUrlList.length;

    this.tasks.set(taskId, task);
    return taskId;
  }

  /**
   * 开始下载任务
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('任务不存在');
    }

    if (task.status === 'downloading') {
      return;
    }

    // 如果需要 AES 解密，先获取密钥
    if (
      task.aesConf.method &&
      task.aesConf.method !== 'NONE' &&
      !task.aesConf.key
    ) {
      await this.getAESKey(task);
    }

    // 重置下载索引到第一个未完成的片段
    if (task.status === 'ready' || task.status === 'pause') {
      // 找到第一个未完成的片段
      let firstIncompleteIndex = 0;
      for (let i = 0; i < task.finishList.length; i++) {
        if (task.finishList[i].status !== 'is-success') {
          firstIncompleteIndex = i;
          break;
        }
      }
      task.downloadIndex = firstIncompleteIndex;
    }

    task.status = 'downloading';
    this.currentTask = task;
    this.downloadTS(task);
  }

  /**
   * 暂停任务
   */
  pauseTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'pause';
    this.abortRequests(task);
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    this.abortRequests(task);

    // 如果是 filesystem 模式且任务未完成，删除已下载的文件
    if (
      task.downloadMode === 'filesystem' &&
      task.status !== 'done' &&
      task.filesystemDirHandle
    ) {
      await this.deleteFilesystemTask(task);
    }

    this.tasks.delete(taskId);

    if (this.currentTask?.id === taskId) {
      this.currentTask = null;
    }
  }

  /**
   * 删除 filesystem 模式下的任务文件
   */
  private async deleteFilesystemTask(task: M3U8DownloadTask): Promise<void> {
    if (
      !task.filesystemDirHandle ||
      !task.source ||
      !task.videoId ||
      task.episodeIndex === undefined
    ) {
      return;
    }

    try {
      // 获取目标目录
      const sourceDirHandle = await task.filesystemDirHandle.getDirectoryHandle(
        task.source,
        { create: false },
      );
      const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(
        task.videoId,
        { create: false },
      );

      // 删除 ep{n} 目录
      const epDirName = `ep${task.episodeIndex + 1}`;
      await videoIdDirHandle.removeEntry(epDirName, { recursive: true });

      console.log(
        `已删除未完成的下载文件: ${task.source}/${task.videoId}/${epDirName}`,
      );
    } catch (error) {
      // 如果目录不存在或删除失败，忽略错误
      console.warn('删除文件失败（可能目录不存在）:', error);
    }
  }

  /**
   * 获取任务信息
   */
  getTask(taskId: string): M3U8DownloadTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): M3U8DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取下载进度
   */
  getProgress(taskId: string): number {
    const task = this.tasks.get(taskId);
    if (!task) return 0;

    if (task.rangeDownload.targetSegment === 0) return 0;
    return (task.finishNum / task.rangeDownload.targetSegment) * 100;
  }

  /**
   * 重试所有失败的片段
   */
  retryFailedSegments(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // 重置所有失败片段的状态
    let hasError = false;
    task.finishList.forEach((item) => {
      if (item.status === 'is-error') {
        item.status = '';
        item.retryCount = 0;
        hasError = true;
      }
    });

    if (hasError) {
      task.errorNum = 0;
      task.status = 'downloading';

      // 找到第一个失败的片段索引
      let firstErrorIndex = task.rangeDownload.endSegment;
      for (
        let i = task.rangeDownload.startSegment;
        i < task.rangeDownload.endSegment;
        i++
      ) {
        if (task.finishList[i] && task.finishList[i].status === '') {
          firstErrorIndex = Math.min(firstErrorIndex, i);
        }
      }

      task.downloadIndex = firstErrorIndex;
      this.downloadTS(task);
    }
  }

  /**
   * 下载 TS 片段
   */
  private downloadTS(task: M3U8DownloadTask): void {
    const download = () => {
      const isPause = task.status === 'pause';
      const index = task.downloadIndex;

      if (index >= task.rangeDownload.endSegment || isPause) {
        return;
      }

      task.downloadIndex++;

      if (task.finishList[index] && task.finishList[index].status === '') {
        task.finishList[index].status = 'is-downloading';
        if (!task.finishList[index].retryCount) {
          task.finishList[index].retryCount = 0;
        }

        const xhr = new XMLHttpRequest();
        xhr.responseType = 'arraybuffer';
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
              this.dealTS(task, xhr.response, index, () => {
                if (
                  task.downloadIndex < task.rangeDownload.endSegment &&
                  !isPause
                ) {
                  download();
                }
              });
            } else {
              // 下载失败，检查是否需要重试
              const maxRetries = 3;
              const currentRetry = task.finishList[index].retryCount || 0;

              if (currentRetry < maxRetries) {
                // 重试
                task.finishList[index].retryCount = currentRetry + 1;
                task.finishList[index].status = '';
                console.log(
                  `片段 ${index} 下载失败，正在重试 (${currentRetry + 1}/${maxRetries})...`,
                );

                // 延迟重试，避免立即重试
                setTimeout(
                  () => {
                    if (task.status !== 'pause') {
                      download();
                    }
                  },
                  1000 * (currentRetry + 1),
                ); // 递增延迟
              } else {
                // 重试次数用完，标记为最终失败
                task.errorNum++;
                task.finishList[index].status = 'is-error';
                this.options.onError?.(
                  task,
                  `片段 ${index} 下载失败（已重试 ${maxRetries} 次）`,
                );

                // 检查是否所有片段都已处理完成
                if (
                  task.finishNum + task.errorNum ===
                  task.rangeDownload.targetSegment
                ) {
                  if (task.errorNum > 0) {
                    task.status = 'pause';
                    this.options.onError?.(
                      task,
                      `下载完成，但有 ${task.errorNum} 个片段失败`,
                    );
                  }
                }
              }

              if (task.downloadIndex < task.rangeDownload.endSegment) {
                !isPause && download();
              }
            }
          }
        };

        xhr.open('GET', task.tsUrlList[index], true);
        xhr.send();
        task.requests.push(xhr);
      } else if (task.downloadIndex < task.rangeDownload.endSegment) {
        !isPause && download();
      }
    };

    // 从localStorage读取单任务线程数设置，默认6个
    const threadsPerTask =
      typeof window !== 'undefined'
        ? Number(localStorage.getItem('downloadThreadsPerTask') || 6)
        : 6;

    // 并发下载片段
    const concurrency = Math.min(
      threadsPerTask,
      task.rangeDownload.targetSegment - task.finishNum,
    );
    for (let i = 0; i < concurrency; i++) {
      download();
    }
  }

  /**
   * 处理 TS 片段
   */
  private dealTS(
    task: M3U8DownloadTask,
    file: ArrayBuffer,
    index: number,
    callback: () => void,
  ): void {
    let data = file;

    // AES 解密
    if (task.aesConf.key) {
      data = this.aesDecrypt(task, data, index);
    }

    // MP4 转码（如果需要）
    if (task.type === 'MP4') {
      this.conversionMp4(task, data, index, (convertedData) => {
        if (task.downloadMode === 'filesystem') {
          // File System API 模式：保存分片到文件系统
          this.saveSegmentToFilesystem(task, convertedData, index)
            .then(() => {
              task.finishList[index].status = 'is-success';
              task.finishNum++;
              this.options.onProgress?.(task);

              if (task.finishNum === task.rangeDownload.targetSegment) {
                task.status = 'done';
                this.generateLocalPlaylist(task);
                this.options.onComplete?.(task);
              }

              callback();
            })
            .catch((error) => {
              console.error('保存分片失败:', error);
              task.finishList[index].status = 'is-error';
              task.errorNum++;
              callback();
            });
        } else {
          // 浏览器下载模式：保存到内存
          task.mediaFileList[index] = convertedData;
          task.finishList[index].status = 'is-success';
          task.finishNum++;

          this.options.onProgress?.(task);

          if (task.finishNum === task.rangeDownload.targetSegment) {
            task.status = 'done';
            this.downloadFile(task);
            this.options.onComplete?.(task);
          }

          callback();
        }
      });
    } else {
      if (task.downloadMode === 'filesystem') {
        // File System API 模式：保存分片到文件系统
        this.saveSegmentToFilesystem(task, data, index)
          .then(() => {
            task.finishList[index].status = 'is-success';
            task.finishNum++;
            this.options.onProgress?.(task);

            if (task.finishNum === task.rangeDownload.targetSegment) {
              task.status = 'done';
              this.generateLocalPlaylist(task);
              this.options.onComplete?.(task);
            }

            callback();
          })
          .catch((error) => {
            console.error('保存分片失败:', error);
            task.finishList[index].status = 'is-error';
            task.errorNum++;
            callback();
          });
      } else {
        // 浏览器下载模式：保存到内存
        task.mediaFileList[index] = data;
        task.finishList[index].status = 'is-success';
        task.finishNum++;

        this.options.onProgress?.(task);

        if (task.finishNum === task.rangeDownload.targetSegment) {
          task.status = 'done';
          this.downloadFile(task);
          this.options.onComplete?.(task);
        }

        callback();
      }
    }
  }

  /**
   * 下载文件
   */
  private downloadFile(task: M3U8DownloadTask): void {
    const fileBlob = new Blob(task.mediaFileList, {
      type: task.type === 'MP4' ? 'video/mp4' : 'video/MP2T',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(fileBlob);
    a.download = `${task.title}.${task.type === 'MP4' ? 'mp4' : 'ts'}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  /**
   * 获取 M3U8 文件
   */
  private async fetchM3U8(url: string): Promise<string> {
    console.log('fetchM3U8 - 请求 URL:', url);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            console.error('fetchM3U8 失败 - URL:', url, 'Status:', xhr.status);
            reject(new Error(`HTTP ${xhr.status}`));
          }
        }
      };
      xhr.open('GET', url, true);
      xhr.send();
    });
  }

  /**
   * 检测是否是主播放列表
   */
  private isMasterPlaylist(m3u8Str: string): boolean {
    return m3u8Str.includes('#EXT-X-STREAM-INF');
  }

  /**
   * 解析流信息
   */
  private parseStreamInfo(
    m3u8Str: string,
    baseUrl: string,
  ): Array<{
    url: string;
    bandwidth: number;
    resolution: string;
    name: string;
  }> {
    const streams: Array<{
      url: string;
      bandwidth: number;
      resolution: string;
      name: string;
    }> = [];
    const lines = m3u8Str.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidth = line.match(/BANDWIDTH=(\d+)/)?.[1] || '';
        const resolution = line.match(/RESOLUTION=([^\s,]+)/)?.[1] || '';
        const name = line.match(/NAME="([^"]+)"/)?.[1] || '';

        if (i + 1 < lines.length) {
          const url = lines[i + 1].trim();
          if (url && !url.startsWith('#')) {
            streams.push({
              url: this.applyURL(url, baseUrl),
              bandwidth: parseInt(bandwidth) || 0,
              resolution: resolution || 'Unknown',
              name:
                name ||
                `${resolution || ''} ${bandwidth ? parseInt(bandwidth) / 1000 + 'kbps' : 'Unknown'}`,
            });
            i++;
          }
        }
      }
    }

    streams.sort((a, b) => b.bandwidth - a.bandwidth);
    return streams;
  }

  /**
   * 合成 URL
   */
  private applyURL(targetURL: string, baseURL: string): string {
    if (targetURL.indexOf('http') === 0) {
      // 如果目标 URL 包含 0.0.0.0，替换为当前浏览器的 host
      if (targetURL.includes('0.0.0.0')) {
        const currentOrigin = `${window.location.protocol}//${window.location.host}`;
        return targetURL.replace(/https?:\/\/0\.0\.0\.0:\d+/, currentOrigin);
      }
      return targetURL;
    } else if (targetURL[0] === '/') {
      const domain = baseURL.split('/');
      let origin = domain[0] + '//' + domain[2];
      // 如果 origin 包含 0.0.0.0，替换为当前浏览器的 host
      if (origin.includes('0.0.0.0')) {
        origin = `${window.location.protocol}//${window.location.host}`;
      }
      return origin + targetURL;
    } else {
      const domain = baseURL.split('/');
      domain.pop();
      let result = domain.join('/') + '/' + targetURL;
      // 如果结果包含 0.0.0.0，替换为当前浏览器的 host
      if (result.includes('0.0.0.0')) {
        const currentOrigin = `${window.location.protocol}//${window.location.host}`;
        result = result.replace(/https?:\/\/0\.0\.0\.0:\d+/, currentOrigin);
      }
      return result;
    }
  }

  /**
   * 解析 IV
   */
  private parseIV(ivString: string): Uint8Array {
    const hex = ivString.replace(/^0x/, '');
    return new Uint8Array(
      hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );
  }

  /**
   * 获取 AES 密钥
   */
  private async getAESKey(task: M3U8DownloadTask): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.responseType = 'arraybuffer';
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            task.aesConf.key = xhr.response;
            // 初始化 AES 解密器
            if (task.aesConf.key) {
              task.aesConf.decryption = new AESDecryptor();
              task.aesConf.decryption.expandKey(task.aesConf.key);
            }
            resolve();
          } else {
            reject(new Error('获取 AES 密钥失败'));
          }
        }
      };
      xhr.open('GET', task.aesConf.uri, true);
      xhr.send();
    });
  }

  /**
   * AES 解密
   */
  private aesDecrypt(
    task: M3U8DownloadTask,
    data: ArrayBuffer,
    index: number,
  ): ArrayBuffer {
    if (!task.aesConf.decryption || !task.aesConf.key) {
      return data;
    }

    // 使用 IV 或默认 IV
    let iv: Uint8Array;
    if (task.aesConf.iv) {
      iv = task.aesConf.iv;
    } else {
      // 如果没有指定 IV，使用片段索引作为 IV
      iv = new Uint8Array(16);
      for (let i = 12; i < 16; i++) {
        iv[i] = (index >> (8 * (15 - i))) & 0xff;
      }
    }

    try {
      const ivBuffer = new ArrayBuffer(iv.byteLength);
      new Uint8Array(ivBuffer).set(iv);
      return task.aesConf.decryption.decrypt(data, 0, ivBuffer, true);
    } catch (error) {
      console.error('AES 解密失败:', error);
      return data;
    }
  }

  /**
   * MP4 转码
   */
  private conversionMp4(
    task: M3U8DownloadTask,
    data: ArrayBuffer,
    index: number,
    callback: (data: ArrayBuffer) => void,
  ): void {
    if (task.type === 'MP4') {
      try {
        // @ts-ignore - mux.js 的 Transmuxer 在 mp4 子模块下
        const transMuxer = new muxjs.mp4.Transmuxer({
          keepOriginalTimestamps: true,
          duration: parseInt(task.durationSecond.toString()),
        });

        transMuxer.on('data', (segment: any) => {
          // 第一个片段需要包含初始化段
          if (index === 0) {
            const combinedData = new Uint8Array(
              segment.initSegment.byteLength + segment.data.byteLength,
            );
            combinedData.set(segment.initSegment, 0);
            combinedData.set(segment.data, segment.initSegment.byteLength);
            callback(combinedData.buffer);
          } else {
            callback(segment.data);
          }
        });

        transMuxer.push(new Uint8Array(data));
        transMuxer.flush();
      } catch (error) {
        console.error('MP4 转码失败:', error);
        // 转码失败，返回原始数据
        callback(data);
      }
    } else {
      // TS 格式直接返回
      callback(data);
    }
  }

  /**
   * 终止请求
   */
  private abortRequests(task: M3U8DownloadTask): void {
    task.requests.forEach((xhr) => {
      if (xhr.readyState !== 4) {
        xhr.abort();
      }
    });
    task.requests = [];
  }

  //禁止SzeMeng76抄袭狗抄袭
  /**
   * 保存分片到文件系统
   */
  private async saveSegmentToFilesystem(
    task: M3U8DownloadTask,
    data: ArrayBuffer,
    index: number,
  ): Promise<void> {
    if (!task.filesystemDirHandle) {
      throw new Error('未选择保存目录');
    }

    // 创建子目录结构：source/videoId/ep{episodeIndex+1}
    let targetDirHandle = task.filesystemDirHandle;

    if (task.source && task.videoId && task.episodeIndex !== undefined) {
      try {
        // 创建 source 目录
        const sourceDirHandle =
          await task.filesystemDirHandle.getDirectoryHandle(task.source, {
            create: true,
          });
        // 创建 videoId 目录
        const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(
          task.videoId,
          { create: true },
        );
        // 创建 ep{n} 目录
        const epDirHandle = await videoIdDirHandle.getDirectoryHandle(
          `ep${task.episodeIndex + 1}`,
          { create: true },
        );
        targetDirHandle = epDirHandle;
      } catch (error) {
        console.error('创建子目录失败:', error);
        throw error;
      }
    }

    const filename = `segment_${index.toString().padStart(5, '0')}.ts`;

    try {
      const fileHandle = await targetDirHandle.getFileHandle(filename, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    } catch (error) {
      console.error(`保存分片 ${filename} 失败:`, error);
      throw error;
    }
  }

  //禁止SzeMeng76抄袭狗抄袭
  /**
   * 生成本地 M3U8 播放列表
   */
  private async generateLocalPlaylist(task: M3U8DownloadTask): Promise<void> {
    if (!task.filesystemDirHandle || !task.m3u8Content) {
      console.error('无法生成播放列表：缺少目录句柄或 M3U8 内容');
      return;
    }

    // 获取目标目录句柄（如果有子目录结构）
    let targetDirHandle = task.filesystemDirHandle;

    if (task.source && task.videoId && task.episodeIndex !== undefined) {
      try {
        const sourceDirHandle =
          await task.filesystemDirHandle.getDirectoryHandle(task.source, {
            create: false,
          });
        const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(
          task.videoId,
          { create: false },
        );
        const epDirHandle = await videoIdDirHandle.getDirectoryHandle(
          `ep${task.episodeIndex + 1}`,
          { create: false },
        );
        targetDirHandle = epDirHandle;
      } catch (error) {
        console.error('获取子目录失败:', error);
        return;
      }
    }

    try {
      const lines = task.m3u8Content.split('\n');
      const modifiedLines: string[] = [];
      let segmentIndex = task.rangeDownload.startSegment;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // 替换加密密钥 URI
        if (trimmedLine.startsWith('#EXT-X-KEY:')) {
          if (task.aesConf.method && task.aesConf.method !== 'NONE') {
            // 如果有加密，保存密钥文件
            if (task.aesConf.key) {
              await this.saveKeyToFilesystem(
                task,
                task.aesConf.key,
                targetDirHandle,
              );
            }
            const modifiedLine = line.replace(/URI="[^"]+"/g, 'URI="key.key"');
            modifiedLines.push(modifiedLine);
          } else {
            modifiedLines.push(line);
          }
        }
        // 替换视频片段 URL
        else if (trimmedLine && !trimmedLine.startsWith('#')) {
          if (segmentIndex < task.rangeDownload.endSegment) {
            const indent = line.match(/^\s*/)?.[0] || '';
            const filename = `segment_${segmentIndex.toString().padStart(5, '0')}.ts`;
            modifiedLines.push(indent + filename);
            segmentIndex++;
          } else {
            modifiedLines.push(line);
          }
        }
        // 保持其他所有行不变
        else {
          modifiedLines.push(line);
        }
      }

      // 保存播放列表
      const playlistContent = modifiedLines.join('\n');
      const fileHandle = await targetDirHandle.getFileHandle('playlist.m3u8', {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(playlistContent);
      await writable.close();
    } catch (error) {
      console.error('生成播放列表失败:', error);
    }
  }

  //禁止SzeMeng76抄袭狗抄袭
  /**
   * 保存加密密钥到文件系统
   */
  private async saveKeyToFilesystem(
    task: M3U8DownloadTask,
    keyData: ArrayBuffer,
    targetDirHandle?: FileSystemDirectoryHandle,
  ): Promise<void> {
    const dirHandle = targetDirHandle || task.filesystemDirHandle;
    if (!dirHandle) {
      return;
    }

    try {
      const fileHandle = await dirHandle.getFileHandle('key.key', {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(keyData);
      await writable.close();
    } catch (error) {
      console.error('保存密钥失败:', error);
    }
  }
}
