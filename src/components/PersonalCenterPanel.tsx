'use client';

import { KeyRound, Mail, Monitor, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface PersonalCenterPanelProps {
  isOpen: boolean;
  mounted: boolean;
  onClose: () => void;
  username: string;
  roleText: string;
  showRoleBadge: boolean;
  avatarText: string;
  roleBadgeClassName: string;
  showDeviceManagement: boolean;
  showChangePassword: boolean;
  onOpenEmailSettings: () => void;
  onOpenDeviceManagement: () => void;
  onOpenChangePassword: () => void;
}

export function PersonalCenterPanel({
  isOpen,
  mounted,
  onClose,
  username,
  roleText,
  showRoleBadge,
  avatarText,
  roleBadgeClassName,
  showDeviceManagement,
  showChangePassword,
  onOpenEmailSettings,
  onOpenDeviceManagement,
  onOpenChangePassword,
}: PersonalCenterPanelProps) {
  if (!isOpen || !mounted) return null;

  return createPortal(
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{ touchAction: 'none' }}
      />

      <div className='fixed top-1/2 left-1/2 z-[1001] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-900'>
        <div
          className='p-6'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{ touchAction: 'auto' }}
        >
          <div className='relative mb-6 flex flex-col items-center text-center'>
            <button
              onClick={onClose}
              className='absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
              aria-label='Close'
            >
              <X className='w-5 h-5' />
            </button>
            <div className='mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-blue-500 text-3xl font-semibold text-white shadow-md'>
              {avatarText}
            </div>
            {showRoleBadge && (
              <span
                className={`mb-2 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${roleBadgeClassName}`}
              >
                {roleText}
              </span>
            )}
            <h3 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
              {username}
            </h3>
          </div>

          <div className='space-y-3'>
            <button
              onClick={onOpenEmailSettings}
              className='flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750'
            >
              <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'>
                <Mail className='w-6 h-6' />
              </div>
              <div>
                <div className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                  邮件通知设置
                </div>
                <div className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                  管理接收收藏更新通知的邮箱和开关
                </div>
              </div>
            </button>

            {showDeviceManagement && (
              <button
                onClick={onOpenDeviceManagement}
                className='flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750'
              >
                <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'>
                  <Monitor className='w-6 h-6' />
                </div>
                <div>
                  <div className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                    设备管理
                  </div>
                  <div className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                    查看并管理当前账号的登录设备
                  </div>
                </div>
              </button>
            )}

            {showChangePassword && (
              <button
                onClick={onOpenChangePassword}
                className='flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750'
              >
                <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'>
                  <KeyRound className='w-6 h-6' />
                </div>
                <div>
                  <div className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                    修改密码
                  </div>
                  <div className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                    修改当前账号密码
                  </div>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
