/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Download,
  FileCheck,
  Lock,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface DataMigrationProps {
  onRefreshConfig?: () => Promise<void>;
}

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'success' | 'error' | 'warning';
  title: string;
  message?: string;
  html?: string;
  confirmText?: string;
  onConfirm?: () => void;
  showConfirm?: boolean;
  timer?: number;
}

const AlertModal = ({
  isOpen,
  onClose,
  type,
  title,
  message,
  html,
  confirmText = '确定',
  onConfirm,
  showConfirm = false,
  timer,
}: AlertModalProps) => {
  const [isVisible, setIsVisible] = useState(false);

  // 控制动画状态
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      if (timer) {
        setTimeout(() => {
          onClose();
        }, timer);
      }
    } else {
      setIsVisible(false);
    }
  }, [isOpen, timer, onClose]);

  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className='w-12 h-12 text-green-500' />;
      case 'error':
        return <AlertCircle className='w-12 h-12 text-red-500' />;
      case 'warning':
        return <AlertTriangle className='w-12 h-12 text-yellow-500' />;
      default:
        return null;
    }
  };

  const getBgColor = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'error':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'warning':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
      default:
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border ${getBgColor()} transition-all duration-200 ${isVisible ? 'scale-100' : 'scale-95'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6 text-center'>
          <div className='flex justify-center mb-4'>{getIcon()}</div>

          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
            {title}
          </h3>

          {message && (
            <p className='text-gray-600 dark:text-gray-400 mb-4'>{message}</p>
          )}

          {html && (
            <div
              className='text-left text-gray-600 dark:text-gray-400 mb-4'
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          <div className='flex justify-center space-x-3'>
            {showConfirm && onConfirm ? (
              <>
                <button
                  onClick={onClose}
                  className='px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors'
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                  className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors'
                >
                  {confirmText}
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors'
              >
                确定
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const DataMigration = ({ onRefreshConfig }: DataMigrationProps) => {
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    phase: string;
    current: number;
    total: number;
    message: string;
  } | null>(null);
  const [importProgress, setImportProgress] = useState<{
    phase: string;
    current: number;
    total: number;
    message: string;
  } | null>(null);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message?: string;
    html?: string;
    confirmText?: string;
    onConfirm?: () => void;
    showConfirm?: boolean;
    timer?: number;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showAlert = (config: Omit<typeof alertModal, 'isOpen'>) => {
    setAlertModal({ ...config, isOpen: true });
  };

  const hideAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  // 导出数据
  const handleExport = async () => {
    if (!exportPassword.trim()) {
      showAlert({
        type: 'error',
        title: '错误',
        message: '请输入加密密码',
      });
      return;
    }

    let eventSource: EventSource | null = null;

    try {
      setIsExporting(true);
      setExportProgress(null);

      // 连接到进度 SSE 端点
      eventSource = new EventSource(
        '/api/admin/data_migration/progress?operation=export',
      );
      eventSource.onmessage = (event) => {
        try {
          const progress = JSON.parse(event.data);
          setExportProgress(progress);
        } catch (e) {
          console.error('Failed to parse progress:', e);
        }
      };

      const response = await fetch('/api/admin/data_migration/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: exportPassword,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `导出失败: ${response.status}`);
      }

      // 获取文件名
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || 'moontv-backup.dat';

      // 下载文件
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      a.style.position = 'fixed';
      a.style.top = '0';
      a.style.left = '0';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showAlert({
        type: 'success',
        title: '导出成功',
        message: '数据已成功导出，请妥善保管备份文件和密码',
        timer: 3000,
      });

      setExportPassword('');
    } catch (error) {
      showAlert({
        type: 'error',
        title: '导出失败',
        message: error instanceof Error ? error.message : '导出过程中发生错误',
      });
    } finally {
      setIsExporting(false);
      setExportProgress(null);
      if (eventSource) {
        eventSource.close();
      }
    }
  };

  // 文件选择处理
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // 导入数据
  const handleImport = async () => {
    if (!selectedFile) {
      showAlert({
        type: 'error',
        title: '错误',
        message: '请选择备份文件',
      });
      return;
    }

    if (!importPassword.trim()) {
      showAlert({
        type: 'error',
        title: '错误',
        message: '请输入解密密码',
      });
      return;
    }

    let eventSource: EventSource | null = null;

    try {
      setIsImporting(true);
      setImportProgress(null);

      // 连接到进度 SSE 端点
      eventSource = new EventSource(
        '/api/admin/data_migration/progress?operation=import',
      );
      eventSource.onmessage = (event) => {
        try {
          const progress = JSON.parse(event.data);
          setImportProgress(progress);
        } catch (e) {
          console.error('Failed to parse progress:', e);
        }
      };

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('password', importPassword);

      const response = await fetch('/api/admin/data_migration/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `导入失败: ${response.status}`);
      }

      showAlert({
        type: 'success',
        title: '导入成功',
        html: `
          <div class="text-left">
            <p><strong>导入完成！</strong></p>
            <p class="mt-2">导入的用户数量: ${result.importedUsers}</p>
            <p>备份时间: ${new Date(result.timestamp).toLocaleString('zh-CN')}</p>
            <p>服务器版本: ${result.serverVersion || '未知版本'}</p>
            <p class="mt-3 text-orange-600">请刷新页面以查看最新数据。</p>
          </div>
        `,
        confirmText: '刷新页面',
        showConfirm: true,
        onConfirm: async () => {
          // 清理状态
          setSelectedFile(null);
          setImportPassword('');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }

          // 刷新配置
          if (onRefreshConfig) {
            await onRefreshConfig();
          }

          // 刷新页面
          window.location.reload();
        },
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: '导入失败',
        message: error instanceof Error ? error.message : '导入过程中发生错误',
      });
    } finally {
      setIsImporting(false);
      setImportProgress(null);
      if (eventSource) {
        eventSource.close();
      }
    }
  };

  return (
    <>
      <div className='max-w-6xl mx-auto space-y-6'>
        {/* 简洁警告提示 */}
        <div className='flex items-center gap-3 p-4 border border-amber-200 dark:border-amber-700 rounded-lg bg-amber-50/30 dark:bg-amber-900/5'>
          <AlertTriangle className='w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0' />
          <p className='text-sm text-amber-800 dark:text-amber-200'>
            数据迁移操作请谨慎，确保已备份重要数据
          </p>
        </div>

        {/* 主要操作区域 - 响应式布局 */}
        <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
          {/* 数据导出 */}
          <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow flex flex-col'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center'>
                <Download className='w-4 h-4 text-blue-600 dark:text-blue-400' />
              </div>
              <div>
                <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
                  数据导出
                </h3>
                <p className='text-sm text-gray-600 dark:text-gray-400'>
                  创建加密备份文件
                </p>
              </div>
            </div>

            <div className='flex-1 flex flex-col'>
              <div className='space-y-4'>
                {/* 密码输入 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    <Lock className='w-4 h-4' />
                    加密密码
                  </label>
                  <input
                    type='password'
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    placeholder='设置强密码保护备份文件'
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                    disabled={isExporting}
                  />
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    导入时需要使用相同密码
                  </p>
                </div>

                {/* 备份内容列表 */}
                <div className='text-xs text-gray-600 dark:text-gray-400 space-y-1'>
                  <p className='font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    备份内容：
                  </p>
                  <div className='grid grid-cols-2 gap-1'>
                    <div>• 管理配置</div>
                    <div>• 用户数据</div>
                    <div>• 播放记录</div>
                    <div>• 收藏夹</div>
                  </div>
                </div>
              </div>

              {/* 导出按钮 */}
              <button
                onClick={handleExport}
                disabled={isExporting || !exportPassword.trim()}
                className={`w-full px-4 py-2.5 rounded-lg font-medium transition-colors mt-10 ${
                  isExporting || !exportPassword.trim()
                    ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed text-gray-500 dark:text-gray-400'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isExporting ? (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-center gap-2'>
                      <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                      导出中...
                    </div>
                    {exportProgress && (
                      <div className='bg-gray-100 dark:bg-gray-700 rounded-lg p-3 space-y-2'>
                        <div className='text-xs text-gray-900 dark:text-gray-100 font-medium'>
                          {exportProgress.message}
                        </div>
                        {exportProgress.total > 0 && (
                          <div className='w-full bg-gray-300 dark:bg-gray-600 rounded-full h-3'>
                            <div
                              className='bg-yellow-500 h-3 rounded-full transition-all duration-300'
                              style={{
                                width: `${(exportProgress.current / exportProgress.total) * 100}%`,
                              }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Download className='w-4 h-4' />
                    导出数据
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* 数据导入 */}
          <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow flex flex-col'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center'>
                <Upload className='w-4 h-4 text-red-600 dark:text-red-400' />
              </div>
              <div>
                <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
                  数据导入
                </h3>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  ⚠️ 将清空现有数据
                </p>
              </div>
            </div>

            <div className='flex-1 flex flex-col'>
              <div className='space-y-4'>
                {/* 文件选择 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    <FileCheck className='w-4 h-4' />
                    备份文件
                    {selectedFile && (
                      <span className='ml-auto text-xs text-green-600 dark:text-green-400 font-normal'>
                        {selectedFile.name} (
                        {(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                    )}
                  </label>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.dat'
                    onChange={handleFileSelect}
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-red-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-50 dark:file:bg-gray-600 file:text-gray-700 dark:file:text-gray-300 hover:file:bg-gray-100 dark:hover:file:bg-gray-500 transition-colors'
                    disabled={isImporting}
                  />
                </div>

                {/* 密码输入 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    <Lock className='w-4 h-4' />
                    解密密码
                  </label>
                  <input
                    type='password'
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder='输入导出时的加密密码'
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors'
                    disabled={isImporting}
                  />
                </div>
              </div>

              {/* 导入按钮 */}
              <button
                onClick={handleImport}
                disabled={
                  isImporting || !selectedFile || !importPassword.trim()
                }
                className={`w-full px-4 py-2.5 rounded-lg font-medium transition-colors mt-10 ${
                  isImporting || !selectedFile || !importPassword.trim()
                    ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed text-gray-500 dark:text-gray-400'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {isImporting ? (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-center gap-2'>
                      <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                      导入中...
                    </div>
                    {importProgress && (
                      <div className='bg-gray-100 dark:bg-gray-700 rounded-lg p-3 space-y-2'>
                        <div className='text-xs text-gray-900 dark:text-gray-100 font-medium'>
                          {importProgress.message}
                        </div>
                        {importProgress.total > 0 && (
                          <div className='w-full bg-gray-300 dark:bg-gray-600 rounded-full h-3'>
                            <div
                              className='bg-yellow-500 h-3 rounded-full transition-all duration-300'
                              style={{
                                width: `${(importProgress.current / importProgress.total) * 100}%`,
                              }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Upload className='w-4 h-4' />
                    导入数据
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        html={alertModal.html}
        confirmText={alertModal.confirmText}
        onConfirm={alertModal.onConfirm}
        showConfirm={alertModal.showConfirm}
        timer={alertModal.timer}
      />
    </>
  );
};

export default DataMigration;
