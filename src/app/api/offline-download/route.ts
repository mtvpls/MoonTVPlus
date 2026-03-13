/**
 * 离线下载任务管理 API
 */

import * as fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  OfflineDownloader,
  OfflineDownloadTask,
} from '@/lib/offline-downloader';

// 检查是否启用离线下载功能
const OFFLINE_DOWNLOAD_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true';
const OFFLINE_DOWNLOAD_DIR = process.env.OFFLINE_DOWNLOAD_DIR || '/data';

// 全局下载器实例
let downloader: OfflineDownloader | null = null;

// 任务存储（内存中）
const tasks = new Map<string, OfflineDownloadTask>();

// 活跃的下载Promise
const activeDownloads = new Map<string, Promise<void>>();

// 任务持久化文件路径
const TASKS_FILE = path.join(OFFLINE_DOWNLOAD_DIR, 'tasks.json');

/**
 * 保存任务到文件
 */
function saveTasks(): void {
  try {
    const tasksArray = Array.from(tasks.values()).map((task) => ({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));

    // 确保目录存在
    const dir = path.dirname(TASKS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasksArray, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存任务失败:', error);
  }
}

/**
 * 从文件加载任务
 */
function loadTasks(): void {
  try {
    console.log('尝试加载任务文件:', TASKS_FILE);

    if (!fs.existsSync(TASKS_FILE)) {
      console.log('任务文件不存在:', TASKS_FILE);
      return;
    }

    const content = fs.readFileSync(TASKS_FILE, 'utf-8');
    const tasksArray = JSON.parse(content);
    console.log(`从文件读取到 ${tasksArray.length} 个任务`);

    for (const taskData of tasksArray) {
      const task: OfflineDownloadTask = {
        ...taskData,
        createdAt: new Date(taskData.createdAt),
        updatedAt: new Date(taskData.updatedAt),
      };

      // 如果任务在下载或等待中，说明服务器重启了，将状态改为暂停
      if (task.status === 'downloading' || task.status === 'pending') {
        task.status = 'paused';
        task.errorMessage = '服务器重启，任务已暂停';
      }

      tasks.set(task.id, task);
    }

    console.log(`已加载 ${tasks.size} 个离线下载任务到内存`);
  } catch (error) {
    console.error('加载任务失败:', error);
  }
}

function getDownloader(): OfflineDownloader {
  if (!downloader) {
    downloader = new OfflineDownloader(OFFLINE_DOWNLOAD_DIR);
    // 首次初始化时加载已保存的任务
    loadTasks();
  }
  return downloader;
}

/**
 * 检查用户权限（仅管理员和站长）
 */
function checkPermission(request: NextRequest): boolean {
  if (!OFFLINE_DOWNLOAD_ENABLED) {
    return false;
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return false;
  }

  // 只有管理员和站长可以使用
  return authInfo.role === 'owner' || authInfo.role === 'admin';
}

/**
 * GET - 获取任务列表或检查下载状态
 */
export async function GET(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  // 确保下载器已初始化（这会触发任务加载）
  getDownloader();

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // 检查视频是否已下载
  if (action === 'check') {
    const source = searchParams.get('source');
    const videoId = searchParams.get('videoId');
    const episodeIndex = searchParams.get('episodeIndex');

    if (!source || !videoId || episodeIndex === null) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const downloader = getDownloader();
    const downloaded = downloader.checkDownloaded(
      source,
      videoId,
      parseInt(episodeIndex),
    );

    return NextResponse.json({ downloaded });
  }

  // 获取所有任务列表
  const taskList = Array.from(tasks.values()).map((task) => ({
    ...task,
    // 转换 Date 对象为 ISO 字符串
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }));

  return NextResponse.json({ tasks: taskList });
}

/**
 * POST - 创建离线下载任务
 */
export async function POST(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { source, videoId, episodeIndex, title, m3u8Url, metadata } = body;

    if (
      !source ||
      !videoId ||
      episodeIndex === undefined ||
      !title ||
      !m3u8Url
    ) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const downloader = getDownloader();

    // 1. 首先检查是否已经有相同的任务（任何状态）
    const existingTask = Array.from(tasks.values()).find(
      (t) =>
        t.source === source &&
        t.videoId === videoId &&
        t.episodeIndex === episodeIndex,
    );

    if (existingTask) {
      // 如果任务正在下载或等待中，不允许重复创建
      if (
        existingTask.status === 'downloading' ||
        existingTask.status === 'pending'
      ) {
        return NextResponse.json(
          {
            task: {
              ...existingTask,
              createdAt: existingTask.createdAt.toISOString(),
              updatedAt: existingTask.updatedAt.toISOString(),
            },
            message: '该任务正在下载中，请勿重复添加',
          },
          { status: 400 },
        );
      }

      // 如果任务已完成，不允许重复创建
      if (existingTask.status === 'completed') {
        return NextResponse.json(
          {
            task: {
              ...existingTask,
              createdAt: existingTask.createdAt.toISOString(),
              updatedAt: existingTask.updatedAt.toISOString(),
            },
            message: '该视频已下载完成，如需重新下载请先删除任务',
          },
          { status: 400 },
        );
      }

      // 如果任务处于错误或暂停状态，提示用户使用重试功能
      if (existingTask.status === 'error' || existingTask.status === 'paused') {
        return NextResponse.json(
          {
            task: {
              ...existingTask,
              createdAt: existingTask.createdAt.toISOString(),
              updatedAt: existingTask.updatedAt.toISOString(),
            },
            message: '该任务已存在但未完成，请使用重试功能继续下载',
          },
          { status: 400 },
        );
      }
    }

    // 2. 检查文件系统中是否已下载完成（防止任务被删除但文件还在的情况）
    const downloaded = downloader.checkDownloaded(
      source,
      videoId,
      episodeIndex,
    );
    if (downloaded) {
      return NextResponse.json(
        {
          message: '该视频文件已存在，无需重复下载',
          downloaded: true,
        },
        { status: 400 },
      );
    }

    // 创建新任务
    const task = await downloader.createTask(
      source,
      videoId,
      episodeIndex,
      title,
      m3u8Url,
      metadata,
    );
    tasks.set(task.id, task);
    saveTasks(); // 持久化任务

    // 开始下载（异步）
    const downloadPromise = downloader
      .startDownload(task, (updatedTask) => {
        // 更新任务状态
        tasks.set(updatedTask.id, updatedTask);
        saveTasks(); // 持久化任务
      })
      .catch((error) => {
        console.error('下载失败:', error);
        task.status = 'error';
        task.errorMessage = error.message;
        tasks.set(task.id, task);
        saveTasks(); // 持久化任务
      })
      .finally(() => {
        // 下载完成后，从活跃下载列表中移除
        activeDownloads.delete(task.id);
      });

    activeDownloads.set(task.id, downloadPromise);

    return NextResponse.json({
      task: {
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      },
      message: '任务已创建',
    });
  } catch (error) {
    console.error('创建任务失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 500 },
    );
  }
}

/**
 * DELETE - 删除任务
 */
export async function DELETE(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    }

    const task = tasks.get(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    const downloader = getDownloader();

    // 如果任务正在下载，先标记为取消状态，等待下载停止
    const downloadPromise = activeDownloads.get(taskId);
    if (downloadPromise) {
      // 将任务状态设置为 error，这样下载器会停止下载
      task.status = 'error';
      task.errorMessage = '任务已被删除';
      tasks.set(taskId, task);

      // 从活跃下载列表中移除
      activeDownloads.delete(taskId);

      // 等待一小段时间，让下载操作有机会停止
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 删除文件
    await downloader.deleteTask(task);

    // 从任务列表中移除
    tasks.delete(taskId);
    saveTasks(); // 持久化任务

    return NextResponse.json({ message: '任务已删除' });
  } catch (error) {
    console.error('删除任务失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '删除任务失败' },
      { status: 500 },
    );
  }
}

/**
 * PUT - 重试任务
 */
export async function PUT(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');
    const action = searchParams.get('action');

    if (!taskId) {
      return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    }

    if (action !== 'retry') {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 });
    }

    const task = tasks.get(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 检查任务状态，只有错误、暂停或完成状态可以重试
    if (task.status === 'downloading' || task.status === 'pending') {
      return NextResponse.json(
        { error: '任务正在进行中，无法重试' },
        { status: 400 },
      );
    }

    // 检查是否已经在重试中
    if (activeDownloads.has(taskId)) {
      return NextResponse.json({ error: '任务已在重试中' }, { status: 400 });
    }

    const downloader = getDownloader();

    // 重置任务状态（保留已下载的进度，只重试失败的片段）
    task.status = 'pending';
    // 不重置 progress 和 downloadedSegments，让下载器自动跳过已下载的片段
    task.errorMessage = undefined;
    task.updatedAt = new Date();
    tasks.set(taskId, task);
    saveTasks(); // 持久化任务

    // 开始重新下载（异步）
    const downloadPromise = downloader
      .startDownload(task, (updatedTask) => {
        // 更新任务状态
        tasks.set(updatedTask.id, updatedTask);
        saveTasks(); // 持久化任务
      })
      .catch((error) => {
        console.error('重试下载失败:', error);
        task.status = 'error';
        task.errorMessage = error.message;
        tasks.set(task.id, task);
        saveTasks(); // 持久化任务
      })
      .finally(() => {
        // 下载完成后，从活跃下载列表中移除
        activeDownloads.delete(task.id);
      });

    activeDownloads.set(task.id, downloadPromise);

    return NextResponse.json({
      task: {
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      },
      message: '任务已重新开始',
    });
  } catch (error) {
    console.error('重试任务失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '重试任务失败' },
      { status: 500 },
    );
  }
}
