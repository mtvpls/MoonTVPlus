'use client';

import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface EmailSettingsPanelProps {
  isOpen: boolean;
  mounted: boolean;
  onClose: () => void;
  userEmail: string;
  onUserEmailChange: (value: string) => void;
  emailNotifications: boolean;
  onEmailNotificationsChange: (value: boolean) => void;
  emailSettingsLoading: boolean;
  emailSettingsSaving: boolean;
  onSave: () => void;
  statusMessage?: string;
  statusType?: 'success' | 'error' | null;
}

export function EmailSettingsPanel({
  isOpen,
  mounted,
  onClose,
  userEmail,
  onUserEmailChange,
  emailNotifications,
  onEmailNotificationsChange,
  emailSettingsLoading,
  emailSettingsSaving,
  onSave,
  statusMessage,
  statusType,
}: EmailSettingsPanelProps) {
  if (!isOpen || !mounted) return null;

  return createPortal(
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
        onTouchMove={(e) => e.preventDefault()}
        onWheel={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
      />

      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'>
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => e.stopPropagation()}
          style={{ touchAction: 'auto' }}
        >
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              邮件通知设置
            </h3>
            <button
              onClick={onClose}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {emailSettingsLoading ? (
            <div className='space-y-4'>
              <div className='animate-pulse'>
                <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-2'></div>
                <div className='h-10 bg-gray-200 dark:bg-gray-700 rounded'></div>
              </div>
              <div className='animate-pulse'>
                <div className='h-20 bg-gray-200 dark:bg-gray-700 rounded'></div>
              </div>
              <div className='animate-pulse'>
                <div className='h-10 bg-gray-200 dark:bg-gray-700 rounded'></div>
              </div>
              <div className='text-center text-sm text-gray-500 dark:text-gray-400'>
                加载中...
              </div>
            </div>
          ) : (
            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  邮箱地址
                </label>
                <input
                  type='email'
                  value={userEmail}
                  onChange={(e) => onUserEmailChange(e.target.value)}
                  placeholder='输入您的邮箱地址'
                  disabled={emailSettingsSaving}
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
                />
              </div>

              <div className='flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    接收收藏更新通知
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    当收藏的影片有更新时发送邮件通知
                  </p>
                </div>
                <button
                  onClick={() => onEmailNotificationsChange(!emailNotifications)}
                  disabled={emailSettingsSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    emailNotifications ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      emailNotifications ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <button
                onClick={onSave}
                disabled={emailSettingsSaving}
                className='w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2'
              >
                {emailSettingsSaving ? (
                  <>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                    <span>保存中...</span>
                  </>
                ) : (
                  '保存设置'
                )}
              </button>

              {statusMessage ? (
                <p
                  className={`text-xs text-center ${
                    statusType === 'success'
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {statusMessage}
                </p>
              ) : null}
            </div>
          )}

          <div className='mt-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg'>
            <p className='text-xs text-blue-800 dark:text-blue-200'>
              💡 提示：需要管理员先在管理面板中配置邮件服务
            </p>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
