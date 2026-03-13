'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { downloadDB } from '@/lib/download-db';
import { M3U8Downloader, M3U8DownloadTask } from '@/lib/m3u8-downloader';

import Toast from '@/components/Toast';

interface DownloadContextType {
  downloader: M3U8Downloader;
  tasks: M3U8DownloadTask[];
  addDownloadTask: (
    url: string,
    title: string,
    type?: 'TS' | 'MP4',
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    },
  ) => Promise<void>;
  startTask: (taskId: string) => void;
  pauseTask: (taskId: string) => void;
  cancelTask: (taskId: string) => Promise<void>;
  retryFailedSegments: (taskId: string) => void;
  getProgress: (taskId: string) => number;
  downloadingCount: number;
  showDownloadPanel: boolean;
  setShowDownloadPanel: (show: boolean) => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(
  undefined,
);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<M3U8DownloadTask[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [startingTaskIds, setStartingTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  // 自动启动下一个等待的任务
  const startNextPendingTask = useCallback(
    (currentDownloader: M3U8Downloader) => {
      // 从localStorage读取最大同时下载限制，默认6个
      const maxConcurrentDownloads =
        typeof window !== 'undefined'
          ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
          : 6;

      const allTasks = currentDownloader.getAllTasks();
      const downloadingCount = allTasks.filter(
        (t) => t.status === 'downloading',
      ).length;

      // 如果当前下载数量小于限制，启动下一个ready任务
      if (downloadingCount < maxConcurrentDownloads) {
        const readyTask = allTasks.find((t) => t.status === 'ready');
        if (readyTask) {
          currentDownloader.startTask(readyTask.id);
          setTasks(currentDownloader.getAllTasks());
        }
      }
    },
    [],
  );

  const [downloader] = useState(
    () =>
      new M3U8Downloader({
        onProgress: (task) => {
          setTasks(downloader.getAllTasks());
          // 保存任务状态
          saveTasks(downloader.getAllTasks());
        },
        onComplete: async (task) => {
          setTasks(downloader.getAllTasks());

          //禁止SzeMeng76抄袭狗抄袭
          // 只有 filesystem 模式才保存到已完成任务表
          if (
            task.downloadMode === 'filesystem' &&
            task.source &&
            task.videoId &&
            task.episodeIndex !== undefined
          ) {
            try {
              // 计算文件大小
              let fileSize: number | undefined;
              if (task.filesystemDirHandle) {
                try {
                  const sourceDirHandle =
                    await task.filesystemDirHandle.getDirectoryHandle(
                      task.source,
                      { create: false },
                    );
                  const videoIdDirHandle =
                    await sourceDirHandle.getDirectoryHandle(task.videoId, {
                      create: false,
                    });
                  const epDirHandle = await videoIdDirHandle.getDirectoryHandle(
                    `ep${task.episodeIndex + 1}`,
                    { create: false },
                  );

                  let totalSize = 0;
                  for await (const entry of epDirHandle.values()) {
                    if (entry.kind === 'file') {
                      const fileHandle = entry as FileSystemFileHandle;
                      const file = await fileHandle.getFile();
                      totalSize += file.size;
                    }
                  }
                  fileSize = totalSize;
                } catch (error) {
                  console.error('计算文件大小失败:', error);
                }
              }

              await downloadDB.saveCompletedTask({
                id: task.id,
                title: task.title,
                source: task.source,
                videoId: task.videoId,
                episodeIndex: task.episodeIndex,
                completedAt: Date.now(),
                downloadMode: 'filesystem',
                fileSize,
              });
            } catch (error) {
              console.error('保存已完成任务失败:', error);
            }
          }

          // 保存任务状态
          saveTasks(downloader.getAllTasks());
          // 任务完成后，尝试启动下一个等待的任务
          startNextPendingTask(downloader);
        },
        onError: (task, error) => {
          console.error('下载错误:', error);
          setTasks(downloader.getAllTasks());
          // 保存任务状态
          saveTasks(downloader.getAllTasks());
          // 任务出错后，尝试启动下一个等待的任务
          startNextPendingTask(downloader);
        },
      }),
  );

  // 保存任务到 IndexedDB
  const saveTasks = useCallback(async (tasks: M3U8DownloadTask[]) => {
    if (typeof window === 'undefined') return;

    try {
      // 只保存必要的信息，不保存 ArrayBuffer 等无法序列化的数据
      // browser 模式的已完成任务不需要保存
      const tasksToSave = tasks
        .filter((task) => {
          // 过滤掉 browser 模式的已完成任务
          if (task.downloadMode === 'browser' && task.status === 'done') {
            return false;
          }
          return true;
        })
        .map((task) => ({
          id: task.id,
          url: task.url,
          title: task.title,
          type: task.type,
          status: task.status,
          finishList: task.finishList,
          downloadIndex: task.downloadIndex,
          finishNum: task.finishNum,
          errorNum: task.errorNum,
          source: task.source,
          videoId: task.videoId,
          episodeIndex: task.episodeIndex,
          downloadMode: task.downloadMode,
          rangeDownload: task.rangeDownload,
          m3u8Content: task.m3u8Content,
          createdAt: task.createdAt || Date.now(),
        }));

      await downloadDB.saveActiveTasks(tasksToSave);
    } catch (error) {
      console.error('保存任务失败:', error);
    }
  }, []);

  // 从 IndexedDB 恢复任务
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const restoreTasks = async () => {
      try {
        const savedTasks = await downloadDB.getActiveTasks();
        if (!savedTasks || savedTasks.length === 0) return;

        //禁止SzeMeng76抄袭狗抄袭
        // 读取下载模式和目录句柄
        const downloadMode =
          (localStorage.getItem('downloadMode') as 'browser' | 'filesystem') ||
          'browser';
        let dirHandle: FileSystemDirectoryHandle | undefined;

        if (downloadMode === 'filesystem') {
          const dbName = 'MoonTVPlus';
          const storeName = 'dirHandles';

          dirHandle = await new Promise<FileSystemDirectoryHandle | undefined>(
            (resolve) => {
              const request = indexedDB.open(dbName, 2);

              request.onsuccess = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (!db.objectStoreNames.contains(storeName)) {
                  db.close();
                  resolve(undefined);
                  return;
                }

                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const getRequest = store.get('downloadDir');

                getRequest.onsuccess = () => {
                  const handle = getRequest.result as
                    | FileSystemDirectoryHandle
                    | undefined;
                  db.close();
                  resolve(handle);
                };

                getRequest.onerror = () => {
                  db.close();
                  resolve(undefined);
                };
              };

              request.onerror = () => {
                resolve(undefined);
              };
            },
          );
        }

        // 收集需要删除的任务 ID
        const tasksToDelete: string[] = [];

        // 恢复任务
        for (const savedTask of savedTasks) {
          // browser 模式的任务标记为删除
          if (savedTask.downloadMode === 'browser') {
            tasksToDelete.push(savedTask.id);
            continue;
          }

          // 已完成的 filesystem 任务标记为删除
          if (
            savedTask.downloadMode === 'filesystem' &&
            savedTask.status === 'done'
          ) {
            tasksToDelete.push(savedTask.id);
            continue;
          }

          // 只恢复 filesystem 模式的未完成任务
          if (
            savedTask.downloadMode === 'filesystem' &&
            (savedTask.status === 'downloading' ||
              savedTask.status === 'pause' ||
              savedTask.status === 'ready')
          ) {
            try {
              const taskId = await downloader.createTask(
                savedTask.url,
                savedTask.title,
                savedTask.type,
                {
                  source: savedTask.source,
                  videoId: savedTask.videoId,
                  episodeIndex: savedTask.episodeIndex,
                },
              );

              const task = downloader.getTask(taskId);
              if (task) {
                // 恢复任务状态
                task.status =
                  savedTask.status === 'downloading'
                    ? 'pause'
                    : savedTask.status; // 将 downloading 改为 pause
                task.finishList = savedTask.finishList;
                task.downloadIndex = savedTask.downloadIndex;
                task.finishNum = savedTask.finishNum;
                task.errorNum = savedTask.errorNum;
                task.downloadMode = savedTask.downloadMode;
                task.rangeDownload = savedTask.rangeDownload;

                if (dirHandle) {
                  task.filesystemDirHandle = dirHandle;
                }
              }
            } catch (error) {
              console.error('恢复任务失败:', savedTask.title, error);
              // 恢复失败的任务也标记为删除
              tasksToDelete.push(savedTask.id);
            }
          } else {
            // 其他状态的任务标记为删除
            tasksToDelete.push(savedTask.id);
          }
        }

        // 批量删除无效任务
        if (tasksToDelete.length > 0) {
          console.log('清理无效任务:', tasksToDelete.length, '个');
          await downloadDB.deleteActiveTasks(tasksToDelete);
        }

        setTasks(downloader.getAllTasks());
      } catch (error) {
        console.error('恢复任务失败:', error);
      }
    };

    restoreTasks();
  }, [downloader]);

  const addDownloadTask = useCallback(
    async (
      url: string,
      title: string,
      type: 'TS' | 'MP4' = 'TS',
      metadata?: {
        source?: string;
        videoId?: string;
        episodeIndex?: number;
      },
    ) => {
      try {
        // 读取下载模式设置
        const downloadMode =
          typeof window !== 'undefined'
            ? (localStorage.getItem('downloadMode') as
                | 'browser'
                | 'filesystem') || 'browser'
            : 'browser';

        // 如果是 filesystem 模式，检查是否已经下载过
        if (
          downloadMode === 'filesystem' &&
          typeof window !== 'undefined' &&
          metadata?.source &&
          metadata?.videoId &&
          metadata?.episodeIndex !== undefined
        ) {
          try {
            const dbName = 'MoonTVPlus';
            const storeName = 'dirHandles';

            const alreadyDownloaded = await new Promise<boolean>((resolve) => {
              const request = indexedDB.open(dbName, 2);

              request.onsuccess = async (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (!db.objectStoreNames.contains(storeName)) {
                  db.close();
                  resolve(false);
                  return;
                }

                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const getRequest = store.get('downloadDir');

                getRequest.onsuccess = async () => {
                  const dirHandle = getRequest.result as
                    | FileSystemDirectoryHandle
                    | undefined;
                  db.close();

                  if (!dirHandle) {
                    resolve(false);
                    return;
                  }

                  try {
                    // 检查子目录和 playlist.m3u8 是否存在
                    const sourceDirHandle = await dirHandle.getDirectoryHandle(
                      metadata.source!,
                      { create: false },
                    );
                    const videoIdDirHandle =
                      await sourceDirHandle.getDirectoryHandle(
                        metadata.videoId!,
                        { create: false },
                      );
                    const epDirHandle =
                      await videoIdDirHandle.getDirectoryHandle(
                        `ep${metadata.episodeIndex! + 1}`,
                        { create: false },
                      );

                    // 只检查 playlist.m3u8 是否存在（它是最后生成的）
                    await epDirHandle.getFileHandle('playlist.m3u8', {
                      create: false,
                    });
                    resolve(true);
                  } catch {
                    // 目录或文件不存在
                    resolve(false);
                  }
                };

                getRequest.onerror = () => {
                  db.close();
                  resolve(false);
                };
              };

              request.onerror = () => {
                resolve(false);
              };
            });

            if (alreadyDownloaded) {
              console.log('视频已下载（文件系统检查），跳过:', title, metadata);
              setToast({
                message: `${title} 已经下载过了，无需重复下载`,
                type: 'info',
              });
              return;
            }
          } catch (error) {
            console.error('检查下载状态失败:', error);
          }
        }

        const taskId = await downloader.createTask(url, title, type, metadata);

        // 设置下载模式
        const task = downloader.getTask(taskId);
        if (task) {
          task.downloadMode = downloadMode;
        }

        //禁止SzeMeng76抄袭狗抄袭
        // 如果是 filesystem 模式，从 IndexedDB 读取目录句柄
        if (downloadMode === 'filesystem' && typeof window !== 'undefined') {
          try {
            const dbName = 'MoonTVPlus';
            const storeName = 'dirHandles';

            // 使用 Promise 包装 IndexedDB 操作，确保在启动任务前完成
            await new Promise<void>((resolve, reject) => {
              const request = indexedDB.open(dbName, 2);

              request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(storeName)) {
                  db.createObjectStore(storeName);
                }
              };

              request.onsuccess = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // 检查 object store 是否存在
                if (!db.objectStoreNames.contains(storeName)) {
                  console.warn('Object store 不存在，跳过读取');
                  db.close();
                  resolve();
                  return;
                }

                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const getRequest = store.get('downloadDir');

                getRequest.onsuccess = () => {
                  const dirHandle = getRequest.result as
                    | FileSystemDirectoryHandle
                    | undefined;
                  if (dirHandle) {
                    // 更新任务的目录句柄
                    const task = downloader.getTask(taskId);
                    if (task) {
                      task.filesystemDirHandle = dirHandle;
                      console.log(
                        '已设置 filesystem 目录句柄:',
                        dirHandle.name,
                      );
                    }
                  } else {
                    console.warn('未找到保存目录，使用浏览器下载模式');
                    // 如果没有目录句柄，回退到 browser 模式
                    const task = downloader.getTask(taskId);
                    if (task) {
                      task.downloadMode = 'browser';
                    }
                  }
                  db.close();
                  resolve();
                };

                getRequest.onerror = () => {
                  db.close();
                  reject(new Error('读取目录句柄失败'));
                };
              };

              request.onerror = () => {
                reject(new Error('打开 IndexedDB 失败'));
              };
            });
          } catch (error) {
            console.error('读取目录句柄失败:', error);
          }
        }

        setTasks(downloader.getAllTasks());

        // 从localStorage读取最大同时下载限制，默认6个
        const maxConcurrentDownloads =
          typeof window !== 'undefined'
            ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
            : 6;

        // 检查当前正在下载的任务数量（包括正在启动的）
        setStartingTaskIds((prev) => {
          const allTasks = downloader.getAllTasks();
          const currentDownloadingCount = allTasks.filter(
            (t) => t.status === 'downloading',
          ).length;
          const totalActiveCount = currentDownloadingCount + prev.size;

          // 如果未超过限制，标记为正在启动并启动任务
          if (totalActiveCount < maxConcurrentDownloads) {
            const newSet = new Set(prev);
            newSet.add(taskId);

            // 异步启动任务
            downloader.startTask(taskId).then(() => {
              setTasks(downloader.getAllTasks());
              // 启动完成后，从正在启动列表中移除
              setStartingTaskIds((current) => {
                const updated = new Set(current);
                updated.delete(taskId);
                return updated;
              });
            });

            return newSet;
          }

          // 否则任务保持ready状态，等待其他任务完成后自动启动
          return prev;
        });
      } catch (error) {
        console.error('添加下载任务失败:', error);
        throw error;
      }
    },
    [downloader],
  );

  const startTask = useCallback(
    (taskId: string) => {
      // 从localStorage读取最大同时下载限制，默认6个
      const maxConcurrentDownloads =
        typeof window !== 'undefined'
          ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
          : 6;

      const currentDownloadingCount = downloader
        .getAllTasks()
        .filter((t) => t.status === 'downloading').length;

      // 如果未超过限制，启动任务
      if (currentDownloadingCount < maxConcurrentDownloads) {
        downloader.startTask(taskId);
        setTasks(downloader.getAllTasks());
      }
    },
    [downloader],
  );

  const pauseTask = useCallback(
    (taskId: string) => {
      downloader.pauseTask(taskId);
      setTasks(downloader.getAllTasks());
      // 暂停任务后，尝试启动下一个等待的任务
      startNextPendingTask(downloader);
    },
    [downloader, startNextPendingTask],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      await downloader.cancelTask(taskId);
      setTasks(downloader.getAllTasks());
      // 保存任务状态到 IndexedDB（删除被取消的任务）
      saveTasks(downloader.getAllTasks());
      // 取消任务后，尝试启动下一个等待的任务
      startNextPendingTask(downloader);
    },
    [downloader, startNextPendingTask, saveTasks],
  );

  const retryFailedSegments = useCallback(
    (taskId: string) => {
      downloader.retryFailedSegments(taskId);
      setTasks(downloader.getAllTasks());
    },
    [downloader],
  );

  const getProgress = useCallback(
    (taskId: string) => {
      return downloader.getProgress(taskId);
    },
    [downloader],
  );

  const downloadingCount = tasks.filter(
    (t) => t.status === 'downloading',
  ).length;

  return (
    <DownloadContext.Provider
      value={{
        downloader,
        tasks,
        addDownloadTask,
        startTask,
        pauseTask,
        cancelTask,
        retryFailedSegments,
        getProgress,
        downloadingCount,
        showDownloadPanel,
        setShowDownloadPanel,
      }}
    >
      {children}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error('useDownload must be used within a DownloadProvider');
  }
  return context;
}
