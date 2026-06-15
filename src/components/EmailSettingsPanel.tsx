'use client';

import { Bell, Info, Mail, MonitorSmartphone, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface EmailSettingsPanelProps {
  isOpen: boolean;
  mounted: boolean;
  onClose: () => void;
  userEmail: string;
  onUserEmailChange: (value: string) => void;
  emailNotifications: boolean;
  onEmailNotificationsChange: (value: boolean) => void;
  pushNotifications: boolean;
  onPushNotificationsChange: (value: boolean) => void;
  pushNotificationsSupported: boolean;
  pushNotificationsConfigured: boolean;
  pushNotificationsBusy: boolean;
  emailSettingsLoading: boolean;
  emailSettingsSaving: boolean;
  onSave: () => void;
  statusMessage?: string;
  statusType?: 'success' | 'error' | null;
}

function Toggle({
  checked,
  disabled,
  busy,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-gray-900 ${
        checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
      }`}
    >
      <span
        className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      >
        {busy ? (
          <span className='h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent' />
        ) : null}
      </span>
    </button>
  );
}

export function EmailSettingsPanel({
  isOpen,
  mounted,
  onClose,
  userEmail,
  onUserEmailChange,
  emailNotifications,
  onEmailNotificationsChange,
  pushNotifications,
  onPushNotificationsChange,
  pushNotificationsSupported,
  pushNotificationsConfigured,
  pushNotificationsBusy,
  emailSettingsLoading,
  emailSettingsSaving,
  onSave,
  statusMessage,
  statusType,
}: EmailSettingsPanelProps) {
  if (!isOpen || !mounted) return null;

  const pushDisabled =
    emailSettingsSaving ||
    pushNotificationsBusy ||
    (!pushNotifications && (!pushNotificationsConfigured || !pushNotificationsSupported));

  return createPortal(
    <>
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        onTouchMove={(e) => e.preventDefault()}
        onWheel={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
      />

      <div className='fixed left-1/2 top-1/2 z-[1001] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-900'>
        <div
          className='max-h-[85vh] overflow-y-auto p-6'
          data-panel-content
          onTouchMove={(e) => e.stopPropagation()}
          style={{ touchAction: 'auto' }}
        >
          <div className='mb-6 flex items-start justify-between gap-4'>
            <div>
              <div className='mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'>
                <Bell className='h-5 w-5' />
              </div>
              <h3 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                通知设置
              </h3>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                管理邮件通知和当前设备浏览器系统通知。
              </p>
            </div>
            <button
              onClick={onClose}
              className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-gray-800'
              aria-label='关闭通知设置'
            >
              <X className='h-5 w-5' />
            </button>
          </div>

          {emailSettingsLoading ? (
            <div className='space-y-4' aria-live='polite'>
              <div className='animate-pulse rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800'>
                <div className='mb-3 h-5 w-28 rounded bg-gray-200 dark:bg-gray-700' />
                <div className='h-10 rounded bg-gray-200 dark:bg-gray-700' />
              </div>
              <div className='animate-pulse rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800'>
                <div className='mb-3 h-5 w-32 rounded bg-gray-200 dark:bg-gray-700' />
                <div className='h-16 rounded bg-gray-200 dark:bg-gray-700' />
              </div>
              <p className='text-center text-sm text-gray-500 dark:text-gray-400'>
                加载中...
              </p>
            </div>
          ) : (
            <div className='space-y-4'>
              <section className='rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800'>
                <div className='mb-4 flex items-start gap-3'>
                  <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300'>
                    <Mail className='h-5 w-5' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                      邮件通知
                    </h4>
                    <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      用于接收收藏影视更新等异步提醒，可独立于系统通知关闭。
                    </p>
                  </div>
                </div>

                <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                  邮箱地址
                </label>
                <input
                  type='email'
                  value={userEmail}
                  onChange={(e) => onUserEmailChange(e.target.value)}
                  placeholder='输入您的邮箱地址'
                  disabled={emailSettingsSaving}
                  className='mb-4 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-white'
                />

                <div className='flex items-center justify-between gap-4 rounded-xl bg-white p-3 dark:bg-gray-900/70'>
                  <div>
                    <h5 className='text-sm font-medium text-gray-800 dark:text-gray-200'>
                      收藏更新邮件
                    </h5>
                    <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      当收藏的影片有更新时发送邮件通知。
                    </p>
                  </div>
                  <Toggle
                    checked={emailNotifications}
                    disabled={emailSettingsSaving}
                    label='切换收藏更新邮件通知'
                    onChange={() => onEmailNotificationsChange(!emailNotifications)}
                  />
                </div>
              </section>

              <section className='rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800'>
                <div className='mb-4 flex items-start gap-3'>
                  <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300'>
                    <MonitorSmartphone className='h-5 w-5' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                      当前设备浏览器系统通知
                    </h4>
                    <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      当前设备收到站内通知时，通过浏览器推送到系统通知中心。
                    </p>
                  </div>
                  <Toggle
                    checked={pushNotifications}
                    disabled={pushDisabled}
                    busy={pushNotificationsBusy}
                    label='切换当前设备浏览器系统通知'
                    onChange={() => onPushNotificationsChange(!pushNotifications)}
                  />
                </div>

                <div className='space-y-2 rounded-xl bg-white p-3 dark:bg-gray-900/70'>
                  <div className='flex items-center justify-between gap-3 text-sm'>
                    <span className='text-gray-600 dark:text-gray-400'>当前设备</span>
                    <span className={`font-medium ${pushNotificationsSupported ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {pushNotificationsSupported ? '可用' : '需支持或授权'}
                    </span>
                  </div>
                  {!pushNotificationsConfigured && (
                    <p className='text-xs text-amber-600 dark:text-amber-400' role='alert'>
                      系统正在初始化 Web Push 密钥，请稍后重试。
                    </p>
                  )}
                  {pushNotificationsConfigured && !pushNotificationsSupported && (
                    <p className='text-xs text-amber-600 dark:text-amber-400' role='alert'>
                      当前浏览器、系统权限或登录模式暂不支持系统通知。
                    </p>
                  )}
                </div>
              </section>

              <button
                onClick={onSave}
                disabled={emailSettingsSaving}
                className='flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-400 dark:focus:ring-offset-gray-900 dark:disabled:bg-blue-500'
              >
                {emailSettingsSaving ? (
                  <>
                    <span className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
                    <span>保存中...</span>
                  </>
                ) : (
                  '保存通知设置'
                )}
              </button>

              {statusMessage ? (
                <p
                  role={statusType === 'error' ? 'alert' : 'status'}
                  className={`text-center text-xs ${
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

          <div className='mt-6 flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20'>
            <Info className='mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300' />
            <p className='text-xs leading-5 text-blue-800 dark:text-blue-200'>
              邮件通知需要管理员配置邮件服务；当前设备浏览器系统通知需要当前浏览器授权通知权限。
            </p>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
