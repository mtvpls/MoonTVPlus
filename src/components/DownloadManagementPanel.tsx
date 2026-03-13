'use client';

import { Check, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { CompletedTask, downloadDB } from '@/lib/download-db';

import { ConfirmDialog } from './ConfirmDialog';

interface DownloadManagementPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DownloadManagementPanel({
  isOpen,
  onClose,
}: DownloadManagementPanelProps) {
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadCompletedTasks();
    }
  }, [isOpen]);

  const loadCompletedTasks = async () => {
    try {
      const tasks = await downloadDB.getCompletedTasks();
      setCompletedTasks(tasks);
    } catch (error) {
      console.error('加载已完成任务失败:', error);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === completedTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(completedTasks.map((t) => t.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;

    setShowConfirmDialog(true);
  };

  const handleConfirmDelete = async () => {
    setShowConfirmDialog(false);
    setIsDeleting(true);
    try {
      // 获取要删除的任务
      const tasksToDelete = completedTasks.filter((t) => selectedIds.has(t.id));

      //禁止SzeMeng76抄袭狗抄袭
      // 删除文件系统中的文件
      for (const task of tasksToDelete) {
        if (task.downloadMode === 'filesystem') {
          try {
            // 从 IndexedDB 读取目录句柄
            const dbName = 'MoonTVPlus';
            const storeName = 'dirHandles';

            const dirHandle = await new Promise<
              FileSystemDirectoryHandle | undefined
            >((resolve) => {
              const request = indexedDB.open(dbName, 2); // 使用版本 2

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
            });

            if (dirHandle) {
              // 请求写权限
              const permission = await (dirHandle as any).requestPermission({
                mode: 'readwrite',
              });
              if (permission !== 'granted') {
                console.error('未获得写权限，无法删除文件');
                continue;
              }

              // 删除目录
              try {
                const sourceDirHandle = await dirHandle.getDirectoryHandle(
                  task.source,
                  { create: false },
                );
                const videoIdDirHandle =
                  await sourceDirHandle.getDirectoryHandle(task.videoId, {
                    create: false,
                  });
                await videoIdDirHandle.removeEntry(
                  `ep${task.episodeIndex + 1}`,
                  { recursive: true },
                );
                console.log(
                  '已删除文件:',
                  task.source,
                  task.videoId,
                  `ep${task.episodeIndex + 1}`,
                );
              } catch (deleteError) {
                console.error('删除目录失败:', deleteError);
                // 如果目录不存在，也算成功
                if ((deleteError as Error).name !== 'NotFoundError') {
                  throw deleteError;
                }
              }
            }
          } catch (error) {
            console.error('删除文件失败:', task.title, error);
          }
        }
      }

      // 从数据库删除记录
      await downloadDB.deleteCompletedTasks(Array.from(selectedIds));
      await loadCompletedTasks();
      setSelectedIds(new Set());
    } catch (error) {
      console.error('删除任务失败:', error);
      alert('删除失败，请重试');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '未知';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  if (!mounted || !isOpen) return null;

  return (
    <>
      {createPortal(
        <div className='fixed inset-0 z-[9999] flex items-center justify-center p-4'>
          <div className='absolute inset-0 bg-black/50' onClick={onClose} />
          <div className='relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col'>
            {/* Header */}
            <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
              <h2 className='text-xl font-semibold text-gray-800 dark:text-gray-200'>
                下载文件管理
              </h2>
              <button
                onClick={onClose}
                className='p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors'
              >
                <X className='w-5 h-5 text-gray-600 dark:text-gray-400' />
              </button>
            </div>

            {/* Toolbar */}
            <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
              <div className='flex items-center gap-4'>
                <label className='flex items-center gap-2 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={
                      selectedIds.size === completedTasks.length &&
                      completedTasks.length > 0
                    }
                    onChange={handleSelectAll}
                    className='w-4 h-4'
                  />
                  <span className='text-sm text-gray-700 dark:text-gray-300'>
                    全选
                  </span>
                </label>
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  已选择 {selectedIds.size} / {completedTasks.length}
                </span>
              </div>
              <button
                onClick={handleDelete}
                disabled={selectedIds.size === 0 || isDeleting}
                className='px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2'
              >
                <Trash2 className='w-4 h-4' />
                {isDeleting ? '删除中...' : '删除选中'}
              </button>
            </div>

            {/* Content */}
            <div className='flex-1 overflow-y-auto p-4'>
              {completedTasks.length === 0 ? (
                <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
                  暂无下载记录
                </div>
              ) : (
                <div className='space-y-2'>
                  {completedTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`p-4 border rounded-lg transition-colors cursor-pointer ${
                        selectedIds.has(task.id)
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                      onClick={() => handleToggleSelect(task.id)}
                    >
                      <div className='flex items-start gap-3'>
                        <div className='flex-shrink-0 mt-1'>
                          <div
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                              selectedIds.has(task.id)
                                ? 'border-green-500 bg-green-500'
                                : 'border-gray-300 dark:border-gray-600'
                            }`}
                          >
                            {selectedIds.has(task.id) && (
                              <Check className='w-3 h-3 text-white' />
                            )}
                          </div>
                        </div>
                        <div className='flex-1 min-w-0'>
                          <div className='flex items-start justify-between gap-2'>
                            <div className='flex-1 min-w-0'>
                              <h3 className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>
                                {task.title}
                              </h3>
                              {task.videoTitle && (
                                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                                  {task.videoTitle}
                                </p>
                              )}
                              {task.episodeTitle && (
                                <p className='text-xs text-gray-500 dark:text-gray-400'>
                                  {task.episodeTitle}
                                </p>
                              )}
                            </div>
                            <div className='flex-shrink-0 text-right'>
                              <div className='text-xs text-gray-500 dark:text-gray-400'>
                                {formatDate(task.completedAt)}
                              </div>
                              {task.fileSize && (
                                <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                                  {formatFileSize(task.fileSize)}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className='flex items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400'>
                            <span>来源: {task.source}</span>
                            <span>•</span>
                            <span>第 {task.episodeIndex + 1} 集</span>
                            <span>•</span>
                            <span>
                              {task.downloadMode === 'filesystem'
                                ? 'File System API'
                                : '浏览器下载'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        isOpen={showConfirmDialog}
        title='确认删除'
        message={`确定要删除选中的 ${selectedIds.size} 个下载记录吗？\n\n注意：如果是 File System API 下载的文件，将会从磁盘删除实际文件。`}
        confirmText='删除'
        cancelText='取消'
        variant='danger'
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowConfirmDialog(false)}
      />
    </>
  );
}
